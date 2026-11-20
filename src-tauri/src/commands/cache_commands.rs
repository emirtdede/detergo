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
        .map_err(|e| AppError::Unknown(format!("Failed to list caches: {}", e)))
}

/// Streams measured sizes one path at a time so the UI can show progress and
/// let the user cancel. The scan runs on a blocking worker thread.
#[tauri::command]
pub async fn measure_cache_providers(
    provider_ids: Option<Vec<String>>,
    on_event: Channel<CacheMeasureEvent>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let token = CancellationToken::new();
    {
        let mut current = crate::lock!(state.cache_token);
        if let Some(old) = current.take() {
            old.cancel();
        }
        *current = Some(token.clone());
    }

    let worker_token = token.clone();
    let result = tokio::task::spawn_blocking(move || {
        measure_providers_blocking(&worker_token, provider_ids.as_deref(), move |event| {
            let _ = on_event.send(event);
        });
    })
    .await
    .map_err(|e| AppError::Unknown(format!("Failed to measure caches: {}", e)));

    {
        let mut current = crate::lock!(state.cache_token);
        if current.as_ref().map(|t| t.same(&token)).unwrap_or(false) {
            *current = None;
        }
    }

    result
}

#[tauri::command]
pub fn cancel_cache_measurement(state: State<'_, AppState>) -> Result<(), AppError> {
    let mut current = crate::lock!(state.cache_token);
    if let Some(token) = current.take() {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
pub async fn preview_official_action(
    provider_id: String,
    action_id: String,
    state: State<'_, AppState>,
) -> Result<OfficialActionPreview, AppError> {
    // Previewing walks every cache path to report a real "before" size. A
    // synchronous command would run that walk on the webview thread and freeze
    // the window for large caches (NuGet, pnpm), so it is offloaded here.
    let registry = state.official.clone();
    let token = CancellationToken::new();
    {
        let mut current = crate::lock!(state.preview_token);
        if let Some(old) = current.take() {
            old.cancel();
        }
        *current = Some(token.clone());
    }

    let worker_token = token.clone();
    let result = tokio::task::spawn_blocking(move || {
        preview_action(&registry, &provider_id, &action_id, &worker_token)
    })
    .await
    .map_err(|e| AppError::Unknown(format!("Cache preview failed: {}", e)));

    {
        let mut current = crate::lock!(state.preview_token);
        if current.as_ref().map(|t| t.same(&token)).unwrap_or(false) {
            *current = None;
        }
    }

    result?
}

/// Stops an in-flight preview measurement. Without this, dismissing the
/// spinner left the directory walk running to completion on a large cache.
#[tauri::command]
pub fn cancel_cache_preview(state: State<'_, AppState>) -> Result<(), AppError> {
    let mut current = crate::lock!(state.preview_token);
    if let Some(token) = current.take() {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
pub async fn execute_official_action(
    token: String,
    state: State<'_, AppState>,
) -> Result<OfficialActionResult, AppError> {
    let registry = state.official.clone();
    let mut result = tokio::task::spawn_blocking(move || execute_action(&registry, &token))
        .await
        .map_err(|e| AppError::Unknown(format!("Tool action failed: {}", e)))??;

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
            result.audit_error = Some(format!("Failed to record action audit: {}", err));
        }
    }
    Ok(result)
}
