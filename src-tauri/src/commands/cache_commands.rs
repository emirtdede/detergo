use tauri::ipc::Channel;
use tauri::State;

use crate::cleanup::official_actions::{
    execute_action, list_cache_providers, measure_cache_providers as measure_providers_blocking,
    preview_action, CacheMeasureEvent, CacheProviderInfo, OfficialActionPreview,
    OfficialActionResult,
};
use crate::commands::AppState;
use crate::error::AppError;
use crate::scanner::cancellation::CancellationToken;

/// Fast path: provider list, paths and versions without walking directories.
#[tauri::command]
pub async fn get_cache_providers() -> Result<Vec<CacheProviderInfo>, AppError> {
    tokio::task::spawn_blocking(list_cache_providers)
        .await
        .map_err(|e| AppError::Unknown(format!("Önbellek listesi başarısız: {}", e)))
}

/// Streams measured sizes one path at a time so the UI can show progress and
/// let the user cancel. The scan runs on a blocking worker thread.
#[tauri::command]
pub async fn measure_cache_providers(
    on_event: Channel<CacheMeasureEvent>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let token = CancellationToken::new();
    {
        let mut current = state
            .cache_token
            .lock()
            .map_err(|_| AppError::Unknown("Önbellek durumu kilitli.".to_string()))?;
        if let Some(old) = current.take() {
            old.cancel();
        }
        *current = Some(token.clone());
    }

    let worker_token = token.clone();
    let result = tokio::task::spawn_blocking(move || {
        measure_providers_blocking(&worker_token, move |event| {
            let _ = on_event.send(event);
        });
    })
    .await
    .map_err(|e| AppError::Unknown(format!("Önbellek ölçümü başarısız: {}", e)));

    if let Ok(mut current) = state.cache_token.lock() {
        if current
            .as_ref()
            .map(|t| t.same(&token))
            .unwrap_or(false)
        {
            *current = None;
        }
    }

    result
}

#[tauri::command]
pub fn cancel_cache_measurement(state: State<'_, AppState>) -> Result<(), AppError> {
    let mut current = state
        .cache_token
        .lock()
        .map_err(|_| AppError::Unknown("Önbellek durumu kilitli.".to_string()))?;
    if let Some(token) = current.take() {
        token.cancel();
    }
    Ok(())
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
