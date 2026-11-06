use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Instant;

use crate::catalog::CatalogIndex;
use crate::cleanup::permanent::PermanentDeleteService;
use crate::cleanup::plan::{CleanupPlan, TargetSnapshot};
use crate::cleanup::recycle_bin::RecycleBinService;
use crate::cleanup::DeleteMode;
use crate::error::AppError;
use crate::platform::volume_free_bytes;
use crate::scanner::measurement::measure_path;
use crate::scanner::session::ScanSession;
use crate::safety::{
    active_use_for_provider, git_guard, revalidate_evidence, validate_target, GuardContext,
};

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
    pub measured_bytes: u64,
    pub reclaim_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupReport {
    pub plan_id: String,
    pub mode: DeleteMode,
    pub success_count: u64,
    pub error_count: u64,
    pub estimated_bytes: u64,
    pub moved_bytes: u64,
    pub reclaim_bytes: u64,
    pub volume_free_before: Option<u64>,
    pub volume_free_after: Option<u64>,
    pub volume_free_delta: Option<i64>,
    pub duration_ms: u64,
    pub results: Vec<CleanupResultItem>,
    pub started_at: String,
    pub finished_at: String,
    /// Set when the cleanup finished but its history record could not be
    /// persisted. The cleanup itself is not rolled back.
    pub audit_error: Option<String>,
}

fn block(
    item: &crate::cleanup::plan::PlanItem,
    code: &str,
    reason: String,
) -> CleanupResultItem {
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
) -> Result<CleanupReport, AppError> {
    execute_plan_with_probe(
        plan,
        session,
        catalog,
        policy,
        confirmation_token,
        permanent_acknowledged,
        &active_use_for_provider,
    )
}

/// Executes a plan with an injectable activity probe.
///
/// Production callers use the real system probe through [`execute_plan`].
/// Tests inject a deterministic probe so a developer machine running an agent
/// cannot make safety tests flaky.
pub(crate) fn execute_plan_with_probe(
    plan: &CleanupPlan,
    session: &ScanSession,
    catalog: &CatalogIndex,
    policy: &crate::cleanup::CleanupPolicy,
    confirmation_token: &str,
    permanent_acknowledged: bool,
    activity_probe: &dyn Fn(&str, &Path) -> crate::safety::ActiveUse,
) -> Result<CleanupReport, AppError> {
    if plan.is_expired() {
        return Err(AppError::PlanExpired(
            "Temizlik planının süresi doldu; yeniden önizleme gerekli.".to_string(),
        ));
    }
    if confirmation_token != plan.confirmation_token {
        return Err(AppError::PlanInvalid(
            "Plan onay belirteci geçersiz.".to_string(),
        ));
    }
    if plan.mode == DeleteMode::Permanent && !permanent_acknowledged {
        return Err(AppError::Blocked(
            "Kalıcı silme için açık kullanıcı onayı gerekli.".to_string(),
        ));
    }

    let started = Instant::now();
    let started_at = chrono::Local::now().to_rfc3339();
    let recycle = RecycleBinService::new();
    let permanent = PermanentDeleteService::new();

    let before_free = volume_free_bytes(&session.root);

    let mut results = Vec::new();
    let mut success_count = 0u64;
    let mut error_count = 0u64;
    let mut moved_bytes = 0u64;
    let mut reclaim_bytes = 0u64;
    let mut estimated: u64 = 0;

    for item in plan.eligible_items() {
        estimated = estimated.saturating_add(item.estimated_reclaim_bytes);

        let Some(target) = session.targets.get(&item.target_id) else {
            results.push(block(item, "NOT_FOUND", "Hedef oturumda bulunamadı.".into()));
            error_count += 1;
            continue;
        };

        let rule = catalog.rule(&target.rule_id);
        if rule.is_none() {
            if target.provider == "project" {
                results.push(block(item, "RULE_MISSING", "Katalog kuralı bulunamadı.".into()));
                error_count += 1;
                continue;
            }
            if let Err(reason) = validate_agent_target(target) {
                results.push(block(item, "AGENT_POLICY", reason));
                error_count += 1;
                continue;
            }
        }

        if target.protected || rule.map(|r| r.is_protected()).unwrap_or(false) {
            results.push(block(item, "PROTECTED", "Korunan hedef silinemez.".into()));
            error_count += 1;
            continue;
        }

        if let Some((code, reason)) = policy.agent_policy_block(target) {
            results.push(block(item, code, reason));
            error_count += 1;
            continue;
        }

        // 1. Plan must still describe the same object: identity (file id) and
        //    measured size are re-checked before anything else happens.
        let measure_token = crate::scanner::cancellation::CancellationToken::new();
        let measured_size = measure_path(&target.path, target.kind, &measure_token);
        let measured_logical = measured_size
            .as_ref()
            .map(|s| s.logical_bytes)
            .unwrap_or(0);
        let current_snapshot = TargetSnapshot::capture(&target.path);
        if !item.snapshot.identity_matches(&current_snapshot)
            || measured_logical != item.logical_bytes
        {
            results.push(block(
                item,
                "PLAN_CHANGED",
                "Hedef, önizlemeden sonra değişti. Yeniden tarayın.".into(),
            ));
            error_count += 1;
            continue;
        }

        // 2. Path guard (root escape, reparse points, protected paths, …).
        let guard_ctx = GuardContext {
            scan_roots: &session.allowed_roots,
            protected_paths: &policy.protected_paths,
        };
        if let Err(err) = validate_target(&target.path, &guard_ctx) {
            results.push(block(item, "PATH_GUARD", err.to_string()));
            error_count += 1;
            continue;
        }

        // 3. Evidence must still be present (catalog rules) or the agent
        //    policy must still allow this provider target.
        if let Some(rule) = rule {
            if let Err(err) = revalidate_evidence(rule, &target.path, &target.evidence) {
                results.push(block(item, "EVIDENCE", err.to_string()));
                error_count += 1;
                continue;
            }

            // 4. Git tracked content is never removed by a generic rule.
            if rule.git_policy == crate::catalog::GitPolicy::DenyTracked {
                if let Err(reason) = git_guard::ensure_not_tracked(&target.path) {
                    results.push(block(item, "GIT_GUARD", reason));
                    error_count += 1;
                    continue;
                }
            }
        }

        // 5. Active use blocks deletion.
        let active = activity_probe(&target.provider, &target.path);
        if active.blocks_deletion() {
            results.push(block(
                item,
                "IN_USE",
                "Hedef kullanımda veya kullanım durumu doğrulanamadı.".into(),
            ));
            error_count += 1;
            continue;
        }

        // 6. Bytes reported after execution come from the fresh measurement.
        let measured = measured_size
            .as_ref()
            .map(|s| s.allocated_bytes.unwrap_or(s.logical_bytes))
            .unwrap_or(0);
        if policy.min_size_bytes > 0 && measured < policy.min_size_bytes {
            results.push(block(
                item,
                "BELOW_MIN_SIZE",
                "Hedef, ayarlardaki minimum öğe boyutundan küçük.".into(),
            ));
            error_count += 1;
            continue;
        }

        // 7. Execute with the requested method only.
        let outcome = match plan.mode {
            DeleteMode::RecycleBin => recycle.recycle(&target.path, &guard_ctx),
            DeleteMode::Permanent => permanent.delete(&target.path, &guard_ctx),
        };

        match outcome {
            Ok(_) => {
                let verified = !target.path.exists();
                if !verified {
                    results.push(block(
                        item,
                        "VERIFY_FAILED",
                        "İşlem sonrası hedef hâlâ mevcut.".into(),
                    ));
                    error_count += 1;
                    continue;
                }
                success_count += 1;
                moved_bytes = moved_bytes.saturating_add(measured);
                if plan.mode == DeleteMode::Permanent {
                    reclaim_bytes = reclaim_bytes.saturating_add(measured);
                }
                results.push(CleanupResultItem {
                    target_id: item.target_id.clone(),
                    display_path: item.display_path.clone(),
                    rule_id: item.rule_id.clone(),
                    success: true,
                    verified: true,
                    error_code: None,
                    error: None,
                    measured_bytes: measured,
                    reclaim_bytes: if plan.mode == DeleteMode::Permanent { measured } else { 0 },
                });
            }
            Err(err) => {
                let code = match &err {
                    AppError::RecycleBinFailed(_) => "RECYCLE_FAILED",
                    AppError::PermanentDeleteFailed(_) => "PERMANENT_FAILED",
                    AppError::UnsafeDeleteTarget(_) => "PATH_GUARD",
                    AppError::AccessDenied(_) => "ACCESS_DENIED",
                    _ => "DELETE_FAILED",
                };
                results.push(block(item, code, err.to_string()));
                error_count += 1;
            }
        }
    }

    let after_free = volume_free_bytes(&session.root);
    let delta = signed_volume_delta(before_free, after_free);

    Ok(CleanupReport {
        plan_id: plan.id.clone(),
        mode: plan.mode,
        success_count,
        error_count,
        estimated_bytes: estimated,
        moved_bytes,
        reclaim_bytes,
        volume_free_before: before_free,
        volume_free_after: after_free,
        volume_free_delta: delta,
        duration_ms: started.elapsed().as_millis() as u64,
        results,
        started_at,
        finished_at: chrono::Local::now().to_rfc3339(),
        audit_error: None,
    })
}


/// Agent storage targets are constructed from fixed provider specs rather than
/// the project catalog. Validate that they still belong to a known provider
/// policy and are not protected or active.
fn validate_agent_target(target: &crate::scanner::models::StoredTarget) -> Result<(), String> {
    let prefix = match target.provider.as_str() {
        "codex" => "codex.",
        "claude-code" => "claude.",
        "antigravity" => "antigravity.",
        "opencode" => "opencode.",
        "t3code" => "t3code.",
        "bionic" => "bionic.",
        "cursor" => "cursor.",
        "windsurf" => "windsurf.",
        "ollama" => "ollama.",
        _ => return Err("Bilinmeyen sağlayıcı hedefi.".to_string()),
    };
    if !target.rule_id.starts_with(prefix) {
        return Err("Sağlayıcı kural kimliği uyuşmuyor.".to_string());
    }
    if target.protected || target.safety_class == crate::catalog::SafetyClass::Keep {
        return Err("Korumalı ajan verisi silinemez.".to_string());
    }
    if target.cleanup_method == crate::catalog::CleanupMethod::None {
        return Err("Bu ajan hedefi için temizleme yöntemi yok.".to_string());
    }
    if target.active_use.blocks_deletion() {
        return Err("Ajan kullanımda; silme reddedildi.".to_string());
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
