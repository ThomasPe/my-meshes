//! Persistent list of library roots (`roots.json` in the app data directory).
//! Small, human-readable, rewritten atomically. The index can always be rebuilt from this.

use crate::error::{io_err, EngineError, Result};
use crate::model::{LibraryRoot, RootStatus, SyncMode};
use std::fs;
use std::path::{Path, PathBuf};
use time::OffsetDateTime;

#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
struct RootsFile {
    #[serde(default = "schema_v1")]
    schema: u32,
    #[serde(default)]
    roots: Vec<LibraryRoot>,
}
fn schema_v1() -> u32 {
    1
}

pub struct RootsStore {
    path: PathBuf,
    roots: Vec<LibraryRoot>,
}

impl RootsStore {
    pub fn open(data_dir: &Path) -> Result<RootsStore> {
        fs::create_dir_all(data_dir).map_err(io_err(data_dir))?;
        let path = data_dir.join("roots.json");
        let roots = match fs::read_to_string(&path) {
            Ok(text) => {
                let mut roots = serde_json::from_str::<RootsFile>(&text)
                    .map_err(|e| EngineError::Serde(format!("roots.json: {e}")))?
                    .roots;
                // Roots saved by earlier builds may carry Windows' verbatim prefix (`\\?\C:\...`).
                for r in &mut roots {
                    r.path = dunce::simplified(&r.path).to_path_buf();
                }
                roots
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(EngineError::Io { path, source: e }),
        };
        Ok(RootsStore { path, roots })
    }

    pub fn list(&self) -> &[LibraryRoot] {
        &self.roots
    }

    pub fn get(&self, id: &str) -> Option<&LibraryRoot> {
        self.roots.iter().find(|r| r.id == id)
    }

    pub fn add(&mut self, path: &Path, mode: SyncMode) -> Result<LibraryRoot> {
        if !path.is_dir() {
            return Err(EngineError::NotADirectory(path.to_path_buf()));
        }
        // `dunce` canonicalizes without Windows' `\\?\` verbatim prefix, which users would
        // otherwise see in every path we display.
        let canonical = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        if self.roots.iter().any(|r| r.path == canonical) {
            return Err(EngineError::RootExists(canonical));
        }
        let root = LibraryRoot {
            id: uuid::Uuid::new_v4().simple().to_string()[..12].to_string(),
            path: canonical,
            mode,
            poll_interval_secs: 900,
            added_at: OffsetDateTime::now_utc(),
            last_scan_at: None,
            status: RootStatus::Online,
            last_scan: None,
            last_error: None,
        };
        self.roots.push(root.clone());
        self.save()?;
        Ok(root)
    }

    pub fn remove(&mut self, id: &str) -> Result<LibraryRoot> {
        let idx = self
            .roots
            .iter()
            .position(|r| r.id == id)
            .ok_or_else(|| EngineError::RootNotFound(id.to_string()))?;
        let root = self.roots.remove(idx);
        self.save()?;
        Ok(root)
    }

    pub fn update(&mut self, id: &str, f: impl FnOnce(&mut LibraryRoot)) -> Result<LibraryRoot> {
        let root = self
            .roots
            .iter_mut()
            .find(|r| r.id == id)
            .ok_or_else(|| EngineError::RootNotFound(id.to_string()))?;
        f(root);
        let out = root.clone();
        self.save()?;
        Ok(out)
    }

    /// Re-checks whether each root directory is reachable. Never removes anything.
    pub fn refresh_status(&mut self) -> Result<()> {
        for r in &mut self.roots {
            r.status = if r.path.is_dir() { RootStatus::Online } else { RootStatus::Offline };
        }
        self.save()
    }

    fn save(&self) -> Result<()> {
        let text = serde_json::to_string_pretty(&RootsFile {
            schema: 1,
            roots: self.roots.clone(),
        })
        .map_err(|e| EngineError::Serde(e.to_string()))?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, text).map_err(io_err(&tmp))?;
        fs::rename(&tmp, &self.path).map_err(io_err(&self.path))
    }
}
