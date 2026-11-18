use serde::Serialize;
use tauri::State;

use crate::audit::{ActionAuditRecord, AuditRecord};
use crate::commands::AppState;
use crate::error::AppError;
use crate::providers::growth::{analyze_growth, GrowthEntry};

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowthReport {
    pub entries: Vec<GrowthEntry>,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub single_file_threshold_bytes: u64,
}

#[tauri::command]
pub fn get_cleanup_history(limit: Option<usize>, state: State<'_, AppState>) -> Vec<AuditRecord> {
    let mut records = state
        .audit
        .list_records(limit.unwrap_or(200).clamp(1, 1000));
    records.reverse();
    records
}

/// Lifetime cleanup totals computed from the whole history file, not a page.
#[tauri::command]
pub fn get_cleanup_totals(state: State<'_, AppState>) -> crate::audit::CleanupTotals {
    state.audit.cleanup_totals()
}

#[tauri::command]
pub fn get_growth_report(state: State<'_, AppState>) -> GrowthReport {
    let snapshots = state.audit.list_snapshots(1000);
    GrowthReport {
        entries: analyze_growth(&snapshots),
        single_file_threshold_bytes: crate::providers::growth::single_file_threshold_bytes(),
    }
}

#[tauri::command]
pub fn get_official_action_history(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Vec<ActionAuditRecord> {
    let mut records = state
        .audit
        .list_actions(limit.unwrap_or(200).clamp(1, 1000));
    records.reverse();
    records
}

/// Clears every cleanup, storage-snapshot and official-action history record.
/// This is what the "clear all" UI action calls.
#[tauri::command]
pub fn clear_all_history(state: State<'_, AppState>) -> Result<(), AppError> {
    state.audit.clear_all()
}

/// Deprecated alias kept for older frontends. Use `clear_all_history`.
///
/// L8: the name promises cleanup history only; delegating to `clear_all`
/// deleted scan history and official-action records too. It now clears only
/// cleanup records, matching its name.
#[tauri::command]
pub fn clear_cleanup_history(state: State<'_, AppState>) -> Result<(), AppError> {
    state.audit.clear_cleanups()
}

#[tauri::command]
pub fn clear_cleanups_history(state: State<'_, AppState>) -> Result<(), AppError> {
    state.audit.clear_cleanups()
}

#[tauri::command]
pub fn clear_actions_history(state: State<'_, AppState>) -> Result<(), AppError> {
    state.audit.clear_actions()
}
