//! Tauri shell: a thin, typed command layer over `meshkeep_engine` plus the few things only
//! the shell can do (dialogs, revealing files, events to the webview, test mode).

mod commands;
mod keys;
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
        .plugin(tauri_plugin_notification::init())
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

    // Private builds only: Store builds must not ship an updater (spec 04-quality, APP-9).
    #[cfg(feature = "updater")]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .setup(move |app| {
            let data_dir = config.resolve_data_dir(app.handle())?;
            log::info!("data dir: {} (test mode: {})", data_dir.display(), config.test_mode);
            let mut engine = meshkeep_engine::Engine::open(&data_dir)?;
            if let Some(mode) = config.ai_mock {
                log::info!("AI provider replaced by the mock ({mode:?})");
                engine.set_ai_provider(Some(std::sync::Arc::new(meshkeep_engine::ai::MockProvider::new(mode))));
            }
            let state = AppState {
                engine: Mutex::new(engine),
                watchers: Mutex::new(Default::default()),
                watch_tx,
                ai_keys: keys::AiKeyStore::new(config.test_mode),
                config: config.clone(),
                data_dir,
            };
            app.manage(state);
            state::seed_test_fixture(app.handle());
            state::start_watchers(app.handle());
            state::spawn_watch_loop(app.handle().clone(), watch_rx);
            state::spawn_poll_loop(app.handle().clone());
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
            commands::reveal_folder,
            commands::log_tail,
            commands::open_url,
            commands::open_project_file,
            commands::pick_folder,
            commands::get_ignore_patterns,
            commands::set_ignore_patterns,
            commands::get_container_dirs,
            commands::set_container_dirs,
            commands::get_thumb_location,
            commands::set_thumb_location,
            commands::facets,
            commands::batch_update_metadata,
            commands::set_favorite,
            commands::rename_project,
            commands::move_projects,
            commands::find_duplicates,
            commands::project_hints,
            commands::creator_suggestions,
            commands::dismiss_creator_hint,
            commands::delete_project,
            commands::delete_file,
            commands::thumb_queue,
            commands::thumb_stats,
            commands::store_thumbnail,
            commands::store_embedded_thumbnail,
            commands::thumbnail_failed,
            commands::read_thumbnail,
            commands::clear_thumbnails,
            commands::reset_thumbnail,
            commands::pick_import_files,
            commands::analyze_import,
            commands::execute_import,
            commands::list_inbox,
            commands::promote_inbox,
            commands::delete_inbox_file,
            commands::promote_inbox_each,
            commands::get_collections,
            commands::create_collection,
            commands::rename_collection,
            commands::delete_collection,
            commands::add_to_collection,
            commands::remove_from_collection,
            commands::reorder_collection,
            commands::get_smart_collections,
            commands::create_smart_collection,
            commands::update_smart_collection,
            commands::delete_smart_collection,
            commands::list_smart_collection,
            commands::check_update,
            commands::install_update,
            commands::get_ai_settings,
            commands::set_ai_settings,
            commands::set_ai_key,
            commands::test_ai,
            commands::suggest_metadata,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Meshkeep");
}
