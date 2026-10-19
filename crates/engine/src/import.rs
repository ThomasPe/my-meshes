//! Import with a staging step (IMP-1, IMP-2, IMP-3). `analyze` looks at dropped archives,
//! folders and files and proposes what to do with each; nothing is written. `execute`
//! performs the confirmed plan: extract archives into new project directories, copy folders,
//! route loose files to `_Inbox`, and apply the archive policy (keep as attachment, move to
//! `_Originals`, or trash). Every target is checked for collisions before the first write.

use crate::engine::Deleter;
use crate::error::{io_err, EngineError, Result};
use crate::model::FileKind;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

pub const INBOX_DIR: &str = "_Inbox";
pub const ORIGINALS_DIR: &str = "_Originals";
/// Folders below a root that are never projects: the inbox and kept originals.
pub const SPECIAL_DIRS: &[&str] = &[INBOX_DIR, ORIGINALS_DIR];

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
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImportReport {
    pub root_id: String,
    /// Relative paths (below the root) of the project directories created.
    pub projects: Vec<String>,
    pub inbox_files: u32,
    pub skipped: u32,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportProgress {
    pub index: u32,
    pub total: u32,
    pub name: String,
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
            items.push(ImportItem {
                source: p.clone(),
                kind: SourceKind::Folder,
                name: stem_name(p),
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
                    items.push(ImportItem {
                        source: p.clone(),
                        kind: SourceKind::Archive,
                        name: stem_name(p),
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
        let model = is_model(p.file_name().and_then(|n| n.to_str()).unwrap_or(""));
        items.push(ImportItem {
            source: p.clone(),
            kind: SourceKind::File,
            name: stem_name(p),
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
fn unique_file_name(dir: &Path, name: &str) -> PathBuf {
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
pub fn execute(root: &Path, req: &ImportRequest, deleter: &Deleter, mut progress: impl FnMut(ImportProgress)) -> Result<ImportReport> {
    if !root.is_dir() {
        return Err(EngineError::RootOffline(root.to_path_buf()));
    }
    // Pass 1: validate every target.
    let mut targets: Vec<Option<PathBuf>> = Vec::with_capacity(req.items.len());
    let mut seen: Vec<String> = Vec::new();
    for item in &req.items {
        match item.action {
            ImportAction::Project => {
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
                ImportAction::Project => {
                    let target = target.expect("validated above");
                    std::fs::create_dir_all(&target).map_err(io_err(&target))?;
                    if item.source.is_dir() {
                        copy_dir(&item.source, &target)?;
                    } else {
                        let summary = summarize_archive(&item.source)?;
                        if ext_of(&item.source) == "7z" {
                            extract_7z(&item.source, summary.strip_prefix.as_deref(), &target)?;
                        } else {
                            extract_zip(&item.source, summary.strip_prefix.as_deref(), &target)?;
                        }
                        let archive_name = item.source.file_name().and_then(|n| n.to_str()).unwrap_or("original.zip");
                        match req.archive_policy {
                            ArchivePolicy::Keep => {
                                let dst = unique_file_name(&target, archive_name);
                                std::fs::copy(&item.source, &dst).map_err(io_err(&dst))?;
                            }
                            ArchivePolicy::Originals => {
                                let originals = root.join(ORIGINALS_DIR);
                                std::fs::create_dir_all(&originals).map_err(io_err(&originals))?;
                                let dst = unique_file_name(&originals, archive_name);
                                if std::fs::rename(&item.source, &dst).is_err() {
                                    std::fs::copy(&item.source, &dst).map_err(io_err(&dst))?;
                                    deleter(&item.source).map_err(|e| EngineError::Io {
                                        path: item.source.clone(),
                                        source: e,
                                    })?;
                                }
                            }
                            ArchivePolicy::Trash => {
                                deleter(&item.source).map_err(|e| EngineError::Io {
                                    path: item.source.clone(),
                                    source: e,
                                })?;
                            }
                        }
                    }
                    report
                        .projects
                        .push(target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
                }
            }
            Ok(())
        })();
        if let Err(e) = result {
            report.errors.push(format!("{}: {e}", item.name));
        }
    }
    Ok(report)
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
            items: vec![ImportRequestItem {
                source: src.join("Seven.7z"),
                action: ImportAction::Project,
                name: "Seven".into(),
            }],
        };
        let report = execute(&root, &req, &remover(), |_| {}).unwrap();
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
            |_| {},
        )
        .unwrap();
        assert!(!src.join("Gone.zip").exists());
        assert!(root.join("Gone/g.stl").is_file());

        // collisions are refused before anything is written
        let err = execute(
            &root,
            &req(ArchivePolicy::Keep, vec![("Folder", ImportAction::Project, "Keep")]),
            &remover(),
            |_| {},
        )
        .unwrap_err();
        assert!(matches!(err, EngineError::AlreadyExists(_)));
        let err = execute(
            &root,
            &req(ArchivePolicy::Keep, vec![("Folder", ImportAction::Project, "_Inbox")]),
            &remover(),
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
