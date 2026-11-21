use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::catalog::model::{CleanupMethod, SafetyClass, TargetKind};
use crate::catalog::CatalogIndex;
use crate::cleanup::DeleteMode;
use crate::error::AppError;
use crate::platform::identity;
use crate::safety::ActiveUse;
use crate::scanner::session::ScanSession;

pub const PLAN_TTL_SECS: u64 = 30 * 60;

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetSnapshot {
    pub exists: bool,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub logical_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<u64>>))]
    pub modified_secs: Option<u64>,
    pub file_id: Option<String>,
    /// Nanosecond modification time used only for in-memory verification.
    /// Kept out of the serialized plan so the wire format stays stable.
    #[serde(skip)]
    #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<u64>>))]
    pub modified_nanos: Option<u64>,
}

/// Result of re-checking a plan item against the live filesystem.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerificationOutcome {
    /// The object is still the same one the user previewed.
    Verified,
    /// A different object now occupies the path (or it disappeared).
    PlanChanged,
    /// Same object, but file content/size/mtime changed after preview.
    ContentChanged,
    /// The object could not be measured or identified; fail closed.
    NotMeasured,
}

fn modified_nanos(meta: &std::fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos().min(u64::MAX as u128) as u64)
}

impl TargetSnapshot {
    pub fn capture(path: &Path) -> Self {
        let meta = std::fs::symlink_metadata(path).ok();
        Self {
            exists: meta.is_some(),
            logical_bytes: meta.as_ref().map(|m| m.len()).unwrap_or(0),
            modified_secs: meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs()),
            file_id: identity(path).map(|id| format!("{}:{}", id.volume_serial, id.file_index)),
            modified_nanos: meta.as_ref().and_then(modified_nanos),
        }
    }

    /// Compares object identity (existence and Windows file id). Size is
    /// verified separately with a fresh measurement.
    ///
    /// Fails closed: if the file id could not be determined on either side the
    /// identity is treated as unverifiable, so the item is blocked instead of
    /// assuming it is the same object.
    pub fn identity_matches(&self, other: &TargetSnapshot) -> bool {
        if self.exists != other.exists {
            return false;
        }
        match (&self.file_id, &other.file_id) {
            (Some(a), Some(b)) => a == b,
            _ => false,
        }
    }
}

/// Verifies a previewed item against a freshly captured snapshot.
///
/// Directory identity is the only trustworthy signal: Windows reports a
/// directory's `metadata().len()` as zero, so comparing it with the measured
/// tree size produced false `PLAN_CHANGED` results for every folder. Files and
/// file groups additionally verify their logical size and nanosecond mtime.
///
/// `measured_logical` is the fresh recursive measurement (`None` when the walk
/// did not complete). Every unverifiable case fails closed as `NotMeasured`.
pub fn verify_snapshot(
    kind: TargetKind,
    expected: &TargetSnapshot,
    current: &TargetSnapshot,
    measured_logical: Option<u64>,
) -> VerificationOutcome {
    if expected.exists != current.exists {
        return VerificationOutcome::PlanChanged;
    }

    // Identity: an unknown id on either side is "cannot verify", not "same".
    match (&expected.file_id, &current.file_id) {
        (Some(a), Some(b)) if a == b => {}
        (Some(_), Some(_)) => return VerificationOutcome::PlanChanged,
        _ => return VerificationOutcome::NotMeasured,
    }

    if kind == TargetKind::Directory {
        // Directories are identified by object id only. Content growth is a
        // normal, expected change between preview and execution.
        return VerificationOutcome::Verified;
    }

    let Some(measured) = measured_logical else {
        return VerificationOutcome::NotMeasured;
    };
    let (Some(expected_nanos), Some(current_nanos)) =
        (expected.modified_nanos, current.modified_nanos)
    else {
        return VerificationOutcome::NotMeasured;
    };

    if measured != expected.logical_bytes
        || current.logical_bytes != expected.logical_bytes
        || current_nanos != expected_nanos
    {
        return VerificationOutcome::ContentChanged;
    }

    VerificationOutcome::Verified
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub target_id: String,
    pub display_path: String,
    pub display_name: String,
    pub rule_id: String,
    pub provider: String,
    pub project_name: Option<String>,
    pub safety_class: SafetyClass,
    pub cleanup_method: CleanupMethod,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub logical_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub estimated_reclaim_bytes: u64,
    pub active_use: ActiveUse,
    pub eligible: bool,
    pub blocked_code: Option<String>,
    pub blocked_reason: Option<String>,
    pub regenerate_hint: Option<String>,
    pub snapshot: TargetSnapshot,
    #[serde(default)]
    pub incremental_slice_count: Option<u32>,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPlan {
    pub id: String,
    pub session_id: String,
    pub mode: DeleteMode,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub created_ms: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub expires_ms: u64,
    pub items: Vec<PlanItem>,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub total_logical_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub total_estimated_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub eligible_count: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub blocked_count: u64,
    pub confirmation_token: String,
    #[serde(default)]
    pub incremental_older_than_days: Option<u32>,
}

impl CleanupPlan {
    pub fn is_expired(&self) -> bool {
        now_ms() >= self.expires_ms
    }

    pub fn eligible_items(&self) -> impl Iterator<Item = &PlanItem> {
        self.items.iter().filter(|i| i.eligible)
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Why a target cannot be deleted, independent of parent/child coverage.
///
/// Coverage is decided separately so that a blocked parent (protected, active,
/// too small, unmeasured) never hides an eligible child. The old single pass
/// added every selected parent to `kept` before checking its eligibility, so a
/// blocked parent marked its children `COVERED_BY_PARENT` even though it would
/// never be deleted.
fn eligibility_block(
    target: &crate::scanner::models::StoredTarget,
    mode: DeleteMode,
    policy: &crate::cleanup::CleanupPolicy,
) -> Option<(String, String)> {
    if target.protected || target.safety_class == SafetyClass::Keep {
        return Some((
            "PROTECTED".to_string(),
            "Protected data; cannot be deleted from interface.".to_string(),
        ));
    }
    if target.active_use.blocks_deletion() {
        return Some((
            "ACTIVE_USE".to_string(),
            "Target is currently in use or active status is unknown.".to_string(),
        ));
    }
    if let Some((code, reason)) = policy.agent_policy_block(target) {
        return Some((code.to_string(), reason));
    }
    if target.logical_bytes.is_none() {
        return Some((
            "NOT_MEASURED".to_string(),
            "Size not measured; rescan required.".to_string(),
        ));
    }
    if policy.min_size_bytes > 0
        && target
            .allocated_bytes
            .unwrap_or_else(|| target.logical_bytes.unwrap_or(0))
            < policy.min_size_bytes
    {
        return Some((
            "BELOW_MIN_SIZE".to_string(),
            "Target is smaller than minimum item size in settings.".to_string(),
        ));
    }
    match target.cleanup_method {
        CleanupMethod::None => Some((
            "NO_METHOD".to_string(),
            "No cleanup method defined for this target.".to_string(),
        )),
        CleanupMethod::OfficialTool => Some((
            "OFFICIAL_ACTION_REQUIRED".to_string(),
            "This target can only be cleaned via official tool command.".to_string(),
        )),
        CleanupMethod::Permanent if mode == DeleteMode::RecycleBin => Some((
            "MODE_NOT_ALLOWED".to_string(),
            "This target can only be cleaned with explicit permanent deletion confirmation."
                .to_string(),
        )),
        _ => None,
    }
}

/// Builds a plan from backend-owned target IDs. Paths are never accepted from
/// the frontend, and parent/child overlaps are resolved before totals are
/// computed.
pub fn build_plan(
    session: &ScanSession,
    target_ids: &[String],
    mode: DeleteMode,
    catalog: &CatalogIndex,
    policy: &crate::cleanup::CleanupPolicy,
) -> Result<CleanupPlan, AppError> {
    build_plan_with_options(session, target_ids, mode, catalog, policy, None)
}

pub fn build_plan_with_options(
    session: &ScanSession,
    target_ids: &[String],
    mode: DeleteMode,
    catalog: &CatalogIndex,
    policy: &crate::cleanup::CleanupPolicy,
    incremental_older_than_days: Option<u32>,
) -> Result<CleanupPlan, AppError> {
    if target_ids.is_empty() {
        return Err(AppError::PlanInvalid(
            "At least one target must be selected for cleanup.".to_string(),
        ));
    }

    let incremental_days = incremental_older_than_days.filter(|&d| d > 0);
    let session_items: std::collections::HashMap<&str, &crate::scanner::models::CleanupItem> =
        session
            .items
            .iter()
            .map(|item| (item.id.as_str(), item))
            .collect();

    let mut seen = std::collections::HashSet::new();
    let mut ordered: Vec<&crate::scanner::models::StoredTarget> = Vec::new();
    for id in target_ids {
        if !seen.insert(id.clone()) {
            continue;
        }
        let target = session
            .targets
            .get(id)
            .ok_or_else(|| AppError::PlanInvalid(format!("Unknown target: {}", id)))?;
        ordered.push(target);
    }

    ordered.sort_by_key(|t| t.path.components().count());

    // Only targets that will actually be deleted may cover their descendants.
    let mut kept: Vec<&crate::scanner::models::StoredTarget> = Vec::new();
    let mut covered: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    for target in &ordered {
        if eligibility_block(target, mode, policy).is_some() {
            continue;
        }
        let target_key = crate::safety::path_guard::normalize_key(&target.path);
        let parent = kept.iter().find(|k| {
            let k_key = crate::safety::path_guard::normalize_key(&k.path);
            k_key != target_key && crate::safety::path_guard::is_within(&target_key, &k_key)
        });
        if let Some(parent) = parent {
            covered.insert(target.id.clone(), parent.id.clone());
        } else {
            kept.push(*target);
        }
    }

    let mut items = Vec::new();
    let mut total_logical = 0u64;
    let mut total_estimated = 0u64;
    let mut eligible_count = 0u64;
    let mut blocked_count = 0u64;

    for target in &ordered {
        let display_path = target.path.to_string_lossy().to_string();
        let display_name = target
            .path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| display_path.clone());

        let (mut eligible, mut blocked_code, mut blocked_reason) =
            if let Some(parent_id) = covered.get(&target.id) {
                (
                    false,
                    Some("COVERED_BY_PARENT".to_string()),
                    Some(format!("Parent target already selected ({})", parent_id)),
                )
            } else {
                match eligibility_block(target, mode, policy) {
                    Some((code, reason)) => (false, Some(code), Some(reason)),
                    None => (true, None, None),
                }
            };

        let logical = target.logical_bytes.unwrap_or(0);
        let mut estimated = target.allocated_bytes.unwrap_or(logical);
        let mut incremental_slice_count = None;

        if let Some(days) = incremental_days {
            if eligible {
                let inc = super::incremental::collect_incremental_slices(
                    &target.path,
                    &target.rule_id,
                    days,
                );
                let count = u32::try_from(inc.stale_slices.len()).unwrap_or(u32::MAX);
                incremental_slice_count = Some(count);
                if inc.stale_slices.is_empty() {
                    eligible = false;
                    blocked_code = Some("NO_STALE_SLICES".to_string());
                    blocked_reason = Some(format!(
                        "No incremental build artifacts older than {days} day(s)."
                    ));
                    estimated = 0;
                } else {
                    estimated = inc.stale_bytes;
                }
            } else {
                incremental_slice_count = Some(0);
            }
        }

        if eligible {
            eligible_count += 1;
            total_logical = total_logical.saturating_add(if incremental_days.is_some() {
                estimated
            } else {
                logical
            });
            total_estimated = total_estimated.saturating_add(estimated);
        } else {
            blocked_count += 1;
        }

        let session_item = session_items.get(target.id.as_str()).copied();
        let project_name = session_item
            .and_then(|item| item.project_name.clone())
            .or_else(|| {
                target.project_root.as_ref().and_then(|p| {
                    Path::new(p)
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                })
            });
        let regenerate_hint = session_item
            .and_then(|item| item.regenerate_hint.clone())
            .or_else(|| {
                catalog
                    .rule(&target.rule_id)
                    .and_then(|r| r.regenerate.clone())
            });

        items.push(PlanItem {
            target_id: target.id.clone(),
            display_path,
            display_name,
            rule_id: target.rule_id.clone(),
            provider: target.provider.clone(),
            project_name,
            safety_class: target.safety_class,
            cleanup_method: target.cleanup_method,
            logical_bytes: logical,
            estimated_reclaim_bytes: estimated,
            active_use: target.active_use,
            eligible,
            blocked_code,
            blocked_reason,
            regenerate_hint,
            snapshot: TargetSnapshot::capture(&target.path),
            incremental_slice_count,
        });
    }

    if eligible_count == 0 {
        return Err(AppError::Blocked(
            "None of the selected targets can be safely deleted.".to_string(),
        ));
    }

    let created = now_ms();
    Ok(CleanupPlan {
        id: format!("plan-{}", uuid::Uuid::new_v4().simple()),
        session_id: session.id.clone(),
        mode,
        created_ms: created,
        expires_ms: created + PLAN_TTL_SECS * 1000,
        items,
        total_logical_bytes: total_logical,
        total_estimated_bytes: total_estimated,
        eligible_count,
        blocked_count,
        confirmation_token: uuid::Uuid::new_v4().simple().to_string(),
        incremental_older_than_days: incremental_days,
    })
}
