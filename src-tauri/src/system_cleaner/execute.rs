//! Orchestration shared by the GUI command and the CLI.
//!
//! The executed set always comes from a token that was created after a fresh
//! measurement, so a stale window cannot run an action the user never saw.

use std::time::Instant;

use crate::error::AppError;
use crate::scanner::cancellation::CancellationToken;

use super::actions::{spec, Engine};
use super::{SystemActionId, SystemActionResult, SystemCleanReport, SystemEvent};

/// Runs the selected actions in order. Cancellation is checked between actions
/// and, for the native walk, between entries.
pub fn execute(
    ids: &[SystemActionId],
    elevated: bool,
    token: &CancellationToken,
    mut on_event: impl FnMut(SystemEvent),
) -> SystemCleanReport {
    let started_at = chrono::Local::now().to_rfc3339();
    let mut results = Vec::new();
    let mut cancelled = false;

    on_event(SystemEvent::Started { total: ids.len() });

    for (index, id) in ids.iter().enumerate() {
        if token.is_cancelled() {
            cancelled = true;
            break;
        }
        on_event(SystemEvent::ActionStarted {
            id: *id,
            index,
            total: ids.len(),
        });

        let started = Instant::now();
        let mut result = match spec(*id).engine {
            Engine::Native => run_native(*id, token),
            Engine::RecycleBin => run_recycle_bin(),
            Engine::CleanMgr => run_cleanmgr(token),
            Engine::Dism => run_dism(token),
        };
        result.duration_ms = started.elapsed().as_millis() as u64;

        on_event(SystemEvent::ActionFinished {
            id: *id,
            success: result.success,
            freed_bytes: result.freed_bytes,
            skipped: result.skipped,
        });
        results.push(result);
    }

    let freed_bytes = results
        .iter()
        .fold(0u64, |sum, item| sum.saturating_add(item.freed_bytes));
    on_event(SystemEvent::Finished {
        freed_bytes,
        cancelled,
    });

    SystemCleanReport {
        results,
        freed_bytes,
        cancelled,
        started_at,
        finished_at: chrono::Local::now().to_rfc3339(),
        elevated,
    }
}

fn run_native(id: SystemActionId, token: &CancellationToken) -> SystemActionResult {
    let mut result = base_result(id);
    let Some(root) = super::guard::root_for(id) else {
        result.error_code = Some("notPresent".to_string());
        return result;
    };
    match super::delete::delete_contents(&root, token) {
        Ok(outcome) => {
            result.success = !outcome.incomplete;
            result.freed_bytes = outcome.freed_bytes;
            result.deleted_files = outcome.deleted_files;
            result.skipped = outcome.skipped;
            result.skipped_sample = outcome.skipped_sample;
            if outcome.incomplete {
                result.error_code = Some("cancelled".to_string());
            }
        }
        Err(err) => {
            result.error_code = Some(error_code(&err));
        }
    }
    result
}

fn run_recycle_bin() -> SystemActionResult {
    let mut result = base_result(SystemActionId::RecycleBin);
    let before = super::recycle::size_bytes().unwrap_or(0);
    match super::recycle::empty() {
        Ok(()) => {
            let after = super::recycle::size_bytes().unwrap_or(0);
            result.success = true;
            result.freed_bytes = before.saturating_sub(after);
        }
        Err(err) => result.error_code = Some(error_code(&err)),
    }
    result
}

fn run_cleanmgr(token: &CancellationToken) -> SystemActionResult {
    let mut result = base_result(SystemActionId::DiskCleanup);
    match super::cleanmgr::run(token) {
        Ok(outcome) => {
            result.success = outcome.exit_code == Some(0) && !outcome.timed_out;
            result.exit_code = outcome.exit_code;
            result.log_tail = Some(outcome.log_tail);
            if outcome.timed_out {
                result.error_code = Some("timedOut".to_string());
            } else if !result.success {
                result.error_code = Some("toolFailed".to_string());
            }
        }
        Err(err) => result.error_code = Some(error_code(&err)),
    }
    result
}

fn run_dism(token: &CancellationToken) -> SystemActionResult {
    let mut result = base_result(SystemActionId::ComponentStore);
    match super::dism::run(token) {
        Ok(outcome) => {
            // 0 = success, 3010 = success but a reboot is recommended.
            result.success =
                matches!(outcome.exit_code, Some(0) | Some(3010)) && !outcome.timed_out;
            result.exit_code = outcome.exit_code;
            result.log_tail = Some(outcome.log_tail);
            if outcome.timed_out {
                result.error_code = Some("timedOut".to_string());
            } else if !result.success {
                result.error_code = Some("toolFailed".to_string());
            }
        }
        Err(err) => result.error_code = Some(error_code(&err)),
    }
    result
}

fn base_result(id: SystemActionId) -> SystemActionResult {
    SystemActionResult {
        id,
        success: false,
        freed_bytes: 0,
        deleted_files: 0,
        skipped: 0,
        skipped_sample: Vec::new(),
        exit_code: None,
        log_tail: None,
        duration_ms: 0,
        error_code: None,
    }
}

/// A short machine code the frontend can translate without parsing English.
fn error_code(err: &AppError) -> String {
    match err {
        AppError::AccessDenied(_) => "accessDenied",
        AppError::PathNotFound(_) => "notPresent",
        AppError::UnsafeDeleteTarget(_) => "unsafeTarget",
        AppError::ScanCancelled(_) => "cancelled",
        AppError::PlatformUnsupported(_) => "unsupported",
        AppError::Blocked(_) => "blocked",
        _ => "failed",
    }
    .to_string()
}

/// Writes one audit record per action, matching the cache-action history shape.
pub fn record_audit(
    repository: &crate::audit::AuditRepository,
    report: &SystemCleanReport,
    enabled: bool,
) -> Option<String> {
    if !enabled {
        return None;
    }
    let mut failure = None;
    for result in &report.results {
        let entry = crate::audit::ActionAuditRecord {
            id: format!("s-{}", uuid::Uuid::new_v4().simple()),
            timestamp: report.finished_at.clone(),
            provider_id: "system".to_string(),
            action_id: result.id.as_str().to_string(),
            label: spec(result.id).label.to_string(),
            success: result.success,
            exit_code: result.exit_code,
            before_bytes: 0,
            after_bytes: 0,
            delta_bytes: result.freed_bytes as i64,
            duration_ms: result.duration_ms,
        };
        if let Err(err) = repository.append_action(&entry) {
            failure = Some(format!("Failed to record system cleanup history: {err}"));
        }
    }
    failure
}
