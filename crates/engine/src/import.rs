//! Import with a staging step (IMP-1, IMP-2, IMP-3). `analyze` looks at dropped archives,
//! folders and files and proposes what to do with each; nothing is written. `execute`
//! performs the confirmed plan: extract archives into new project directories, copy folders
//! and loose files (a 3MF is a zip inside, but it is a model and is never extracted), route
//! files to `_Inbox`, and apply the archive policy (keep as attachment, move to `_Originals`,
//! or trash) to real archives only. Every target is checked for collisions before the first
//! write. A project is assembled below `.meshkeep-import` and renamed into place once it
//! qualifies as a project; a failure removes the half-built folder and leaves the source alone.

use crate::engine::Deleter;
use crate::error::{io_err, EngineError, Result};
use crate::model::FileKind;
use crate::scan::{self, IgnoreMatcher, ScanOptions};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

pub const INBOX_DIR: &str = "_Inbox";
pub const ORIGINALS_DIR: &str = "_Originals";
/// Working folder below a root where a project is assembled before it is renamed into place.
/// Never scanned; a folder left in it belongs to an interrupted import and is replaced.
pub const STAGING_DIR: &str = ".meshkeep-import";
/// Folders below a root that are never projects: the inbox, kept originals and the staging area.
pub const SPECIAL_DIRS: &[&str] = &[INBOX_DIR, ORIGINALS_DIR, STAGING_DIR];

const ARCHIVE_EXTS: &[&str] = &["zip", "7z"];
const UNSUPPORTED_ARCHIVE_EXTS: &[&str] = &["rar", "tar", "gz", "tgz"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    Archive,
    Folder,
    File,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportAction {
    /// Becomes a project directory named `name` directly below the root.
    Project,
    /// Zip archives only (LIB-9): the archive itself goes into a new project directory named
    /// `name`, unextracted, next to a project.yaml that names it as the packed archive.
    Packed,
    /// Copied into `<root>/_Inbox`.
    Inbox,
    Skip,
}

/// What the staging dialog shows for one dropped thing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportItem {
    pub source: PathBuf,
    pub kind: SourceKind,
    /// Proposed project name (directory name), derived from the source.
    pub name: String,
    pub action: ImportAction,
    pub model_count: u32,
    pub file_count: u32,
    pub total_bytes: u64,
    /// For archives: a single top-level folder that will be stripped on extraction.
    pub strip_prefix: Option<String>,
    pub warnings: Vec<String>,
    /// Creator, license and link guessed from names and small text files (META-7a); shown in
    /// the staging dialog, written on request after extraction.
    #[serde(default)]
    pub hints: crate::hints::ItemHints,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchivePolicy {
    /// Copy the archive into the new project as an attachment (Q7 default).
    #[default]
    Keep,
    /// Move the archive to `<root>/_Originals`.
    Originals,
    /// Send the archive to the trash after a successful extraction.
    Trash,
    /// Leave the archive where it is (e.g. in Downloads); the library gets only the files.
    Leave,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportRequestItem {
    pub source: PathBuf,
    pub action: ImportAction,
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportRequest {
    pub root_id: String,
    pub items: Vec<ImportRequestItem>,
    #[serde(default)]
    pub archive_policy: ArchivePolicy,
    /// Write creator, license and link found in the extracted files into the new project.yaml.
    #[serde(default)]
    pub apply_hints: bool,
    /// Also read the model page of each new project with a link (needs the network setting).
    #[serde(default)]
    pub fetch_pages: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImportReport {
    pub root_id: String,
    /// Relative paths (below the root) of the project directories created.
    pub projects: Vec<String>,
    /// The ones among them that were created packed (LIB-9).
    #[serde(default)]
    pub packed: Vec<String>,
    pub inbox_files: u32,
    pub skipped: u32,
    pub errors: Vec<String>,
    /// New projects whose project.yaml received metadata from hints or pages.
    #[serde(default)]
    pub metadata_written: u32,
    /// Model pages read for new projects.
    #[serde(default)]
    pub pages_read: u32,
    /// Non-fatal notes from the metadata step (a page that did not answer, a sidecar that existed).
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportProgress {
    pub index: u32,
    pub total: u32,
    pub name: String,
    /// "copy" while files move, "metadata" while hints and pages are applied.
    #[serde(default = "phase_copy")]
    pub phase: String,
}

fn phase_copy() -> String {
    "copy".into()
}

/// Small text files worth reading for hints at staging time.
fn is_hint_text(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    l.ends_with(".txt") || l.ends_with(".md") || l.ends_with(".url") || l.ends_with(".nfo") || l.ends_with(".webloc")
}
const HINT_TEXT_MAX: u64 = 64 << 10;

fn folder_hint_inputs(dir: &Path) -> (Vec<String>, Vec<String>) {
    let mut models = Vec::new();
    let mut texts = Vec::new();
    for entry in walkdir::WalkDir::new(dir).follow_links(false).max_depth(3).into_iter().flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_model(&name) {
            models.push(name);
        } else if is_hint_text(&name) && entry.metadata().map(|m| m.len() <= HINT_TEXT_MAX).unwrap_or(false) {
            if let Ok(t) = std::fs::read(entry.path()) {
                texts.push(String::from_utf8_lossy(&t).into_owned());
            }
        }
    }
    (models, texts)
}

fn zip_hint_texts(path: &Path, entries: &[(String, u64)]) -> Vec<String> {
    let Ok(f) = File::open(path) else { return Vec::new() };
    let Ok(mut archive) = zip::ZipArchive::new(f) else {
        return Vec::new();
    };
    let mut texts = Vec::new();
    for (name, size) in entries.iter().filter(|(n, s)| is_hint_text(n) && *s <= HINT_TEXT_MAX).take(8) {
        let _ = size;
        if let Ok(mut e) = archive.by_name(name) {
            let mut buf = Vec::new();
            if e.read_to_end(&mut buf).is_ok() {
                texts.push(String::from_utf8_lossy(&buf).into_owned());
            }
        }
    }
    texts
}

fn ext_of(p: &Path) -> String {
    p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

fn stem_name(p: &Path) -> String {
    let s = p.file_stem().and_then(|s| s.to_str()).unwrap_or("import").trim();
    let s = s.trim_end_matches(['.', ' ']);
    if s.is_empty() {
        "import".to_string()
    } else {
        s.to_string()
    }
}

fn is_model(name: &str) -> bool {
    name.rsplit('.').next().map(FileKind::from_extension) == Some(FileKind::Model)
}

/// A real archive the import extracts (`zip`, `7z`). A 3MF is a zip container too, but it is
/// a model file and never counts as an archive here.
fn is_archive(p: &Path) -> bool {
    !p.is_dir() && ARCHIVE_EXTS.contains(&ext_of(p).as_str())
}

/// Rejects absolute paths, `..`, drive prefixes and empty names (zip-slip guard).
fn safe_relative(name: &str) -> Option<PathBuf> {
    let p = Path::new(name);
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::Normal(n) => out.push(n),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

struct ArchiveSummary {
    entries: Vec<(String, u64)>, // file entries (dirs excluded), normalized with '/'
    strip_prefix: Option<String>,
    warnings: Vec<String>,
}

fn summarize_zip(path: &Path) -> Result<ArchiveSummary> {
    let f = File::open(path).map_err(io_err(path))?;
    let mut archive = zip::ZipArchive::new(f).map_err(|e| EngineError::Io {
        path: path.to_path_buf(),
        source: std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()),
    })?;
    let mut entries = Vec::new();
    let mut warnings = Vec::new();
    for i in 0..archive.len() {
        let entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(e) => {
                warnings.push(format!("entry {i}: {e}"));
                continue;
            }
        };
        if entry.is_dir() {
            continue;
        }
        let name = match entry.name() {
            Ok(n) => n.replace('\\', "/"),
            Err(e) => {
                warnings.push(format!("entry {i}: {e}"));
                continue;
            }
        };
        if name.starts_with("__MACOSX/") || name.ends_with(".DS_Store") {
            continue;
        }
        if safe_relative(&name).is_none() {
            warnings.push(format!("skipping unsafe path {name}"));
            continue;
        }
        entries.push((name, entry.size()));
    }
    // One top-level folder holding everything -> strip it, the project dir replaces it.
    let mut tops = entries
        .iter()
        .filter_map(|(n, _)| n.split_once('/').map(|(t, _)| t.to_string()))
        .collect::<Vec<_>>();
    tops.sort();
    tops.dedup();
    let all_nested = entries.iter().all(|(n, _)| n.contains('/'));
    let strip_prefix = if tops.len() == 1 && all_nested { tops.pop() } else { None };
    Ok(ArchiveSummary {
        entries,
        strip_prefix,
        warnings,
    })
}

fn summarize_7z(path: &Path) -> Result<ArchiveSummary> {
    let archive = sevenz_rust2::Archive::open(path).map_err(|e| EngineError::Io {
        path: path.to_path_buf(),
        source: std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()),
    })?;
    let mut entries = Vec::new();
    let mut warnings = Vec::new();
    for f in &archive.files {
        if f.is_directory() {
            continue;
        }
        let name = f.name().replace('\\', "/");
        if name.starts_with("__MACOSX/") || name.ends_with(".DS_Store") {
            continue;
        }
        if safe_relative(&name).is_none() {
            warnings.push(format!("skipping unsafe path {name}"));
            continue;
        }
        entries.push((name, f.size()));
    }
    Ok(ArchiveSummary {
        strip_prefix: strip_prefix_of(&entries),
        entries,
        warnings,
    })
}

fn summarize_archive(path: &Path) -> Result<ArchiveSummary> {
    if ext_of(path) == "7z" {
        summarize_7z(path)
    } else {
        summarize_zip(path)
    }
}

/// One top-level folder holding everything -> strip it, the project dir replaces it.
fn strip_prefix_of(entries: &[(String, u64)]) -> Option<String> {
    let mut tops = entries
        .iter()
        .filter_map(|(n, _)| n.split_once('/').map(|(t, _)| t.to_string()))
        .collect::<Vec<_>>();
    tops.sort();
    tops.dedup();
    let all_nested = entries.iter().all(|(n, _)| n.contains('/'));
    if tops.len() == 1 && all_nested {
        tops.pop()
    } else {
        None
    }
}

fn extract_7z(archive: &Path, strip: Option<&str>, target: &Path) -> Result<u32> {
    let mut reader = sevenz_rust2::ArchiveReader::open(archive, sevenz_rust2::Password::empty()).map_err(|e| EngineError::Io {
        path: archive.to_path_buf(),
        source: std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()),
    })?;
    let mut written = 0u32;
    let target = target.to_path_buf();
    let strip = strip.map(|s| s.to_string());
    reader
        .for_each_entries(|entry, r| {
            if entry.is_directory() {
                return Ok(true);
            }
            let name = entry.name().replace('\\', "/");
            if name.starts_with("__MACOSX/") || name.ends_with(".DS_Store") {
                return Ok(true);
            }
            let rel = match &strip {
                Some(s) => name.strip_prefix(&format!("{s}/")).map(|r| r.to_string()).unwrap_or(name.clone()),
                None => name.clone(),
            };
            let Some(rel) = safe_relative(&rel) else { return Ok(true) };
            let out = target.join(&rel);
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut file = File::create(&out)?;
            std::io::copy(r, &mut file)?;
            written += 1;
            Ok(true)
        })
        .map_err(|e| EngineError::Io {
            path: archive.to_path_buf(),
            source: std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()),
        })?;
    Ok(written)
}

fn walk_folder(dir: &Path) -> (u32, u32, u64) {
    let mut models = 0;
    let mut files = 0;
    let mut bytes = 0;
    for entry in walkdir::WalkDir::new(dir).follow_links(false).into_iter().flatten() {
        if entry.file_type().is_file() {
            files += 1;
            bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
            if is_model(&entry.file_name().to_string_lossy()) {
                models += 1;
            }
        }
    }
    (models, files, bytes)
}

/// Looks at each dropped path and proposes an action. Read-only.
pub fn analyze(paths: &[PathBuf]) -> Vec<ImportItem> {
    let mut items = Vec::new();
    for p in paths {
        let mut warnings = Vec::new();
        if p.is_dir() {
            let (models, files, bytes) = walk_folder(p);
            if models == 0 {
                warnings.push("no model files inside".into());
            }
            let (model_names, texts) = folder_hint_inputs(p);
            let name = stem_name(p);
            items.push(ImportItem {
                source: p.clone(),
                kind: SourceKind::Folder,
                hints: crate::hints::quick(&name, &model_names, &texts, &[]),
                name,
                action: if models > 0 { ImportAction::Project } else { ImportAction::Skip },
                model_count: models,
                file_count: files,
                total_bytes: bytes,
                strip_prefix: None,
                warnings,
            });
            continue;
        }
        let ext = ext_of(p);
        if ARCHIVE_EXTS.contains(&ext.as_str()) {
            match summarize_archive(p) {
                Ok(s) => {
                    let models = s.entries.iter().filter(|(n, _)| is_model(n)).count() as u32;
                    let mut warnings = s.warnings;
                    if models == 0 {
                        warnings.push("archive contains no model files".into());
                    }
                    let name = stem_name(p);
                    let model_names: Vec<String> = s.entries.iter().filter(|(n, _)| is_model(n)).map(|(n, _)| n.clone()).collect();
                    let texts = if ext == "zip" { zip_hint_texts(p, &s.entries) } else { Vec::new() };
                    items.push(ImportItem {
                        source: p.clone(),
                        kind: SourceKind::Archive,
                        hints: crate::hints::quick(&name, &model_names, &texts, &[]),
                        name,
                        action: if models > 0 { ImportAction::Project } else { ImportAction::Skip },
                        model_count: models,
                        file_count: s.entries.len() as u32,
                        total_bytes: s.entries.iter().map(|(_, b)| b).sum(),
                        strip_prefix: s.strip_prefix,
                        warnings,
                    });
                }
                Err(e) => items.push(ImportItem {
                    source: p.clone(),
                    kind: SourceKind::Archive,
                    name: stem_name(p),
                    action: ImportAction::Skip,
                    model_count: 0,
                    file_count: 0,
                    total_bytes: 0,
                    strip_prefix: None,
                    warnings: vec![format!("cannot read archive: {e}")],
                    hints: Default::default(),
                }),
            }
            continue;
        }
        let size = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
        if UNSUPPORTED_ARCHIVE_EXTS.contains(&ext.as_str()) {
            warnings.push(format!(
                ".{ext} archives are not extracted yet; extract manually or keep it in the inbox"
            ));
        }
        let file_name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let model = is_model(&file_name);
        let name = stem_name(p);
        items.push(ImportItem {
            source: p.clone(),
            kind: SourceKind::File,
            hints: crate::hints::quick(&name, &[file_name], &[], &[]),
            name,
            action: ImportAction::Inbox,
            model_count: model as u32,
            file_count: 1,
            total_bytes: size,
            strip_prefix: None,
            warnings,
        });
    }
    items
}

fn project_target(root: &Path, name: &str) -> Result<PathBuf> {
    let name = crate::engine::validate_dir_name(name)?;
    if SPECIAL_DIRS.iter().any(|s| s.eq_ignore_ascii_case(&name)) {
        return Err(EngineError::InvalidName(format!("{name} is reserved")));
    }
    Ok(root.join(name))
}

fn extract_zip(archive: &Path, strip: Option<&str>, target: &Path) -> Result<u32> {
    let f = File::open(archive).map_err(io_err(archive))?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| EngineError::Io {
        path: archive.to_path_buf(),
        source: std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()),
    })?;
    let mut written = 0;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| EngineError::Io {
            path: archive.to_path_buf(),
            source: std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()),
        })?;
        if entry.is_dir() {
            continue;
        }
        let Ok(name) = entry.name().map(|n| n.replace('\\', "/")) else {
            continue;
        };
        if name.starts_with("__MACOSX/") || name.ends_with(".DS_Store") {
            continue;
        }
        let rel = match strip {
            Some(s) => match name.strip_prefix(&format!("{s}/")) {
                Some(r) => r.to_string(),
                None => name.clone(),
            },
            None => name.clone(),
        };
        let Some(rel) = safe_relative(&rel) else { continue };
        let out = target.join(&rel);
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(io_err(parent))?;
        }
        let mut file = File::create(&out).map_err(io_err(&out))?;
        std::io::copy(&mut entry, &mut file).map_err(io_err(&out))?;
        written += 1;
    }
    Ok(written)
}

fn copy_dir(src: &Path, dst: &Path) -> Result<u32> {
    let mut n = 0;
    for entry in walkdir::WalkDir::new(src).follow_links(false) {
        let entry = entry.map_err(|e| EngineError::Io {
            path: src.to_path_buf(),
            source: std::io::Error::other(e.to_string()),
        })?;
        let rel = entry.path().strip_prefix(src).unwrap_or(entry.path());
        let out = dst.join(rel);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&out).map_err(io_err(&out))?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent).map_err(io_err(parent))?;
            }
            std::fs::copy(entry.path(), &out).map_err(io_err(&out))?;
            n += 1;
        }
    }
    Ok(n)
}

/// A name that does not collide in `dir`: `name`, `name (2)`, `name (3)`, ...
pub(crate) fn unique_file_name(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let p = Path::new(name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let ext = p.extension().and_then(|e| e.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
    for i in 2..1000 {
        let c = dir.join(format!("{stem} ({i}){ext}"));
        if !c.exists() {
            return c;
        }
    }
    dir.join(format!("{stem} ({}){ext}", std::process::id()))
}

/// Runs a confirmed plan. Collisions are rejected before anything is written; per-item
/// failures after that are collected in the report and do not stop the other items.
pub fn execute(
    root: &Path,
    req: &ImportRequest,
    deleter: &Deleter,
    opts: &ScanOptions,
    mut progress: impl FnMut(ImportProgress),
) -> Result<ImportReport> {
    if !root.is_dir() {
        return Err(EngineError::RootOffline(root.to_path_buf()));
    }
    let ignore = IgnoreMatcher::new(&opts.ignore)?;
    // Pass 1: validate every target.
    let mut targets: Vec<Option<PathBuf>> = Vec::with_capacity(req.items.len());
    let mut seen: Vec<String> = Vec::new();
    for item in &req.items {
        match item.action {
            ImportAction::Project | ImportAction::Packed => {
                let t = project_target(root, &item.name)?;
                let key = item.name.trim().to_lowercase();
                if seen.contains(&key) {
                    return Err(EngineError::AlreadyExists(format!("{} (twice in this import)", item.name)));
                }
                if t.exists() {
                    return Err(EngineError::AlreadyExists(item.name.clone()));
                }
                seen.push(key);
                targets.push(Some(t));
            }
            _ => targets.push(None),
        }
    }
    // Pass 2: do the work.
    let total = req.items.len() as u32;
    let mut report = ImportReport::default();
    for (i, (item, target)) in req.items.iter().zip(targets).enumerate() {
        progress(ImportProgress {
            index: i as u32,
            total,
            name: item.name.clone(),
            phase: phase_copy(),
        });
        let result: Result<()> = (|| {
            match item.action {
                ImportAction::Skip => {
                    report.skipped += 1;
                }
                ImportAction::Inbox => {
                    let inbox = root.join(INBOX_DIR);
                    std::fs::create_dir_all(&inbox).map_err(io_err(&inbox))?;
                    let name = item.source.file_name().and_then(|n| n.to_str()).unwrap_or("file");
                    let dst = unique_file_name(&inbox, name);
                    std::fs::copy(&item.source, &dst).map_err(io_err(&dst))?;
                    report.inbox_files += 1;
                }
                ImportAction::Packed => {
                    let target = target.expect("validated above");
                    let note = build_packed(root, &item.source, &target, req.archive_policy, deleter)?;
                    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                    report.projects.push(name.clone());
                    report.packed.push(name);
                    if let Some(note) = note {
                        report.warnings.push(format!("{}: {note}", item.name));
                    }
                }
                ImportAction::Project => {
                    let target = target.expect("validated above");
                    build_project(root, &item.source, &target, req.archive_policy, &ignore, opts)?;
                    report
                        .projects
                        .push(target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
                    // Only now, with the project in place and holding a model, may the source go.
                    // The project is complete at this point, so a failure to trash or move the
                    // archive is a warning, not a failed item: the project stays, the archive
                    // stays where it was.
                    if is_archive(&item.source) {
                        if let Err(e) = dispose_archive(root, &item.source, req.archive_policy, deleter) {
                            report
                                .warnings
                                .push(format!("{}: project created, but the archive was left in place: {e}", item.name));
                        }
                    }
                }
            }
            Ok(())
        })();
        if let Err(e) = result {
            report.errors.push(format!("{}: {e}", item.name));
        }
    }
    // The staging area is empty once every item is in place or rolled back.
    let _ = std::fs::remove_dir(root.join(STAGING_DIR));
    Ok(report)
}

/// Assembles one project below `<root>/.meshkeep-import/<name>` from a folder, an archive or
/// a loose file, checks that the result qualifies as a project, and renames it to `target`.
/// Any failure removes the staging folder again; the source is never touched here.
fn build_project(
    root: &Path,
    source: &Path,
    target: &Path,
    policy: ArchivePolicy,
    ignore: &IgnoreMatcher,
    opts: &ScanOptions,
) -> Result<()> {
    let staging_root = root.join(STAGING_DIR);
    let staging = staging_root.join(target.file_name().unwrap_or_default());
    if staging.exists() {
        // Left behind by an interrupted import of the same name: ours, never library content.
        std::fs::remove_dir_all(&staging).map_err(io_err(&staging))?;
    }
    std::fs::create_dir_all(&staging).map_err(io_err(&staging))?;
    let result = fill_project(source, &staging, policy).and_then(|_| {
        // The boundary rule alone also accepts a folder holding nothing but a project.yaml;
        // a project the import creates must hold at least one model file as well.
        let (models, _, _) = walk_folder(&staging);
        if models == 0 || !scan::is_project_dir(&staging, ignore, root, opts) {
            return Err(EngineError::NotAllowed(
                "the result holds no model files, so no project was created".into(),
            ));
        }
        move_dir(&staging, target)
    });
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
        if target.exists() {
            let _ = std::fs::remove_dir_all(target);
        }
    }
    result
}

/// A packed project (LIB-9): the zip goes into a new project folder as it is, next to a
/// project.yaml naming it; nothing is extracted. The archive must hold at least one model.
/// With the policies that take the archive away from its source folder (trash, originals) it
/// is moved, otherwise copied. Returns a note when the project is fine but the source could
/// not be removed. A failure puts a moved archive back and removes the staging folder.
fn build_packed(root: &Path, source: &Path, target: &Path, policy: ArchivePolicy, deleter: &Deleter) -> Result<Option<String>> {
    if source.is_dir() || ext_of(source) != "zip" {
        return Err(EngineError::NotAllowed(
            "only zip archives can stay packed; folders, 7z archives and loose files are copied or extracted".into(),
        ));
    }
    let entries = crate::packed::list_entries(source)?;
    if !entries.iter().any(|e| is_model(&e.name)) {
        return Err(EngineError::NotAllowed(
            "the archive holds no model files, so no project was created".into(),
        ));
    }
    let staging = root.join(STAGING_DIR).join(target.file_name().unwrap_or_default());
    if staging.exists() {
        std::fs::remove_dir_all(&staging).map_err(io_err(&staging))?;
    }
    std::fs::create_dir_all(&staging).map_err(io_err(&staging))?;
    let archive_name = source.file_name().and_then(|n| n.to_str()).unwrap_or("models.zip").to_string();
    let dst = staging.join(&archive_name);
    let take = matches!(policy, ArchivePolicy::Trash | ArchivePolicy::Originals);
    let mut renamed = false;
    let result = (|| -> Result<()> {
        let sidecar = crate::model::Sidecar {
            packed: Some(archive_name.clone()),
            ..Default::default()
        };
        crate::sidecar::write(&staging, &sidecar, None)?;
        if take && std::fs::rename(source, &dst).is_ok() {
            renamed = true;
        } else {
            std::fs::copy(source, &dst).map_err(io_err(&dst))?;
        }
        move_dir(&staging, target)
    })();
    if let Err(e) = result {
        if renamed {
            // the archive was moved into the staging folder: it goes back where it was
            let from = if target.join(&archive_name).is_file() {
                target.join(&archive_name)
            } else {
                dst
            };
            let _ = std::fs::rename(&from, source);
        }
        let _ = std::fs::remove_dir_all(&staging);
        if target.exists() {
            let _ = std::fs::remove_dir_all(target);
        }
        return Err(e);
    }
    if take && !renamed {
        // copied across volumes: the project holds the archive, the source may go now
        if let Err(e) = deleter(source) {
            return Ok(Some(format!("project created, but the archive was left in place: {e}")));
        }
    }
    Ok(None)
}

/// Copies or extracts `source` into the (empty) `dir`.
fn fill_project(source: &Path, dir: &Path, policy: ArchivePolicy) -> Result<()> {
    if source.is_dir() {
        copy_dir(source, dir)?;
    } else if is_archive(source) {
        let summary = summarize_archive(source)?;
        if ext_of(source) == "7z" {
            extract_7z(source, summary.strip_prefix.as_deref(), dir)?;
        } else {
            extract_zip(source, summary.strip_prefix.as_deref(), dir)?;
        }
        if policy == ArchivePolicy::Keep {
            let archive_name = source.file_name().and_then(|n| n.to_str()).unwrap_or("original.zip");
            let dst = unique_file_name(dir, archive_name);
            std::fs::copy(source, &dst).map_err(io_err(&dst))?;
        }
    } else {
        // A loose file (stl, 3mf, obj, ...) is copied as it is; it is never extracted.
        let name = source
            .file_name()
            .ok_or_else(|| EngineError::InvalidName(source.display().to_string()))?;
        let dst = dir.join(name);
        std::fs::copy(source, &dst).map_err(io_err(&dst))?;
    }
    Ok(())
}

/// Renames a finished staging folder into place; copies and removes it when the rename is
/// refused (a different volume, a sync client holding a handle).
fn move_dir(from: &Path, to: &Path) -> Result<()> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    copy_dir(from, to)?;
    std::fs::remove_dir_all(from).map_err(io_err(from))
}

/// Applies the archive policy to a real archive after its project is in place.
fn dispose_archive(root: &Path, archive: &Path, policy: ArchivePolicy, deleter: &Deleter) -> Result<()> {
    let archive_name = archive.file_name().and_then(|n| n.to_str()).unwrap_or("original.zip");
    match policy {
        // Already copied into the project while it was staged.
        ArchivePolicy::Keep | ArchivePolicy::Leave => {}
        ArchivePolicy::Originals => {
            let originals = root.join(ORIGINALS_DIR);
            std::fs::create_dir_all(&originals).map_err(io_err(&originals))?;
            let dst = unique_file_name(&originals, archive_name);
            if std::fs::rename(archive, &dst).is_err() {
                std::fs::copy(archive, &dst).map_err(io_err(&dst))?;
                deleter(archive).map_err(|e| EngineError::Io {
                    path: archive.to_path_buf(),
                    source: e,
                })?;
            }
        }
        ArchivePolicy::Trash => {
            deleter(archive).map_err(|e| EngineError::Io {
                path: archive.to_path_buf(),
                source: e,
            })?;
        }
    }
    Ok(())
}

/// One loose file in `<root>/_Inbox`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboxFile {
    pub name: String,
    pub kind: FileKind,
    pub size: u64,
    #[serde(with = "time::serde::rfc3339")]
    pub modified: time::OffsetDateTime,
}

pub fn list_inbox(root: &Path) -> Result<Vec<InboxFile>> {
    let inbox = root.join(INBOX_DIR);
    let mut out = Vec::new();
    let rd = match std::fs::read_dir(&inbox) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(EngineError::Io { path: inbox, source: e }),
    };
    for entry in rd.flatten() {
        let meta = match entry.metadata() {
            Ok(m) if m.is_file() => m,
            _ => continue,
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        out.push(InboxFile {
            kind: name.rsplit('.').next().map(FileKind::from_extension).unwrap_or(FileKind::Other),
            size: meta.len(),
            modified: meta
                .modified()
                .map(time::OffsetDateTime::from)
                .unwrap_or(time::OffsetDateTime::UNIX_EPOCH),
            name,
        });
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified).then(a.name.cmp(&b.name)));
    Ok(out)
}

/// Moves the named inbox files into a new project directory `<root>/<name>`.
pub fn promote_inbox(root: &Path, files: &[String], name: &str) -> Result<PathBuf> {
    let target = project_target(root, name)?;
    if target.exists() {
        return Err(EngineError::AlreadyExists(name.to_string()));
    }
    let inbox = root.join(INBOX_DIR);
    let sources: Vec<PathBuf> = files
        .iter()
        .map(|f| {
            let p = Path::new(f);
            if p.components().count() != 1 || matches!(p.components().next(), Some(Component::ParentDir)) {
                return Err(EngineError::InvalidName(f.clone()));
            }
            let full = inbox.join(p);
            if !full.is_file() {
                return Err(EngineError::Io {
                    path: full,
                    source: std::io::Error::new(std::io::ErrorKind::NotFound, "not in the inbox"),
                });
            }
            Ok(full)
        })
        .collect::<Result<_>>()?;
    if sources.is_empty() {
        return Err(EngineError::NotAllowed("no files selected".into()));
    }
    std::fs::create_dir_all(&target).map_err(io_err(&target))?;
    for src in sources {
        let dst = target.join(src.file_name().unwrap());
        if std::fs::rename(&src, &dst).is_err() {
            std::fs::copy(&src, &dst).map_err(io_err(&dst))?;
            std::fs::remove_file(&src).map_err(io_err(&src))?;
        }
    }
    Ok(target)
}

/// Reads up to `max` bytes of a file (for the staging dialog's peek at archives).
#[allow(dead_code)]
pub(crate) fn read_head(path: &Path, max: usize) -> Result<Vec<u8>> {
    let mut f = File::open(path).map_err(io_err(path))?;
    let mut buf = Vec::new();
    f.by_ref().take(max as u64).read_to_end(&mut buf).map_err(io_err(path))?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_zip(path: &Path, files: &[(&str, &[u8])]) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let f = File::create(path).unwrap();
        let mut w = zip::ZipWriter::new(f);
        let opts = zip::write::SimpleFileOptions::default();
        for (name, bytes) in files {
            w.start_file(*name, opts).unwrap();
            w.write_all(bytes).unwrap();
        }
        w.finish().unwrap();
    }
    fn touch(p: &Path, bytes: usize) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, vec![0u8; bytes]).unwrap();
    }
    fn write_7z(path: &Path, files: &[(&str, &[u8])]) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut w = sevenz_rust2::ArchiveWriter::create(path).unwrap();
        for (name, bytes) in files {
            w.push_archive_entry(
                sevenz_rust2::ArchiveEntry::new_file(name),
                Some(std::io::Cursor::new(bytes.to_vec())),
            )
            .unwrap();
        }
        w.finish().unwrap();
    }
    fn remover() -> Deleter {
        Box::new(|p: &Path| {
            if p.is_dir() {
                std::fs::remove_dir_all(p)
            } else {
                std::fs::remove_file(p)
            }
        })
    }

    #[test]
    fn analyze_proposes_projects_inbox_and_skips() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path();
        write_zip(
            &d.join("Cable Clip.zip"),
            &[
                ("Cable Clip/files/clip.stl", b"solid"),
                ("Cable Clip/README.md", b"hi"),
                ("__MACOSX/._x", b""),
            ],
        );
        write_zip(&d.join("flat.zip"), &[("a.stl", b"x"), ("b.stl", b"y")]);
        write_zip(&d.join("docs.zip"), &[("readme.txt", b"x")]);
        write_zip(&d.join("evil.zip"), &[("../../escape.stl", b"x"), ("ok.stl", b"y")]);
        std::fs::write(d.join("bad.zip"), b"not a zip").unwrap();
        touch(&d.join("Folder/part.stl"), 5);
        touch(&d.join("Empty/notes.txt"), 5);
        touch(&d.join("loose.stl"), 7);
        touch(&d.join("photo.jpg"), 7);
        touch(&d.join("pack.rar"), 7);
        write_7z(&d.join("Seven.7z"), &[("Seven/part.stl", b"solid"), ("Seven/notes.txt", b"n")]);
        let items = analyze(
            &[
                "Cable Clip.zip",
                "flat.zip",
                "docs.zip",
                "evil.zip",
                "bad.zip",
                "Folder",
                "Empty",
                "loose.stl",
                "photo.jpg",
                "pack.rar",
                "Seven.7z",
            ]
            .iter()
            .map(|n| d.join(n))
            .collect::<Vec<_>>(),
        );
        let by = |n: &str| items.iter().find(|i| i.source.ends_with(n)).unwrap();
        let cable = by("Cable Clip.zip");
        assert_eq!(
            (cable.kind, cable.action, cable.model_count, cable.file_count),
            (SourceKind::Archive, ImportAction::Project, 1, 2)
        );
        assert_eq!(cable.strip_prefix.as_deref(), Some("Cable Clip"));
        assert_eq!(by("flat.zip").strip_prefix, None);
        assert_eq!(by("docs.zip").action, ImportAction::Skip);
        let evil = by("evil.zip");
        assert_eq!(evil.file_count, 1);
        assert!(evil.warnings.iter().any(|w| w.contains("unsafe")));
        assert_eq!(by("bad.zip").action, ImportAction::Skip);
        assert_eq!(
            (by("Folder").kind, by("Folder").action),
            (SourceKind::Folder, ImportAction::Project)
        );
        assert_eq!(by("Empty").action, ImportAction::Skip);
        assert_eq!(
            (by("loose.stl").kind, by("loose.stl").action),
            (SourceKind::File, ImportAction::Inbox)
        );
        assert_eq!(by("photo.jpg").action, ImportAction::Inbox);
        assert!(by("pack.rar").warnings[0].contains("not extracted yet"));
        let seven = by("Seven.7z");
        assert_eq!(
            (seven.kind, seven.action, seven.model_count, seven.file_count),
            (SourceKind::Archive, ImportAction::Project, 1, 2)
        );
        assert_eq!(seven.strip_prefix.as_deref(), Some("Seven"));
    }

    #[test]
    fn execute_copies_loose_model_files_into_projects() {
        // A loose 3MF or STL with action "project" is copied as it is: the 3MF is a zip
        // inside but never extracted, and the archive policy does not touch model files.
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("src");
        let root = t.path().join("root");
        std::fs::create_dir_all(&root).unwrap();
        let threemf = &[("3D/3dmodel.model", b"<model/>" as &[u8]), ("Metadata/thumbnail.png", b"png")];
        write_zip(&src.join("Vase.3mf"), threemf);
        let threemf_bytes = std::fs::read(src.join("Vase.3mf")).unwrap();
        touch(&src.join("cake.stl"), 9);
        for (i, policy) in [
            ArchivePolicy::Keep,
            ArchivePolicy::Originals,
            ArchivePolicy::Trash,
            ArchivePolicy::Leave,
        ]
        .into_iter()
        .enumerate()
        {
            let req = ImportRequest {
                root_id: "r".into(),
                archive_policy: policy,
                apply_hints: false,
                fetch_pages: false,
                items: vec![
                    ImportRequestItem {
                        source: src.join("Vase.3mf"),
                        action: ImportAction::Project,
                        name: format!("Vase {i}"),
                    },
                    ImportRequestItem {
                        source: src.join("cake.stl"),
                        action: ImportAction::Project,
                        name: format!("Cake {i}"),
                    },
                ],
            };
            let report = execute(&root, &req, &remover(), &ScanOptions::default(), |_| {}).unwrap();
            assert!(report.errors.is_empty(), "{policy:?}: {:?}", report.errors);
            assert_eq!(report.projects, vec![format!("Vase {i}"), format!("Cake {i}")]);
            let vase = root.join(format!("Vase {i}"));
            assert_eq!(
                std::fs::read(vase.join("Vase.3mf")).unwrap(),
                threemf_bytes,
                "{policy:?}: 3MF intact"
            );
            assert!(!vase.join("3D").exists(), "{policy:?}: a 3MF is never extracted");
            assert_eq!(std::fs::read_dir(&vase).unwrap().count(), 1, "{policy:?}: only the model");
            assert_eq!(std::fs::read(root.join(format!("Cake {i}/cake.stl"))).unwrap().len(), 9);
            assert!(
                src.join("Vase.3mf").is_file() && src.join("cake.stl").is_file(),
                "{policy:?}: sources untouched"
            );
            assert!(!root.join(ORIGINALS_DIR).exists(), "{policy:?}: model files never go to _Originals");
        }
        assert!(!root.join(STAGING_DIR).exists(), "staging area is cleaned up");
    }

    #[test]
    fn execute_rolls_back_a_failed_project_and_keeps_the_source() {
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("src");
        let root = t.path().join("root");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("bad.zip"), b"not a zip").unwrap();
        write_zip(&src.join("docs.zip"), &[("readme.txt", b"no models here")]);
        write_zip(&src.join("Sidecar.zip"), &[("Sidecar/project.yaml", b"name: Sidecar\n")]);
        touch(&src.join("notes/readme.md"), 3);
        write_zip(&src.join("Good.zip"), &[("Good/part.stl", b"solid")]);
        // Something an interrupted earlier run left in the staging area is neither a project
        // nor in the way of the next import under that name.
        touch(&root.join(STAGING_DIR).join("Good/half.stl"), 1);
        let scanned = scan::scan_root("r", &root, &ScanOptions::default(), |_| {}).unwrap();
        assert!(scanned.projects.is_empty(), "the staging area is never scanned");
        let req = ImportRequest {
            root_id: "r".into(),
            archive_policy: ArchivePolicy::Trash,
            apply_hints: false,
            fetch_pages: false,
            items: vec![
                ImportRequestItem {
                    source: src.join("bad.zip"),
                    action: ImportAction::Project,
                    name: "Bad".into(),
                },
                ImportRequestItem {
                    source: src.join("docs.zip"),
                    action: ImportAction::Project,
                    name: "Docs".into(),
                },
                ImportRequestItem {
                    source: src.join("notes"),
                    action: ImportAction::Project,
                    name: "Notes".into(),
                },
                ImportRequestItem {
                    source: src.join("Sidecar.zip"),
                    action: ImportAction::Project,
                    name: "Sidecar".into(),
                },
                ImportRequestItem {
                    source: src.join("Good.zip"),
                    action: ImportAction::Project,
                    name: "Good".into(),
                },
            ],
        };
        let report = execute(&root, &req, &remover(), &ScanOptions::default(), |_| {}).unwrap();
        assert_eq!(report.projects, vec!["Good"]);
        assert_eq!(report.errors.len(), 4, "{:?}", report.errors);
        assert!(report.errors[0].starts_with("Bad: "), "{:?}", report.errors);
        for e in &report.errors[1..] {
            assert!(e.contains("no model files"), "{:?}", report.errors);
        }
        for name in ["Bad", "Docs", "Notes", "Sidecar"] {
            assert!(!root.join(name).exists(), "{name}: no half-made folder stays behind");
        }
        for file in ["bad.zip", "docs.zip", "Sidecar.zip"] {
            assert!(src.join(file).is_file(), "{file}: a failed item never trashes its source");
        }
        assert!(src.join("notes/readme.md").is_file());
        assert!(root.join("Good/part.stl").is_file());
        assert!(!root.join("Good/half.stl").exists(), "stale staging content is replaced");
        assert!(
            !src.join("Good.zip").exists(),
            "the good archive was trashed after its project was in place"
        );
        assert!(!root.join(STAGING_DIR).exists());

        // When the trash refuses the archive, the finished project stays and the report
        // carries a warning instead of counting the item as failed.
        write_zip(&src.join("Stuck.zip"), &[("Stuck/part.stl", b"solid")]);
        let failing: Deleter = Box::new(|_: &Path| Err(std::io::Error::other("recycle bin unavailable")));
        let req = ImportRequest {
            root_id: "r".into(),
            archive_policy: ArchivePolicy::Trash,
            apply_hints: false,
            fetch_pages: false,
            items: vec![ImportRequestItem {
                source: src.join("Stuck.zip"),
                action: ImportAction::Project,
                name: "Stuck".into(),
            }],
        };
        let report = execute(&root, &req, &failing, &ScanOptions::default(), |_| {}).unwrap();
        assert_eq!(report.projects, vec!["Stuck"]);
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert_eq!(report.warnings.len(), 1, "{:?}", report.warnings);
        assert!(report.warnings[0].contains("archive was left in place"), "{:?}", report.warnings);
        assert!(root.join("Stuck/part.stl").is_file());
        assert!(src.join("Stuck.zip").is_file());
    }

    #[test]
    fn execute_extracts_7z() {
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("src");
        let root = t.path().join("root");
        std::fs::create_dir_all(&root).unwrap();
        write_7z(
            &src.join("Seven.7z"),
            &[("Seven/part.stl", b"solid"), ("Seven/sub/notes.txt", b"n")],
        );
        let req = ImportRequest {
            root_id: "r".into(),
            archive_policy: ArchivePolicy::Trash,
            apply_hints: false,
            fetch_pages: false,
            items: vec![ImportRequestItem {
                source: src.join("Seven.7z"),
                action: ImportAction::Project,
                name: "Seven".into(),
            }],
        };
        let report = execute(&root, &req, &remover(), &ScanOptions::default(), |_| {}).unwrap();
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert!(root.join("Seven/part.stl").is_file());
        assert_eq!(std::fs::read(root.join("Seven/sub/notes.txt")).unwrap(), b"n");
        assert!(!src.join("Seven.7z").exists());
    }

    #[test]
    fn execute_extracts_copies_routes_and_applies_policy() {
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("src");
        let root = t.path().join("root");
        std::fs::create_dir_all(&root).unwrap();
        write_zip(
            &src.join("Cable Clip.zip"),
            &[("Cable Clip/files/clip.stl", b"solid"), ("Cable Clip/README.md", b"hi")],
        );
        write_zip(&src.join("Keep.zip"), &[("k.stl", b"solid")]);
        write_zip(&src.join("Gone.zip"), &[("g.stl", b"solid")]);
        touch(&src.join("Folder/part.stl"), 5);
        touch(&src.join("Folder/sub/more.stl"), 5);
        touch(&src.join("loose.stl"), 7);
        touch(&src.join("loose2.stl"), 7);
        let req = |policy, items: Vec<(&str, ImportAction, &str)>| ImportRequest {
            root_id: "r".into(),
            archive_policy: policy,
            apply_hints: false,
            fetch_pages: false,
            items: items
                .into_iter()
                .map(|(s, a, n)| ImportRequestItem {
                    source: src.join(s),
                    action: a,
                    name: n.into(),
                })
                .collect(),
        };
        let mut seen = 0;
        let report = execute(
            &root,
            &req(
                ArchivePolicy::Originals,
                vec![
                    ("Cable Clip.zip", ImportAction::Project, "Cable Clip"),
                    ("Folder", ImportAction::Project, "My Folder"),
                    ("loose.stl", ImportAction::Inbox, ""),
                    ("loose2.stl", ImportAction::Skip, ""),
                ],
            ),
            &remover(),
            &ScanOptions::default(),
            |p| seen = p.index + 1,
        )
        .unwrap();
        assert_eq!(seen, 4);
        assert_eq!(report.projects, vec!["Cable Clip", "My Folder"]);
        assert_eq!((report.inbox_files, report.skipped), (1, 1));
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert!(root.join("Cable Clip/files/clip.stl").is_file(), "prefix stripped");
        assert!(root.join("Cable Clip/README.md").is_file());
        assert!(root.join("_Originals/Cable Clip.zip").is_file(), "archive moved to _Originals");
        assert!(!src.join("Cable Clip.zip").exists());
        assert!(root.join("My Folder/sub/more.stl").is_file());
        assert!(src.join("Folder/part.stl").is_file(), "folders are copied, not moved");
        assert!(root.join("_Inbox/loose.stl").is_file());

        // keep policy: archive becomes an attachment; trash policy: archive is gone
        let report = execute(
            &root,
            &req(ArchivePolicy::Keep, vec![("Keep.zip", ImportAction::Project, "Keep")]),
            &remover(),
            &ScanOptions::default(),
            |_| {},
        )
        .unwrap();
        assert!(report.errors.is_empty());
        assert!(root.join("Keep/Keep.zip").is_file());
        assert!(root.join("Keep/k.stl").is_file());
        execute(
            &root,
            &req(ArchivePolicy::Trash, vec![("Gone.zip", ImportAction::Project, "Gone")]),
            &remover(),
            &ScanOptions::default(),
            |_| {},
        )
        .unwrap();
        assert!(!src.join("Gone.zip").exists());
        assert!(root.join("Gone/g.stl").is_file());
        write_zip(&src.join("Stay.zip"), &[("s.stl", b"0123456789")]);
        execute(
            &root,
            &req(ArchivePolicy::Leave, vec![("Stay.zip", ImportAction::Project, "Stay")]),
            &remover(),
            &ScanOptions::default(),
            |_| {},
        )
        .unwrap();
        assert!(src.join("Stay.zip").is_file(), "leave: the source archive is untouched");
        assert!(root.join("Stay/s.stl").is_file());
        assert!(!root.join("Stay/Stay.zip").exists());
        assert!(!root.join(ORIGINALS_DIR).join("Stay.zip").exists());

        // collisions are refused before anything is written
        let err = execute(
            &root,
            &req(ArchivePolicy::Keep, vec![("Folder", ImportAction::Project, "Keep")]),
            &remover(),
            &ScanOptions::default(),
            |_| {},
        )
        .unwrap_err();
        assert!(matches!(err, EngineError::AlreadyExists(_)));
        let err = execute(
            &root,
            &req(ArchivePolicy::Keep, vec![("Folder", ImportAction::Project, "_Inbox")]),
            &remover(),
            &ScanOptions::default(),
            |_| {},
        )
        .unwrap_err();
        assert!(matches!(err, EngineError::InvalidName(_)));
        let err = execute(
            &root,
            &req(
                ArchivePolicy::Keep,
                vec![("Folder", ImportAction::Project, "Dup"), ("Folder", ImportAction::Project, "dup")],
            ),
            &remover(),
            &ScanOptions::default(),
            |_| {},
        )
        .unwrap_err();
        assert!(matches!(err, EngineError::AlreadyExists(_)));
        assert!(!root.join("Dup").exists());

        // inbox: list, duplicate names get a suffix, promote moves files out
        execute(
            &root,
            &req(ArchivePolicy::Keep, vec![("loose.stl", ImportAction::Inbox, "")]),
            &remover(),
            &ScanOptions::default(),
            |_| {},
        )
        .unwrap();
        let inbox = list_inbox(&root).unwrap();
        let names: Vec<_> = inbox.iter().map(|f| f.name.as_str()).collect();
        assert!(names.contains(&"loose.stl") && names.contains(&"loose (2).stl"), "{names:?}");
        let dir = promote_inbox(&root, &["loose.stl".into()], "Promoted").unwrap();
        assert!(dir.join("loose.stl").is_file());
        assert_eq!(list_inbox(&root).unwrap().len(), 1);
        assert!(matches!(
            promote_inbox(&root, &["../x.stl".into()], "Nope"),
            Err(EngineError::InvalidName(_))
        ));
        assert!(matches!(
            promote_inbox(&root, &["missing.stl".into()], "Nope"),
            Err(EngineError::Io { .. })
        ));
        assert!(matches!(
            promote_inbox(&root, &["loose (2).stl".into()], "Promoted"),
            Err(EngineError::AlreadyExists(_))
        ));
    }
}
