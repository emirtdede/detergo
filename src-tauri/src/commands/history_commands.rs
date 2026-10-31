use serde::Serialize;
use tauri::State;

use crate::audit::{ActionAuditRecord, AuditRecord};
use crate::commands::AppState;
use crate::error::AppError;
use crate::providers::growth::{analyze_growth, GrowthEntry};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowthReport {
    pub entries: Vec<GrowthEntry>,
    pub single_file_threshold_bytes: u64,
}

#[tauri::command]
pub fn get_cleanup_history(limit: Option<usize>, state: State<'_, AppState>) -> Vec<AuditRecord> {
    let mut records = state.audit.list_records(limit.unwrap_or(200).clamp(1, 1000));
    records.reverse();
    records
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
    let mut records = state.audit.list_actions(limit.unwrap_or(200).clamp(1, 1000));
    records.reverse();
    records
}

#[tauri::command]
pub fn clear_cleanup_history(state: State<'_, AppState>) -> Result<(), AppError> {
    state.audit.clear_all()
}
