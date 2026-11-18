use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

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
    let session = crate::lock!(handle);
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
        let mut slot = crate::lock!(state.cleanup_token);
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
        let mut slot = crate::lock!(state.cleanup_token);
        *slot = None;
    }

    outcome
}

#[tauri::command]
pub fn cancel_cleanup(state: State<'_, AppState>) -> Result<(), AppError> {
    let current = crate::lock!(state.cleanup_token);
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
    // Validate the session before consuming the plan: a restored/expired
    // session must not burn the single-use plan, otherwise the user has to
    // redo the preview after an unrelated session error.
    let preview = state.registry.peek_plan(&plan_id)?;
    let handle = state.registry.get_session(&preview.session_id)?;
    // Load everything the run depends on *before* the plan is consumed. A
    // catalog/settings failure at this point must leave the preview reusable
    // instead of forcing the user to build a new one.
    let catalog = state.catalog()?;
    let settings = state.settings.load();
    let policy = crate::cleanup::CleanupPolicy::from(&settings);
    let plan = state.registry.consume_plan(&plan_id)?;

    let plan_for_task = plan.clone();
    let handle_for_task = handle.clone();
    let token_for_task = token.clone();
    // Clone the session under the lock and release it immediately. Holding the
    // mutex for the whole run blocked read-only commands (`get_scan_summary`,
    // `preview_cleanup`) until every target was processed.
    let session_for_task = {
        let session = crate::lock!(handle_for_task);
        session.clone()
    };
    // A closed frontend channel must not abort the cleanup, but the lost events
    // must be reported instead of silently vanishing (Y-3).
    let dropped_events = Arc::new(AtomicU64::new(0));
    let dropped_for_task = Arc::clone(&dropped_events);
    let report = tokio::task::spawn_blocking(move || {
        let observer = |event: CleanupEvent| {
            if let Some(channel) = on_event.as_ref() {
                // A dropped frontend channel must never abort a cleanup; the
                // run continues and the final report still says how many
                // progress events were lost.
                if channel.send(event).is_err() {
                    dropped_for_task.fetch_add(1, Ordering::Relaxed);
                }
            }
        };
        execute_plan_with_hooks(
            &plan_for_task,
            &session_for_task,
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
    .map_err(|e| {
        // A JoinError means the worker panicked or was aborted: that is a bug,
        // not something the user can act on. Keep the details in the log and
        // return a stable message instead of embedding the panic payload.
        crate::logging::error("delete task failed to join", e);
        AppError::Unknown("Cleanup worker stopped unexpectedly.".to_string())
    })??;

    let mut report = report;
    report.dropped_events = dropped_events.load(Ordering::Relaxed);

    {
        let mut session = crate::lock!(handle);
        let success_ids: Vec<String> = report
            .results
            .iter()
            .filter(|result| result.success)
            .map(|result| result.target_id.clone())
            .collect();
        // A successful parent also removed every nested row from disk; keeping
        // them in the session produced ghost targets in the UI.
        session.apply_successful_deletions(&success_ids);
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
