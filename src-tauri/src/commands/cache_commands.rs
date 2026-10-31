use tauri::State;

use crate::cleanup::official_actions::{
    execute_action, list_cache_providers, preview_action, CacheProviderInfo, OfficialActionPreview,
    OfficialActionResult,
};
use crate::commands::AppState;
use crate::error::AppError;
use crate::scanner::cancellation::CancellationToken;

#[tauri::command]
pub async fn get_global_cache_providers() -> Result<Vec<CacheProviderInfo>, AppError> {
    tokio::task::spawn_blocking(|| list_cache_providers(&CancellationToken::new()))
        .await
        .map_err(|e| AppError::Unknown(format!("Önbellek taraması başarısız: {}", e)))
}

#[tauri::command]
pub fn preview_official_action(
    provider_id: String,
    action_id: String,
    state: State<'_, AppState>,
) -> Result<OfficialActionPreview, AppError> {
    preview_action(&state.official, &provider_id, &action_id)
}

#[tauri::command]
pub async fn execute_official_action(
    token: String,
    state: State<'_, AppState>,
) -> Result<OfficialActionResult, AppError> {
    let registry = state.official.clone();
    let mut result = tokio::task::spawn_blocking(move || execute_action(&registry, &token))
        .await
        .map_err(|e| AppError::Unknown(format!("Araç komutu başarısız: {}", e)))??;

    let settings = state.settings.load();
    if settings.history_enabled {
        let record = crate::audit::ActionAuditRecord {
            id: format!("a-{}", uuid::Uuid::new_v4().simple()),
            timestamp: chrono::Local::now().to_rfc3339(),
            provider_id: result.provider_id.clone(),
            action_id: result.action_id.clone(),
            label: result.label.clone(),
            success: result.success,
            exit_code: result.exit_code,
            before_bytes: result.before_bytes,
            after_bytes: result.after_bytes,
            delta_bytes: result.delta_bytes,
            duration_ms: result.duration_ms,
        };
        if let Err(err) = state.audit.append_action(&record) {
            result.audit_error = Some(format!("İşlem kaydı yazılamadı: {}", err));
        }
    }
    Ok(result)
}
