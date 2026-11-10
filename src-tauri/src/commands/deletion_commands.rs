use tauri::ipc::{Channel, JavaScriptChannelId};
use tauri::State;

use crate::audit::{AuditEntry, AuditRecord};
use crate::cleanup::{
    build_plan, coordinator::execute_plan_with_hooks, CleanupEvent, CleanupPlan, CleanupReport,
    DeleteMode,
};
use crate::commands::AppState;
use crate::error::AppError;
use crate::scanner::cancellation::CancellationToken;
use crate::scanner::models::ItemStatus;

#[tauri::command]
pub fn preview_cleanup(
    scan_session_id: String,
    target_ids: Vec<String>,
    mode: DeleteMode,
    state: State<'_, AppState>,
) -> Result<CleanupPlan, AppError> {
    let catalog = state.catalog()?;
    let settings = state.settings.load();
    let policy = crate::cleanup::CleanupPolicy::from(&settings);
    let handle = state.registry.get_session(&scan_session_id)?;
    let session = handle.lock().unwrap();
    let plan = build_plan(&session, &target_ids, mode, &catalog, &policy)?;
    drop(session);
    state.registry.insert_plan(plan.clone());
    Ok(plan)
}

#[tauri::command]
pub async fn execute_cleanup(
    plan_id: String,
    confirmation_token: String,
    permanent_acknowledged: bool,
    on_event: Option<JavaScriptChannelId>,
    webview: tauri::Webview,
    state: State<'_, AppState>,
) -> Result<CleanupReport, AppError> {
    // `Channel<T>` itself is not optional as a command argument, so the raw
    // JavaScript channel id is accepted and upgraded here. Callers without a
    // channel (CLI-style probes) simply receive no progress events.
    let on_event: Option<Channel<CleanupEvent>> = on_event.map(|id| id.channel_on(webview.clone()));
    // Acquire the slot before consuming the plan: a second concurrent request
    // must be rejected instead of invalidating the plan the first one is using.
    let token = {
        let mut slot = state.cleanup_token.lock().unwrap();
        if slot.is_some() {
            return Err(AppError::Blocked(
                "A cleanup is already running.".to_string(),
            ));
        }
        let token = CancellationToken::new();
        *slot = Some(token.clone());
        token
    };

    let outcome = run_cleanup(
        plan_id,
        confirmation_token,
        permanent_acknowledged,
        on_event,
        &state,
        token,
    )
    .await;

    // The slot is released on every exit path (success, blocked, error), and
    // only after the run above has fully finished. `cancel_cleanup` therefore
    // keeps seeing the token until cancellation has taken effect.
    {
        let mut slot = state.cleanup_token.lock().unwrap();
        *slot = None;
    }

    outcome
}

#[tauri::command]
pub fn cancel_cleanup(state: State<'_, AppState>) -> Result<(), AppError> {
    let current = state.cleanup_token.lock().unwrap();
    if let Some(token) = current.as_ref() {
        token.cancel();
    }
    Ok(())
}

async fn run_cleanup(
    plan_id: String,
    confirmation_token: String,
    permanent_acknowledged: bool,
    on_event: Option<Channel<CleanupEvent>>,
    state: &AppState,
    token: CancellationToken,
) -> Result<CleanupReport, AppError> {
    let plan = state.registry.consume_plan(&plan_id)?;
    let handle = state.registry.get_session(&plan.session_id)?;
    let catalog = state.catalog()?;
    let settings = state.settings.load();
    let policy = crate::cleanup::CleanupPolicy::from(&settings);

    let plan_for_task = plan.clone();
    let handle_for_task = handle.clone();
    let token_for_task = token.clone();
    let report = tokio::task::spawn_blocking(move || {
        let session = handle_for_task.lock().unwrap();
        let observer = |event: CleanupEvent| {
            if let Some(channel) = on_event.as_ref() {
                // A dropped frontend channel must never abort a cleanup; the
                // run continues and the final report is still returned.
                let _ = channel.send(event);
            }
        };
        execute_plan_with_hooks(
            &plan_for_task,
            &session,
            &catalog,
            &policy,
            &confirmation_token,
            permanent_acknowledged,
            &crate::safety::active_use_for_provider,
            &observer,
            &token_for_task,
        )
    })
    .await
    .map_err(|e| AppError::Unknown(format!("Delete task failed: {}", e)))??;

    {
        let mut session = handle.lock().unwrap();
        for result in &report.results {
            if result.success {
                if let Some(item) = session.items.iter_mut().find(|i| i.id == result.target_id) {
                    item.status = ItemStatus::Deleted;
                }
                session.targets.remove(&result.target_id);
            }
        }
    }

    if settings.history_enabled {
        let record = AuditRecord {
            id: format!("h-{}", uuid::Uuid::new_v4().simple()),
            timestamp: report.finished_at.clone(),
            session_id: plan.session_id.clone(),
            plan_id: plan.id.clone(),
            mode: report.mode,
            success_count: report.success_count,
            error_count: report.error_count,
            reclaim_bytes: report.reclaim_bytes,
            moved_bytes: report.moved_bytes,
            duration_ms: report.duration_ms,
            entries: report
                .results
                .iter()
                .map(|r| AuditEntry {
                    target_id: r.target_id.clone(),
                    rule_id: r.rule_id.clone(),
                    path: r.display_path.clone(),
                    success: r.success,
                    verified: r.verified,
                    error_code: r.error_code.clone(),
                    bytes: r.measured_bytes,
                })
                .collect(),
            cancelled: report.cancelled,
            processed_count: report.processed_count,
            skipped_count: report.skipped_count,
        };
        // A failed history write must never be reported as success without a
        // hint: the user has to know that the audit trail is incomplete.
        if let Err(err) = state.audit.append_record(&record) {
            return Ok(CleanupReport {
                audit_error: Some(format!("Failed to record cleanup audit: {}", err)),
                ..report
            });
        }
    }

    Ok(report)
}
