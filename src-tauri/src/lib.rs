pub mod audit;
#[cfg(feature = "bindings")]
pub mod bindings;
pub mod build_info;
pub mod catalog;
pub mod cleanup;
pub mod cli;
pub mod commands;
pub mod error;
pub mod format;
pub mod last_scan;
pub mod logging;
pub mod mcp;
pub mod platform;
pub mod providers;
pub mod safety;
pub mod scanner;
pub mod settings;
pub mod updates;

use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
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
                let win =
                    tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
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
            cancel_cleanup,
            get_cache_providers,
            measure_cache_providers,
            cancel_cache_measurement,
            preview_official_action,
            cancel_cache_preview,
            execute_official_action,
            get_cleanup_history,
            get_cleanup_totals,
            get_disk_pressure,
            get_growth_report,
            get_official_action_history,
            clear_all_history,
            clear_cleanup_history,
            clear_cleanups_history,
            clear_actions_history,
            get_app_settings,
            save_app_settings,
            reset_app_data,
            get_build_info,
            check_for_updates,
            test_webhook,
            dispatch_webhook,
            get_last_scan,
            save_last_scan,
            clear_last_scan,
            hide_to_tray,
            quit_app
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|err| {
            // A panic here aborted the process with a backtrace-oriented message
            // and no explanation. Log the real cause and exit deliberately so a
            // support report has something actionable.
            crate::logging::error("fatal: the desktop runtime could not start", err);
            std::process::exit(1);
        });
}

/// Native tray entry point: the app keeps running when the window is hidden,
/// and the tray is the only way back (or the only way to really quit).
///
/// Tray labels are localized from the same generated dictionary the frontend
/// uses for backend-originated strings, so every supported locale is covered.
fn tray_labels(language: Option<&str>) -> (&'static str, &'static str) {
    use std::collections::HashMap;
    use std::sync::OnceLock;

    static TABLE: OnceLock<HashMap<String, (String, String)>> = OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let raw: serde_json::Value =
            serde_json::from_str(include_str!("../assets/tray-locales.json"))
                .unwrap_or(serde_json::Value::Null);
        let mut map = HashMap::new();
        if let serde_json::Value::Object(entries) = raw {
            for (locale, value) in entries {
                let show = value
                    .get("Show")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Show")
                    .to_string();
                let quit = value
                    .get("Quit")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Quit")
                    .to_string();
                map.insert(locale, (show, quit));
            }
        }
        map
    });

    let fallback = || ("Show", "Quit");
    match language {
        Some(lang) => match table.get(lang) {
            Some((show, quit)) => (show.as_str(), quit.as_str()),
            None => fallback(),
        },
        None => fallback(),
    }
}

/// Rebuild the tray menu with labels for `language`.
///
/// Called when the user saves settings so a language change also updates the
/// tray without restarting the application.
pub fn refresh_tray_labels(app: &tauri::AppHandle, language: Option<&str>) {
    use tauri::menu::{Menu, MenuItem};

    let Some(tray) = app.tray_by_id("main-tray") else {
        return;
    };
    let (show_label, quit_label) = tray_labels(language);
    let show_item = match MenuItem::with_id(app, "show", show_label, true, None::<&str>) {
        Ok(item) => item,
        Err(_) => return,
    };
    let quit_item = match MenuItem::with_id(app, "quit", quit_label, true, None::<&str>) {
        Ok(item) => item,
        Err(_) => return,
    };
    if let Ok(menu) = Menu::with_items(app, &[&show_item, &quit_item]) {
        let _ = tray.set_menu(Some(menu));
    }
}

/// Pick the tray bitmap for the primary monitor's DPI.
///
/// Windows asks the notification area for `SM_CXSMICON` pixels, which is
/// `16 x scale` (28 px at 175%, 36 px at 225%, 48 px at 300%). The nearest
/// pre-rendered size at or above the request is used so the shell never has to
/// upscale a smaller bitmap.
fn tray_icon(app: &tauri::App) -> Option<tauri::image::Image<'static>> {
    let scale = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(1.0);
    let target = (16.0 * scale).round() as u32;
    let size = [16u32, 20, 24, 28, 32, 36, 40, 48]
        .into_iter()
        .find(|candidate| *candidate >= target)
        .unwrap_or(48);

    let png: &'static [u8] = match size {
        16 => include_bytes!("../icons/tray-16.png"),
        20 => include_bytes!("../icons/tray-20.png"),
        24 => include_bytes!("../icons/tray-24.png"),
        28 => include_bytes!("../icons/tray-28.png"),
        32 => include_bytes!("../icons/tray-32.png"),
        36 => include_bytes!("../icons/tray-36.png"),
        40 => include_bytes!("../icons/tray-40.png"),
        48 => include_bytes!("../icons/tray-48.png"),
        _ => return None,
    };

    tauri::image::Image::from_bytes(png).ok()
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::Manager;

    let settings = settings::SettingsRepository::new().load();
    let (show_label, quit_label) = tray_labels(settings.language.as_deref());

    let show_item = MenuItem::with_id(app, "show", show_label, true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("Dev Cleaner")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => window_commands::show_main_window(app),
            "quit" => {
                // Route the tray through the same guard as the title-bar close
                // button. Exiting here directly would kill a running cleanup.
                window_commands::show_main_window(app);
                use tauri::Emitter;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("close-requested", ());
                }
            }
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

    if let Some(icon) = tray_icon(app) {
        builder = builder.icon(icon);
    } else if let Some(icon) = app.default_window_icon().cloned() {
        // Decoding a PNG should never fail, but a missing tray must not stop
        // the application from starting.
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}
