use crate::state::{self, AppState};
use meshkeep_engine::model::{
    FolderNode, LibraryRoot, ListQuery, Project, ProjectSummary, ScanReport, SyncMode, TagCount, ThumbJob, ThumbStats,
};
use meshkeep_engine::{EngineError, UpdateMetadata};
use serde::Serialize;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// Error shape the frontend can switch on.
#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: &'static str,
    pub message: String,
}

impl From<EngineError> for AppError {
    fn from(e: EngineError) -> Self {
        let code = match &e {
            EngineError::SidecarConflict => "sidecar_conflict",
            EngineError::SidecarInvalid(_) => "sidecar_invalid",
            EngineError::RootOffline(_) => "root_offline",
            EngineError::RootNotFound(_) | EngineError::ProjectNotFound(_) => "not_found",
            EngineError::RootExists(_) => "root_exists",
            EngineError::NotADirectory(_) => "not_a_directory",
            EngineError::Pattern(_) => "invalid_pattern",
            EngineError::Io { .. } => "io",
            EngineError::Index(_) => "index",
            EngineError::Serde(_) => "serde",
            EngineError::Watch(_) => "watch",
            EngineError::InvalidName(_) => "invalid_name",
            EngineError::AlreadyExists(_) => "already_exists",
            EngineError::NotAllowed(_) => "not_allowed",
        };
        AppError {
            code,
            message: e.to_string(),
        }
    }
}
impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError {
            code: "shell",
            message: e.to_string(),
        }
    }
}
impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError {
            code: "io",
            message: e.to_string(),
        }
    }
}
type CmdResult<T> = Result<T, AppError>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    data_dir: String,
    test_mode: bool,
    e2e_build: bool,
    os: String,
    arch: String,
    webview: String,
}

#[tauri::command]
pub fn app_info(app: AppHandle, state: State<AppState>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: state.data_dir.to_string_lossy().into_owned(),
        test_mode: state.config.test_mode,
        e2e_build: cfg!(feature = "e2e"),
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        webview: tauri::webview_version().unwrap_or_else(|_| "unknown".into()),
    }
}

#[tauri::command]
pub fn get_roots(state: State<AppState>) -> CmdResult<Vec<LibraryRoot>> {
    Ok(state.engine.lock().unwrap().roots()?)
}

#[tauri::command]
pub fn add_root(app: AppHandle, state: State<AppState>, path: String, mode: Option<SyncMode>) -> CmdResult<LibraryRoot> {
    let mode = mode.unwrap_or(SyncMode::Watch);
    let root = { state.engine.lock().unwrap().add_root(&PathBuf::from(path), mode)? };
    if mode == SyncMode::Watch {
        state::start_watcher_for(&app, &root.id);
    }
    Ok(root)
}

#[tauri::command]
pub fn remove_root(app: AppHandle, state: State<AppState>, id: String) -> CmdResult<LibraryRoot> {
    state::stop_watcher_for(&app, &id);
    let root = { state.engine.lock().unwrap().remove_root(&id)? };
    let _ = app.emit("library://changed", serde_json::json!({ "rootId": id, "reason": "root_removed" }));
    Ok(root)
}

#[tauri::command]
pub fn set_root_mode(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    mode: SyncMode,
    poll_interval_secs: Option<u64>,
) -> CmdResult<LibraryRoot> {
    let root = { state.engine.lock().unwrap().set_root_mode(&id, mode, poll_interval_secs)? };
    state::stop_watcher_for(&app, &id);
    if mode == SyncMode::Watch {
        state::start_watcher_for(&app, &id);
    }
    Ok(root)
}

/// Long-running: runs on a blocking thread, streams `scan://progress`, ends with `library://changed`.
#[tauri::command]
pub async fn scan_root(app: AppHandle, id: String) -> CmdResult<ScanReport> {
    let handle = app.clone();
    let report = tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<AppState>();
        let mut engine = state.engine.lock().unwrap();
        let mut last = Instant::now() - Duration::from_secs(1);
        engine.scan_root(&id, |p| {
            if last.elapsed() >= Duration::from_millis(100) {
                last = Instant::now();
                let _ = handle.emit("scan://progress", &p);
            }
        })
    })
    .await
    .map_err(|e| AppError {
        code: "shell",
        message: e.to_string(),
    })??;
    let _ = app.emit(
        "library://changed",
        serde_json::json!({ "rootId": report.root_id, "report": report, "reason": "scan" }),
    );
    Ok(report)
}

#[tauri::command]
pub fn list_projects(state: State<AppState>, query: ListQuery) -> CmdResult<Vec<ProjectSummary>> {
    Ok(state.engine.lock().unwrap().list_projects(&query)?)
}

#[tauri::command]
pub fn get_project(state: State<AppState>, id: String) -> CmdResult<Project> {
    Ok(state.engine.lock().unwrap().get_project(&id)?)
}

#[tauri::command]
pub fn tag_counts(state: State<AppState>, root_id: Option<String>) -> CmdResult<Vec<TagCount>> {
    Ok(state.engine.lock().unwrap().tag_counts(root_id.as_deref())?)
}

#[tauri::command]
pub fn folder_tree(state: State<AppState>, root_id: String) -> CmdResult<Vec<FolderNode>> {
    Ok(state.engine.lock().unwrap().folder_tree(&root_id)?)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    projects: u32,
    total_bytes: u64,
    favorites: u32,
}

#[tauri::command]
pub fn library_stats(state: State<AppState>, root_id: Option<String>) -> CmdResult<LibraryStats> {
    let engine = state.engine.lock().unwrap();
    let (projects, total_bytes) = engine.count(root_id.as_deref())?;
    let favorites = engine.favorite_count()?;
    Ok(LibraryStats {
        projects,
        total_bytes,
        favorites,
    })
}

/// Raw bytes of a file inside a project (models for the viewer, images). No JSON, no base64.
#[tauri::command]
pub async fn read_project_file(app: AppHandle, project_id: String, rel_path: String) -> CmdResult<Response> {
    let path = {
        app.state::<AppState>()
            .engine
            .lock()
            .unwrap()
            .resolve_file(&project_id, &rel_path)?
    };
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(path))
        .await
        .map_err(|e| AppError {
            code: "shell",
            message: e.to_string(),
        })??;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn update_metadata(app: AppHandle, state: State<AppState>, project_id: String, update: UpdateMetadata) -> CmdResult<Project> {
    let project = { state.engine.lock().unwrap().update_metadata(&project_id, update)? };
    let _ = app.emit("project://changed", serde_json::json!({ "projectId": project.id }));
    Ok(project)
}

#[tauri::command]
pub fn reveal_project(app: AppHandle, state: State<AppState>, project_id: String) -> CmdResult<()> {
    let dir = {
        let engine = state.engine.lock().unwrap();
        let p = engine.get_project(&project_id)?;
        engine.project_dir(&p)?
    };
    app.opener().reveal_item_in_dir(dir).map_err(|e| AppError {
        code: "shell",
        message: e.to_string(),
    })
}

#[tauri::command]
pub fn open_project_file(app: AppHandle, state: State<AppState>, project_id: String, rel_path: String) -> CmdResult<()> {
    let path = { state.engine.lock().unwrap().resolve_file(&project_id, &rel_path)? };
    app.opener()
        .open_path(path.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| AppError {
            code: "shell",
            message: e.to_string(),
        })
}

/// Native folder picker. In test mode `MESHKEEP_PICK_FOLDER` short-circuits the dialog
/// (a narrow test seam, see docs/spec/04-quality.md).
#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> CmdResult<Option<String>> {
    if app.state::<AppState>().config.test_mode {
        if let Some(p) = std::env::var_os("MESHKEEP_PICK_FOLDER") {
            return Ok(Some(p.to_string_lossy().into_owned()));
        }
    }
    let picked = tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
        .await
        .map_err(|e| AppError {
            code: "shell",
            message: e.to_string(),
        })?;
    Ok(picked.map(|p| p.to_string()))
}

#[tauri::command]
pub fn get_ignore_patterns(state: State<AppState>) -> Vec<String> {
    state.engine.lock().unwrap().ignore_patterns().to_vec()
}

#[tauri::command]
pub fn set_ignore_patterns(state: State<AppState>, patterns: Vec<String>) -> CmdResult<Vec<String>> {
    let mut engine = state.engine.lock().unwrap();
    engine.set_ignore_patterns(patterns)?;
    Ok(engine.ignore_patterns().to_vec())
}

// ---- favorites, rename, delete ---------------------------------------------------------

#[tauri::command]
pub fn set_favorite(app: AppHandle, state: State<AppState>, project_id: String, favorite: bool) -> CmdResult<Project> {
    let project = { state.engine.lock().unwrap().set_favorite(&project_id, favorite)? };
    let _ = app.emit("project://changed", serde_json::json!({ "projectId": project.id }));
    Ok(project)
}

#[tauri::command]
pub fn rename_project(app: AppHandle, state: State<AppState>, project_id: String, new_name: String) -> CmdResult<Project> {
    let project = { state.engine.lock().unwrap().rename_project(&project_id, &new_name)? };
    let _ = app.emit(
        "library://changed",
        serde_json::json!({ "rootId": project.root_id, "report": serde_json::Value::Null, "reason": "rename", "oldId": project_id, "newId": project.id }),
    );
    Ok(project)
}

/// Moves the project directory to the OS trash (IMP-5).
#[tauri::command]
pub fn delete_project(app: AppHandle, state: State<AppState>, project_id: String) -> CmdResult<()> {
    let root_id = {
        let mut engine = state.engine.lock().unwrap();
        let p = engine.get_project(&project_id)?;
        engine.delete_project(&project_id)?;
        p.root_id
    };
    let _ = app.emit(
        "library://changed",
        serde_json::json!({ "rootId": root_id, "report": serde_json::Value::Null, "reason": "delete", "oldId": project_id }),
    );
    Ok(())
}

/// Moves one file to the OS trash. `None` when the project vanished with it.
#[tauri::command]
pub fn delete_file(app: AppHandle, state: State<AppState>, project_id: String, rel_path: String) -> CmdResult<Option<Project>> {
    let (root_id, project) = {
        let mut engine = state.engine.lock().unwrap();
        let p = engine.get_project(&project_id)?;
        (p.root_id, engine.delete_file(&project_id, &rel_path)?)
    };
    match &project {
        Some(p) => {
            let _ = app.emit("project://changed", serde_json::json!({ "projectId": p.id }));
        }
        None => {
            let _ = app.emit(
                "library://changed",
                serde_json::json!({ "rootId": root_id, "report": serde_json::Value::Null, "reason": "delete", "oldId": project_id }),
            );
        }
    }
    Ok(project)
}

// ---- thumbnails ----------------------------------------------------------------------

#[tauri::command]
pub fn thumb_queue(state: State<AppState>, limit: Option<u32>) -> CmdResult<Vec<ThumbJob>> {
    Ok(state.engine.lock().unwrap().thumb_queue(limit.unwrap_or(50))?)
}

#[tauri::command]
pub fn thumb_stats(state: State<AppState>) -> CmdResult<ThumbStats> {
    Ok(state.engine.lock().unwrap().thumb_stats()?)
}

/// Raw PNG bytes in the request body; the project id travels URL-encoded in a header
/// (headers must be ASCII, folder names need not be).
#[tauri::command]
pub fn store_thumbnail(state: State<AppState>, request: Request<'_>) -> CmdResult<String> {
    let project_id = request
        .headers()
        .get("x-project-id")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .ok_or(AppError {
            code: "shell",
            message: "missing x-project-id header".into(),
        })?;
    let InvokeBody::Raw(png) = request.body() else {
        return Err(AppError {
            code: "shell",
            message: "thumbnail body must be raw bytes".into(),
        });
    };
    Ok(state.engine.lock().unwrap().store_thumbnail(&project_id, png)?)
}

#[tauri::command]
pub fn store_embedded_thumbnail(state: State<AppState>, project_id: String) -> CmdResult<String> {
    Ok(state.engine.lock().unwrap().store_embedded_thumbnail(&project_id)?)
}

#[tauri::command]
pub fn thumbnail_failed(state: State<AppState>, project_id: String, reason: String) -> CmdResult<()> {
    Ok(state.engine.lock().unwrap().thumbnail_failed(&project_id, &reason)?)
}

#[tauri::command]
pub async fn read_thumbnail(app: AppHandle, key: String) -> CmdResult<Response> {
    let path = { app.state::<AppState>().engine.lock().unwrap().thumbnail_path(&key)? };
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(path))
        .await
        .map_err(|e| AppError {
            code: "shell",
            message: e.to_string(),
        })??;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn clear_thumbnails(app: AppHandle, state: State<AppState>) -> CmdResult<()> {
    state.engine.lock().unwrap().clear_thumbnails()?;
    let _ = app.emit(
        "library://changed",
        serde_json::json!({ "rootId": serde_json::Value::Null, "report": serde_json::Value::Null, "reason": "thumbs_cleared" }),
    );
    Ok(())
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
