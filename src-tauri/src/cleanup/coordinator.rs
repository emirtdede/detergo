use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Instant;

use crate::catalog::CatalogIndex;
use crate::cleanup::permanent::PermanentDeleteService;
use crate::cleanup::plan::{
    verify_snapshot, CleanupPlan, PlanItem, TargetSnapshot, VerificationOutcome,
};
use crate::cleanup::recycle_bin::RecycleBinService;
use crate::cleanup::DeleteMode;
use crate::error::AppError;
use crate::platform::volume_free_bytes;
use crate::safety::{
    active_use_for_provider, git_guard, revalidate_evidence, validate_target, GuardContext,
};
use crate::scanner::cancellation::CancellationToken;
use crate::scanner::measurement::measure_path;
use crate::scanner::session::ScanSession;

/// Progress events streamed to the UI while a cleanup runs.
///
/// The frontend uses these to render per-item progress and to know that a
/// cancellation took effect between two items.
#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CleanupEvent {
    Started {
        #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<usize>))]
        total: usize,
    },
    ItemStarted {
        #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<usize>))]
        index: usize,
        #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<usize>))]
        total: usize,
        display_path: String,
    },
    ItemFinished {
        #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<usize>))]
        index: usize,
        #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<usize>))]
        total: usize,
        success: bool,
        error_code: Option<String>,
    },
    Cancelled {
        #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<usize>))]
        processed: usize,
        #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<usize>))]
        skipped: usize,
    },
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResultItem {
    pub target_id: String,
    pub display_path: String,
    pub rule_id: String,
    pub success: bool,
    pub verified: bool,
    pub error_code: Option<String>,
    pub error: Option<String>,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub measured_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub reclaim_bytes: u64,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupReport {
    pub plan_id: String,
    pub mode: DeleteMode,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub success_count: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub error_count: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub estimated_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub moved_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub reclaim_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<u64>>))]
    pub volume_free_before: Option<u64>,
    #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<u64>>))]
    pub volume_free_after: Option<u64>,
    #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<i64>>))]
    pub volume_free_delta: Option<i64>,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub duration_ms: u64,
    pub results: Vec<CleanupResultItem>,
    pub started_at: String,
    pub finished_at: String,
    /// True when the user cancelled and at least one eligible item was left
    /// unprocessed. Items already handled keep their own results.
    #[serde(default)]
    pub cancelled: bool,
    /// Number of eligible items the run actually visited (`results.len()`).
    #[serde(default)]
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub processed_count: u64,
    /// Eligible items that were never visited because the run stopped.
    #[serde(default)]
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub skipped_count: u64,
    /// Progress events that could not be delivered because the frontend
    /// channel was gone. Stamped by the command layer after the run; a lost
    /// event never aborts a cleanup.
    #[serde(default)]
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub dropped_events: u64,
    /// Set when the cleanup finished but its history record could not be
    /// persisted. The cleanup itself is not rolled back.
    pub audit_error: Option<String>,
}

fn block(item: &crate::cleanup::plan::PlanItem, code: &str, reason: String) -> CleanupResultItem {
    CleanupResultItem {
        target_id: item.target_id.clone(),
        display_path: item.display_path.clone(),
        rule_id: item.rule_id.clone(),
        success: false,
        verified: false,
        error_code: Some(code.to_string()),
        error: Some(reason),
        measured_bytes: 0,
        reclaim_bytes: 0,
    }
}

/// Executes a previously previewed plan.
///
/// Every target is re-validated against the filesystem immediately before the
/// destructive call. Any mismatch aborts that item (never the whole batch) and
/// no automatic permanent fallback exists for recycle-bin failures.
pub fn execute_plan(
    plan: &CleanupPlan,
    session: &ScanSession,
    catalog: &CatalogIndex,
    policy: &crate::cleanup::CleanupPolicy,
    confirmation_token: &str,
    permanent_acknowledged: bool,
    token: &CancellationToken,
) -> Result<CleanupReport, AppError> {
    execute_plan_with_hooks(
        plan,
        session,
        catalog,
        policy,
        confirmation_token,
        permanent_acknowledged,
        &active_use_for_provider,
        &|_| {},
        token,
    )
}

/// Executes a plan with an injectable activity probe.
///
/// Production callers use the real system probe through [`execute_plan`].
/// Tests inject a deterministic probe so a developer machine running an agent
/// cannot make safety tests flaky.
#[allow(dead_code)]
pub(crate) fn execute_plan_with_probe(
    plan: &CleanupPlan,
    session: &ScanSession,
    catalog: &CatalogIndex,
    policy: &crate::cleanup::CleanupPolicy,
    confirmation_token: &str,
    permanent_acknowledged: bool,
    activity_probe: &dyn Fn(&str, &Path) -> crate::safety::ActiveUse,
) -> Result<CleanupReport, AppError> {
    execute_plan_with_hooks(
        plan,
        session,
        catalog,
        policy,
        confirmation_token,
        permanent_acknowledged,
        activity_probe,
        &|_| {},
        &CancellationToken::new(),
    )
}

/// Executes a plan with injectable activity probe, progress observer and
/// cancellation token.
///
/// Cancellation is cooperative and only takes effect between two items: an
/// in-flight `IFileOperation` or permanent delete is never interrupted.
#[allow(clippy::too_many_arguments)]
pub(crate) fn execute_plan_with_hooks(
    plan: &CleanupPlan,
    session: &ScanSession,
    catalog: &CatalogIndex,
    policy: &crate::cleanup::CleanupPolicy,
    confirmation_token: &str,
    permanent_acknowledged: bool,
    activity_probe: &dyn Fn(&str, &Path) -> crate::safety::ActiveUse,
    observer: &dyn Fn(CleanupEvent),
    token: &CancellationToken,
) -> Result<CleanupReport, AppError> {
    if plan.is_expired() {
        return Err(AppError::PlanExpired(
            "Cleanup plan expired; a new preview is required.".to_string(),
        ));
    }
    if confirmation_token != plan.confirmation_token {
        return Err(AppError::PlanInvalid(
            "Plan confirmation token is invalid.".to_string(),
        ));
    }
    if plan.mode == DeleteMode::Permanent && !permanent_acknowledged {
        return Err(AppError::Blocked(
            "Permanent deletion requires explicit user confirmation.".to_string(),
        ));
    }

    let started = Instant::now();
    let started_at = chrono::Local::now().to_rfc3339();
    let mut recycle_session = if plan.mode == DeleteMode::RecycleBin {
        Some(crate::cleanup::recycle_bin::RecycleBinSession::new())
    } else {
        None
    };
    let permanent = PermanentDeleteService::new();

    let before_free = sample_volume_free(&session.allowed_roots);

    let eligible: Vec<&PlanItem> = plan.eligible_items().collect();
    let total = eligible.len();
    observer(CleanupEvent::Started { total });

    let mut results = Vec::new();
    let mut success_count = 0u64;
    let mut error_count = 0u64;
    let mut moved_bytes = 0u64;
    let mut reclaim_bytes = 0u64;
    let mut estimated: u64 = 0;
    let mut stopped_early = false;

    'run: for (offset, item) in eligible.iter().enumerate() {
        if token.is_cancelled() {
            stopped_early = true;
            break;
        }

        let index = offset + 1;
        observer(CleanupEvent::ItemStarted {
            index,
            total,
            display_path: item.display_path.clone(),
        });
        estimated = estimated.saturating_add(item.estimated_reclaim_bytes);

        let (result, moved, reclaimed) = 'item: {
            let Some(target) = session.targets.get(&item.target_id) else {
                break 'item (
                    block(item, "NOT_FOUND", "Target not found in session.".into()),
                    0u64,
                    0u64,
                );
            };

            let rule = catalog.rule(&target.rule_id);
            if rule.is_none() {
                if target.provider == "project" {
                    break 'item (
                        block(item, "RULE_MISSING", "Catalog rule not found.".into()),
                        0u64,
                        0u64,
                    );
                }
                if let Err(reason) = validate_agent_target(target) {
                    break 'item (block(item, "AGENT_POLICY", reason), 0u64, 0u64);
                }
            }

            if target.protected || rule.map(|r| r.is_protected()).unwrap_or(false) {
                break 'item (
                    block(
                        item,
                        "PROTECTED",
                        "Protected target cannot be deleted.".into(),
                    ),
                    0u64,
                    0u64,
                );
            }

            if let Some((code, reason)) = policy.agent_policy_block(target) {
                break 'item (block(item, code, reason), 0u64, 0u64);
            }

            // 1. The plan must still describe the same object. Directories are
            //    verified in O(1) by NTFS object id without re-walking tens of
            //    thousands of child files right before deleting them; files
            //    still perform an O(1) stat + identity + nanosecond mtime check.
            let measured_size = if target.kind == crate::catalog::TargetKind::Directory {
                None
            } else {
                let s = measure_path(&target.path, target.kind, token);
                if s.is_none() && token.is_cancelled() {
                    stopped_early = true;
                    break 'run;
                }
                s
            };
            let measured_logical = measured_size.as_ref().map(|s| s.logical_bytes);
            let current_snapshot = TargetSnapshot::capture(&target.path);
            match verify_snapshot(
                target.kind,
                &item.snapshot,
                &current_snapshot,
                measured_logical,
            ) {
                VerificationOutcome::Verified => {}
                VerificationOutcome::PlanChanged => {
                    break 'item (
                        block(
                            item,
                            "PLAN_CHANGED",
                            "Target changed after preview. Rescan required.".into(),
                        ),
                        0u64,
                        0u64,
                    );
                }
                VerificationOutcome::ContentChanged => {
                    break 'item (
                        block(
                            item,
                            "CONTENT_CHANGED",
                            "Target content changed after preview. Rescan required.".into(),
                        ),
                        0u64,
                        0u64,
                    );
                }
                VerificationOutcome::NotMeasured => {
                    break 'item (
                        block(
                            item,
                            "NOT_MEASURED",
                            "Target could not be measured; blocked for safety.".into(),
                        ),
                        0u64,
                        0u64,
                    );
                }
            }

            // 2. Path guard (root escape, reparse points, protected paths, …).
            let guard_ctx = GuardContext {
                scan_roots: &session.allowed_roots,
                protected_paths: &policy.protected_paths,
            };
            if let Err(err) = validate_target(&target.path, &guard_ctx) {
                break 'item (block(item, "PATH_GUARD", err.to_string()), 0u64, 0u64);
            }

            // 3. Evidence must still be present (catalog rules) or the agent
            //    policy must still allow this provider target.
            if let Some(rule) = rule {
                if let Err(err) = revalidate_evidence(rule, &target.path, &target.evidence) {
                    break 'item (block(item, "EVIDENCE", err.to_string()), 0u64, 0u64);
                }

                // 4. Git tracked content is never removed by a generic rule.
                if rule.git_policy == crate::catalog::GitPolicy::DenyTracked {
                    if let Err(reason) = git_guard::ensure_not_tracked(&target.path) {
                        break 'item (block(item, "GIT_GUARD", reason), 0u64, 0u64);
                    }
                }
            }

            // 5. Active use blocks deletion.
            let active = activity_probe(&target.provider, &target.path);
            if active.blocks_deletion() {
                break 'item (
                    block(
                        item,
                        "IN_USE",
                        "Target is in use or active status could not be verified.".into(),
                    ),
                    0u64,
                    0u64,
                );
            }

            // 6. Bytes reported after execution come from the fresh file
            //    measurement (or the validated session measurement for dirs).
            let measured = measured_size
                .as_ref()
                .map(|s| s.allocated_bytes.unwrap_or(s.logical_bytes))
                .unwrap_or_else(|| {
                    target
                        .allocated_bytes
                        .or(target.logical_bytes)
                        .unwrap_or(item.estimated_reclaim_bytes)
                });
            if policy.min_size_bytes > 0 && measured < policy.min_size_bytes {
                break 'item (
                    block(
                        item,
                        "BELOW_MIN_SIZE",
                        "Target is smaller than minimum item size in settings.".into(),
                    ),
                    0u64,
                    0u64,
                );
            }

            // 7. Execute with the requested method only (full target or
            //    intra-target age-based incremental slices).
            if let Some(days) = plan.incremental_older_than_days.filter(|&d| d > 0) {
                let inc = super::incremental::collect_incremental_slices(
                    &target.path,
                    &item.rule_id,
                    days,
                );
                if inc.stale_slices.is_empty() {
                    break 'item (
                        block(
                            item,
                            "NO_STALE_SLICES",
                            format!("No incremental build artifacts older than {days} day(s)."),
                        ),
                        0u64,
                        0u64,
                    );
                }

                let mut pruned_bytes = 0u64;
                for slice in &inc.stale_slices {
                    if let Err(err) = validate_target(&slice.path, &guard_ctx) {
                        break 'item (block(item, "PATH_GUARD", err.to_string()), 0u64, 0u64);
                    }
                    let slice_outcome = match plan.mode {
                        DeleteMode::RecycleBin => match recycle_session.as_mut() {
                            Some(session) => session.recycle(&slice.path, &guard_ctx),
                            None => RecycleBinService::new().recycle(&slice.path, &guard_ctx),
                        },
                        DeleteMode::Permanent => permanent.delete(&slice.path, &guard_ctx),
                    };
                    match slice_outcome {
                        Ok(_) => {
                            if slice.path.exists() {
                                break 'item (
                                    block(
                                        item,
                                        "VERIFY_FAILED",
                                        "Incremental artifact slice still exists after cleanup."
                                            .into(),
                                    ),
                                    0u64,
                                    0u64,
                                );
                            }
                            pruned_bytes = pruned_bytes.saturating_add(slice.logical_bytes);
                        }
                        Err(err) => {
                            let code = error_code(&err);
                            break 'item (block(item, code, err.to_string()), 0u64, 0u64);
                        }
                    }
                }

                let reclaim = if plan.mode == DeleteMode::Permanent {
                    pruned_bytes
                } else {
                    0
                };
                break 'item (
                    CleanupResultItem {
                        target_id: item.target_id.clone(),
                        display_path: item.display_path.clone(),
                        rule_id: item.rule_id.clone(),
                        success: true,
                        verified: target.path.exists(),
                        error_code: None,
                        error: None,
                        measured_bytes: pruned_bytes,
                        reclaim_bytes: reclaim,
                    },
                    pruned_bytes,
                    reclaim,
                );
            }

            let outcome = match plan.mode {
                DeleteMode::RecycleBin => match recycle_session.as_mut() {
                    Some(session) => session.recycle(&target.path, &guard_ctx),
                    None => RecycleBinService::new().recycle(&target.path, &guard_ctx),
                },
                DeleteMode::Permanent => permanent.delete(&target.path, &guard_ctx),
            };

            match outcome {
                Ok(_) => {
                    let verified = !target.path.exists();
                    if !verified {
                        break 'item (
                            block(
                                item,
                                "VERIFY_FAILED",
                                "Target still exists after cleanup operation.".into(),
                            ),
                            0u64,
                            0u64,
                        );
                    }
                    let reclaim = if plan.mode == DeleteMode::Permanent {
                        measured
                    } else {
                        0
                    };
                    (
                        CleanupResultItem {
                            target_id: item.target_id.clone(),
                            display_path: item.display_path.clone(),
                            rule_id: item.rule_id.clone(),
                            success: true,
                            verified: true,
                            error_code: None,
                            error: None,
                            measured_bytes: measured,
                            reclaim_bytes: reclaim,
                        },
                        measured,
                        reclaim,
                    )
                }
                Err(err) => {
                    let code = error_code(&err);
                    break 'item (block(item, code, err.to_string()), 0u64, 0u64);
                }
            }
        };

        observer(CleanupEvent::ItemFinished {
            index,
            total,
            success: result.success,
            error_code: result.error_code.clone(),
        });

        if result.success {
            success_count += 1;
            moved_bytes = moved_bytes.saturating_add(moved);
            reclaim_bytes = reclaim_bytes.saturating_add(reclaimed);
        } else {
            error_count += 1;
        }
        results.push(result);
    }

    // Kept as `usize` until the report is built: the old code widened to u64 and
    // narrowed straight back, which is the only lossy-looking cast in the path
    // and cannot truncate here anyway (`results.len() <= total`).
    let processed_count = results.len();
    let skipped_count = total.saturating_sub(processed_count);
    let cancelled = stopped_early && skipped_count > 0;
    if cancelled {
        observer(CleanupEvent::Cancelled {
            processed: processed_count,
            skipped: skipped_count,
        });
    }

    let after_free = sample_volume_free(&session.allowed_roots);
    let (volume_free_before, volume_free_after, delta) =
        signed_volume_delta_across(&before_free, &after_free);

    Ok(CleanupReport {
        plan_id: plan.id.clone(),
        mode: plan.mode,
        success_count,
        error_count,
        estimated_bytes: estimated,
        moved_bytes,
        reclaim_bytes,
        volume_free_before,
        volume_free_after,
        volume_free_delta: delta,
        duration_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        results,
        started_at,
        finished_at: chrono::Local::now().to_rfc3339(),
        cancelled,
        processed_count: processed_count as u64,
        skipped_count: skipped_count as u64,
        // The channel is owned by the command layer, which stamps the count.
        dropped_events: 0,
        audit_error: None,
    })
}

/// Maps a deletion failure to the stable error code the UI localizes.
fn error_code(err: &AppError) -> &'static str {
    match err {
        AppError::RecycleBinTooSmall(_) => "RECYCLE_BIN_TOO_SMALL",
        AppError::RecycleBinDisabled(_) => "RECYCLE_BIN_DISABLED",
        AppError::RecycleBinNotFound(_) => "RECYCLE_BIN_NOT_FOUND",
        AppError::RecycleBinPathTooLong(_) => "RECYCLE_BIN_PATH_TOO_LONG",
        AppError::RecycleBinSharingViolation(_) => "RECYCLE_BIN_SHARING_VIOLATION",
        AppError::RecycleBinAccessDenied(_) => "RECYCLE_BIN_ACCESS_DENIED",
        AppError::RecycleBinAborted(_) => "RECYCLE_BIN_ABORTED",
        AppError::RecycleBinComFailed(_) => "RECYCLE_BIN_COM_FAILED",
        AppError::RecycleBinFailed(_) => "RECYCLE_FAILED",
        AppError::PermanentDeleteFailed(_) => "PERMANENT_FAILED",
        AppError::UnsafeDeleteTarget(_) => "PATH_GUARD",
        AppError::AccessDenied(_) => "ACCESS_DENIED",
        _ => "DELETE_FAILED",
    }
}

/// Agent storage targets are constructed from fixed provider specs rather than
/// the project catalog. Validate that they still belong to a known provider
/// policy and are not protected or active.
fn validate_agent_target(target: &crate::scanner::models::StoredTarget) -> Result<(), String> {
    let prefix = match target.provider.as_str() {
        "codex" => "codex.",
        "claude-code" => "claude.",
        "claude-desktop" => "claude_desktop.",
        "antigravity" => "antigravity.",
        "opencode" => "opencode.",
        "t3code" => "t3code.",
        "bionic" => "bionic.",
        "cursor" => "cursor.",
        "windsurf" => "windsurf.",
        "copilot" => "copilot.",
        "cline" => "cline.",
        "roo-code" => "roo_code.",
        "aider" => "aider.",
        "continue" => "continue.",
        "zed" => "zed.",
        "ollama" => "ollama.",
        "lm-studio" => "lm_studio.",
        _ => return Err("Unknown provider target.".to_string()),
    };
    if !target.rule_id.starts_with(prefix) {
        return Err("Provider rule ID mismatch.".to_string());
    }
    if target.protected || target.safety_class == crate::catalog::SafetyClass::Keep {
        return Err("Protected agent data cannot be deleted.".to_string());
    }
    if target.cleanup_method == crate::catalog::CleanupMethod::None {
        return Err("No cleanup method defined for this agent target.".to_string());
    }
    if target.active_use.blocks_deletion() {
        return Err("Agent is in use; deletion rejected.".to_string());
    }
    Ok(())
}

pub fn path_display(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

/// Free-space change between two samples. Signed on purpose: a decrease in
/// free space must surface as a negative value instead of being flattened to
/// zero.
pub fn signed_volume_delta(before: Option<u64>, after: Option<u64>) -> Option<i64> {
    match (before, after) {
        (Some(b), Some(a)) => Some(a as i64 - b as i64),
        _ => None,
    }
}

/// Stable key for the volume that contains `path` (`C:\` on Windows, `/` on
/// Unix-like systems). Two roots on the same volume must be sampled once.
fn volume_key(path: &Path) -> String {
    let root = path.ancestors().last().unwrap_or(path);
    crate::safety::path_guard::normalize_key(root)
}

/// Samples free space for every unique local volume behind the scan roots. A
/// full-disk cleanup can delete from several drives; reporting the delta of
/// only the first one showed the wrong number to the user.
fn sample_volume_free(
    roots: &[std::path::PathBuf],
) -> std::collections::HashMap<String, Option<u64>> {
    let mut samples = std::collections::HashMap::new();
    for root in roots {
        let key = volume_key(root);
        samples
            .entry(key)
            .or_insert_with(|| volume_free_bytes(root));
    }
    samples
}

/// Aggregates before/after samples for every sampled volume. Returns `None`
/// for the aggregated values when any volume could not be sampled, so the UI
/// never presents a partial sum as the real change.
fn signed_volume_delta_across(
    before: &std::collections::HashMap<String, Option<u64>>,
    after: &std::collections::HashMap<String, Option<u64>>,
) -> (Option<u64>, Option<u64>, Option<i64>) {
    let mut before_total = 0u64;
    let mut after_total = 0u64;
    let mut any = false;
    for (key, before_free) in before {
        let Some(before_free) = before_free else {
            return (None, None, None);
        };
        let Some(after_free) = after.get(key).and_then(|value| *value) else {
            return (None, None, None);
        };
        before_total = before_total.saturating_add(*before_free);
        after_total = after_total.saturating_add(after_free);
        any = true;
    }
    if !any {
        return (None, None, None);
    }
    (
        Some(before_total),
        Some(after_total),
        Some(after_total as i64 - before_total as i64),
    )
}
