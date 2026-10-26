//! Local metadata hints (META-7, stage 1): creator, license and source link guessed from
//! what a project folder already carries. Nothing here writes anything; the UI shows the
//! hints and the user applies or dismisses them.
//!
//! Sources, from most to least reliable: metadata inside 3MF files (slicers store the
//! designer, license and link the model page gave them), download shortcuts and readme
//! files next to the models, the model page URL itself, a prefix shared by the model file
//! names, and the folder name ("Creator - Model", "Model by Creator").

use crate::model::{FileEntry, FileKind};
use crate::threemf;
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HintSource {
    ThreeMf,
    Shortcut,
    Readme,
    SourceUrl,
    FileNames,
    FolderName,
    /// A file-name prefix that many projects of the library share (`library_prefixes`).
    Library,
    /// A creator the library already knows heads the file name ("Cinderwing3D Baby Rose").
    KnownCreator,
}

#[derive(Debug, Clone, Serialize)]
pub struct Hint {
    pub value: String,
    pub source: HintSource,
    /// 0..=100, how sure the heuristic is; the UI shows the best one first.
    pub confidence: u8,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Hints {
    pub creator: Vec<Hint>,
    pub license: Vec<Hint>,
    pub source_url: Vec<Hint>,
}

const MAX_TEXT: u64 = 64 << 10;
/// Words that are common first words of file names but never a creator.
const GENERIC: &[&str] = &[
    "model", "models", "part", "parts", "file", "files", "print", "stl", "new", "my", "the", "body", "base", "top", "bottom", "left",
    "right", "front", "back", "final", "test", "version", "v1", "v2", "v3", "copy", "untitled", "object", "mesh", "plate", "export",
];

/// Hints for one project folder. `known_creators` are the creators already in the library,
/// used to settle spelling (a hint that matches one is reported in that spelling).
pub fn detect(dir: &Path, files: &[FileEntry], known_creators: &[String]) -> Hints {
    let mut h = Hints::default();
    for f in files {
        let path = dir.join(&f.rel_path);
        match f.kind {
            FileKind::Model if f.name.to_ascii_lowercase().ends_with(".3mf") => {
                for (key, value) in threemf_metadata(&path) {
                    match key.to_ascii_lowercase().as_str() {
                        "designer" | "creator" | "author" => push(&mut h.creator, value, HintSource::ThreeMf, 90),
                        "license" | "licenseterms" | "creativecommonslicense" | "licence" => {
                            if let Some(l) = normalize_license(&value) {
                                push(&mut h.license, l, HintSource::ThreeMf, 85);
                            }
                        }
                        "origin" | "source" | "url" | "modelurl" | "link" => {
                            if let Some(u) = first_model_url(&value) {
                                push(&mut h.source_url, u, HintSource::ThreeMf, 85);
                            }
                        }
                        _ => {}
                    }
                }
            }
            FileKind::Document | FileKind::Other => {
                let lower = f.name.to_ascii_lowercase();
                let is_shortcut = lower.ends_with(".url") || lower.ends_with(".webloc");
                let is_text = lower.ends_with(".txt")
                    || lower.ends_with(".md")
                    || lower.ends_with(".nfo")
                    || lower.ends_with(".html")
                    || lower.ends_with(".htm");
                if !(is_shortcut || is_text) {
                    continue;
                }
                let Some(text) = read_text(&path) else { continue };
                let source = if is_shortcut { HintSource::Shortcut } else { HintSource::Readme };
                for url in model_urls(&text) {
                    push(&mut h.source_url, url, source, if is_shortcut { 90 } else { 75 });
                }
                if !is_shortcut {
                    for c in readme_creators(&text) {
                        push(&mut h.creator, c, HintSource::Readme, 70);
                    }
                    if let Some(l) = normalize_license(&text) {
                        push(&mut h.license, l, HintSource::Readme, 65);
                    }
                }
            }
            _ => {}
        }
    }
    // the model page link often names the creator in its path
    let from_urls: Vec<String> = h.source_url.iter().filter_map(|u| creator_from_url(&u.value)).collect();
    for c in from_urls {
        push(&mut h.creator, c, HintSource::SourceUrl, 80);
    }
    let stems: Vec<String> = files.iter().filter(|f| f.kind == FileKind::Model).map(|f| stem(&f.name)).collect();
    if let Some(p) = shared_prefix(&stems) {
        push(&mut h.creator, p, HintSource::FileNames, 55);
    }
    if let Some(name) = dir.file_name().and_then(|n| n.to_str()) {
        for (c, conf) in folder_creators(name) {
            push(&mut h.creator, c, HintSource::FolderName, conf);
        }
    }
    for k in known_creators {
        let fk = fold(k);
        if fk.len() >= 3
            && stems.iter().any(|s| {
                let fs = fold(s);
                fs.len() > fk.len() && fs.starts_with(&fk)
            })
        {
            push(&mut h.creator, k.clone(), HintSource::KnownCreator, 62);
        }
    }
    settle(&mut h.creator, known_creators);
    h.license.sort_by_key(|x| std::cmp::Reverse(x.confidence));
    h.source_url.sort_by_key(|x| std::cmp::Reverse(x.confidence));
    h
}

/// Word-boundary prefixes of model-file stems that recur across many projects of a library
/// ("Cinderwing3D Baby Rose", "Cinderwing3D Cinder Snake", ...). Returns, per project id,
/// the shortest prefix at least `min_support` projects share, with its support.
pub fn library_prefixes(stems_per_project: &[(String, Vec<String>)], min_support: usize) -> BTreeMap<String, (String, usize)> {
    let mut support: BTreeMap<String, std::collections::BTreeSet<usize>> = BTreeMap::new();
    for (i, (_, stems)) in stems_per_project.iter().enumerate() {
        for s in stems {
            let words: Vec<&str> = s.split_whitespace().collect();
            // a prefix must leave something behind, else it is the file's own name
            for k in 1..words.len().min(4) {
                let p = words[..k].join(" ");
                if plausible_creator(&p) {
                    support.entry(p).or_default().insert(i);
                }
            }
        }
    }
    let mut out = BTreeMap::new();
    for (id, stems) in stems_per_project {
        let mut best: Option<(String, usize)> = None;
        for s in stems {
            let words: Vec<&str> = s.split_whitespace().collect();
            for k in 1..words.len().min(4) {
                let p = words[..k].join(" ");
                let n = support.get(&p).map(|s| s.len()).unwrap_or(0);
                if n >= min_support && best.as_ref().map_or(true, |(bp, _)| p.len() < bp.len()) {
                    best = Some((p.clone(), n));
                }
            }
        }
        if let Some(b) = best {
            out.insert(id.clone(), b);
        }
    }
    out
}

fn push(list: &mut Vec<Hint>, value: String, source: HintSource, confidence: u8) {
    let value = value.trim().trim_matches(|c: char| c == '"' || c == '\'').trim().to_string();
    if value.is_empty() || value.len() > 120 {
        return;
    }
    if let Some(existing) = list.iter_mut().find(|h| fold(&h.value) == fold(&value)) {
        if confidence > existing.confidence {
            existing.confidence = confidence;
            existing.source = source;
        } else {
            // two sources agreeing is worth a little extra
            existing.confidence = existing.confidence.saturating_add(5).min(99);
        }
        return;
    }
    list.push(Hint { value, source, confidence });
}

/// Aligns hints with creators the library already has and orders them best first.
fn settle(list: &mut [Hint], known: &[String]) {
    for h in list.iter_mut() {
        if let Some(k) = known.iter().find(|k| fold(k) == fold(&h.value)) {
            h.value = k.clone();
            h.confidence = h.confidence.saturating_add(10).min(99);
        }
    }
    list.sort_by(|a, b| b.confidence.cmp(&a.confidence).then(a.value.cmp(&b.value)));
}

/// Case- and punctuation-insensitive key ("Cinderwing3D" == "cinderwing 3d").
pub fn fold(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect()
}

fn stem(name: &str) -> String {
    let base = name.rsplit_once('.').map(|(b, _)| b).unwrap_or(name);
    base.replace(['_', '-', '.'], " ").split_whitespace().collect::<Vec<_>>().join(" ")
}

fn plausible_creator(p: &str) -> bool {
    let f = fold(p);
    f.len() >= 3
        && f.chars().any(|c| c.is_alphabetic())
        && !p.split_whitespace().all(|w| GENERIC.contains(&w.to_ascii_lowercase().as_str()))
}

/// Word-boundary prefix shared by at least two differently named model files of one project,
/// when it leaves something behind in every file ("Cinderwing3D Baby Rose" + "Cinderwing3D
/// stand"). Capped at two words: "Cinderwing3D Baby Rose" + "Cinderwing3D Baby Snake" would
/// otherwise yield "Cinderwing3D Baby"; the library-wide pass settles such cases.
fn shared_prefix(stems: &[String]) -> Option<String> {
    if stems.len() < 2 || stems.iter().all(|s| s.eq_ignore_ascii_case(&stems[0])) {
        return None;
    }
    let first: Vec<&str> = stems[0].split_whitespace().collect();
    let mut best: Option<String> = None;
    for k in 1..first.len().min(3) {
        let p = first[..k].join(" ");
        let all = stems.iter().all(|s| {
            let w: Vec<&str> = s.split_whitespace().collect();
            w.len() > k && w[..k].iter().zip(&first[..k]).all(|(a, b)| a.eq_ignore_ascii_case(b))
        });
        if all && plausible_creator(&p) {
            best = Some(p);
        } else if !all {
            break;
        }
    }
    best
}

fn folder_creators(name: &str) -> Vec<(String, u8)> {
    let mut out = Vec::new();
    if let Some((a, _)) = name.split_once(" - ") {
        if plausible_creator(a) {
            out.push((a.trim().to_string(), 45));
        }
    }
    let lower = name.to_ascii_lowercase();
    if let Some(i) = lower.rfind(" by ") {
        let c = name[i + 4..].trim().trim_end_matches(')').trim();
        if plausible_creator(c) {
            out.push((c.to_string(), 55));
        }
    }
    out
}

fn read_text(path: &Path) -> Option<String> {
    let f = std::fs::File::open(path).ok()?;
    let mut buf = Vec::new();
    f.take(MAX_TEXT).read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// `<metadata name="X">Y</metadata>` pairs from the head of the model XML.
pub fn threemf_metadata(path: &Path) -> Vec<(String, String)> {
    let Ok(head) = threemf::read_entry_head(path, "3D/3dmodel.model", MAX_TEXT as usize) else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&head);
    let mut out = Vec::new();
    let mut rest = text.as_ref();
    while let Some(i) = rest.find("<metadata") {
        rest = &rest[i..];
        let Some(end) = rest.find("</metadata>") else { break };
        let tag = &rest[..end];
        if let Some(n) = tag.find("name=\"") {
            let after = &tag[n + 6..];
            if let (Some(q), Some(gt)) = (after.find('"'), tag.find('>')) {
                let name = &after[..q];
                let value = &tag[gt + 1..];
                out.push((name.to_string(), unescape(value.trim())));
            }
        }
        rest = &rest[end + 11..];
    }
    out
}

fn unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

const MODEL_HOSTS: &[&str] = &[
    "printables.com",
    "thingiverse.com",
    "makerworld.com",
    "thangs.com",
    "cults3d.com",
    "myminifactory.com",
    "cgtrader.com",
];

fn model_urls(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for (i, _) in text.match_indices("http") {
        let s = &text[i..];
        let end = s
            .find(|c: char| c.is_whitespace() || c == '"' || c == '\'' || c == '<' || c == '>' || c == ')' || c == ']')
            .unwrap_or(s.len());
        let url = s[..end].trim_end_matches(['.', ',', ';']);
        if MODEL_HOSTS.iter().any(|h| url.contains(h)) && !out.contains(&url.to_string()) {
            out.push(url.to_string());
        }
    }
    out
}

fn first_model_url(text: &str) -> Option<String> {
    model_urls(text).into_iter().next()
}

/// The creator a model-page URL names in its path, per site convention.
pub fn creator_from_url(url: &str) -> Option<String> {
    let no_scheme = url.split("://").nth(1).unwrap_or(url);
    let (host, path) = no_scheme.split_once('/').unwrap_or((no_scheme, ""));
    let host = host.trim_start_matches("www.");
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let clean = |s: &str| s.split(['?', '#']).next().unwrap_or(s).to_string();
    let name = if host.ends_with("printables.com") {
        segs.iter().find(|s| s.starts_with('@')).map(|s| strip_id(&s[1..]))
    } else if host.ends_with("makerworld.com") {
        segs.iter().find(|s| s.starts_with('@')).map(|s| s[1..].to_string())
    } else if host.ends_with("thingiverse.com") {
        match segs.as_slice() {
            [user, rest, ..] if *rest == "designs" || *rest == "collections" || *rest == "about" => Some(user.to_string()),
            _ => None,
        }
    } else if host.ends_with("thangs.com") {
        segs.windows(2).find(|w| w[0] == "designer").map(|w| w[1].to_string())
    } else if host.ends_with("cults3d.com") || host.ends_with("myminifactory.com") {
        segs.windows(2).find(|w| w[0] == "users").map(|w| w[1].to_string())
    } else {
        None
    };
    name.map(|n| clean(&n)).filter(|n| plausible_creator(n))
}

/// Printables appends a numeric id: `@Cinderwing3D_123456` -> `Cinderwing3D`.
fn strip_id(s: &str) -> String {
    match s.rsplit_once('_') {
        Some((name, id)) if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) => name.to_string(),
        _ => s.to_string(),
    }
}

fn readme_creators(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines().take(200) {
        let l = line.trim().trim_start_matches(['#', '*', '-', ' ']);
        let lower = l.to_ascii_lowercase();
        for key in ["designer:", "designed by", "author:", "creator:", "created by", "made by", "by "] {
            if let Some(i) = lower.find(key) {
                if key == "by " && i != 0 {
                    continue;
                }
                let v = l[i + key.len()..].trim().trim_start_matches(':').trim();
                let v: String = v.split(['(', ',', '|', '·']).next().unwrap_or(v).trim().to_string();
                if plausible_creator(&v) && v.split_whitespace().count() <= 4 {
                    out.push(v);
                }
                break;
            }
        }
    }
    out
}

/// Maps license wording to the identifiers the app uses.
pub fn normalize_license(text: &str) -> Option<String> {
    let f = fold(text);
    let has = |s: &str| f.contains(&fold(s));
    if has("CC0") || has("public domain") {
        return Some("CC0-1.0".into());
    }
    if has("CC BY") || has("creative commons") || has("CC-BY") {
        let nc = has("NC") || has("noncommercial") || has("non commercial");
        let sa = has("SA") || has("sharealike") || has("share alike");
        let nd = has("ND") || has("noderivatives") || has("no derivatives");
        if nd {
            return None; // not in the app's list; leave it to the user
        }
        return Some(
            match (nc, sa) {
                (true, true) => "CC-BY-NC-SA-4.0",
                (true, false) => "CC-BY-NC-4.0",
                (false, true) => "CC-BY-SA-4.0",
                (false, false) => "CC-BY-4.0",
            }
            .into(),
        );
    }
    if has("MIT license") || f == "mit" {
        return Some("MIT".into());
    }
    if has("GPL") || has("General Public License") {
        return Some("GPL-3.0".into());
    }
    if has("personal use") || has("standard digital file license") {
        return Some("Personal use".into());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::FileKind;
    use time::OffsetDateTime;

    fn entry(name: &str, kind: FileKind) -> FileEntry {
        FileEntry {
            rel_path: name.into(),
            name: name.into(),
            kind,
            size: 1,
            modified: OffsetDateTime::UNIX_EPOCH,
            slicer: None,
            embedded_thumbnail: false,
        }
    }

    #[test]
    fn urls_name_the_creator() {
        assert_eq!(
            creator_from_url("https://www.printables.com/@Cinderwing3D_1104478/models").as_deref(),
            Some("Cinderwing3D")
        );
        assert_eq!(creator_from_url("https://www.printables.com/model/123-baby-rose").as_deref(), None);
        assert_eq!(
            creator_from_url("https://makerworld.com/en/@Cinderwing3D?x=1").as_deref(),
            Some("Cinderwing3D")
        );
        assert_eq!(
            creator_from_url("https://www.thingiverse.com/zachfreedman/designs").as_deref(),
            Some("zachfreedman")
        );
        assert_eq!(creator_from_url("https://www.thingiverse.com/thing:5212158").as_deref(), None);
        assert_eq!(
            creator_from_url("https://thangs.com/designer/Cinderwing3D/3d-model/x").as_deref(),
            Some("Cinderwing3D")
        );
        assert_eq!(
            creator_from_url("https://cults3d.com/en/users/Cinderwing3D/3d-models").as_deref(),
            Some("Cinderwing3D")
        );
    }

    #[test]
    fn licenses_normalize() {
        assert_eq!(
            normalize_license("Creative Commons - Attribution - Non-Commercial - Share Alike").as_deref(),
            Some("CC-BY-NC-SA-4.0")
        );
        assert_eq!(normalize_license("CC BY 4.0").as_deref(), Some("CC-BY-4.0"));
        assert_eq!(normalize_license("cc-by-nc").as_deref(), Some("CC-BY-NC-4.0"));
        assert_eq!(normalize_license("CC BY-ND").as_deref(), None);
        assert_eq!(normalize_license("Public Domain (CC0)").as_deref(), Some("CC0-1.0"));
        assert_eq!(normalize_license("Standard Digital File License").as_deref(), Some("Personal use"));
        assert_eq!(normalize_license("whatever").as_deref(), None);
    }

    #[test]
    fn prefixes_folders_and_readmes() {
        assert_eq!(
            shared_prefix(&["Cinderwing3D Baby Rose".into(), "Cinderwing3D stand".into()]).as_deref(),
            Some("Cinderwing3D")
        );
        assert_eq!(
            shared_prefix(&["Cinderwing3D Baby Rose".into(), "Cinderwing3D Baby Rose".into()]).as_deref(),
            None,
            "same names say nothing"
        );
        assert_eq!(
            shared_prefix(&["Cinderwing3D Baby Rose".into(), "Cinderwing3D Baby Snake".into()]).as_deref(),
            Some("Cinderwing3D Baby"),
            "capped at two words"
        );
        assert_eq!(shared_prefix(&["part 1".into(), "part 2".into()]).as_deref(), None, "generic");
        assert_eq!(shared_prefix(&["only one".into()]).as_deref(), None);
        assert_eq!(folder_creators("Cinderwing3D - Baby Rose"), vec![("Cinderwing3D".to_string(), 45)]);
        assert_eq!(folder_creators("Baby Rose by Cinderwing3D"), vec![("Cinderwing3D".to_string(), 55)]);
        assert!(folder_creators("Baby Rose").is_empty());
        assert_eq!(
            readme_creators("# Baby Rose\nDesigned by Cinderwing3D (Printables)\nLicense: CC BY-NC-SA"),
            vec!["Cinderwing3D".to_string()]
        );
        assert_eq!(
            model_urls("see https://www.printables.com/model/1-x, and https://example.com/no"),
            vec!["https://www.printables.com/model/1-x".to_string()]
        );
    }

    #[test]
    fn library_wide_prefix_needs_support_and_skips_generic_words() {
        let lib = vec![
            ("a".to_string(), vec!["Cinderwing3D Baby Rose 23".to_string()]),
            ("b".to_string(), vec!["Cinderwing3D Cinder Snake".to_string()]),
            ("c".to_string(), vec!["Cinderwing3D Baby Jellyfish".to_string()]),
            ("d".to_string(), vec!["part 1".to_string()]),
            ("e".to_string(), vec!["part 2".to_string()]),
            ("f".to_string(), vec!["part 3".to_string()]),
            ("g".to_string(), vec!["Lonely Model".to_string()]),
        ];
        let p = library_prefixes(&lib, 3);
        assert_eq!(p.get("a").cloned(), Some(("Cinderwing3D".to_string(), 3)));
        assert_eq!(
            p.get("c").cloned(),
            Some(("Cinderwing3D".to_string(), 3)),
            "shortest supported prefix wins over 'Cinderwing3D Baby'"
        );
        assert!(!p.contains_key("d"), "generic first word");
        assert!(!p.contains_key("g"));
    }

    #[test]
    fn detect_reads_3mf_metadata_shortcuts_and_known_spelling() {
        let dir = tempfile::tempdir().unwrap();
        {
            use std::io::Write;
            let f = std::fs::File::create(dir.path().join("rose.3mf")).unwrap();
            let mut w = zip::ZipWriter::new(f);
            let opts = zip::write::SimpleFileOptions::default();
            w.start_file("3D/3dmodel.model", opts).unwrap();
            w.write_all(br#"<?xml version="1.0"?><model><metadata name="Designer">cinderwing 3d</metadata><metadata name="License">CC BY-NC-SA 4.0</metadata><metadata name="Title">Baby &amp; Rose</metadata><resources/><build/></model>"#).unwrap();
            w.finish().unwrap();
        }
        std::fs::write(
            dir.path().join("Baby Rose.url"),
            "[InternetShortcut]\r\nURL=https://www.printables.com/model/99-baby-rose\r\n",
        )
        .unwrap();
        let files = vec![entry("rose.3mf", FileKind::Model), entry("Baby Rose.url", FileKind::Other)];
        let h = detect(dir.path(), &files, &["Cinderwing3D".to_string()]);
        assert_eq!(h.creator[0].value, "Cinderwing3D", "{:?}", h.creator);
        assert_eq!(h.creator[0].source, HintSource::ThreeMf);
        assert!(h.creator[0].confidence >= 90);
        assert_eq!(h.license[0].value, "CC-BY-NC-SA-4.0");
        assert_eq!(h.source_url[0].value, "https://www.printables.com/model/99-baby-rose");
        assert_eq!(h.source_url[0].source, HintSource::Shortcut);
    }
}
