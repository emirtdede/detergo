use tauri::{AppHandle, Manager, WebviewWindow};

use crate::error::AppError;

/// Hides the main window in the system tray instead of terminating the process.
/// Used by the close-confirmation dialog and by the tray menu.
#[tauri::command]
pub fn hide_to_tray(window: WebviewWindow) -> Result<(), AppError> {
    window
        .hide()
        .map_err(|e| AppError::Unknown(format!("Failed to hide window to tray: {}", e)))
}

/// Real application exit. Bypasses the close guard so the tray menu and the
/// dialog can always terminate the process.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Brings the window back from the tray and focuses it.
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();

        #[cfg(windows)]
        {
            if let Ok(hwnd) = window.hwnd() {
                use windows::Win32::Foundation::HWND;
                crate::platform::force_foreground(HWND(hwnd.0 as _));
            }
        }
    }
}
