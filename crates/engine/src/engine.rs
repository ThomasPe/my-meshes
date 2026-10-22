//! The facade the application shell talks to. One instance per app; not thread-safe by
//! itself (wrap in a mutex in the shell), but every operation is short except `scan_root`.

use crate::collections::{Collection, CollectionsStore, SmartCollection};
use crate::error::{EngineError, Result};
use crate::hash;
use crate::import::{self, ImportItem, ImportProgress, ImportReport, ImportRequest, InboxFile};
use crate::index::{Index, ThumbSourceState};
use crate::model::{
    Facets, FolderNode, LibraryRoot, ListQuery, Project, ProjectSummary, RootStatus, ScanReport, ScanSummary, Sidecar, SidecarStamp,
    SyncMode, TagCount, ThumbJob, ThumbLocation, ThumbSource, ThumbStats,
};
use crate::roots::RootsStore;
use crate::scan::{self, IgnoreMatcher, ScanOptions};
use crate::settings::{Settings, SettingsStore};
use crate::sidecar;
use crate::watch::{RootWatcher, WatchEvent};
use crate::{threemf, thumbs};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use time::OffsetDateTime;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ScanProgress {
    pub root_id: String,
    pub projects_found: u32,
}

/// Partial update of a project's metadata. `None` leaves a field unchanged.
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct UpdateMetadata {
    pub title: Option<String>,
    pub creator: Option<String>,
    pub license: Option<String>,
    pub source_url: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub recommended_material: Option<String>,
    pub supports_required: Option<bool>,
    pub notes: Option<String>,
    /// Stamp from the last `get_project`; `None` means "I believe there is no sidecar".
    #[serde(default)]
    pub expected_stamp: Option<SidecarStamp>,
    /// Skip the conflict check (after the user chose to overwrite).
    #[serde(default)]
    pub force: bool,
}

/// One change applied to many projects at once (META-6). Tags are merged, not replaced;
/// `creator`/`license` set the field when `Some` (an empty string clears it).
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct BatchUpdate {
    #[serde(default)]
    pub add_tags: Vec<String>,
    #[serde(default)]
    pub remove_tags: Vec<String>,
    pub creator: Option<String>,
    pub license: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BatchFailure {
    pub project_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct BatchReport {
    pub updated: u32,
    pub failed: Vec<BatchFailure>,
}

/// Progress of the hashing step of duplicate detection.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct HashProgress {
    pub done: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DuplicateKind {
    /// The projects hold exactly the same model files (by content).
    Identical,
    /// The projects share some model files but differ in others.
    Overlap,
}

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateMember {
    #[serde(flatten)]
    pub project: ProjectSummary,
    /// How many of the group's shared files this project holds.
    pub shared_files: u32,
    /// All model files of this project.
    pub model_files: u32,
    /// Members whose model files all exist in this project (by content): the ones that can
    /// go when this one is kept. A project with a model the kept one lacks is never covered.
    pub covers: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateGroup {
    pub kind: DuplicateKind,
    /// Distinct model files (by content) that at least two members share.
    pub files: u32,
    /// Their size, counted once.
    pub bytes: u64,
    pub members: Vec<DuplicateMember>,
}

/// Outcome of duplicate detection (LIB-8).
#[derive(Debug, Clone, Serialize, Default)]
pub struct DuplicateReport {
    pub groups: Vec<DuplicateGroup>,
    /// Model files considered (same size as a file in another project).
    pub candidates: u32,
    /// Files hashed in this run (the rest came from the cache).
    pub hashed: u32,
}

/// Outcome of moving projects into another folder (IMP-7): the projects under their new
/// ids plus the ones that stayed put and why (name taken, offline), one bad row never
/// stops the rest.
#[derive(Debug, Clone, Serialize, Default)]
pub struct MoveReport {
    pub moved: Vec<Project>,
    pub failed: Vec<BatchFailure>,
}

/// One inbox file that becomes a project of its own (IMP-3, "make separate projects").
#[derive(Debug, Clone, Deserialize)]
pub struct PromoteItem {
    pub file: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PromoteFailure {
    pub file: String,
    pub message: String,
}

/// Outcome of a batch promote: every created project plus the files that stayed in the
/// inbox and why (name taken, file gone), so one bad row does not undo the others.
#[derive(Debug, Clone, Serialize, Default)]
pub struct PromoteReport {
    pub created: Vec<Project>,
    pub failed: Vec<PromoteFailure>,
}

/// How files leave a library. The default moves them to the OS trash / recycle bin
/// (IMP-5); tests inject a plain remove.
pub type Deleter = Box<dyn Fn(&Path) -> std::io::Result<()> + Send>;

fn trash_deleter() -> Deleter {
    Box::new(|p: &Path| trash::delete(p).map_err(|e| std::io::Error::other(e.to_string())))
}

pub struct Engine {
    data_dir: PathBuf,
    roots: RootsStore,
    index: Index,
    collections: CollectionsStore,
    settings: SettingsStore,
    scan_opts: ScanOptions,
    deleter: Deleter,
}

impl Engine {
    pub fn open(data_dir: &Path) -> Result<Engine> {
        std::fs::create_dir_all(data_dir).map_err(crate::error::io_err(data_dir))?;
        let roots = RootsStore::open(data_dir)?;
        let index = Index::open(&data_dir.join("index.sqlite"))?;
        let collections = CollectionsStore::open(data_dir)?;
        let settings = SettingsStore::open(data_dir)?;
        let scan_opts = ScanOptions {
            ignore: settings.get().ignore.clone(),
            container_dirs: settings.get().container_dirs.clone(),
        };
        Ok(Engine {
            data_dir: data_dir.to_path_buf(),
            roots,
            index,
            collections,
            settings,
            scan_opts,
            deleter: trash_deleter(),
        })
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    /// Replaces the trash-based deleter (tests, or a future "delete permanently" setting).
    pub fn set_deleter(&mut self, deleter: Deleter) {
        self.deleter = deleter;
    }

    pub fn ignore_patterns(&self) -> &[String] {
        &self.scan_opts.ignore
    }

    pub fn set_ignore_patterns(&mut self, patterns: Vec<String>) -> Result<()> {
        IgnoreMatcher::new(&patterns)?; // validate
        self.settings.update(|s| s.ignore = patterns.clone())?;
        self.scan_opts.ignore = patterns;
        Ok(())
    }

    pub fn settings(&self) -> &Settings {
        self.settings.get()
    }

    pub fn thumb_location(&self) -> ThumbLocation {
        self.settings.get().thumb_location
    }

    /// Switching the location keeps existing previews where they are; they are found by
    /// `thumbnail_path` either way and re-created at the new place when their source changes.
    pub fn set_thumb_location(&mut self, location: ThumbLocation) -> Result<ThumbLocation> {
        self.settings.update(|s| s.thumb_location = location)?;
        Ok(location)
    }

    /// Sub-folder names that mark a download bundle (see `scan::DEFAULT_CONTAINER_DIRS`).
    pub fn container_dirs(&self) -> &[String] {
        &self.scan_opts.container_dirs
    }

    pub fn set_container_dirs(&mut self, names: Vec<String>) -> Result<()> {
        let clean: Vec<String> = names.into_iter().map(|n| n.trim().to_string()).filter(|n| !n.is_empty()).collect();
        self.settings.update(|s| s.container_dirs = clean.clone())?;
        self.scan_opts.container_dirs = clean;
        Ok(())
    }

    // ---- roots -------------------------------------------------------------------------

    pub fn roots(&mut self) -> Result<Vec<LibraryRoot>> {
        self.roots.refresh_status()?;
        for r in self.roots.list().to_vec() {
            self.index.mark_root_offline(&r.id, r.status == RootStatus::Offline)?;
        }
        Ok(self.roots.list().to_vec())
    }

    pub fn root(&self, id: &str) -> Result<LibraryRoot> {
        self.roots.get(id).cloned().ok_or_else(|| EngineError::RootNotFound(id.to_string()))
    }

    pub fn add_root(&mut self, path: &Path, mode: SyncMode) -> Result<LibraryRoot> {
        self.roots.add(path, mode)
    }

    pub fn remove_root(&mut self, id: &str) -> Result<LibraryRoot> {
        let root = self.roots.remove(id)?;
        self.index.remove_root(id)?;
        Ok(root)
    }

    pub fn set_root_mode(&mut self, id: &str, mode: SyncMode, poll_interval_secs: Option<u64>) -> Result<LibraryRoot> {
        self.roots.update(id, |r| {
            r.mode = mode;
            if let Some(s) = poll_interval_secs {
                r.poll_interval_secs = s.max(30);
            }
        })
    }

    /// Roots in poll mode whose interval has elapsed since the last scan (LIB-4). The shell
    /// calls this on a timer and scans what comes back.
    pub fn poll_due(&self, now: OffsetDateTime) -> Vec<String> {
        self.roots
            .list()
            .iter()
            .filter(|r| r.mode == SyncMode::Poll && r.status != RootStatus::Offline)
            .filter(|r| match r.last_scan_at {
                None => true,
                Some(last) => now - last >= Duration::from_secs(r.poll_interval_secs.max(30)),
            })
            .map(|r| r.id.clone())
            .collect()
    }

    // ---- scanning ---------------------------------------------------------------------

    /// Full scan of one root; replaces its index rows. A missing directory marks the root
    /// offline and keeps the index as it was.
    pub fn scan_root(&mut self, id: &str, progress: impl FnMut(ScanProgress)) -> Result<ScanReport> {
        self.scan_root_as(id, "manual", progress)
    }

    /// Like `scan_root`, recording what triggered the scan in the root's status (LIB-6).
    pub fn scan_root_as(&mut self, id: &str, trigger: &str, mut progress: impl FnMut(ScanProgress)) -> Result<ScanReport> {
        let root = self.root(id)?;
        let started = Instant::now();
        let mut outcome = match scan::scan_root(&root.id, &root.path, &self.scan_opts, |n| {
            progress(ScanProgress {
                root_id: id.to_string(),
                projects_found: n,
            })
        }) {
            Ok(o) => o,
            Err(EngineError::RootOffline(p)) => {
                self.roots.update(id, |r| {
                    r.status = RootStatus::Offline;
                    r.last_error = Some(format!("folder not reachable: {}", p.display()));
                })?;
                self.index.mark_root_offline(id, true)?;
                return Err(EngineError::RootOffline(p));
            }
            Err(e) => {
                self.roots.update(id, |r| r.last_error = Some(e.to_string()))?;
                return Err(e);
            }
        };
        for p in &mut outcome.projects {
            p.favorite = self.collections.is_favorite(&p.id);
        }
        self.index.rebuild_root(id, &outcome.projects)?;
        let summary = ScanSummary {
            projects: outcome.projects.len() as u32,
            files: outcome.files,
            ignored: outcome.ignored,
            warnings: outcome.warnings.iter().take(50).cloned().collect(),
            warning_count: outcome.warnings.len() as u32,
            millis: started.elapsed().as_millis() as u64,
            trigger: trigger.to_string(),
        };
        self.roots.update(id, |r| {
            r.status = RootStatus::Online;
            r.last_scan_at = Some(OffsetDateTime::now_utc());
            r.last_scan = Some(summary);
            r.last_error = None;
        })?;
        Ok(ScanReport {
            root_id: id.to_string(),
            projects: outcome.projects.len() as u32,
            files: outcome.files,
            ignored: outcome.ignored,
            warnings: outcome.warnings,
            millis: started.elapsed().as_millis(),
        })
    }

    /// Reacts to watcher events. Coarse but correct for now: any change under a root
    /// re-scans that root. Fine up to tens of thousands of files (a scan is sub-second
    /// per few thousand projects); project-level rescans are an optimization for later.
    pub fn rescan_for_event(&mut self, ev: &WatchEvent) -> Result<ScanReport> {
        self.scan_root_as(&ev.root_id, "watch", |_| {})
    }

    /// Records a sync problem the shell noticed (e.g. the watcher could not start on a share).
    pub fn set_root_error(&mut self, id: &str, message: &str) -> Result<LibraryRoot> {
        self.roots.update(id, |r| r.last_error = Some(message.to_string()))
    }

    pub fn start_watch(&self, root_id: &str, tx: mpsc::Sender<WatchEvent>) -> Result<RootWatcher> {
        let root = self.root(root_id)?;
        RootWatcher::start(root.id.clone(), &root.path, Duration::from_millis(750), tx)
    }

    // ---- reading ----------------------------------------------------------------------

    pub fn list_projects(&self, q: &ListQuery) -> Result<Vec<ProjectSummary>> {
        match &q.collection_id {
            Some(cid) => {
                let members = self.collections.collection(cid)?.projects.clone();
                self.index.list(q, Some(&members))
            }
            None => self.index.list(q, None),
        }
    }

    /// Evaluates a smart collection's saved query (with the caller's sort/paging on top).
    pub fn list_smart_collection(&self, id: &str, overrides: Option<&ListQuery>) -> Result<Vec<ProjectSummary>> {
        let mut q = self.collections.smart_collection(id)?.query.clone();
        if let Some(o) = overrides {
            q.sort = o.sort;
            q.limit = o.limit;
            q.offset = o.offset;
            if o.text.is_some() {
                q.text = o.text.clone();
            }
        }
        self.index.list(&q, None)
    }

    pub fn get_project(&self, id: &str) -> Result<Project> {
        let mut p = self
            .index
            .project(id)?
            .ok_or_else(|| EngineError::ProjectNotFound(id.to_string()))?;
        if !p.offline {
            if let Ok(Some((_, stamp))) = sidecar::read(&self.project_dir(&p)?) {
                p.sidecar_stamp = Some(stamp);
            }
        }
        Ok(p)
    }

    pub fn facets(&self, root_id: Option<&str>) -> Result<Facets> {
        self.index.facets(root_id)
    }

    pub fn tag_counts(&self, root_id: Option<&str>) -> Result<Vec<TagCount>> {
        self.index.tag_counts(root_id)
    }

    pub fn folder_tree(&self, root_id: &str) -> Result<Vec<FolderNode>> {
        self.index.folder_tree(root_id)
    }

    pub fn count(&self, root_id: Option<&str>) -> Result<(u32, u64)> {
        self.index.count(root_id)
    }

    pub fn favorite_count(&self) -> Result<u32> {
        self.index.favorite_count()
    }

    pub fn project_dir(&self, p: &Project) -> Result<PathBuf> {
        let root = self.root(&p.root_id)?;
        Ok(if p.rel_path.is_empty() {
            root.path
        } else {
            root.path.join(&p.rel_path)
        })
    }

    fn online_project(&self, id: &str) -> Result<Project> {
        let p = self
            .index
            .project(id)?
            .ok_or_else(|| EngineError::ProjectNotFound(id.to_string()))?;
        if p.offline {
            return Err(EngineError::RootOffline(self.root(&p.root_id)?.path));
        }
        Ok(p)
    }

    /// Absolute path of a folder inside a root (a tree node, the inbox, a project). Refuses
    /// anything that escapes the root and anything that does not exist.
    pub fn resolve_dir(&self, root_id: &str, rel: &str) -> Result<PathBuf> {
        let root = self.root(root_id)?;
        let rel_path = Path::new(rel);
        if rel_path.is_absolute()
            || rel_path
                .components()
                .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_) | Component::RootDir))
        {
            return Err(EngineError::NotAllowed(format!("path escapes the root: {rel}")));
        }
        let full = if rel.is_empty() {
            root.path.clone()
        } else {
            root.path.join(rel_path)
        };
        if !full.is_dir() {
            return Err(EngineError::Io {
                path: full,
                source: std::io::Error::new(std::io::ErrorKind::NotFound, "folder not found"),
            });
        }
        Ok(full)
    }

    /// Absolute path of a file inside a project. Refuses anything that escapes the project.
    pub fn resolve_file(&self, project_id: &str, rel: &str) -> Result<PathBuf> {
        let p = self
            .index
            .project(project_id)?
            .ok_or_else(|| EngineError::ProjectNotFound(project_id.to_string()))?;
        let rel_path = Path::new(rel);
        if rel_path.is_absolute()
            || rel_path
                .components()
                .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_) | Component::RootDir))
        {
            return Err(EngineError::ProjectNotFound(format!("{project_id}/{rel}")));
        }
        let dir = self.project_dir(&p)?;
        let full = dir.join(rel_path);
        if !full.is_file() {
            return Err(EngineError::Io {
                path: full,
                source: std::io::Error::new(std::io::ErrorKind::NotFound, "file not found"),
            });
        }
        Ok(full)
    }

    // ---- favorites --------------------------------------------------------------------

    pub fn set_favorite(&mut self, project_id: &str, favorite: bool) -> Result<Project> {
        let _ = self
            .index
            .project(project_id)?
            .ok_or_else(|| EngineError::ProjectNotFound(project_id.to_string()))?;
        self.collections.set_favorite(project_id, favorite)?;
        self.index.set_favorite(project_id, favorite)?;
        self.get_project(project_id)
    }

    // ---- collections ------------------------------------------------------------------

    pub fn collections(&self) -> Vec<Collection> {
        self.collections.collections().to_vec()
    }
    pub fn create_collection(&mut self, name: &str) -> Result<Collection> {
        self.collections.create_collection(name)
    }
    pub fn rename_collection(&mut self, id: &str, name: &str) -> Result<Collection> {
        self.collections.rename_collection(id, name)
    }
    pub fn delete_collection(&mut self, id: &str) -> Result<()> {
        self.collections.delete_collection(id)
    }
    pub fn add_to_collection(&mut self, id: &str, project_ids: &[String]) -> Result<Collection> {
        self.collections.add_to_collection(id, project_ids)
    }
    pub fn remove_from_collection(&mut self, id: &str, project_ids: &[String]) -> Result<Collection> {
        self.collections.remove_from_collection(id, project_ids)
    }
    pub fn reorder_collection(&mut self, id: &str, order: &[String]) -> Result<Collection> {
        self.collections.reorder_collection(id, order)
    }
    pub fn smart_collections(&self) -> Vec<SmartCollection> {
        self.collections.smart_collections().to_vec()
    }
    pub fn create_smart_collection(&mut self, name: &str, query: ListQuery) -> Result<SmartCollection> {
        self.collections.create_smart_collection(name, query)
    }
    pub fn update_smart_collection(&mut self, id: &str, name: Option<&str>, query: Option<ListQuery>) -> Result<SmartCollection> {
        self.collections.update_smart_collection(id, name, query)
    }
    pub fn delete_smart_collection(&mut self, id: &str) -> Result<()> {
        self.collections.delete_smart_collection(id)
    }

    // ---- import and inbox -------------------------------------------------------------

    /// Staging step: proposes an action per dropped path. Writes nothing.
    pub fn analyze_import(&self, paths: &[PathBuf]) -> Vec<ImportItem> {
        import::analyze(paths)
    }

    /// Runs a confirmed import into a root and rescans that root afterwards.
    pub fn execute_import(&mut self, req: &ImportRequest, progress: impl FnMut(ImportProgress)) -> Result<ImportReport> {
        let root = self.root(&req.root_id)?;
        let report = import::execute(&root.path, req, &self.deleter, progress)?;
        self.scan_root_as(&req.root_id, "import", |_| {})?;
        Ok(report)
    }

    pub fn list_inbox(&self, root_id: &str) -> Result<Vec<InboxFile>> {
        let root = self.root(root_id)?;
        if root.status == RootStatus::Offline {
            return Ok(Vec::new());
        }
        import::list_inbox(&root.path)
    }

    /// Moves inbox files into a new project directory and returns the indexed project.
    pub fn promote_inbox(&mut self, root_id: &str, files: &[String], name: &str) -> Result<Project> {
        let root = self.root(root_id)?;
        let dir = import::promote_inbox(&root.path, files, name)?;
        self.reindex_dir(root_id, &dir)
    }

    /// Turns each listed inbox file into its own project; failures are reported per file.
    pub fn promote_inbox_each(&mut self, root_id: &str, items: &[PromoteItem]) -> Result<PromoteReport> {
        self.root(root_id)?;
        let mut report = PromoteReport::default();
        for it in items {
            match self.promote_inbox(root_id, std::slice::from_ref(&it.file), &it.name) {
                Ok(p) => report.created.push(p),
                Err(e) => report.failed.push(PromoteFailure {
                    file: it.file.clone(),
                    message: e.to_string(),
                }),
            }
        }
        Ok(report)
    }

    pub fn delete_inbox_file(&mut self, root_id: &str, name: &str) -> Result<()> {
        let root = self.root(root_id)?;
        if Path::new(name).components().count() != 1 {
            return Err(EngineError::InvalidName(name.to_string()));
        }
        let path = root.path.join(import::INBOX_DIR).join(name);
        if !path.is_file() {
            return Err(EngineError::Io {
                path,
                source: std::io::Error::new(std::io::ErrorKind::NotFound, "not in the inbox"),
            });
        }
        (self.deleter)(&path).map_err(|e| EngineError::Io { path, source: e })
    }

    // ---- thumbnails -------------------------------------------------------------------

    pub fn thumb_queue(&self, limit: u32) -> Result<Vec<ThumbJob>> {
        self.index.thumb_queue(limit)
    }

    pub fn thumb_stats(&self) -> Result<ThumbStats> {
        self.index.thumb_stats()
    }

    /// Absolute path of a cached thumbnail; the key is validated, never joined blindly. Looks
    /// in the app cache first, then in the owning project's `.cache/thumbs`.
    pub fn thumbnail_path(&self, key: &str) -> Result<PathBuf> {
        let path = thumbs::path_for(&self.data_dir, key)?;
        if path.is_file() {
            return Ok(path);
        }
        if let Some(pid) = self.index.project_of_thumb(key)? {
            if let Some(p) = self.index.project(&pid)? {
                let in_project = thumbs::project_cache_dir(&self.project_dir(&p)?).join(key);
                if in_project.is_file() {
                    return Ok(in_project);
                }
            }
        }
        Err(EngineError::Io {
            path,
            source: std::io::Error::new(std::io::ErrorKind::NotFound, "thumbnail not found"),
        })
    }

    /// Directory a new preview for this project goes to, per the thumbnail location setting.
    fn thumb_dir_for(&self, project_id: &str) -> Result<PathBuf> {
        Ok(match self.thumb_location() {
            ThumbLocation::AppData => thumbs::cache_dir(&self.data_dir),
            ThumbLocation::Project => thumbs::project_cache_dir(&self.project_dir(&self.online_project(project_id)?)?),
        })
    }

    fn thumb_source_now(&self, project_id: &str) -> Result<ThumbSourceState> {
        self.index
            .thumb_source(project_id)?
            .ok_or_else(|| EngineError::ProjectNotFound(format!("{project_id} has no thumbnail source")))
    }

    /// Stores a PNG rendered by the frontend for the project's current source. Returns the key.
    pub fn store_thumbnail(&mut self, project_id: &str, png: &[u8]) -> Result<String> {
        let src = self.thumb_source_now(project_id)?;
        let key = thumbs::key_for(project_id, &src.rel_path);
        thumbs::write_in(&self.thumb_dir_for(project_id)?, &key, png)?;
        self.index.set_thumb(project_id, &src, Some(&key), None)?;
        Ok(key)
    }

    /// For `ThumbSource::Embedded`: pulls the preview out of the 3MF and caches it. Falls back
    /// to recording a failure (so the frontend can render instead) when the entry is unusable.
    pub fn store_embedded_thumbnail(&mut self, project_id: &str) -> Result<String> {
        let src = self.thumb_source_now(project_id)?;
        if src.source != ThumbSource::Embedded {
            return Err(EngineError::NotAllowed(format!(
                "{project_id}: thumbnail source is not an embedded preview"
            )));
        }
        let file = self.resolve_file(project_id, &src.rel_path)?;
        let info = threemf::inspect(&file)?;
        let entry = info
            .thumbnail_entry
            .ok_or_else(|| EngineError::NotAllowed(format!("{}: no embedded preview", src.rel_path)))?;
        let png = threemf::read_entry(&file, &entry)?;
        let key = thumbs::key_for(project_id, &src.rel_path);
        thumbs::write_in(&self.thumb_dir_for(project_id)?, &key, &png)?;
        self.index.set_thumb(project_id, &src, Some(&key), None)?;
        Ok(key)
    }

    /// Records that this source cannot be thumbnailed right now (parse error, no WebGL...).
    /// Not retried until the source file changes.
    pub fn thumbnail_failed(&mut self, project_id: &str, reason: &str) -> Result<()> {
        let src = self.thumb_source_now(project_id)?;
        self.index.set_thumb(project_id, &src, None, Some(reason))
    }

    /// Drops one project's thumbnail (PNG in either location, or the recorded failure) so
    /// the queue renders it again, e.g. after a framing fix or for a source that failed once.
    pub fn reset_thumbnail(&mut self, project_id: &str) -> Result<()> {
        let p = self
            .index
            .project(project_id)?
            .ok_or_else(|| EngineError::ProjectNotFound(project_id.to_string()))?;
        if let Some(key) = self.index.thumb_key(project_id)? {
            let _ = std::fs::remove_file(thumbs::cache_dir(&self.data_dir).join(&key));
            if let Ok(dir) = self.project_dir(&p) {
                let cache = thumbs::project_cache_dir(&dir);
                let _ = std::fs::remove_file(cache.join(&key));
                let _ = std::fs::remove_dir(&cache); // only when empty
                let _ = std::fs::remove_dir(dir.join(".cache"));
            }
        }
        self.index.clear_thumb(project_id)
    }

    /// Drops the whole cache (app data and project-side files of reachable projects);
    /// everything re-enters the queue.
    pub fn clear_thumbnails(&mut self) -> Result<()> {
        for (pid, key) in self.index.thumb_keys()? {
            if let Ok(Some(p)) = self.index.project(&pid) {
                if let Ok(dir) = self.project_dir(&p) {
                    let cache = thumbs::project_cache_dir(&dir);
                    let _ = std::fs::remove_file(cache.join(&key));
                    let _ = std::fs::remove_dir(&cache); // only when empty
                    let _ = std::fs::remove_dir(dir.join(".cache"));
                }
            }
        }
        self.index.clear_thumbs()?;
        let dir = thumbs::cache_dir(&self.data_dir);
        if dir.is_dir() {
            std::fs::remove_dir_all(&dir).map_err(crate::error::io_err(&dir))?;
        }
        Ok(())
    }

    // ---- writing ----------------------------------------------------------------------

    /// Applies a metadata change: writes (or lazily creates) project.yaml atomically, then
    /// re-reads the project directory and refreshes the index row. Optimistic UI lives in
    /// the frontend; this is the authoritative step that can fail with `SidecarConflict`.
    pub fn update_metadata(&mut self, project_id: &str, upd: UpdateMetadata) -> Result<Project> {
        let current = self.online_project(project_id)?;
        let dir = self.project_dir(&current)?;
        let (mut sc, on_disk) = match sidecar::read(&dir) {
            Ok(Some((sc, stamp))) => (sc, Some(stamp)),
            Ok(None) => (Sidecar::default(), None),
            Err(EngineError::SidecarInvalid(msg)) => {
                if !upd.force {
                    return Err(EngineError::SidecarInvalid(msg));
                }
                (
                    Sidecar::default(),
                    std::fs::metadata(sidecar::sidecar_path(&dir)).ok().map(|m| stamp_of(&m)),
                )
            }
            Err(e) => return Err(e),
        };
        if !upd.force && on_disk != upd.expected_stamp {
            return Err(EngineError::SidecarConflict);
        }
        let md = &mut sc.metadata;
        if let Some(v) = upd.title {
            md.title = non_empty(v);
        }
        if let Some(v) = upd.creator {
            md.creator = non_empty(v);
        }
        if let Some(v) = upd.license {
            md.license = non_empty(v);
        }
        if let Some(v) = upd.source_url {
            md.source_url = non_empty(v);
        }
        if let Some(v) = upd.description {
            md.description = non_empty(v);
        }
        if let Some(tags) = upd.tags {
            let mut clean: Vec<String> = tags
                .into_iter()
                .map(|t| t.trim().to_lowercase())
                .filter(|t| !t.is_empty())
                .collect();
            clean.sort();
            clean.dedup();
            md.tags = clean;
        }
        if md.created.is_none() {
            md.created = Some(OffsetDateTime::now_utc().date().to_string());
        }
        if let Some(v) = upd.recommended_material {
            sc.printing.recommended_material = non_empty(v);
        }
        if let Some(v) = upd.supports_required {
            sc.printing.supports_required = Some(v);
        }
        if let Some(v) = upd.notes {
            sc.printing.notes = non_empty(v);
        }
        sidecar::write(&dir, &sc, if upd.force { current_stamp(&dir) } else { on_disk })?;
        self.reindex_dir(&current.root_id, &dir)
    }

    /// Applies one change to many projects (META-6). Each project is written on its own with
    /// the stamp currently on disk, so one unreadable sidecar does not stop the rest; the
    /// report says which ones failed and why.
    pub fn batch_update_metadata(&mut self, project_ids: &[String], upd: &BatchUpdate) -> Result<BatchReport> {
        let add: Vec<String> = upd
            .add_tags
            .iter()
            .map(|t| t.trim().to_lowercase())
            .filter(|t| !t.is_empty())
            .collect();
        let remove: Vec<String> = upd
            .remove_tags
            .iter()
            .map(|t| t.trim().to_lowercase())
            .filter(|t| !t.is_empty())
            .collect();
        let mut report = BatchReport::default();
        for id in project_ids {
            let result = (|| -> Result<()> {
                let current = self.online_project(id)?;
                let dir = self.project_dir(&current)?;
                let (mut sc, on_disk) = match sidecar::read(&dir)? {
                    Some((sc, stamp)) => (sc, Some(stamp)),
                    None => (Sidecar::default(), None),
                };
                let md = &mut sc.metadata;
                if let Some(v) = &upd.creator {
                    md.creator = non_empty(v.clone());
                }
                if let Some(v) = &upd.license {
                    md.license = non_empty(v.clone());
                }
                let mut tags: Vec<String> = md.tags.iter().map(|t| t.trim().to_lowercase()).filter(|t| !t.is_empty()).collect();
                tags.extend(add.iter().cloned());
                tags.retain(|t| !remove.contains(t));
                tags.sort();
                tags.dedup();
                md.tags = tags;
                if md.created.is_none() {
                    md.created = Some(OffsetDateTime::now_utc().date().to_string());
                }
                sidecar::write(&dir, &sc, on_disk)?;
                self.reindex_dir(&current.root_id, &dir)?;
                Ok(())
            })();
            match result {
                Ok(()) => report.updated += 1,
                Err(e) => report.failed.push(BatchFailure {
                    project_id: id.clone(),
                    message: e.to_string(),
                }),
            }
        }
        Ok(report)
    }

    /// Re-reads one project directory and refreshes its index row.
    fn reindex_dir(&mut self, root_id: &str, dir: &Path) -> Result<Project> {
        let root = self.root(root_id)?;
        let ignore = IgnoreMatcher::new(&self.scan_opts.ignore)?;
        let mut out = scan::ScanOutcome::default();
        let mut fresh = scan::read_project(&root.id, &root.path, dir, &ignore, &mut out)?;
        fresh.favorite = self.collections.is_favorite(&fresh.id);
        self.index.upsert_project(&fresh)?;
        fresh.sidecar_stamp = sidecar::read(dir).ok().flatten().map(|(_, s)| s);
        // the cached thumbnail (if still valid for this file state) is known only to the index
        fresh.thumb = self.index.project(&fresh.id)?.and_then(|p| p.thumb);
        Ok(fresh)
    }

    /// Renames the project directory (META-5). Collisions are detected before anything is
    /// touched; favorites and the cached thumbnail follow the project to its new id.
    pub fn rename_project(&mut self, project_id: &str, new_name: &str) -> Result<Project> {
        let new_name = validate_dir_name(new_name)?;
        let current = self.online_project(project_id)?;
        if current.rel_path.is_empty() {
            return Err(EngineError::NotAllowed("the library root itself cannot be renamed".into()));
        }
        let old_dir = self.project_dir(&current)?;
        let parent = old_dir
            .parent()
            .ok_or_else(|| EngineError::NotAllowed("project has no parent directory".into()))?
            .to_path_buf();
        let new_dir = parent.join(&new_name);
        let old_name = old_dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if old_name == new_name {
            return self.get_project(project_id);
        }
        let case_only = old_name.eq_ignore_ascii_case(&new_name);
        if new_dir.exists() && !case_only {
            return Err(EngineError::AlreadyExists(new_name));
        }
        std::fs::rename(&old_dir, &new_dir).map_err(crate::error::io_err(&old_dir))?;

        let new_rel = match current.rel_path.rsplit_once('/') {
            Some((parent_rel, _)) => format!("{parent_rel}/{new_name}"),
            None => new_name.clone(),
        };
        let new_id = Project::make_id(&current.root_id, &new_rel);
        self.collections.rename(project_id, &new_id)?;
        self.index.rename_thumb(project_id, &new_id)?;
        self.index.rename_file_hashes(project_id, &new_id)?;
        self.index.remove_project(project_id)?;
        self.reindex_dir(&current.root_id, &new_dir)
    }

    /// Finds projects that share model files by content (LIB-8). Only files whose size
    /// matches a file in another project are hashed (SHA-256, all cores); hashes are cached
    /// per file size and mtime, so a second run touches only changed files.
    pub fn find_duplicates(&mut self, mut progress: impl FnMut(HashProgress)) -> Result<DuplicateReport> {
        use std::collections::{BTreeMap, BTreeSet, HashMap};
        self.index.prune_file_hashes()?;
        let files = self.index.model_files()?;
        let mut models_per_project: HashMap<String, u32> = HashMap::new();
        let mut by_size: HashMap<u64, Vec<usize>> = HashMap::new();
        for (i, (pid, _, size, _)) in files.iter().enumerate() {
            *models_per_project.entry(pid.clone()).or_default() += 1;
            by_size.entry(*size).or_default().push(i);
        }
        let candidates: Vec<usize> = by_size
            .values()
            .filter(|idx| idx.iter().map(|&i| &files[i].0).collect::<BTreeSet<_>>().len() >= 2)
            .flatten()
            .copied()
            .collect();
        let cached = self.index.file_hashes()?;
        let mut hashes: HashMap<usize, String> = HashMap::new();
        let mut todo: Vec<usize> = Vec::new();
        for &i in &candidates {
            let (pid, rel, size, modified) = &files[i];
            match cached.get(&(pid.clone(), rel.clone())) {
                Some((s, m, sha)) if s == size && m == modified => {
                    hashes.insert(i, sha.clone());
                }
                _ => todo.push(i),
            }
        }
        let total = todo.len() as u32;
        progress(HashProgress { done: 0, total });
        let mut done = 0u32;
        let roots: HashMap<String, PathBuf> = self.roots()?.into_iter().map(|r| (r.id, r.path)).collect();
        for chunk in todo.chunks(32) {
            let paths: Vec<PathBuf> = chunk
                .iter()
                .filter_map(|&i| {
                    let (pid, rel, _, _) = &files[i];
                    let (root_id, proj_rel) = Project::split_id(pid)?;
                    let root = roots.get(root_id)?;
                    let dir = if proj_rel.is_empty() { root.clone() } else { root.join(proj_rel) };
                    Some(dir.join(rel))
                })
                .collect();
            let results = hash::sha256_many(&paths);
            let mut rows = Vec::new();
            for (&i, (_, res)) in chunk.iter().zip(results.iter()) {
                if let Ok(sha) = res {
                    let (pid, rel, size, modified) = &files[i];
                    hashes.insert(i, sha.clone());
                    rows.push((pid.clone(), rel.clone(), *size, modified.clone(), sha.clone()));
                }
            }
            self.index.set_file_hashes(&rows)?;
            done += chunk.len() as u32;
            progress(HashProgress { done, total });
        }

        // project -> its hashed files; hash -> projects holding it
        let mut per_project: HashMap<&str, BTreeMap<&str, u64>> = HashMap::new();
        let mut holders: HashMap<&str, BTreeSet<&str>> = HashMap::new();
        for (&i, sha) in &hashes {
            let (pid, _, size, _) = &files[i];
            per_project.entry(pid.as_str()).or_default().insert(sha.as_str(), *size);
            holders.entry(sha.as_str()).or_default().insert(pid.as_str());
        }
        // union-find over projects that share at least one file
        let ids: Vec<&str> = per_project.keys().copied().collect();
        let pos: HashMap<&str, usize> = ids.iter().enumerate().map(|(i, id)| (*id, i)).collect();
        let mut parent: Vec<usize> = (0..ids.len()).collect();
        fn find(parent: &mut [usize], i: usize) -> usize {
            let mut r = i;
            while parent[r] != r {
                r = parent[r];
            }
            let mut c = i;
            while parent[c] != r {
                let next = parent[c];
                parent[c] = r;
                c = next;
            }
            r
        }
        for members in holders.values().filter(|m| m.len() >= 2) {
            let mut it = members.iter();
            let first = find(&mut parent, pos[it.next().unwrap()]);
            for m in it {
                let r = find(&mut parent, pos[m]);
                parent[r] = first;
            }
        }
        let mut components: BTreeMap<usize, Vec<&str>> = BTreeMap::new();
        for (i, id) in ids.iter().enumerate() {
            let r = find(&mut parent, i);
            components.entry(r).or_default().push(id);
        }
        let summaries: HashMap<String, ProjectSummary> = self
            .index
            .list(&ListQuery::default(), None)?
            .into_iter()
            .map(|p| (p.id.clone(), p))
            .collect();
        let mut groups = Vec::new();
        for members in components.values().filter(|m| m.len() >= 2) {
            let shared: BTreeMap<&str, u64> = members
                .iter()
                .flat_map(|m| per_project[m].iter())
                .filter(|(sha, _)| holders[**sha].len() >= 2)
                .map(|(sha, size)| (*sha, *size))
                .collect();
            let first = &per_project[members[0]];
            let identical = members.iter().all(|m| {
                let mine = &per_project[m];
                mine.len() == first.len()
                    && mine.keys().eq(first.keys())
                    && models_per_project.get(*m).copied().unwrap_or(0) as usize == mine.len()
            });
            let fully_hashed = |m: &str| models_per_project.get(m).copied().unwrap_or(0) as usize == per_project[m].len();
            let mut rows: Vec<DuplicateMember> = members
                .iter()
                .filter_map(|m| {
                    let project = summaries.get(*m)?.clone();
                    let mine = &per_project[m];
                    let covers = members
                        .iter()
                        .filter(|o| *o != m && fully_hashed(o) && per_project[*o].keys().all(|k| mine.contains_key(k)))
                        .map(|o| (*o).to_string())
                        .collect();
                    Some(DuplicateMember {
                        shared_files: mine.keys().filter(|k| shared.contains_key(*k)).count() as u32,
                        model_files: models_per_project.get(*m).copied().unwrap_or(0),
                        covers,
                        project,
                    })
                })
                .collect();
            if rows.len() < 2 {
                continue;
            }
            rows.sort_by(|a, b| a.project.rel_path.cmp(&b.project.rel_path));
            groups.push(DuplicateGroup {
                kind: if identical {
                    DuplicateKind::Identical
                } else {
                    DuplicateKind::Overlap
                },
                files: shared.len() as u32,
                bytes: shared.values().sum(),
                members: rows,
            });
        }
        groups.sort_by(|a, b| {
            (b.kind == DuplicateKind::Identical)
                .cmp(&(a.kind == DuplicateKind::Identical))
                .then(b.bytes.cmp(&a.bytes))
        });
        Ok(DuplicateReport {
            groups,
            candidates: candidates.len() as u32,
            hashed: total,
        })
    }

    /// Moves project folders into another folder of any root (IMP-7). The destination is
    /// created when missing and must not lie inside a project (nested projects are ignored
    /// by the scanner). Collections, favorites and cached thumbnails follow each project,
    /// nested projects inside a moved folder included; a different volume is handled by
    /// copying and removing.
    pub fn move_projects(&mut self, project_ids: &[String], dest_root: &str, dest_rel: &str) -> Result<MoveReport> {
        let root = self.root(dest_root)?;
        let dest_rel = dest_rel.trim_matches('/').to_string();
        let rel_path = Path::new(&dest_rel);
        if rel_path.components().any(|c| !matches!(c, Component::Normal(_))) {
            return Err(EngineError::NotAllowed(format!("path escapes the root: {dest_rel}")));
        }
        for seg in dest_rel.split('/').filter(|s| !s.is_empty()) {
            validate_dir_name(seg)?;
        }
        if dest_rel
            .split('/')
            .next()
            .is_some_and(|s| s.eq_ignore_ascii_case(import::INBOX_DIR))
            || dest_rel.split('/').any(|s| scan::APP_DIRS.contains(&s))
        {
            return Err(EngineError::NotAllowed(format!("{dest_rel} is reserved")));
        }
        if root.status == RootStatus::Offline {
            return Err(EngineError::RootOffline(root.path));
        }
        // the destination must not be a project or sit inside one
        let in_dest_root = self.index.list(
            &ListQuery {
                root_id: Some(dest_root.to_string()),
                ..Default::default()
            },
            None,
        )?;
        if in_dest_root.iter().any(|p| {
            p.rel_path == dest_rel || (p.rel_path.is_empty() && !dest_rel.is_empty()) || dest_rel.starts_with(&format!("{}/", p.rel_path))
        }) {
            return Err(EngineError::NotAllowed(format!(
                "{dest_rel}: a project folder cannot contain other projects"
            )));
        }
        let dest_dir = if dest_rel.is_empty() {
            root.path.clone()
        } else {
            root.path.join(rel_path)
        };
        std::fs::create_dir_all(&dest_dir).map_err(crate::error::io_err(&dest_dir))?;

        let mut report = MoveReport::default();
        for id in project_ids {
            match self.move_one(id, dest_root, &dest_rel, &dest_dir) {
                Ok(p) => report.moved.push(p),
                Err(e) => report.failed.push(BatchFailure {
                    project_id: id.clone(),
                    message: e.to_string(),
                }),
            }
        }
        Ok(report)
    }

    fn move_one(&mut self, project_id: &str, dest_root: &str, dest_rel: &str, dest_dir: &Path) -> Result<Project> {
        let current = self.online_project(project_id)?;
        if current.rel_path.is_empty() {
            return Err(EngineError::NotAllowed("the library root itself cannot be moved".into()));
        }
        let old_dir = self.project_dir(&current)?;
        let name = old_dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .ok_or_else(|| EngineError::NotAllowed("project has no folder name".into()))?;
        let parent_rel = current.rel_path.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
        if current.root_id == dest_root {
            if parent_rel == dest_rel {
                return Ok(current); // already there
            }
            if dest_rel == current.rel_path || dest_rel.starts_with(&format!("{}/", current.rel_path)) {
                return Err(EngineError::NotAllowed("a project cannot be moved into itself".into()));
            }
        }
        let new_dir = dest_dir.join(&name);
        if new_dir.exists() {
            return Err(EngineError::AlreadyExists(name));
        }
        // nested projects travel with the folder: remember them before the ids change
        let nested: Vec<(String, String)> = self
            .index
            .list(
                &ListQuery {
                    root_id: Some(current.root_id.clone()),
                    path_prefix: Some(current.rel_path.clone()),
                    ..Default::default()
                },
                None,
            )?
            .into_iter()
            .filter(|p| p.id != current.id)
            .map(|p| (p.id, p.rel_path))
            .collect();
        move_dir(&old_dir, &new_dir).map_err(|e| EngineError::Io {
            path: old_dir.clone(),
            source: e,
        })?;
        let new_rel = if dest_rel.is_empty() {
            name.clone()
        } else {
            format!("{dest_rel}/{name}")
        };
        let mut nested_dirs = Vec::new();
        let mut all = nested.clone();
        all.push((project_id.to_string(), current.rel_path.clone()));
        for (old_id, old_rel) in &all {
            let suffix = &old_rel[current.rel_path.len()..];
            let rel = format!("{new_rel}{suffix}");
            let new_id = Project::make_id(dest_root, &rel);
            self.collections.rename(old_id, &new_id)?;
            self.index.rename_thumb(old_id, &new_id)?;
            self.index.rename_file_hashes(old_id, &new_id)?;
            self.index.remove_project(old_id)?;
            if old_id != project_id {
                nested_dirs.push(rel);
            }
        }
        let root_path = self.root(dest_root)?.path;
        for rel in nested_dirs {
            let _ = self.reindex_dir(dest_root, &root_path.join(&rel));
        }
        self.reindex_dir(dest_root, &new_dir)
    }

    /// Moves the whole project directory to the trash (IMP-5) and forgets it.
    pub fn delete_project(&mut self, project_id: &str) -> Result<()> {
        let current = self.online_project(project_id)?;
        if current.rel_path.is_empty() {
            return Err(EngineError::NotAllowed(
                "the library root itself cannot be deleted; remove it in settings".into(),
            ));
        }
        let dir = self.project_dir(&current)?;
        (self.deleter)(&dir).map_err(|e| EngineError::Io {
            path: dir.clone(),
            source: e,
        })?;
        self.collections.forget(project_id)?;
        self.index.remove_project(project_id)?;
        Ok(())
    }

    /// Moves one file of a project to the trash. Returns the refreshed project, or `None`
    /// when the directory no longer qualifies as a project (no model, no sidecar) and was
    /// dropped from the index.
    pub fn delete_file(&mut self, project_id: &str, rel: &str) -> Result<Option<Project>> {
        let current = self.online_project(project_id)?;
        if Path::new(rel)
            .file_name()
            .map(|n| n == crate::model::SIDECAR_FILE_NAME)
            .unwrap_or(false)
        {
            return Err(EngineError::NotAllowed("project.yaml is managed by the app".into()));
        }
        let path = self.resolve_file(project_id, rel)?;
        (self.deleter)(&path).map_err(|e| EngineError::Io {
            path: path.clone(),
            source: e,
        })?;
        let dir = self.project_dir(&current)?;
        let still_project = {
            let ignore = IgnoreMatcher::new(&self.scan_opts.ignore)?;
            let root = self.root(&current.root_id)?;
            scan::is_project_dir(&dir, &ignore, &root.path, &self.scan_opts)
        };
        if still_project {
            Ok(Some(self.reindex_dir(&current.root_id, &dir)?))
        } else {
            self.collections.forget(project_id)?;
            self.index.remove_project(project_id)?;
            Ok(None)
        }
    }
}

/// Windows-safe directory names (the stricter platform wins so libraries stay portable).
/// `rename` when source and destination share a volume, copy + remove otherwise.
fn move_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    if std::fs::rename(src, dst).is_ok() {
        return Ok(());
    }
    fn copy_all(src: &Path, dst: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(dst)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            let target = dst.join(entry.file_name());
            if entry.file_type()?.is_dir() {
                copy_all(&entry.path(), &target)?;
            } else {
                std::fs::copy(entry.path(), &target)?;
            }
        }
        Ok(())
    }
    if let Err(e) = copy_all(src, dst) {
        let _ = std::fs::remove_dir_all(dst);
        return Err(e);
    }
    std::fs::remove_dir_all(src)
}

pub(crate) fn validate_dir_name(name: &str) -> Result<String> {
    let n = name.trim();
    if n.is_empty() {
        return Err(EngineError::InvalidName("name is empty".into()));
    }
    if n == "." || n == ".." {
        return Err(EngineError::InvalidName(n.into()));
    }
    if n.chars()
        .any(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control())
    {
        return Err(EngineError::InvalidName(format!(
            "{n}: contains / \\ : * ? \" < > | or control characters"
        )));
    }
    if n.ends_with('.') || n.ends_with(' ') {
        return Err(EngineError::InvalidName(format!("{n}: must not end with a dot or space")));
    }
    if n.len() > 200 {
        return Err(EngineError::InvalidName("name is longer than 200 bytes".into()));
    }
    let upper = n.split('.').next().unwrap_or("").to_ascii_uppercase();
    const RESERVED: &[&str] = &[
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4",
        "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.contains(&upper.as_str()) {
        return Err(EngineError::InvalidName(format!("{n} is reserved on Windows")));
    }
    Ok(n.to_string())
}

fn non_empty(v: String) -> Option<String> {
    let t = v.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}
fn stamp_of(m: &std::fs::Metadata) -> SidecarStamp {
    let mtime = m
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos() as i128)
        .unwrap_or(0);
    SidecarStamp {
        mtime_unix_nanos: mtime,
        size: m.len(),
    }
}
fn current_stamp(dir: &Path) -> Option<SidecarStamp> {
    std::fs::metadata(sidecar::sidecar_path(dir)).ok().map(|m| stamp_of(&m))
}

#[cfg(test)]
mod tests {
    use super::validate_dir_name;

    #[test]
    fn dir_names() {
        assert_eq!(validate_dir_name("  Arm v5 ").unwrap(), "Arm v5");
        for bad in ["", ".", "..", "a/b", "a\\b", "x:", "q?", "trailing.", "CON", "nul.txt"] {
            assert!(validate_dir_name(bad).is_err(), "{bad:?} should be rejected");
        }
    }
}
