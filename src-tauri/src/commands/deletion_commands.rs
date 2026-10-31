use tauri::State;

use crate::audit::{AuditEntry, AuditRecord};
use crate::cleanup::{build_plan, execute_plan, CleanupPlan, CleanupReport, DeleteMode};
use crate::commands::AppState;
use crate::error::AppError;
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
    state: State<'_, AppState>,
) -> Result<CleanupReport, AppError> {
    let plan = state.registry.consume_plan(&plan_id)?;
    let handle = state.registry.get_session(&plan.session_id)?;
    let catalog = state.catalog()?;
    let settings = state.settings.load();
    let policy = crate::cleanup::CleanupPolicy::from(&settings);

    let plan_for_task = plan.clone();
    let handle_for_task = handle.clone();
    let report = tokio::task::spawn_blocking(move || {
        let session = handle_for_task.lock().unwrap();
        execute_plan(
            &plan_for_task,
            &session,
            &catalog,
            &policy,
            &confirmation_token,
            permanent_acknowledged,
        )
    })
    .await
    .map_err(|e| AppError::Unknown(format!("Silme görevi başarısız: {}", e)))??;

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
        };
        // A failed history write must never be reported as success without a
        // hint: the user has to know that the audit trail is incomplete.
        if let Err(err) = state.audit.append_record(&record) {
            return Ok(CleanupReport {
                audit_error: Some(format!("Temizlik geçmişi yazılamadı: {}", err)),
                ..report
            });
        }
    }

    Ok(report)
}
