//! Loading a model's web page (META-7, stage 2). Behind `NetworkSettings::fetch_model_pages`,
//! off by default and named in the privacy policy. One request per page, capped, never
//! automatic. The page is read for the metadata every big platform publishes anyway:
//! JSON-LD, OpenGraph, `<meta>` tags, Creative Commons links and the site's own profile
//! links. Everything comes back as a suggestion the user applies or not.

use crate::error::{EngineError, Result};
use crate::hints::{self, MODEL_HOSTS};
use serde::Serialize;
use std::io::Read;
use std::time::Duration;

/// What a page said about its model; empty fields were not found.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Parsed {
    pub title: Option<String>,
    pub creator: Option<String>,
    pub license: Option<String>,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub image: Option<String>,
    pub site: String,
}

/// A page's metadata shaped like an AI suggestion, so the same dialog shows both.
#[derive(Debug, Clone, Serialize)]
pub struct PageSuggestion {
    pub title: Option<String>,
    pub creator: Option<String>,
    pub license: Option<String>,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub new_tags: Vec<String>,
    pub url: String,
    pub site: String,
    pub cached: bool,
}

/// Outcome of warming the page cache for many projects.
#[derive(Debug, Clone, Serialize, Default)]
pub struct EnrichReport {
    pub fetched: u32,
    pub cached: u32,
    pub no_link: u32,
    pub failed: Vec<crate::engine::BatchFailure>,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct EnrichProgress {
    pub done: u32,
    pub total: u32,
}

// Next.js pages carry their data in a script near the end of the body (a Thangs model page
// is about 0.9 MB), so the cap has to leave room for it.
const MAX_BODY: u64 = 4 << 20;
const USER_AGENT: &str = concat!(
    "Mozilla/5.0 (compatible; Meshkeep/",
    env!("CARGO_PKG_VERSION"),
    "; +https://meshkeep.app)"
);

pub fn host_of(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let host = rest.split(['/', '?', '#']).next()?.trim_start_matches("www.").to_ascii_lowercase();
    (!host.is_empty()).then_some(host)
}

/// Only the platforms the hints know; anything else is refused before a request is made.
pub fn host_allowed(url: &str) -> bool {
    host_of(url).is_some_and(|h| MODEL_HOSTS.iter().any(|m| h == *m || h.ends_with(&format!(".{m}"))))
}

/// GETs the page (HTML only, at most 1 MiB, 15 s), following redirects within the allowed hosts.
pub fn fetch_html(url: &str) -> Result<String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(EngineError::PageFetch(format!("not a web link: {url}")));
    }
    if !host_allowed(url) {
        return Err(EngineError::PageFetch(format!(
            "{} is not a supported model site",
            host_of(url).unwrap_or_default()
        )));
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::custom(|a| {
            if a.previous().len() >= 5 {
                return a.error("too many redirects");
            }
            if host_allowed(a.url().as_str()) {
                a.follow()
            } else {
                a.error("redirect leaves the model site")
            }
        }))
        .build()
        .map_err(|e| EngineError::PageFetch(e.to_string()))?;
    let resp = client
        .get(url)
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Accept-Language", "en")
        .send()
        .map_err(|e| EngineError::PageFetch(e.to_string()))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(EngineError::PageFetch(format!("{url}: HTTP {status}")));
    }
    let mut body = Vec::new();
    resp.take(MAX_BODY)
        .read_to_end(&mut body)
        .map_err(|e| EngineError::PageFetch(e.to_string()))?;
    Ok(String::from_utf8_lossy(&body).into_owned())
}

/// Pure extraction, so it can be tested on saved pages.
pub fn parse(url: &str, html: &str) -> Parsed {
    let site = host_of(url).unwrap_or_default();
    let mut p = Parsed {
        site: site.clone(),
        ..Default::default()
    };
    // 1. JSON-LD: the most explicit source where present
    for block in script_blocks(html, "application/ld+json") {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&block) {
            walk_ld(&v, &mut p);
        }
    }
    // 1b. Next.js pages (Thangs, MakerWorld) embed their data as JSON
    if let Some(v) = next_data(html) {
        if site.ends_with("thangs.com") {
            thangs_from_next(&v, &mut p);
        } else if site.ends_with("makerworld.com") {
            makerworld_from_next(&v, &mut p);
        }
    }
    // 2. OpenGraph / meta tags
    let og = |prop: &str| meta(html, "property", prop).or_else(|| meta(html, "name", prop));
    if p.title.is_none() {
        p.title = og("og:title")
            .or_else(|| tag_text(html, "title"))
            .map(|t| strip_site_suffix(&t, &site));
    }
    if p.description.is_none() {
        p.description = og("og:description").or_else(|| meta(html, "name", "description"));
    }
    if p.image.is_none() {
        p.image = og("og:image");
    }
    if p.creator.is_none() {
        p.creator = meta(html, "name", "author").filter(|a| plausible(a));
    }
    if p.tags.is_empty() {
        if let Some(k) = meta(html, "name", "keywords") {
            p.tags = split_tags(&k);
        }
    }
    // 3. license: a Creative Commons link or wording anywhere in the page
    if p.license.is_none() {
        p.license = cc_link(html)
            .and_then(|l| hints::normalize_license(&l))
            .or_else(|| license_phrase(html));
    }
    // 4. site conventions
    if p.creator.is_none() {
        p.creator = site_creator(&site, html, p.title.as_deref());
    }
    if let Some(t) = p.title.as_deref() {
        // "Classic Crystal Dragon - 3D model by Cinderwing3D on Thangs"
        let t = t.strip_suffix(" on Thangs").unwrap_or(t).replace(" - 3D model by ", " by ");
        // "Baby Rose by Cinderwing3D" (Thingiverse, Thangs, MakerWorld titles) -> title + creator
        if let Some(i) = t.rfind(" by ") {
            let (name, who) = (t[..i].trim(), t[i + 4..].trim());
            if plausible(who) && !name.is_empty() {
                if p.creator.is_none() {
                    p.creator = Some(who.to_string());
                }
                p.title = Some(name.to_string());
            }
        } else if t != p.title.as_deref().unwrap_or("") {
            p.title = Some(t);
        }
    }
    p.title = p.title.map(|t| decode(t.trim())).filter(|t| !t.is_empty());
    p.description = p
        .description
        .map(|d| decode(d.trim()))
        .filter(|d| !d.is_empty())
        .map(|d| clip(&d, 1000));
    p.creator = p.creator.map(|c| decode(c.trim())).filter(|c| plausible(c));
    p.tags = p
        .tags
        .into_iter()
        .map(|t| decode(&t).trim().to_lowercase())
        .filter(|t| t.len() >= 2 && t.len() <= 40)
        .collect::<Vec<_>>();
    p.tags.dedup();
    p
}

fn walk_ld(v: &serde_json::Value, p: &mut Parsed) {
    match v {
        serde_json::Value::Array(items) => items.iter().for_each(|i| walk_ld(i, p)),
        serde_json::Value::Object(o) => {
            if let Some(g) = o.get("@graph") {
                walk_ld(g, p);
            }
            let ty = o.get("@type").and_then(|t| t.as_str()).unwrap_or("");
            let relevant = matches!(
                ty,
                "Product" | "CreativeWork" | "3DModel" | "ImageObject" | "WebPage" | "Article" | "Thing" | "VisualArtwork" | "Dataset"
            ) || o.contains_key("author");
            if !relevant {
                return;
            }
            if p.title.is_none() {
                p.title = o.get("name").and_then(|x| x.as_str()).map(String::from);
            }
            if p.description.is_none() {
                p.description = o.get("description").and_then(|x| x.as_str()).map(String::from);
            }
            if p.creator.is_none() {
                p.creator = ["author", "creator", "brand"].iter().find_map(|k| person_name(o.get(*k)?));
            }
            if p.license.is_none() {
                p.license = o.get("license").and_then(|l| l.as_str()).and_then(hints::normalize_license);
            }
            if p.tags.is_empty() {
                p.tags = match o.get("keywords") {
                    Some(serde_json::Value::String(s)) => split_tags(s),
                    Some(serde_json::Value::Array(a)) => a.iter().filter_map(|x| x.as_str()).map(String::from).collect(),
                    _ => Vec::new(),
                };
            }
            if p.image.is_none() {
                p.image = match o.get("image") {
                    Some(serde_json::Value::String(s)) => Some(s.clone()),
                    Some(serde_json::Value::Array(a)) => a.first().and_then(|x| {
                        x.as_str()
                            .map(String::from)
                            .or_else(|| x.get("url").and_then(|u| u.as_str()).map(String::from))
                    }),
                    Some(serde_json::Value::Object(m)) => m.get("url").and_then(|u| u.as_str()).map(String::from),
                    _ => None,
                };
            }
        }
        _ => {}
    }
}

/// `<script id="__NEXT_DATA__" type="application/json">…</script>`.
fn next_data(html: &str) -> Option<serde_json::Value> {
    let i = html.find("id=\"__NEXT_DATA__\"")?;
    let start = i + html[i..].find('>')? + 1;
    let end = start + html[start..].find("</script>")?;
    serde_json::from_str(html[start..end].trim()).ok()
}

fn str_at<'a>(v: &'a serde_json::Value, path: &[&str]) -> Option<&'a str> {
    let mut cur = v;
    for k in path {
        cur = cur.get(*k)?;
    }
    cur.as_str()
}

fn tags_of(v: Option<&serde_json::Value>) -> Vec<String> {
    match v {
        Some(serde_json::Value::Array(a)) => a
            .iter()
            .filter_map(|x| {
                x.as_str()
                    .map(String::from)
                    .or_else(|| x.get("name").and_then(|n| n.as_str()).map(String::from))
            })
            .collect(),
        Some(serde_json::Value::String(s)) => split_tags(s),
        _ => Vec::new(),
    }
}

/// Thangs: `props.pageProps.initialState.model.data` (verified on a live page). The license
/// field holds either a Creative Commons wording or the designer's own terms file; only the
/// former maps to a license id.
fn thangs_from_next(v: &serde_json::Value, p: &mut Parsed) {
    let Some(data) = v.pointer("/props/pageProps/initialState/model/data") else {
        return;
    };
    if p.title.is_none() {
        p.title = str_at(data, &["name"]).map(String::from);
    }
    if p.description.is_none() {
        p.description = str_at(data, &["description"]).map(String::from);
    }
    if p.creator.is_none() {
        p.creator = str_at(data, &["owner", "username"]).map(String::from);
    }
    if p.license.is_none() {
        p.license = str_at(data, &["license"]).and_then(hints::normalize_license);
    }
    if p.tags.is_empty() {
        p.tags = tags_of(data.get("tags"));
    }
    if p.image.is_none() {
        p.image = str_at(data, &["image"]).map(String::from);
    }
}

/// MakerWorld: the design object carries `designCreator`, `title`, `summary`, `license`
/// (bare codes such as "BY-NC-SA" or "Standard Digital File License") and `tags`. Its
/// position inside the Next.js data is not fixed, so the first object with a `designCreator`
/// is taken. Built from the documented structure; the live page could not be checked.
fn makerworld_from_next(v: &serde_json::Value, p: &mut Parsed) {
    fn find_design(v: &serde_json::Value) -> Option<&serde_json::Value> {
        match v {
            serde_json::Value::Object(o) => {
                if o.contains_key("designCreator") && (o.contains_key("title") || o.contains_key("name")) {
                    return Some(v);
                }
                o.values().find_map(find_design)
            }
            serde_json::Value::Array(a) => a.iter().find_map(find_design),
            _ => None,
        }
    }
    let Some(d) = find_design(v) else { return };
    if p.title.is_none() {
        p.title = str_at(d, &["title"]).or_else(|| str_at(d, &["name"])).map(String::from);
    }
    if p.description.is_none() {
        p.description = str_at(d, &["summary"]).or_else(|| str_at(d, &["description"])).map(String::from);
    }
    if p.creator.is_none() {
        p.creator = str_at(d, &["designCreator", "name"])
            .or_else(|| str_at(d, &["designCreator", "username"]))
            .map(String::from);
    }
    if p.license.is_none() {
        p.license = str_at(d, &["license"]).and_then(hints::normalize_license);
    }
    if p.tags.is_empty() {
        p.tags = tags_of(d.get("tags"));
    }
    if p.image.is_none() {
        p.image = str_at(d, &["cover"]).or_else(|| str_at(d, &["coverUrl"])).map(String::from);
    }
}

fn person_name(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Array(a) => a.iter().find_map(person_name),
        serde_json::Value::Object(o) => o.get("name").and_then(|n| n.as_str()).map(String::from),
        _ => None,
    }
}

fn site_creator(site: &str, html: &str, _title: Option<&str>) -> Option<String> {
    if site.ends_with("printables.com") {
        // profile links look like href="/@Cinderwing3D_1104478"
        for (i, _) in html.match_indices("href=\"/@") {
            let s = &html[i + 8..];
            let end = s.find(['"', '/', '?']).unwrap_or(s.len());
            if let Some(c) = hints::creator_from_url(&format!("https://www.printables.com/@{}", &s[..end])) {
                return Some(c);
            }
        }
    } else if site.ends_with("thingiverse.com") {
        for (i, _) in html.match_indices("thingiverse.com/") {
            let s = &html[i + 16..];
            let end = s.find(['"', '\'', ' ', '<']).unwrap_or(s.len());
            if let Some(c) = hints::creator_from_url(&format!("https://www.thingiverse.com/{}", &s[..end])) {
                return Some(c);
            }
        }
    } else if site.ends_with("makerworld.com")
        || site.ends_with("thangs.com")
        || site.ends_with("cults3d.com")
        || site.ends_with("myminifactory.com")
    {
        for (i, _) in html.match_indices("href=\"") {
            let s = &html[i + 6..];
            let end = s.find('"').unwrap_or(s.len());
            let href = &s[..end];
            let full = if href.starts_with("http") {
                href.to_string()
            } else {
                format!("https://{site}{href}")
            };
            if let Some(c) = hints::creator_from_url(&full) {
                return Some(c);
            }
        }
    }
    None
}

fn script_blocks(html: &str, ty: &str) -> Vec<String> {
    let mut out = Vec::new();
    let needle = format!("type=\"{ty}\"");
    for (i, _) in html.match_indices(&needle) {
        let Some(open) = html[i..].find('>') else { continue };
        let start = i + open + 1;
        let Some(close) = html[start..].find("</script>") else { continue };
        out.push(html[start..start + close].trim().to_string());
    }
    out
}

/// `<meta property="og:title" content="...">` in either attribute order.
fn meta(html: &str, attr: &str, key: &str) -> Option<String> {
    let needle = format!("{attr}=\"{key}\"");
    for (i, _) in html.match_indices(&needle) {
        let start = html[..i].rfind("<meta")?;
        let end = html[i..].find('>')? + i;
        let tag = &html[start..end];
        if let Some(c) = attr_value(tag, "content") {
            if !c.trim().is_empty() {
                return Some(decode(c.trim()));
            }
        }
    }
    None
}

fn attr_value<'a>(tag: &'a str, attr: &str) -> Option<&'a str> {
    let needle = format!("{attr}=\"");
    let i = tag.find(&needle)? + needle.len();
    let end = tag[i..].find('"')? + i;
    Some(&tag[i..end])
}

fn tag_text(html: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}");
    let i = html.find(&open)?;
    let s = i + html[i..].find('>')? + 1;
    let e = s + html[s..].find(&format!("</{tag}>"))?;
    Some(decode(html[s..e].trim()))
}

fn cc_link(html: &str) -> Option<String> {
    let i = html.find("creativecommons.org/")?;
    let s = &html[i + 20..];
    let end = s.find(['"', '\'', '<', ' ', ')']).unwrap_or(s.len());
    let mut parts = s[..end].trim_end_matches('/').split('/');
    match parts.next()? {
        // creativecommons.org/publicdomain/zero/1.0/
        "publicdomain" => Some("CC0".into()),
        // creativecommons.org/licenses/by-nc-sa/4.0/ -> "CC BY-NC-SA"
        "licenses" => Some(format!("CC {}", parts.next()?.to_ascii_uppercase())),
        _ => None,
    }
}

fn license_phrase(html: &str) -> Option<String> {
    let text = html.to_ascii_lowercase();
    for key in [
        "creative commons - attribution",
        "creative commons attribution",
        "cc by",
        "cc0",
        "public domain",
        "standard digital file license",
    ] {
        if let Some(i) = text.find(key) {
            let snippet = &html[i..(i + 80).min(html.len())];
            let snippet = snippet.split('<').next().unwrap_or(snippet);
            if let Some(l) = hints::normalize_license(snippet) {
                return Some(l);
            }
        }
    }
    None
}

fn strip_site_suffix(title: &str, site: &str) -> String {
    let mut t = title.trim().to_string();
    for sep in [" | ", " – ", " - ", " · "] {
        if let Some(i) = t.rfind(sep) {
            let tail = t[i + sep.len()..].to_ascii_lowercase();
            if tail.contains("printables")
                || tail.contains("thingiverse")
                || tail.contains("makerworld")
                || tail.contains("thangs")
                || tail.contains("cults")
                || tail.contains("myminifactory")
                || tail.contains(site.split('.').next().unwrap_or(""))
            {
                t.truncate(i);
            }
        }
    }
    t.trim().to_string()
}

fn split_tags(s: &str) -> Vec<String> {
    s.split([',', ';'])
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect()
}

fn plausible(c: &str) -> bool {
    let f = hints::fold(c);
    f.len() >= 2 && f.chars().any(|x| x.is_alphabetic()) && c.len() <= 80
}

fn decode(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ")
}

fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(max).collect::<String>().trim_end())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRINTABLES: &str = include_str!("../tests/fixtures/pages/printables.html");
    const THINGIVERSE: &str = include_str!("../tests/fixtures/pages/thingiverse.html");

    #[test]
    fn printables_page() {
        let p = parse("https://www.printables.com/model/1234567-baby-rose-dragon", PRINTABLES);
        assert_eq!(p.title.as_deref(), Some("Baby Rose Dragon"));
        assert_eq!(p.creator.as_deref(), Some("Cinderwing3D"));
        assert_eq!(p.license.as_deref(), Some("CC-BY-NC-SA-4.0"));
        assert_eq!(p.tags, vec!["dragon", "articulated", "print in place"]);
        assert!(p.description.as_deref().unwrap().starts_with("An articulated"));
        assert_eq!(
            p.image.as_deref(),
            Some("https://media.printables.com/media/prints/1234567/images/1.jpg")
        );
        assert_eq!(p.site, "printables.com");
    }

    #[test]
    fn thingiverse_page() {
        let p = parse("https://www.thingiverse.com/thing:5212158", THINGIVERSE);
        assert_eq!(p.title.as_deref(), Some("Gridfinity Storage Bins"));
        assert_eq!(p.creator.as_deref(), Some("zackfreedman"));
        assert_eq!(p.license.as_deref(), Some("CC-BY-4.0"));
        assert_eq!(p.tags, vec!["gridfinity", "storage", "organizer"]);
        assert_eq!(p.description.as_deref(), Some("Modular bins for the Gridfinity system."));
    }

    const THANGS: &str = include_str!("../tests/fixtures/pages/thangs.html");
    const MAKERWORLD: &str = include_str!("../tests/fixtures/pages/makerworld.html");

    #[test]
    fn thangs_page_from_next_data() {
        let p = parse(
            "https://thangs.com/designer/Cinderwing3D/3d-model/Classic%20Crystal%20Dragon-1561367",
            THANGS,
        );
        assert_eq!(p.title.as_deref(), Some("Classic Crystal Dragon"));
        assert_eq!(p.creator.as_deref(), Some("Cinderwing3D"));
        assert_eq!(p.license, None, "the designer's own terms file is not a license id");
        assert_eq!(
            p.tags[..3],
            ["articulated".to_string(), "print-in-place".to_string(), "flexi".to_string()]
        );
        assert!(p.description.as_deref().unwrap().starts_with("Hi, I'm Tracy!"));
        assert_eq!(p.site, "thangs.com");
    }

    #[test]
    fn makerworld_page_from_next_data() {
        let p = parse("https://makerworld.com/en/models/1052-gridfinity-bins", MAKERWORLD);
        assert_eq!(p.title.as_deref(), Some("Gridfinity Bins"));
        assert_eq!(p.creator.as_deref(), Some("Zack Freedman"));
        assert_eq!(p.license.as_deref(), Some("CC-BY-NC-SA-4.0"), "bare MakerWorld code");
        assert_eq!(p.tags, vec!["gridfinity", "storage"]);
        assert_eq!(p.description.as_deref(), Some("Bins for the Gridfinity system."));
        // a page without the Next.js data still yields title and creator from OpenGraph
        let og = r#"<html><head><meta property="og:title" content="Cute Thing by Someone | MakerWorld: Download Free 3D Models"><meta property="og:description" content="x"></head></html>"#;
        let p = parse("https://makerworld.com/en/models/2", og);
        assert_eq!(p.title.as_deref(), Some("Cute Thing"));
        assert_eq!(p.creator.as_deref(), Some("Someone"));
    }

    #[test]
    fn generic_page_and_guards() {
        let html = r#"<html><head><title>Cute Thing | MakerWorld</title><meta property="og:description" content="Some &amp; thing"><a href="/en/@Someone">x</a><link rel="license" href="https://creativecommons.org/publicdomain/zero/1.0/"></head></html>"#;
        let p = parse("https://makerworld.com/en/models/1", html);
        assert_eq!(p.title.as_deref(), Some("Cute Thing"));
        assert_eq!(p.description.as_deref(), Some("Some & thing"));
        assert_eq!(p.creator.as_deref(), Some("Someone"));
        assert_eq!(p.license.as_deref(), Some("CC0-1.0"));
        assert!(host_allowed("https://www.printables.com/model/1"));
        assert!(host_allowed("https://thangs.com/designer/x"));
        assert!(!host_allowed("https://example.com/model/1"));
        assert!(!host_allowed("https://printables.com.evil.net/"));
        assert!(matches!(fetch_html("https://example.com/x"), Err(EngineError::PageFetch(_))));
        assert!(matches!(fetch_html("file:///etc/passwd"), Err(EngineError::PageFetch(_))));
    }
}
