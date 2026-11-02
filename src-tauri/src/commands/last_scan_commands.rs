use tauri::State;

use crate::commands::AppState;
use crate::error::AppError;
use crate::last_scan::LastScanSnapshot;

/// Returns the single most recent scan snapshot (or `None` when the app has
/// never completed a scan on this machine).
#[tauri::command]
pub fn get_last_scan(state: State<'_, AppState>) -> Option<LastScanSnapshot> {
    state.last_scan.load()
}

#[tauri::command]
pub fn save_last_scan(
    snapshot: LastScanSnapshot,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.last_scan.save(&snapshot)
}

#[tauri::command]
pub fn clear_last_scan(state: State<'_, AppState>) -> Result<(), AppError> {
    state.last_scan.clear()
}
