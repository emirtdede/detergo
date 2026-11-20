use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::commands::AppState;
use crate::error::AppError;
use crate::scanner::cancellation::CancellationToken;

/// How long a quit waits for the running cleanup to acknowledge cancellation.
/// Cleanup cancellation is checked between targets, so one very large target can
/// take a while; after this bound the process exits anyway rather than leaving
/// an invisible orphan because the tray is gone.
const QUIT_CLEANUP_TIMEOUT: Duration = Duration::from_secs(30);
const QUIT_CLEANUP_POLL: Duration = Duration::from_millis(100);

/// Hides the main window in the system tray instead of terminating the process.
/// Used by the close-confirmation dialog and by the tray menu.
#[tauri::command]
pub fn hide_to_tray(window: WebviewWindow) -> Result<(), AppError> {
    window
        .hide()
        .map_err(|e| AppError::Unknown(format!("Failed to hide window to tray: {}", e)))
}

/// Asks the active cleanup to stop. Safe to call when nothing is running.
pub fn cancel_running_cleanup(slot: &Mutex<Option<CancellationToken>>) {
    if let Some(token) = crate::lock!(slot).as_ref() {
        token.cancel();
    }
}

/// Real application exit.
///
/// A cleanup that is mid-run must not be cut in half: partial deletions are
/// exactly the state the plan/coordinator work hard to avoid. The command asks
/// the run to cancel and waits for `execute_cleanup` to release its slot before
/// terminating. `AppState` is the single source of truth, so a remembered
/// "quit" from the close guard and the tray both converge here.
#[tauri::command]
pub async fn quit_app(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    cancel_running_cleanup(&state.scan_token);
    cancel_running_cleanup(&state.cache_token);
    cancel_running_cleanup(&state.preview_token);
    cancel_running_cleanup(&state.cleanup_token);
    cancel_running_cleanup(&state.system_token);

    let deadline = Instant::now() + QUIT_CLEANUP_TIMEOUT;
    loop {
        let idle = crate::lock!(state.cleanup_token).is_none()
            && crate::lock!(state.system_token).is_none();
        if idle || Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(QUIT_CLEANUP_POLL).await;
    }

    app.exit(0);
    Ok(())
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
                crate::platform::force_foreground(HWND(hwnd.0));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_running_cleanup_cancels_the_active_token() {
        let token = CancellationToken::new();
        let slot = Mutex::new(Some(token.clone()));

        cancel_running_cleanup(&slot);

        assert!(token.is_cancelled());
        // The slot stays occupied until the run acknowledges the cancellation
        // and clears it; quit_app relies on that signal.
        assert!(crate::lock!(slot).is_some());
    }

    #[test]
    fn cancel_running_cleanup_is_a_noop_when_idle() {
        let slot: Mutex<Option<CancellationToken>> = Mutex::new(None);
        cancel_running_cleanup(&slot);
        assert!(crate::lock!(slot).is_none());
    }
}
