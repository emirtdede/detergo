pub mod audit;
pub mod catalog;
pub mod cleanup;
pub mod commands;
pub mod error;
pub mod platform;
pub mod providers;
pub mod safety;
pub mod scanner;
pub mod settings;

use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                use tauri::Manager;
                window.app_handle().exit(0);
            }
        })
        .setup(|app| {
            use tauri::Manager;
            let windows = app.webview_windows();
            for win in windows.values() {
                let _ = win.show();
                let _ = win.set_focus();
            }
            if windows.is_empty() {
                let win = tauri::WebviewWindowBuilder::new(
                    app,
                    "main",
                    tauri::WebviewUrl::default(),
                )
                .title("Node Cleaner")
                .inner_size(1180.0, 760.0)
                .min_inner_size(980.0, 640.0)
                .center()
                .build()?;
                let _ = win.show();
                let _ = win.set_focus();
            }
            Ok(())
        })
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            start_scan,
            cancel_scan,
            get_catalog,
            get_scan_summary,
            get_agent_providers,
            get_known_locations,
            open_path_in_explorer,
            open_url,
            preview_cleanup,
            execute_cleanup,
            get_global_cache_providers,
            preview_official_action,
            execute_official_action,
            get_cleanup_history,
            get_growth_report,
            get_official_action_history,
            clear_cleanup_history,
            get_app_settings,
            save_app_settings
        ])
        .run(tauri::generate_context!())
        .expect("Node Cleaner başlatılırken hata oluştu");
}
