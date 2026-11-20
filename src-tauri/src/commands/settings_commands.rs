use tauri::State;

use crate::commands::AppState;
use crate::error::AppError;
use crate::settings::AppSettings;

#[tauri::command]
pub fn get_app_settings(state: State<'_, AppState>) -> AppSettings {
    state.settings.load()
}

#[tauri::command]
pub fn save_app_settings(
    mut settings: AppSettings,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<AppSettings, AppError> {
    state.settings.save(&settings)?;
    // Return what was actually persisted (migrated and clamped) so a caller
    // cannot keep showing values the backend silently normalised.
    settings.migrate();
    // The tray menu is built at startup; rebuild its labels so a language
    // change is reflected without restarting the application.
    crate::refresh_tray_labels(&app, settings.language.as_deref());
    Ok(settings)
}

/// Factory reset: settings, cleanup/scan/action history, and the last-scan
/// snapshot are deleted from disk.
///
/// The frontend clears its localStorage caches and reloads the webview after
/// this returns. Refusing while a scan or cleanup is running prevents a reset
/// from deleting files that the operation is still appending to.
#[tauri::command]
pub fn reset_app_data(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    if let Some(operation) = state.active_operation() {
        return Err(AppError::Blocked(format!(
            "Cannot reset application data while a {operation} is running."
        )));
    }

    state.audit.reset()?;
    state.last_scan.reset()?;
    state.settings.reset()?;
    let _ = crate::system_cleaner::schedule::uninstall();
    state.system_automation.clear()?;
    // The saved language is gone; the native tray must not keep the old labels.
    crate::refresh_tray_labels(&app, None);
    Ok(())
}
