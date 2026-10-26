use crate::state::{self, AppState};
use meshkeep_engine::ai::{AiSettings, AiTestReport, MetadataSuggestion};
use meshkeep_engine::collections::{Collection, SmartCollection};
use meshkeep_engine::enrich::{EnrichReport, PageSuggestion};
use meshkeep_engine::hints::Hints;
use meshkeep_engine::import::{ImportItem, ImportReport, ImportRequest, InboxFile};
use meshkeep_engine::model::{
    Facets, FolderNode, LibraryRoot, ListQuery, Project, ProjectSummary, ScanReport, SyncMode, TagCount, ThumbJob, ThumbLocation,
    ThumbStats,
};
use meshkeep_engine::settings::NetworkSettings;
use meshkeep_engine::{
    BatchReport, BatchUpdate, CreatorSuggestions, DuplicateReport, EngineError, MoveReport, PromoteItem, PromoteReport, UpdateMetadata,
};
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
            EngineError::AiDisabled => "ai_disabled",
            EngineError::AiUnauthorized(_) => "ai_unauthorized",
            EngineError::AiRateLimited(_) => "ai_rate_limited",
            EngineError::AiInvalidResponse(_) => "ai_invalid_response",
            EngineError::AiUnavailable(_) => "ai_unavailable",
            EngineError::PageFetchDisabled => "page_fetch_disabled",
            EngineError::PageFetch(_) => "page_fetch",
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
    /// Built with the self-updater (private NSIS builds).
    updater: bool,
    /// Built for the Microsoft Store (updates come from the Store).
    store: bool,
    /// Update channel of this build ("dev", "stable") or `None` without an updater.
    channel: Option<String>,
    os: String,
    arch: String,
    webview: String,
    /// "Windows 10.0.26100" style string for bug reports.
    os_version: String,
}

#[tauri::command]
pub fn app_info(app: AppHandle, state: State<AppState>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: state.data_dir.to_string_lossy().into_owned(),
        test_mode: state.config.test_mode,
        e2e_build: cfg!(feature = "e2e"),
        updater: cfg!(feature = "updater"),
        store: cfg!(feature = "store"),
        channel: if cfg!(feature = "updater") {
            app.config()
                .plugins
                .0
                .get("meshkeep")
                .and_then(|v| v.get("channel"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        } else {
            None
        },
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        webview: tauri::webview_version().unwrap_or_else(|_| "unknown".into()),
        os_version: os_info::get().to_string(),
    }
}

/// Last `lines` lines of the app log for a bug report, with the home directory shortened to
/// `~` so a pasted excerpt does not carry the user name (APP-12).
#[tauri::command]
pub fn log_tail(app: AppHandle, lines: usize) -> CmdResult<String> {
    let path = app
        .path()
        .app_log_dir()
        .map_err(|e| AppError {
            code: "io",
            message: e.to_string(),
        })?
        .join("meshkeep.log");
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => {
            return Err(AppError {
                code: "io",
                message: format!("{}: {e}", path.display()),
            })
        }
    };
    let all: Vec<&str> = text.lines().collect();
    let start = all.len().saturating_sub(lines.clamp(1, 2000));
    let mut tail = all[start..].join("\n");
    if let Ok(home) = app.path().home_dir() {
        let home = home.to_string_lossy().into_owned();
        for h in [home.clone(), home.replace('\\', "/")] {
            if h.len() > 3 {
                tail = tail.replace(&h, "~");
            }
        }
    }
    Ok(tail)
}

/// Opens a web link in the default browser; only http(s), so a crafted sidecar cannot launch
/// anything else through this command.
#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> CmdResult<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError {
            code: "not_allowed",
            message: format!("not a web link: {url}"),
        });
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| AppError {
        code: "shell",
        message: e.to_string(),
    })
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
pub fn facets(state: State<AppState>, root_id: Option<String>) -> CmdResult<Facets> {
    Ok(state.engine.lock().unwrap().facets(root_id.as_deref())?)
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

/// META-6: one change for a multi-selection, written by the engine project by project.
#[tauri::command]
pub fn batch_update_metadata(
    app: AppHandle,
    state: State<AppState>,
    project_ids: Vec<String>,
    update: BatchUpdate,
) -> CmdResult<BatchReport> {
    let report = { state.engine.lock().unwrap().batch_update_metadata(&project_ids, &update)? };
    for id in &project_ids {
        let _ = app.emit("project://changed", serde_json::json!({ "projectId": id }));
    }
    Ok(report)
}

/// Opens a folder of a root (tree node, inbox) in the file manager.
#[tauri::command]
pub fn reveal_folder(app: AppHandle, state: State<AppState>, root_id: String, rel_path: String) -> CmdResult<()> {
    let dir = { state.engine.lock().unwrap().resolve_dir(&root_id, &rel_path)? };
    app.opener()
        .open_path(dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| AppError {
            code: "shell",
            message: e.to_string(),
        })
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

/// Native multi-file picker for imports (archives, models, folders are dropped instead).
/// In test mode `MESHKEEP_PICK_FILES` (`;`-separated paths) short-circuits the dialog.
#[tauri::command]
pub async fn pick_import_files(app: AppHandle) -> CmdResult<Vec<String>> {
    if app.state::<AppState>().config.test_mode {
        if let Some(p) = std::env::var_os("MESHKEEP_PICK_FILES") {
            return Ok(p
                .to_string_lossy()
                .split(';')
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.trim().to_string())
                .collect());
        }
    }
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Archives and models", &["zip", "stl", "obj", "3mf", "step", "stp", "ply", "amf"])
            .blocking_pick_files()
    })
    .await
    .map_err(|e| AppError {
        code: "shell",
        message: e.to_string(),
    })?;
    Ok(picked.unwrap_or_default().into_iter().map(|p| p.to_string()).collect())
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

#[tauri::command]
pub fn get_container_dirs(state: State<AppState>) -> Vec<String> {
    state.engine.lock().unwrap().container_dirs().to_vec()
}

#[tauri::command]
pub fn set_container_dirs(state: State<AppState>, names: Vec<String>) -> CmdResult<Vec<String>> {
    let mut engine = state.engine.lock().unwrap();
    engine.set_container_dirs(names)?;
    Ok(engine.container_dirs().to_vec())
}

#[tauri::command]
pub fn get_thumb_location(state: State<AppState>) -> ThumbLocation {
    state.engine.lock().unwrap().thumb_location()
}

#[tauri::command]
pub fn set_thumb_location(state: State<AppState>, location: ThumbLocation) -> CmdResult<ThumbLocation> {
    Ok(state.engine.lock().unwrap().set_thumb_location(location)?)
}

// ---- favorites, rename, delete ---------------------------------------------------------

#[tauri::command]
pub fn set_favorite(app: AppHandle, state: State<AppState>, project_id: String, favorite: bool) -> CmdResult<Project> {
    let project = { state.engine.lock().unwrap().set_favorite(&project_id, favorite)? };
    let _ = app.emit("project://changed", serde_json::json!({ "projectId": project.id }));
    Ok(project)
}

#[tauri::command]
pub async fn fetch_model_page(app: AppHandle, project_id: String) -> CmdResult<PageSuggestion> {
    let handle = app.clone();
    let out = tauri::async_runtime::spawn_blocking(move || handle.state::<AppState>().engine.lock().unwrap().fetch_model_page(&project_id))
        .await
        .map_err(|e| AppError {
            code: "shell",
            message: e.to_string(),
        })??;
    Ok(out)
}

#[tauri::command]
pub async fn fetch_model_pages(app: AppHandle, project_ids: Vec<String>) -> CmdResult<EnrichReport> {
    let handle = app.clone();
    let out = tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<AppState>();
        let mut engine = state.engine.lock().unwrap();
        engine.fetch_model_pages(&project_ids, |p| {
            let _ = handle.emit("enrich://progress", &p);
        })
    })
    .await
    .map_err(|e| AppError {
        code: "shell",
        message: e.to_string(),
    })??;
    Ok(out)
}

#[tauri::command]
pub fn project_hints(state: State<AppState>, project_id: String) -> CmdResult<Hints> {
    Ok(state.engine.lock().unwrap().project_hints(&project_id)?)
}

#[tauri::command]
pub async fn creator_suggestions(app: AppHandle) -> CmdResult<CreatorSuggestions> {
    let handle = app.clone();
    let out = tauri::async_runtime::spawn_blocking(move || handle.state::<AppState>().engine.lock().unwrap().creator_suggestions())
        .await
        .map_err(|e| AppError {
            code: "shell",
            message: e.to_string(),
        })??;
    Ok(out)
}

#[tauri::command]
pub fn dismiss_creator_hint(state: State<AppState>, project_id: String, value: String) -> CmdResult<()> {
    Ok(state.engine.lock().unwrap().dismiss_creator_hint(&project_id, &value)?)
}

#[tauri::command]
pub async fn find_duplicates(app: AppHandle) -> CmdResult<DuplicateReport> {
    let handle = app.clone();
    let report = tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<AppState>();
        let mut engine = state.engine.lock().unwrap();
        let mut last = Instant::now() - Duration::from_secs(1);
        engine.find_duplicates(|p| {
            if p.done == p.total || last.elapsed() >= Duration::from_millis(100) {
                last = Instant::now();
                let _ = handle.emit("duplicates://progress", &p);
            }
        })
    })
    .await
    .map_err(|e| AppError {
        code: "shell",
        message: e.to_string(),
    })??;
    Ok(report)
}

#[tauri::command]
pub fn move_projects(
    app: AppHandle,
    state: State<AppState>,
    project_ids: Vec<String>,
    root_id: String,
    dest_rel: String,
) -> CmdResult<MoveReport> {
    let report = { state.engine.lock().unwrap().move_projects(&project_ids, &root_id, &dest_rel)? };
    if !report.moved.is_empty() {
        let old_ids: Vec<&String> = project_ids
            .iter()
            .filter(|id| report.failed.iter().all(|f| &f.project_id != *id))
            .collect();
        let _ = app.emit(
            "library://changed",
            serde_json::json!({ "rootId": root_id, "report": serde_json::Value::Null, "reason": "move", "oldIds": old_ids }),
        );
    }
    Ok(report)
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
pub fn reset_thumbnail(app: AppHandle, state: State<AppState>, project_id: String) -> CmdResult<()> {
    state.engine.lock().unwrap().reset_thumbnail(&project_id)?;
    let _ = app.emit("project://changed", serde_json::json!({ "projectId": project_id }));
    Ok(())
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

// ---- import and inbox ----------------------------------------------------------------

#[tauri::command]
pub fn analyze_import(state: State<AppState>, paths: Vec<String>) -> Vec<ImportItem> {
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    state.engine.lock().unwrap().analyze_import(&paths)
}

/// Long-running: streams `import://progress`, ends with `library://changed` (reason "import").
#[tauri::command]
pub async fn execute_import(app: AppHandle, request: ImportRequest) -> CmdResult<ImportReport> {
    let handle = app.clone();
    let report = tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<AppState>();
        let mut engine = state.engine.lock().unwrap();
        engine.execute_import(&request, |p| {
            let _ = handle.emit("import://progress", &p);
        })
    })
    .await
    .map_err(|e| AppError {
        code: "shell",
        message: e.to_string(),
    })??;
    let _ = app.emit(
        "library://changed",
        serde_json::json!({ "rootId": report.root_id, "report": serde_json::Value::Null, "reason": "import" }),
    );
    Ok(report)
}

#[tauri::command]
pub fn list_inbox(state: State<AppState>, root_id: String) -> CmdResult<Vec<InboxFile>> {
    Ok(state.engine.lock().unwrap().list_inbox(&root_id)?)
}

#[tauri::command]
pub fn promote_inbox(app: AppHandle, state: State<AppState>, root_id: String, files: Vec<String>, name: String) -> CmdResult<Project> {
    let project = { state.engine.lock().unwrap().promote_inbox(&root_id, &files, &name)? };
    let _ = app.emit(
        "library://changed",
        serde_json::json!({ "rootId": root_id, "report": serde_json::Value::Null, "reason": "import", "newId": project.id }),
    );
    Ok(project)
}

#[tauri::command]
pub fn promote_inbox_each(app: AppHandle, state: State<AppState>, root_id: String, items: Vec<PromoteItem>) -> CmdResult<PromoteReport> {
    let report = { state.engine.lock().unwrap().promote_inbox_each(&root_id, &items)? };
    if !report.created.is_empty() {
        let _ = app.emit(
            "library://changed",
            serde_json::json!({ "rootId": root_id, "report": serde_json::Value::Null, "reason": "import" }),
        );
    }
    Ok(report)
}

#[tauri::command]
pub fn delete_inbox_file(app: AppHandle, state: State<AppState>, root_id: String, name: String) -> CmdResult<()> {
    state.engine.lock().unwrap().delete_inbox_file(&root_id, &name)?;
    let _ = app.emit("inbox://changed", serde_json::json!({ "rootId": root_id }));
    Ok(())
}

// ---- collections ---------------------------------------------------------------------

fn collections_changed(app: &AppHandle) {
    let _ = app.emit("collections://changed", serde_json::Value::Null);
}

#[tauri::command]
pub fn get_collections(state: State<AppState>) -> Vec<Collection> {
    state.engine.lock().unwrap().collections()
}

#[tauri::command]
pub fn create_collection(app: AppHandle, state: State<AppState>, name: String) -> CmdResult<Collection> {
    let c = { state.engine.lock().unwrap().create_collection(&name)? };
    collections_changed(&app);
    Ok(c)
}

#[tauri::command]
pub fn rename_collection(app: AppHandle, state: State<AppState>, id: String, name: String) -> CmdResult<Collection> {
    let c = { state.engine.lock().unwrap().rename_collection(&id, &name)? };
    collections_changed(&app);
    Ok(c)
}

#[tauri::command]
pub fn delete_collection(app: AppHandle, state: State<AppState>, id: String) -> CmdResult<()> {
    state.engine.lock().unwrap().delete_collection(&id)?;
    collections_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn add_to_collection(app: AppHandle, state: State<AppState>, id: String, project_ids: Vec<String>) -> CmdResult<Collection> {
    let c = { state.engine.lock().unwrap().add_to_collection(&id, &project_ids)? };
    collections_changed(&app);
    Ok(c)
}

#[tauri::command]
pub fn remove_from_collection(app: AppHandle, state: State<AppState>, id: String, project_ids: Vec<String>) -> CmdResult<Collection> {
    let c = { state.engine.lock().unwrap().remove_from_collection(&id, &project_ids)? };
    collections_changed(&app);
    Ok(c)
}

#[tauri::command]
pub fn reorder_collection(app: AppHandle, state: State<AppState>, id: String, order: Vec<String>) -> CmdResult<Collection> {
    let c = { state.engine.lock().unwrap().reorder_collection(&id, &order)? };
    collections_changed(&app);
    Ok(c)
}

#[tauri::command]
pub fn get_smart_collections(state: State<AppState>) -> Vec<SmartCollection> {
    state.engine.lock().unwrap().smart_collections()
}

#[tauri::command]
pub fn create_smart_collection(app: AppHandle, state: State<AppState>, name: String, query: ListQuery) -> CmdResult<SmartCollection> {
    let c = { state.engine.lock().unwrap().create_smart_collection(&name, query)? };
    collections_changed(&app);
    Ok(c)
}

#[tauri::command]
pub fn update_smart_collection(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    name: Option<String>,
    query: Option<ListQuery>,
) -> CmdResult<SmartCollection> {
    let c = { state.engine.lock().unwrap().update_smart_collection(&id, name.as_deref(), query)? };
    collections_changed(&app);
    Ok(c)
}

#[tauri::command]
pub fn delete_smart_collection(app: AppHandle, state: State<AppState>, id: String) -> CmdResult<()> {
    state.engine.lock().unwrap().delete_smart_collection(&id)?;
    collections_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn list_smart_collection(state: State<AppState>, id: String, overrides: Option<ListQuery>) -> CmdResult<Vec<ProjectSummary>> {
    Ok(state.engine.lock().unwrap().list_smart_collection(&id, overrides.as_ref())?)
}

// ---- updates (APP-9) -----------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    available: bool,
    version: Option<String>,
    notes: Option<String>,
    date: Option<String>,
}

#[cfg(feature = "updater")]
fn none() -> UpdateInfo {
    UpdateInfo {
        available: false,
        version: None,
        notes: None,
        date: None,
    }
}

/// Private builds: asks the release feed (skipped in test mode so E2E stays deterministic).
#[cfg(feature = "updater")]
#[tauri::command]
pub async fn check_update(app: AppHandle) -> CmdResult<UpdateInfo> {
    use tauri_plugin_updater::UpdaterExt;
    if app.state::<AppState>().config.test_mode {
        return Ok(none());
    }
    let updater_err = |e: tauri_plugin_updater::Error| AppError {
        code: "updater",
        message: e.to_string(),
    };
    let update = app.updater().map_err(updater_err)?.check().await.map_err(updater_err)?;
    Ok(match update {
        Some(u) => UpdateInfo {
            available: true,
            version: Some(u.version.clone()),
            notes: u.body.clone(),
            date: u.date.map(|d| d.to_string()),
        },
        None => none(),
    })
}

/// Store and dev builds: no updater; the message says where updates come from.
#[cfg(not(feature = "updater"))]
#[tauri::command]
pub async fn check_update(_app: AppHandle) -> CmdResult<UpdateInfo> {
    Err(AppError {
        code: "updater",
        message: if cfg!(feature = "store") {
            "updates come from the Microsoft Store".into()
        } else {
            "this build has no updater".into()
        },
    })
}

/// Downloads and installs the pending update, then relaunches.
#[cfg(feature = "updater")]
#[tauri::command]
pub async fn install_update(app: AppHandle) -> CmdResult<()> {
    use tauri_plugin_updater::UpdaterExt;
    let updater_err = |e: tauri_plugin_updater::Error| AppError {
        code: "updater",
        message: e.to_string(),
    };
    let update = app
        .updater()
        .map_err(updater_err)?
        .check()
        .await
        .map_err(updater_err)?
        .ok_or(AppError {
            code: "updater",
            message: "no update available".into(),
        })?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(updater_err)?;
    app.restart();
}

#[cfg(not(feature = "updater"))]
#[tauri::command]
pub async fn install_update(_app: AppHandle) -> CmdResult<()> {
    Err(AppError {
        code: "updater",
        message: "this build has no updater".into(),
    })
}

// ---- AI assistance (ADR-0003) ---------------------------------------------------------

/// The `ai` settings block plus whether a key is stored; the key itself never crosses IPC
/// in this direction.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsView {
    #[serde(flatten)]
    settings: AiSettings,
    has_key: bool,
}

fn key_err(e: String) -> AppError {
    AppError {
        code: "keyring",
        message: e,
    }
}

#[tauri::command]
pub fn get_network_settings(state: State<AppState>) -> NetworkSettings {
    state.engine.lock().unwrap().network_settings()
}

#[tauri::command]
pub fn set_network_settings(state: State<AppState>, settings: NetworkSettings) -> CmdResult<NetworkSettings> {
    Ok(state.engine.lock().unwrap().set_network_settings(settings)?)
}

#[tauri::command]
pub fn get_ai_settings(state: State<AppState>) -> CmdResult<AiSettingsView> {
    let settings = state.engine.lock().unwrap().ai_settings().clone();
    let has_key = state.ai_keys.get().map_err(key_err)?.is_some();
    Ok(AiSettingsView { settings, has_key })
}

#[tauri::command]
pub fn set_ai_settings(state: State<AppState>, settings: AiSettings) -> CmdResult<AiSettingsView> {
    let settings = { state.engine.lock().unwrap().set_ai_settings(settings)? };
    let has_key = state.ai_keys.get().map_err(key_err)?.is_some();
    Ok(AiSettingsView { settings, has_key })
}

/// Stores the key in the OS credential store; `None` or an empty string removes it. Never
/// logged, never returned.
#[tauri::command]
pub fn set_ai_key(state: State<AppState>, key: Option<String>) -> CmdResult<bool> {
    state.ai_keys.set(key.as_deref()).map_err(key_err)?;
    Ok(state.ai_keys.get().map_err(key_err)?.is_some())
}

/// One tiny request against the configured provider. Runs off the UI thread and outside the
/// engine lock (only the provider handle is taken under it).
#[tauri::command]
pub async fn test_ai(app: AppHandle) -> CmdResult<AiTestReport> {
    let provider = {
        let state = app.state::<AppState>();
        let key = state.ai_keys.get().map_err(key_err)?;
        let provider = state.engine.lock().unwrap().ai_provider(key.as_deref())?;
        provider
    };
    tauri::async_runtime::spawn_blocking(move || meshkeep_engine::Engine::ai_run_test(provider.as_ref()))
        .await
        .map_err(|e| AppError {
            code: "shell",
            message: e.to_string(),
        })?
        .map_err(AppError::from)
}

/// Metadata suggestion for one project: inputs are gathered under the engine lock, the
/// network call runs without it so scans and queries keep flowing meanwhile.
#[tauri::command]
pub async fn suggest_metadata(app: AppHandle, project_id: String) -> CmdResult<MetadataSuggestion> {
    let (provider, prepared) = {
        let state = app.state::<AppState>();
        let key = state.ai_keys.get().map_err(key_err)?;
        let engine = state.engine.lock().unwrap();
        let provider = engine.ai_provider(key.as_deref())?;
        (provider, engine.ai_prepare_suggestion(&project_id)?)
    };
    tauri::async_runtime::spawn_blocking(move || meshkeep_engine::ai::run_suggestion(prepared, provider.as_ref()))
        .await
        .map_err(|e| AppError {
            code: "shell",
            message: e.to_string(),
        })?
        .map_err(AppError::from)
}
