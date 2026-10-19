//! Scanning a library root into projects. Read-only by contract.
//!
//! Project boundary rule (open question Q10, option c): walking top-down, the first directory
//! that directly contains a model file or a `project.yaml` is a project, and everything below it
//! belongs to that project. Directories without models of their own are just structure.
//! A `project.yaml` found deeper inside a project is a warning (nested projects are not allowed).

use crate::error::{EngineError, Result};
use crate::model::{FileEntry, FileKind, Project, SidecarState, SIDECAR_FILE_NAME};
use crate::sidecar;
use crate::threemf;
use globset::{Glob, GlobSet, GlobSetBuilder};
use std::path::{Component, Path};
use time::OffsetDateTime;
use walkdir::WalkDir;

pub const DEFAULT_IGNORE: &[&str] = &[
    ".git",
    "__MACOSX",
    ".DS_Store",
    "Thumbs.db",
    "node_modules",
    ".cache",
    ".meshkeep",
    "*.gcode",
    "*.bgcode",
    "*.tmp",
];

/// Sub-folder names that download bundles (Printables, MakerWorld, Thingiverse zips) use to
/// hold the model files next to images and a README. A folder whose models live only in such
/// children is one project, not a project per child (case-insensitive match).
pub const DEFAULT_CONTAINER_DIRS: &[&str] = &[
    "files",
    "file",
    "stl",
    "stls",
    "3mf",
    "obj",
    "models",
    "model",
    "meshes",
    "3d",
    "print files",
    "printfiles",
];

#[derive(Debug, Clone)]
pub struct ScanOptions {
    pub ignore: Vec<String>,
    pub container_dirs: Vec<String>,
}

impl Default for ScanOptions {
    fn default() -> Self {
        ScanOptions {
            ignore: DEFAULT_IGNORE.iter().map(|s| s.to_string()).collect(),
            container_dirs: DEFAULT_CONTAINER_DIRS.iter().map(|s| s.to_string()).collect(),
        }
    }
}

impl ScanOptions {
    pub fn is_container_name(&self, name: &str) -> bool {
        let n = name.trim().to_lowercase();
        self.container_dirs.iter().any(|c| c.trim().to_lowercase() == n)
    }
}

#[derive(Debug, Default)]
pub struct ScanOutcome {
    pub projects: Vec<Project>,
    pub files: u32,
    pub ignored: u32,
    pub warnings: Vec<String>,
}

pub struct IgnoreMatcher {
    set: GlobSet,
}

impl IgnoreMatcher {
    pub fn new(patterns: &[String]) -> Result<IgnoreMatcher> {
        let mut b = GlobSetBuilder::new();
        for p in patterns {
            b.add(Glob::new(p).map_err(|e| EngineError::Pattern(format!("{p}: {e}")))?);
        }
        Ok(IgnoreMatcher {
            set: b.build().map_err(|e| EngineError::Pattern(e.to_string()))?,
        })
    }
    /// Patterns match against the file/dir name and against the path relative to the root.
    pub fn is_ignored(&self, rel: &Path) -> bool {
        if let Some(name) = rel.file_name() {
            if self.set.is_match(name) {
                return true;
            }
        }
        self.set.is_match(rel)
    }
}

pub fn to_rel_string(rel: &Path) -> String {
    rel.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn modified_of(meta: &std::fs::Metadata) -> OffsetDateTime {
    meta.modified().ok().map(OffsetDateTime::from).unwrap_or(OffsetDateTime::UNIX_EPOCH)
}

/// What a directory directly contains, as far as the boundary rule cares.
#[derive(Debug, Default)]
struct DirShape {
    /// A model file or a `project.yaml` directly inside.
    marker: bool,
    /// Images or documents directly inside (what a download bundle carries next to `files/`).
    media: bool,
    /// Non-ignored child directories: (name, directly contains models).
    children: Vec<(String, bool)>,
}

fn dir_shape(dir: &Path, ignore: &IgnoreMatcher, root: &Path, look_into_children: bool) -> std::io::Result<DirShape> {
    let mut shape = DirShape::default();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let rel = path.strip_prefix(root).unwrap_or(&path);
        if ignore.is_ignored(rel) {
            continue;
        }
        let ft = entry.file_type()?;
        if ft.is_file() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name == SIDECAR_FILE_NAME {
                shape.marker = true;
                continue;
            }
            match path.extension().and_then(|e| e.to_str()).map(FileKind::from_extension) {
                Some(FileKind::Model) => shape.marker = true,
                Some(FileKind::Image) | Some(FileKind::Document) => shape.media = true,
                _ => {}
            }
        } else if ft.is_dir() && look_into_children {
            let has_models = dir_shape(&path, ignore, root, false).map(|s| s.marker).unwrap_or(false);
            shape.children.push((entry.file_name().to_string_lossy().into_owned(), has_models));
        }
    }
    Ok(shape)
}

/// The boundary rule (Q10 option c, extended): a directory is a project when it directly
/// contains a model or a sidecar, or when it is a download bundle: no models of its own, at
/// least one container-named child (`files/`, `stl/`, ...) that holds models, and either
/// media next to it or nothing but container children.
fn dir_is_project(dir: &Path, ignore: &IgnoreMatcher, root: &Path, opts: &ScanOptions) -> std::io::Result<bool> {
    let shape = dir_shape(dir, ignore, root, true)?;
    if shape.marker {
        return Ok(true);
    }
    let container_with_models = shape.children.iter().any(|(n, m)| *m && opts.is_container_name(n));
    if !container_with_models {
        return Ok(false);
    }
    let all_containers = shape.children.iter().all(|(n, _)| opts.is_container_name(n));
    Ok(shape.media || all_containers)
}

/// Whether `dir` still qualifies as a project under the boundary rule.
pub fn is_project_dir(dir: &Path, ignore: &IgnoreMatcher, root: &Path, opts: &ScanOptions) -> bool {
    dir_is_project(dir, ignore, root, opts).unwrap_or(false)
}

/// Collects every file beneath `project_dir` into a project. Does not write anything.
pub fn read_project(root_id: &str, root: &Path, project_dir: &Path, ignore: &IgnoreMatcher, out: &mut ScanOutcome) -> Result<Project> {
    let rel_dir = project_dir.strip_prefix(root).unwrap_or(Path::new(""));
    let rel_path = to_rel_string(rel_dir);
    let mut files = Vec::new();
    let mut warnings = Vec::new();
    let mut total = 0u64;
    let mut newest = OffsetDateTime::UNIX_EPOCH;
    let mut walker = WalkDir::new(project_dir).follow_links(false).sort_by_file_name().into_iter();
    while let Some(entry) = walker.next() {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                warnings.push(format!("unreadable entry: {e}"));
                continue;
            }
        };
        let path = entry.path();
        if path == project_dir {
            continue;
        }
        let rel_root = path.strip_prefix(root).unwrap_or(path);
        if ignore.is_ignored(rel_root) {
            out.ignored += 1;
            if entry.file_type().is_dir() {
                walker.skip_current_dir();
            }
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let rel_in_project = to_rel_string(path.strip_prefix(project_dir).unwrap_or(path));
        if name == SIDECAR_FILE_NAME {
            if entry.depth() > 1 {
                warnings.push(format!("nested project.yaml ignored: {rel_in_project}"));
            }
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(e) => {
                warnings.push(format!("{rel_in_project}: {e}"));
                continue;
            }
        };
        let kind = path
            .extension()
            .and_then(|e| e.to_str())
            .map(FileKind::from_extension)
            .unwrap_or(FileKind::Other);
        let modified = modified_of(&meta);
        if modified > newest {
            newest = modified;
        }
        total += meta.len();
        let (slicer, embedded_thumbnail) = if kind == FileKind::Model && name.to_ascii_lowercase().ends_with(".3mf") {
            match threemf::inspect(path) {
                Ok(info) => (info.slicer, info.thumbnail_entry.is_some()),
                Err(e) => {
                    warnings.push(format!("{rel_in_project}: not a readable 3MF ({e})"));
                    (None, false)
                }
            }
        } else {
            (None, false)
        };
        files.push(FileEntry {
            rel_path: rel_in_project,
            name,
            kind,
            size: meta.len(),
            modified,
            slicer,
            embedded_thumbnail,
        });
    }
    out.files += files.len() as u32;

    let dir_name = project_dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.to_string_lossy().into_owned());
    let (sidecar, state) = match sidecar::read(project_dir) {
        Ok(Some((sc, _))) => (Some(sc), SidecarState::Ok),
        Ok(None) => (None, SidecarState::Missing),
        Err(EngineError::SidecarInvalid(msg)) => {
            warnings.push(format!("project.yaml could not be parsed: {msg}"));
            (None, SidecarState::Malformed(msg))
        }
        Err(e) => return Err(e),
    };
    let md = sidecar.as_ref().map(|s| s.metadata.clone()).unwrap_or_default();
    let pr = sidecar.as_ref().map(|s| s.printing.clone()).unwrap_or_default();
    let model_count = files.iter().filter(|f| f.kind == FileKind::Model).count() as u32;
    let dir_meta = std::fs::metadata(project_dir).ok();
    if newest == OffsetDateTime::UNIX_EPOCH {
        if let Some(m) = &dir_meta {
            newest = modified_of(m);
        }
    }
    // "Added" is when the directory appeared: creation time where the file system has one
    // (NTFS, APFS), otherwise the directory's own mtime.
    let added = dir_meta
        .as_ref()
        .and_then(|m| m.created().ok().map(OffsetDateTime::from).or_else(|| Some(modified_of(m))))
        .unwrap_or(newest);
    let slicer = files.iter().find_map(|f| f.slicer.clone());
    Ok(Project {
        id: Project::make_id(root_id, &rel_path),
        root_id: root_id.to_string(),
        rel_path,
        title: md.title.filter(|t| !t.trim().is_empty()).unwrap_or(dir_name),
        creator: md.creator,
        license: md.license,
        source_url: md.source_url,
        description: md.description,
        tags: md.tags,
        material: pr.recommended_material,
        supports_required: pr.supports_required,
        thumbnail: sidecar.as_ref().and_then(|s| s.thumbnail.clone()),
        files,
        total_bytes: total,
        model_count,
        modified: newest,
        sidecar: state,
        sidecar_stamp: None,
        warnings,
        offline: false,
        favorite: false,
        added,
        thumb: None,
        slicer,
    })
}

/// Scans a whole root. Never writes.
pub fn scan_root(root_id: &str, root: &Path, opts: &ScanOptions, mut progress: impl FnMut(u32)) -> Result<ScanOutcome> {
    if !root.is_dir() {
        return Err(EngineError::RootOffline(root.to_path_buf()));
    }
    let ignore = IgnoreMatcher::new(&opts.ignore)?;
    let mut out = ScanOutcome::default();
    let mut walker = WalkDir::new(root).follow_links(false).sort_by_file_name().into_iter();
    while let Some(entry) = walker.next() {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                out.warnings.push(format!("unreadable entry: {e}"));
                continue;
            }
        };
        if !entry.file_type().is_dir() {
            continue;
        }
        let dir = entry.path();
        let rel = dir.strip_prefix(root).unwrap_or(dir);
        if dir != root && ignore.is_ignored(rel) {
            out.ignored += 1;
            walker.skip_current_dir();
            continue;
        }
        // `_Inbox` and `_Originals` directly below the root are the app's own folders, not projects.
        if entry.depth() == 1 && crate::import::SPECIAL_DIRS.iter().any(|s| rel.as_os_str().eq_ignore_ascii_case(s)) {
            walker.skip_current_dir();
            continue;
        }
        let is_project = match dir_is_project(dir, &ignore, root, opts) {
            Ok(v) => v,
            Err(e) => {
                out.warnings.push(format!("{}: {e}", to_rel_string(rel)));
                false
            }
        };
        if is_project {
            let project = read_project(root_id, root, dir, &ignore, &mut out)?;
            out.warnings
                .extend(project.warnings.iter().map(|w| format!("{}: {w}", project.rel_path)));
            out.projects.push(project);
            progress(out.projects.len() as u32);
            walker.skip_current_dir();
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn touch(p: &Path, bytes: usize) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, vec![0u8; bytes]).unwrap();
    }

    #[test]
    fn project_boundaries_follow_the_heuristic() {
        let t = tempfile::tempdir().unwrap();
        let r = t.path();
        touch(&r.join("Gridfinity/Bins/bin_1x1.stl"), 10);
        touch(&r.join("Gridfinity/Bins/bin_1x2.stl"), 10);
        touch(&r.join("Gridfinity/Lids/lid.stl"), 10);
        touch(&r.join("Robotics/Arm v4/base.stl"), 10);
        touch(&r.join("Robotics/Arm v4/stl/forearm.stl"), 10);
        touch(&r.join("Robotics/Arm v4/stl/project.yaml"), 5); // nested -> warning, same project
        touch(&r.join("Robotics/Arm v4/firmware.zip"), 10);
        touch(&r.join("Robotics/Arm v4/.git/HEAD"), 1); // ignored
        touch(&r.join("Props/empty-but-sidecar/project.yaml"), 0);
        fs::write(r.join("Props/empty-but-sidecar/project.yaml"), "metadata:\n  title: Only sidecar\n").unwrap();
        touch(&r.join("Docs/readme.txt"), 3); // not a project
        touch(&r.join("Robotics/Arm v4/print.gcode"), 3); // ignored by pattern

        let out = scan_root("r1", r, &ScanOptions::default(), |_| {}).unwrap();
        let mut names: Vec<_> = out.projects.iter().map(|p| p.rel_path.clone()).collect();
        names.sort();
        assert_eq!(
            names,
            vec!["Gridfinity/Bins", "Gridfinity/Lids", "Props/empty-but-sidecar", "Robotics/Arm v4"]
        );
        let arm = out.projects.iter().find(|p| p.rel_path == "Robotics/Arm v4").unwrap();
        assert_eq!(arm.model_count, 2, "{:?}", arm.files);
        assert!(arm.files.iter().any(|f| f.kind == FileKind::Attachment));
        assert!(!arm.files.iter().any(|f| f.name == "print.gcode"));
        assert!(!arm.files.iter().any(|f| f.rel_path.starts_with(".git")));
        assert!(arm.warnings.iter().any(|w| w.contains("nested project.yaml")), "{:?}", arm.warnings);
        let only = out.projects.iter().find(|p| p.rel_path == "Props/empty-but-sidecar").unwrap();
        assert_eq!(only.title, "Only sidecar");
        assert_eq!(only.sidecar, SidecarState::Ok);
        assert_eq!(arm.sidecar, SidecarState::Missing);
        assert_eq!(arm.title, "Arm v4");
        assert!(arm.added != OffsetDateTime::UNIX_EPOCH);
    }

    #[test]
    fn slicer_3mf_is_detected_and_bad_3mf_is_a_warning() {
        let t = tempfile::tempdir().unwrap();
        let r = t.path();
        touch(&r.join("P/part.stl"), 10);
        crate::threemf::tests::write_3mf(
            &r.join("P/plate.3mf"),
            &[
                ("Metadata/Slic3r_PE.config", b"x"),
                ("Metadata/thumbnail.png", crate::threemf::tests::TINY_PNG),
            ],
        );
        touch(&r.join("P/broken.3mf"), 20);
        let out = scan_root("r1", r, &ScanOptions::default(), |_| {}).unwrap();
        let p = &out.projects[0];
        assert_eq!(p.slicer.as_deref(), Some("PrusaSlicer"));
        let plate = p.files.iter().find(|f| f.name == "plate.3mf").unwrap();
        assert!(plate.embedded_thumbnail);
        assert_eq!(p.model_count, 3);
        assert!(p.warnings.iter().any(|w| w.contains("broken.3mf")), "{:?}", p.warnings);
    }

    #[test]
    fn download_bundles_are_one_project() {
        let t = tempfile::tempdir().unwrap();
        let r = t.path();
        // Printables-style: README + images at the top, models in files/
        touch(&r.join("Cable Organizer/README.md"), 3);
        touch(&r.join("Cable Organizer/images/photo.jpg"), 3);
        touch(&r.join("Cable Organizer/photo.jpg"), 3);
        touch(&r.join("Cable Organizer/files/body.stl"), 10);
        touch(&r.join("Cable Organizer/files/lid.stl"), 10);
        // bare bundle: nothing but a container folder
        touch(&r.join("Bare/STL/part.stl"), 10);
        // a plain category folder with real sub-projects stays a category
        touch(&r.join("Gridfinity/notes.txt"), 3);
        touch(&r.join("Gridfinity/Bins/bin.stl"), 10);
        touch(&r.join("Gridfinity/Lids/lid.stl"), 10);
        // media next to a non-container child: still a category
        touch(&r.join("Mixed/cover.png"), 3);
        touch(&r.join("Mixed/Arm/arm.stl"), 10);

        let out = scan_root("r1", r, &ScanOptions::default(), |_| {}).unwrap();
        let mut names: Vec<_> = out.projects.iter().map(|p| p.rel_path.clone()).collect();
        names.sort();
        assert_eq!(
            names,
            vec!["Bare", "Cable Organizer", "Gridfinity/Bins", "Gridfinity/Lids", "Mixed/Arm"]
        );
        let bundle = out.projects.iter().find(|p| p.rel_path == "Cable Organizer").unwrap();
        assert_eq!(bundle.title, "Cable Organizer");
        assert_eq!(bundle.model_count, 2);
        assert_eq!(bundle.files.len(), 5);
        assert!(bundle.files.iter().any(|f| f.rel_path == "files/body.stl"));

        // the list is configurable
        let opts = ScanOptions {
            container_dirs: vec![],
            ..Default::default()
        };
        let out = scan_root("r1", r, &opts, |_| {}).unwrap();
        assert!(out.projects.iter().any(|p| p.rel_path == "Cable Organizer/files"));
    }

    #[test]
    fn inbox_and_originals_are_not_projects() {
        let t = tempfile::tempdir().unwrap();
        touch(&t.path().join("_Inbox/loose.stl"), 10);
        touch(&t.path().join("_Originals/old.zip"), 10);
        touch(&t.path().join("Real/part.stl"), 10);
        let out = scan_root("r1", t.path(), &ScanOptions::default(), |_| {}).unwrap();
        assert_eq!(out.projects.iter().map(|p| p.rel_path.as_str()).collect::<Vec<_>>(), vec!["Real"]);
    }

    #[test]
    fn root_with_loose_models_is_itself_a_project() {
        let t = tempfile::tempdir().unwrap();
        touch(&t.path().join("loose.stl"), 10);
        touch(&t.path().join("Sub/other.stl"), 10);
        let out = scan_root("r1", t.path(), &ScanOptions::default(), |_| {}).unwrap();
        assert_eq!(out.projects.len(), 1);
        assert_eq!(out.projects[0].rel_path, "");
        assert_eq!(out.projects[0].files.len(), 2);
    }

    #[test]
    fn malformed_sidecar_is_a_warning() {
        let t = tempfile::tempdir().unwrap();
        touch(&t.path().join("P/a.stl"), 1);
        fs::write(t.path().join("P/project.yaml"), "metadata: [oops").unwrap();
        let out = scan_root("r1", t.path(), &ScanOptions::default(), |_| {}).unwrap();
        assert!(matches!(out.projects[0].sidecar, SidecarState::Malformed(_)));
        assert_eq!(out.projects[0].title, "P");
    }

    #[test]
    fn missing_root_is_offline() {
        let err = scan_root("r1", Path::new("/definitely/not/here"), &ScanOptions::default(), |_| {}).unwrap_err();
        assert!(matches!(err, EngineError::RootOffline(_)));
    }
}
