pub mod audit;
pub mod build_info;
pub mod catalog;
pub mod cleanup;
pub mod cli;
pub mod commands;
pub mod error;
pub mod last_scan;
pub mod mcp;
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
            window_commands::show_main_window(app);
        }))
        .on_window_event(|window, event| {
            // The close button never terminates the process on its own. The
            // window asks the frontend to show a guard dialog so the user can
            // choose "keep in tray" (default), "quit", or "cancel".
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                use tauri::Emitter;
                let _ = window.emit("close-requested", ());
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
                .title("Dev Cleaner")
                .inner_size(1180.0, 760.0)
                .min_inner_size(980.0, 640.0)
                .center()
                .build()?;
                let _ = win.show();
                let _ = win.set_focus();
            }

            setup_tray(app)?;
            Ok(())
        })
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            start_scan,
            cancel_scan,
            get_catalog,
            get_scan_summary,
            get_agent_providers,
            add_custom_agent_provider,
            remove_custom_agent_provider,
            set_agent_provider_hidden,
            get_known_locations,
            open_path_in_explorer,
            open_url,
            preview_cleanup,
            execute_cleanup,
            get_cache_providers,
            measure_cache_providers,
            cancel_cache_measurement,
            preview_official_action,
            execute_official_action,
            get_cleanup_history,
            get_growth_report,
            get_official_action_history,
            clear_cleanup_history,
            clear_cleanups_history,
            clear_actions_history,
            get_app_settings,
            save_app_settings,
            get_build_info,
            get_last_scan,
            save_last_scan,
            clear_last_scan,
            hide_to_tray,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("Dev Cleaner başlatılırken hata oluştu");
}

/// Native tray entry point: the app keeps running when the window is hidden,
/// and the tray is the only way back (or the only way to really quit).
fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show_item = MenuItem::with_id(app, "show", "Göster", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Çıkış", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("Dev Cleaner")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => window_commands::show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                window_commands::show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}
