//! File-system watching with debouncing. The engine only reports which paths changed;
//! the shell decides what to rescan (see `Engine::rescan_paths`).

use crate::error::{EngineError, Result};
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct WatchEvent {
    pub root_id: String,
    pub paths: Vec<PathBuf>,
}

pub struct RootWatcher {
    _debouncer: Debouncer<notify::RecommendedWatcher, RecommendedCache>,
}

impl RootWatcher {
    /// Starts watching `path` recursively; batches of changed paths arrive on `tx` after
    /// `debounce` of quiet time. Returns an error when the platform cannot watch the path
    /// (network shares often), which is the signal to fall back to polling.
    pub fn start(root_id: String, path: &Path, debounce: Duration, tx: mpsc::Sender<WatchEvent>) -> Result<RootWatcher> {
        let rid = root_id.clone();
        let mut debouncer = new_debouncer(debounce, None, move |res: DebounceEventResult| {
            if let Ok(events) = res {
                let mut paths: Vec<PathBuf> = events.into_iter().flat_map(|e| e.event.paths.clone()).collect();
                paths.sort();
                paths.dedup();
                if !paths.is_empty() {
                    let _ = tx.send(WatchEvent { root_id: rid.clone(), paths });
                }
            }
        })
        .map_err(|e| EngineError::Watch(e.to_string()))?;
        debouncer.watch(path, RecursiveMode::Recursive).map_err(|e| EngineError::Watch(e.to_string()))?;
        Ok(RootWatcher { _debouncer: debouncer })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_created_files() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx) = mpsc::channel();
        let _w = RootWatcher::start("r1".into(), dir.path(), Duration::from_millis(200), tx).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        std::fs::create_dir_all(dir.path().join("P")).unwrap();
        std::fs::write(dir.path().join("P/part.stl"), b"x").unwrap();
        let ev = rx.recv_timeout(Duration::from_secs(5)).expect("watch event");
        assert_eq!(ev.root_id, "r1");
        assert!(ev.paths.iter().any(|p| p.ends_with("part.stl") || p.ends_with("P")), "{:?}", ev.paths);
    }
}
