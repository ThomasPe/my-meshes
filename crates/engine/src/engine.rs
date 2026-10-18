//! The facade the application shell talks to. One instance per app; not thread-safe by
//! itself (wrap in a mutex in the shell), but every operation is short except `scan_root`.

use crate::error::{EngineError, Result};
use crate::index::Index;
use crate::model::{
    FolderNode, LibraryRoot, ListQuery, Project, ProjectSummary, RootStatus, ScanReport, Sidecar, SidecarStamp, SyncMode, TagCount,
};
use crate::roots::RootsStore;
use crate::scan::{self, IgnoreMatcher, ScanOptions};
use crate::sidecar;
use crate::watch::{RootWatcher, WatchEvent};
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

pub struct Engine {
    data_dir: PathBuf,
    roots: RootsStore,
    index: Index,
    scan_opts: ScanOptions,
}

impl Engine {
    pub fn open(data_dir: &Path) -> Result<Engine> {
        std::fs::create_dir_all(data_dir).map_err(crate::error::io_err(data_dir))?;
        let roots = RootsStore::open(data_dir)?;
        let index = Index::open(&data_dir.join("index.sqlite"))?;
        Ok(Engine {
            data_dir: data_dir.to_path_buf(),
            roots,
            index,
            scan_opts: ScanOptions::default(),
        })
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn ignore_patterns(&self) -> &[String] {
        &self.scan_opts.ignore
    }

    pub fn set_ignore_patterns(&mut self, patterns: Vec<String>) -> Result<()> {
        IgnoreMatcher::new(&patterns)?; // validate
        self.scan_opts.ignore = patterns;
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

    // ---- scanning ---------------------------------------------------------------------

    /// Full scan of one root; replaces its index rows. A missing directory marks the root
    /// offline and keeps the index as it was.
    pub fn scan_root(&mut self, id: &str, mut progress: impl FnMut(ScanProgress)) -> Result<ScanReport> {
        let root = self.root(id)?;
        let started = Instant::now();
        let outcome = match scan::scan_root(&root.id, &root.path, &self.scan_opts, |n| {
            progress(ScanProgress {
                root_id: id.to_string(),
                projects_found: n,
            })
        }) {
            Ok(o) => o,
            Err(EngineError::RootOffline(p)) => {
                self.roots.update(id, |r| r.status = RootStatus::Offline)?;
                self.index.mark_root_offline(id, true)?;
                return Err(EngineError::RootOffline(p));
            }
            Err(e) => return Err(e),
        };
        self.index.rebuild_root(id, &outcome.projects)?;
        self.roots.update(id, |r| {
            r.status = RootStatus::Online;
            r.last_scan_at = Some(OffsetDateTime::now_utc());
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
        self.scan_root(&ev.root_id, |_| {})
    }

    pub fn start_watch(&self, root_id: &str, tx: mpsc::Sender<WatchEvent>) -> Result<RootWatcher> {
        let root = self.root(root_id)?;
        RootWatcher::start(root.id.clone(), &root.path, Duration::from_millis(750), tx)
    }

    // ---- reading ----------------------------------------------------------------------

    pub fn list_projects(&self, q: &ListQuery) -> Result<Vec<ProjectSummary>> {
        self.index.list(q)
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

    pub fn tag_counts(&self, root_id: Option<&str>) -> Result<Vec<TagCount>> {
        self.index.tag_counts(root_id)
    }

    pub fn folder_tree(&self, root_id: &str) -> Result<Vec<FolderNode>> {
        self.index.folder_tree(root_id)
    }

    pub fn count(&self, root_id: Option<&str>) -> Result<(u32, u64)> {
        self.index.count(root_id)
    }

    pub fn project_dir(&self, p: &Project) -> Result<PathBuf> {
        let root = self.root(&p.root_id)?;
        Ok(if p.rel_path.is_empty() {
            root.path
        } else {
            root.path.join(&p.rel_path)
        })
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

    // ---- writing ----------------------------------------------------------------------

    /// Applies a metadata change: writes (or lazily creates) project.yaml atomically, then
    /// re-reads the project directory and refreshes the index row. Optimistic UI lives in
    /// the frontend; this is the authoritative step that can fail with `SidecarConflict`.
    pub fn update_metadata(&mut self, project_id: &str, upd: UpdateMetadata) -> Result<Project> {
        let current = self
            .index
            .project(project_id)?
            .ok_or_else(|| EngineError::ProjectNotFound(project_id.to_string()))?;
        if current.offline {
            return Err(EngineError::RootOffline(self.root(&current.root_id)?.path));
        }
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

        let root = self.root(&current.root_id)?;
        let ignore = IgnoreMatcher::new(&self.scan_opts.ignore)?;
        let mut out = scan::ScanOutcome::default();
        let mut fresh = scan::read_project(&root.id, &root.path, &dir, &ignore, &mut out)?;
        self.index.upsert_project(&fresh)?;
        fresh.sidecar_stamp = sidecar::read(&dir).ok().flatten().map(|(_, s)| s);
        Ok(fresh)
    }
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
