//! Library conventions per root (#58): how a library should be organised, written down in
//! `<root>/.meshkeep/conventions.yaml` so it travels with the folder and every agent and
//! session follows the same rules. The structured part is enforced by the engine
//! (`check` finds deviations, `organize` fixes what it can, tag rules apply on every
//! write); `notes` is free text for the judgement calls only an agent can make and is
//! passed through to MCP clients as is. No file means no rules, as before.

use crate::error::{io_err, EngineError, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const CONVENTIONS_REL: &str = ".meshkeep/conventions.yaml";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Conventions {
    #[serde(default = "v1")]
    pub version: u32,
    #[serde(default)]
    pub layout: Layout,
    #[serde(default)]
    pub titles: Titles,
    #[serde(default)]
    pub metadata: MetadataRules,
    #[serde(default)]
    pub duplicates: Duplicates,
    /// Free text for agents: the rules the engine cannot check.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub notes: String,
}

fn v1() -> u32 {
    1
}

/// Where a project belongs. `pattern` is a path of placeholders and literal folder names
/// whose last segment must be `{title}` (the project's own folder, which keeps its name);
/// `{creator}` resolves to the creator's folder name, to `shared_folder` for creators with
/// fewer than `shared_threshold` projects, and to `unknown_creator` when none is set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Layout {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shared_folder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shared_threshold: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unknown_creator: Option<String>,
}

/// Named cleanups for titles: `thingiverse_id` drops a trailing " - 6277078" / "_6277078"
/// (or a "thing:6277078"), `date_suffix` a trailing " 2024-01-05" / "_20240105".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Titles {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub strip: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct MetadataRules {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description_language: Option<String>,
    #[serde(default)]
    pub tags: TagRules,
    /// The license to use when the source is unclear; also what `check` proposes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license_default: Option<String>,
    /// Allowed license identifiers; empty means anything goes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub licenses: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct TagRules {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    /// Only "lower" is enforced; anything else leaves the case alone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub case: Option<String>,
    /// Replaces whitespace and underscores inside a tag ("print in place" -> "print-in-place").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub separator: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Duplicates {
    /// most_metadata | newest | largest | path: which member of a duplicate group to keep.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep: Option<String>,
}

/// Reads the root's file; `None` when there is none, an error when it does not parse.
pub fn read(root: &Path) -> Result<Option<Conventions>> {
    let path = root.join(CONVENTIONS_REL);
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(EngineError::Io { path, source: e }),
    };
    parse(&text).map(Some)
}

/// The file's text as the user wrote it (for the editor), if any.
pub fn read_text(root: &Path) -> Result<Option<String>> {
    match std::fs::read_to_string(root.join(CONVENTIONS_REL)) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(EngineError::Io {
            path: root.join(CONVENTIONS_REL),
            source: e,
        }),
    }
}

pub fn parse(text: &str) -> Result<Conventions> {
    if text.trim().is_empty() {
        return Ok(Conventions::default());
    }
    let c: Conventions = serde_yaml_ng::from_str(text).map_err(|e| EngineError::ConventionsInvalid(e.to_string()))?;
    if let Some(p) = &c.layout.pattern {
        let p = p.trim().trim_matches('/');
        if p.is_empty() || !p.ends_with("{title}") {
            return Err(EngineError::ConventionsInvalid(format!(
                "layout.pattern must end with {{title}} (the project's own folder), got \"{p}\""
            )));
        }
        for seg in p.split('/') {
            if seg.is_empty() {
                return Err(EngineError::ConventionsInvalid("layout.pattern has an empty segment".into()));
            }
            if seg.contains('{') && !matches!(seg, "{creator}" | "{title}") {
                return Err(EngineError::ConventionsInvalid(format!(
                    "layout.pattern: unknown placeholder {seg}; use {{creator}} and {{title}}"
                )));
            }
        }
    }
    for rule in &c.titles.strip {
        if !matches!(rule.as_str(), "thingiverse_id" | "date_suffix") {
            return Err(EngineError::ConventionsInvalid(format!(
                "titles.strip: unknown rule {rule}; use thingiverse_id or date_suffix"
            )));
        }
    }
    if let Some(k) = &c.duplicates.keep {
        if !matches!(k.as_str(), "most_metadata" | "newest" | "largest" | "path") {
            return Err(EngineError::ConventionsInvalid(format!(
                "duplicates.keep: unknown value {k}; use most_metadata, newest, largest or path"
            )));
        }
    }
    Ok(c)
}

/// Writes the text as given (after it parsed), atomically, creating `.meshkeep`.
pub fn write_text(root: &Path, text: &str) -> Result<()> {
    parse(text)?;
    let path = root.join(CONVENTIONS_REL);
    let dir = path.parent().expect("conventions path has a parent");
    std::fs::create_dir_all(dir).map_err(io_err(dir))?;
    let tmp = dir.join(format!(".conventions.{}.tmp", std::process::id()));
    std::fs::write(&tmp, text.as_bytes()).map_err(io_err(&tmp))?;
    if let Err(e) = std::fs::rename(&tmp, &path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(EngineError::Io { path, source: e });
    }
    Ok(())
}

/// A sensible starter set, offered by the settings card for a root without a file.
pub fn starter_text() -> String {
    r#"# Library conventions for this folder (Meshkeep reads this file, agents receive it).
version: 1
layout:
  pattern: "{creator}/{title}"   # where a project belongs; {title} is its own folder
  shared_folder: Misc            # creators with fewer projects than the threshold go here
  shared_threshold: 2
  unknown_creator: Misc          # projects without a creator
titles:
  strip: [thingiverse_id, date_suffix]   # "Screw organizer - 6277078" -> "Screw organizer"
metadata:
  description_language: en
  tags: { language: en, case: lower, separator: "-" }
  license_default: Personal use  # when the source is unclear or contradictory
  licenses: [CC0-1.0, CC-BY-4.0, CC-BY-SA-4.0, CC-BY-NC-4.0, CC-BY-NC-SA-4.0, MIT, GPL-3.0, Personal use]
duplicates:
  keep: most_metadata            # or: newest, largest, path
notes: |
  Link the original model as the source, not a later remake.
  Keep a creator's collection folders together; do not split them into single projects.
"#
    .to_string()
}

/// A creator name as a folder name: the characters Windows refuses become "-", a trailing
/// dot or space goes, and an empty result means "no creator".
pub fn folder_name(creator: &str) -> Option<String> {
    let cleaned: String = creator
        .trim()
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim_end_matches(['.', ' ']).trim().to_string();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        None
    } else {
        Some(cleaned)
    }
}

/// Where a project with this creator belongs (its parent folder, relative to the root),
/// or `None` when the layout has no pattern or nothing applies. `count` is how many
/// projects of the root carry the same creator.
pub fn expected_parent(layout: &Layout, creator: Option<&str>, count: u32) -> Option<String> {
    let pattern = layout.pattern.as_deref()?.trim().trim_matches('/');
    let mut parts: Vec<String> = Vec::new();
    for seg in pattern.split('/') {
        match seg {
            "{title}" => break,
            "{creator}" => {
                let threshold = layout.shared_threshold.unwrap_or(1).max(1);
                let folder = match creator.and_then(folder_name) {
                    Some(name) if count >= threshold => Some(name),
                    Some(_) => layout.shared_folder.clone(),
                    None => layout.unknown_creator.clone().or_else(|| layout.shared_folder.clone()),
                };
                parts.push(folder?);
            }
            literal => parts.push(literal.to_string()),
        }
    }
    Some(parts.join("/"))
}

/// Applies the named title rules; `None` when nothing changes.
pub fn clean_title(title: &str, rules: &[String]) -> Option<String> {
    let mut t = title.trim().to_string();
    for rule in rules {
        t = match rule.as_str() {
            "thingiverse_id" => strip_thingiverse_id(&t),
            "date_suffix" => strip_date_suffix(&t),
            _ => t,
        };
    }
    let t = t.trim().trim_end_matches(['-', '_', ' ']).trim().to_string();
    if t.is_empty() || t == title.trim() {
        None
    } else {
        Some(t)
    }
}

fn strip_thingiverse_id(t: &str) -> String {
    // "Name - 6277078", "Name_6277078", "Name 6277078", "Name (thing:6277078)", "thing:6277078 Name"
    let lower = t.to_ascii_lowercase();
    if let Some(i) = lower.find("thing:") {
        let after = &t[i + 6..];
        let digits = after.chars().take_while(|c| c.is_ascii_digit()).count();
        if digits >= 5 {
            let mut rest = format!("{}{}", &t[..i], &after[digits..]);
            rest = rest.replace("()", "").replace("[]", "");
            return rest
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .trim_matches(['-', '_', ' '])
                .to_string();
        }
    }
    let trimmed = t.trim_end();
    let digits = trimmed.chars().rev().take_while(|c| c.is_ascii_digit()).count();
    if !(5..=8).contains(&digits) {
        return t.to_string();
    }
    let head = &trimmed[..trimmed.len() - digits];
    let sep = head.trim_end_matches(['-', '_', ' ']);
    if sep.len() == head.len() || sep.is_empty() {
        return t.to_string(); // digits glued to a word ("Model2024") or nothing left
    }
    sep.to_string()
}

fn strip_date_suffix(t: &str) -> String {
    let trimmed = t.trim_end();
    let tail: String = trimmed
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit() || *c == '-')
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    let compact: String = tail.chars().filter(|c| c.is_ascii_digit()).collect();
    let looks_like_date =
        (tail.len() == 10 && tail.matches('-').count() == 2 && compact.len() == 8) || (tail.len() == 8 && compact.len() == 8);
    if !looks_like_date {
        return t.to_string();
    }
    let year: u32 = compact[..4].parse().unwrap_or(0);
    let month: u32 = compact[4..6].parse().unwrap_or(0);
    let day: u32 = compact[6..8].parse().unwrap_or(0);
    if !(1990..=2100).contains(&year) || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return t.to_string();
    }
    let head = &trimmed[..trimmed.len() - tail.len()];
    let sep = head.trim_end_matches(['-', '_', ' ']);
    if sep.len() == head.len() || sep.is_empty() {
        return t.to_string();
    }
    sep.to_string()
}

/// One tag under the rules: lower-cased when asked, inner whitespace and underscores
/// replaced by the separator when one is set.
pub fn normalize_tag(tag: &str, rules: &TagRules) -> String {
    let mut t = tag.trim().to_string();
    if rules.case.as_deref().map(|c| c.eq_ignore_ascii_case("lower")).unwrap_or(false) {
        t = t.to_lowercase();
    }
    if let Some(sep) = rules.separator.as_deref().filter(|s| !s.is_empty()) {
        let parts: Vec<&str> = t
            .split(|c: char| c.is_whitespace() || c == '_' || (c == '-' && sep != "-"))
            .filter(|p| !p.is_empty())
            .collect();
        t = parts.join(sep);
    }
    t
}

/// What `check` found for one project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Deviation {
    pub project_id: String,
    pub rel_path: String,
    /// folder | title | license | tags
    pub kind: String,
    pub current: String,
    pub expected: String,
    /// `organize` can fix it (folder, title, tags); a license is a judgement call.
    pub fixable: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct CheckReport {
    pub root_id: String,
    pub checked: u32,
    pub deviations: Vec<Deviation>,
}

/// The summary an MCP client gets with `initialize`.
pub fn describe(root_path: &Path, c: &Conventions) -> String {
    let yaml = serde_yaml_ng::to_string(c).unwrap_or_default();
    format!(
        "Conventions for the library at {} (enforced by check_conventions/organize; follow them):\n{}",
        root_path.display(),
        yaml.trim()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_starter_and_rejects_bad_patterns() {
        let c = parse(&starter_text()).unwrap();
        assert_eq!(c.layout.pattern.as_deref(), Some("{creator}/{title}"));
        assert_eq!(c.metadata.licenses.len(), 8);
        assert!(c.notes.contains("original model"));
        assert!(parse("layout:\n  pattern: \"{creator}\"\n").is_err(), "must end with {{title}}");
        assert!(parse("layout:\n  pattern: \"{site}/{title}\"\n").is_err());
        assert!(parse("titles:\n  strip: [regex]\n").is_err());
        assert!(parse("duplicates:\n  keep: oldest\n").is_err());
        assert!(parse("not: [valid").is_err());
        assert_eq!(parse("").unwrap(), Conventions::default());
    }

    #[test]
    fn layout_resolves_creators_shared_and_unknown() {
        let l = Layout {
            pattern: Some("{creator}/{title}".into()),
            shared_folder: Some("Misc".into()),
            shared_threshold: Some(2),
            unknown_creator: Some("Unknown".into()),
        };
        assert_eq!(expected_parent(&l, Some("Cinderwing3D"), 5).as_deref(), Some("Cinderwing3D"));
        assert_eq!(expected_parent(&l, Some("One Hit"), 1).as_deref(), Some("Misc"));
        assert_eq!(expected_parent(&l, None, 0).as_deref(), Some("Unknown"));
        assert_eq!(expected_parent(&l, Some("A/B: C?"), 3).as_deref(), Some("A-B- C-"));
        let nested = Layout {
            pattern: Some("Models/{creator}/{title}".into()),
            ..Default::default()
        };
        assert_eq!(expected_parent(&nested, Some("Zack"), 1).as_deref(), Some("Models/Zack"));
        assert_eq!(expected_parent(&nested, None, 0), None, "no shared folder, nowhere to put it");
        assert_eq!(expected_parent(&Layout::default(), Some("Zack"), 1), None);
    }

    #[test]
    fn titles_lose_ids_and_dates_but_not_real_words() {
        let rules = vec!["thingiverse_id".to_string(), "date_suffix".to_string()];
        assert_eq!(
            clean_title("Small screws organizer - 6277078", &rules).as_deref(),
            Some("Small screws organizer")
        );
        assert_eq!(clean_title("Baby Rose_1234567", &rules).as_deref(), Some("Baby Rose"));
        assert_eq!(clean_title("Phone stand (thing:2345678)", &rules).as_deref(), Some("Phone stand"));
        assert_eq!(clean_title("Vase 2024-03-01", &rules).as_deref(), Some("Vase"));
        assert_eq!(clean_title("Vase_20240301", &rules).as_deref(), Some("Vase"));
        assert_eq!(clean_title("Benchy 2024", &rules), None, "a year is not an id");
        assert_eq!(clean_title("Model2024567", &rules), None, "glued digits stay");
        assert_eq!(clean_title("6277078", &rules), None, "nothing would be left");
        assert_eq!(clean_title("Clean title", &rules), None);
    }

    #[test]
    fn tags_follow_case_and_separator() {
        let rules = TagRules {
            language: None,
            case: Some("lower".into()),
            separator: Some("-".into()),
        };
        assert_eq!(normalize_tag("Print In Place", &rules), "print-in-place");
        assert_eq!(normalize_tag("print_in_place", &rules), "print-in-place");
        assert_eq!(normalize_tag("dragon", &rules), "dragon");
        assert_eq!(normalize_tag("Dragon", &TagRules::default()), "Dragon");
    }
}
