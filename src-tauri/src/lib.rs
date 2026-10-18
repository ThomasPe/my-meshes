//! Tauri shell: a thin, typed command layer over `meshkeep_engine` plus the few things only
//! the shell can do (dialogs, revealing files, events to the webview, test mode).

mod commands;
mod state;

use state::{AppState, RuntimeConfig};
use std::sync::{mpsc, Mutex};
use tauri::Manager;

pub fn run() {
    let config = RuntimeConfig::from_env_and_args();
    let (watch_tx, watch_rx) = mpsc::channel();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if config.test_mode {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("meshkeep".into()),
                    }),
                ])
                .build(),
        );

    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .setup(move |app| {
            let data_dir = config.resolve_data_dir(app.handle())?;
            log::info!("data dir: {} (test mode: {})", data_dir.display(), config.test_mode);
            let engine = meshkeep_engine::Engine::open(&data_dir)?;
            let state = AppState {
                engine: Mutex::new(engine),
                watchers: Mutex::new(Default::default()),
                watch_tx,
                config: config.clone(),
                data_dir,
            };
            app.manage(state);
            state::seed_test_fixture(app.handle());
            state::start_watchers(app.handle());
            state::spawn_watch_loop(app.handle().clone(), watch_rx);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::get_roots,
            commands::add_root,
            commands::remove_root,
            commands::set_root_mode,
            commands::scan_root,
            commands::list_projects,
            commands::get_project,
            commands::tag_counts,
            commands::folder_tree,
            commands::library_stats,
            commands::read_project_file,
            commands::update_metadata,
            commands::reveal_project,
            commands::open_project_file,
            commands::pick_folder,
            commands::get_ignore_patterns,
            commands::set_ignore_patterns,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Meshkeep");
}
