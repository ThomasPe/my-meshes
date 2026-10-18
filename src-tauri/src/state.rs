use mymeshes_engine::model::SyncMode;
use mymeshes_engine::watch::{RootWatcher, WatchEvent};
use mymeshes_engine::Engine;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{mpsc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

/// Startup configuration. Test mode isolates all app data and can seed a fixture root so
/// agent-driven E2E runs are deterministic (docs/spec/04-quality.md).
#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub test_mode: bool,
    pub data_dir_override: Option<PathBuf>,
    pub fixture_root: Option<PathBuf>,
}

impl RuntimeConfig {
    pub fn from_env_and_args() -> RuntimeConfig {
        let args: Vec<String> = std::env::args().collect();
        let test_mode = args.iter().any(|a| a == "--test-mode") || std::env::var("MYMESHES_TEST_MODE").map(|v| v == "1").unwrap_or(false);
        let data_dir_override = std::env::var_os("MYMESHES_DATA_DIR").map(PathBuf::from);
        let fixture_root = std::env::var_os("MYMESHES_FIXTURE_ROOT").map(PathBuf::from);
        RuntimeConfig {
            test_mode,
            data_dir_override,
            fixture_root,
        }
    }

    pub fn resolve_data_dir(&self, app: &AppHandle) -> tauri::Result<PathBuf> {
        if let Some(d) = &self.data_dir_override {
            return Ok(d.clone());
        }
        if self.test_mode {
            let d = std::env::temp_dir().join(format!("mymeshes-test-{}", std::process::id()));
            return Ok(d);
        }
        app.path().app_data_dir()
    }
}

pub struct AppState {
    pub engine: Mutex<Engine>,
    pub watchers: Mutex<HashMap<String, RootWatcher>>,
    pub watch_tx: mpsc::Sender<WatchEvent>,
    pub config: RuntimeConfig,
    pub data_dir: PathBuf,
}

/// In test mode with `MYMESHES_FIXTURE_ROOT` set: register that folder (once) and scan it.
pub fn seed_test_fixture(app: &AppHandle) {
    let state = app.state::<AppState>();
    let Some(fixture) = state.config.fixture_root.clone() else { return };
    if !state.config.test_mode {
        log::warn!("MYMESHES_FIXTURE_ROOT ignored outside test mode");
        return;
    }
    let mut engine = state.engine.lock().unwrap();
    let id = match engine.add_root(&fixture, SyncMode::Manual) {
        Ok(r) => r.id,
        Err(mymeshes_engine::EngineError::RootExists(_)) => engine
            .roots()
            .ok()
            .and_then(|rs| rs.into_iter().find(|r| r.path == fixture).map(|r| r.id))
            .unwrap_or_default(),
        Err(e) => {
            log::error!("fixture root {}: {e}", fixture.display());
            return;
        }
    };
    match engine.scan_root(&id, |_| {}) {
        Ok(r) => log::info!("fixture root scanned: {} projects", r.projects),
        Err(e) => log::error!("fixture scan failed: {e}"),
    }
}

/// Start a watcher for every root in `watch` mode. Failures (e.g. network shares) are logged
/// and surfaced as an event; the root keeps working with manual rescans.
pub fn start_watchers(app: &AppHandle) {
    let state = app.state::<AppState>();
    let roots = { state.engine.lock().unwrap().roots().unwrap_or_default() };
    for root in roots {
        if root.mode == SyncMode::Watch {
            start_watcher_for(app, &root.id);
        }
    }
}

pub fn start_watcher_for(app: &AppHandle, root_id: &str) {
    let state = app.state::<AppState>();
    let result = { state.engine.lock().unwrap().start_watch(root_id, state.watch_tx.clone()) };
    match result {
        Ok(w) => {
            state.watchers.lock().unwrap().insert(root_id.to_string(), w);
            log::info!("watching root {root_id}");
        }
        Err(e) => {
            log::warn!("cannot watch root {root_id}: {e}");
            let _ = app.emit("watch://error", serde_json::json!({ "rootId": root_id, "message": e.to_string() }));
        }
    }
}

pub fn stop_watcher_for(app: &AppHandle, root_id: &str) {
    let state = app.state::<AppState>();
    state.watchers.lock().unwrap().remove(root_id);
}

/// Receives debounced file-system events and rescans the affected root, then tells the UI.
pub fn spawn_watch_loop(app: AppHandle, rx: mpsc::Receiver<WatchEvent>) {
    std::thread::Builder::new()
        .name("mymeshes-watch".into())
        .spawn(move || {
            while let Ok(ev) = rx.recv() {
                log::debug!("fs change in {}: {} paths", ev.root_id, ev.paths.len());
                let state = app.state::<AppState>();
                let result = { state.engine.lock().unwrap().rescan_for_event(&ev) };
                match result {
                    Ok(report) => {
                        let _ = app.emit("library://changed", serde_json::json!({ "rootId": ev.root_id, "report": report, "reason": "watch" }));
                    }
                    Err(e) => {
                        log::warn!("rescan after change failed: {e}");
                        let _ = app.emit("library://changed", serde_json::json!({ "rootId": ev.root_id, "report": serde_json::Value::Null, "reason": "watch", "error": e.to_string() }));
                    }
                }
            }
        })
        .expect("spawn watch thread");
}
