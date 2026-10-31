use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::catalog::model::{CleanupMethod, SafetyClass};
use crate::catalog::CatalogIndex;
use crate::cleanup::DeleteMode;
use crate::error::AppError;
use crate::platform::identity;
use crate::scanner::session::ScanSession;
use crate::safety::ActiveUse;

pub const PLAN_TTL_SECS: u64 = 15 * 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetSnapshot {
    pub exists: bool,
    pub logical_bytes: u64,
    pub modified_secs: Option<u64>,
    pub file_id: Option<String>,
}

impl TargetSnapshot {
    pub fn capture(path: &Path) -> Self {
        let meta = std::fs::metadata(path).ok();
        Self {
            exists: path.exists(),
            logical_bytes: meta.as_ref().map(|m| m.len()).unwrap_or(0),
            modified_secs: meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs()),
            file_id: identity(path).map(|id| format!("{}:{}", id.volume_serial, id.file_index)),
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
    pub logical_bytes: u64,
    pub estimated_reclaim_bytes: u64,
    pub active_use: ActiveUse,
    pub eligible: bool,
    pub blocked_code: Option<String>,
    pub blocked_reason: Option<String>,
    pub regenerate_hint: Option<String>,
    pub snapshot: TargetSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPlan {
    pub id: String,
    pub session_id: String,
    pub mode: DeleteMode,
    pub created_ms: u64,
    pub expires_ms: u64,
    pub items: Vec<PlanItem>,
    pub total_logical_bytes: u64,
    pub total_estimated_bytes: u64,
    pub eligible_count: u64,
    pub blocked_count: u64,
    pub confirmation_token: String,
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

/// Builds a plan from backend-owned target IDs. Paths are never accepted from
/// the frontend, and parent/child overlaps are resolved before totals are
/// computed.
pub fn build_plan(
    session: &ScanSession,
    target_ids: &[String],
    mode: DeleteMode,
    _catalog: &CatalogIndex,
    policy: &crate::cleanup::CleanupPolicy,
) -> Result<CleanupPlan, AppError> {
    if target_ids.is_empty() {
        return Err(AppError::PlanInvalid(
            "Temizlik için en az bir hedef seçilmelidir.".to_string(),
        ));
    }

    let mut seen = std::collections::HashSet::new();
    let mut ordered: Vec<&crate::scanner::models::StoredTarget> = Vec::new();
    for id in target_ids {
        if !seen.insert(id.clone()) {
            continue;
        }
        let target = session
            .targets
            .get(id)
            .ok_or_else(|| AppError::PlanInvalid(format!("Bilinmeyen hedef: {}", id)))?;
        ordered.push(target);
    }

    ordered.sort_by_key(|t| t.path.components().count());

    let mut kept: Vec<&crate::scanner::models::StoredTarget> = Vec::new();
    let mut covered: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    for target in &ordered {
        let parent = kept
            .iter()
            .find(|k| k.path != target.path && target.path.starts_with(&k.path));
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

        let mut eligible = true;
        let mut blocked_code: Option<String> = None;
        let mut blocked_reason: Option<String> = None;

        if let Some(parent_id) = covered.get(&target.id) {
            eligible = false;
            blocked_code = Some("COVERED_BY_PARENT".to_string());
            blocked_reason = Some(format!("Üst hedef zaten seçildi ({})", parent_id));
        } else if target.protected || target.safety_class == SafetyClass::Keep {
            eligible = false;
            blocked_code = Some("PROTECTED".to_string());
            blocked_reason = Some("Korunan veri; arabirimden silinemez.".to_string());
        } else if target.active_use.blocks_deletion() {
            eligible = false;
            blocked_code = Some("ACTIVE_USE".to_string());
            blocked_reason =
                Some("Hedef şu anda kullanımda veya kullanım durumu bilinmiyor.".to_string());
        } else if let Some((code, reason)) = policy.agent_policy_block(target) {
            eligible = false;
            blocked_code = Some(code.to_string());
            blocked_reason = Some(reason);
        } else if target.logical_bytes.is_none() {
            eligible = false;
            blocked_code = Some("NOT_MEASURED".to_string());
            blocked_reason = Some("Boyut ölçülmedi; yeniden tarama gerekli.".to_string());
        } else if policy.min_size_bytes > 0
            && target
                .allocated_bytes
                .unwrap_or_else(|| target.logical_bytes.unwrap_or(0))
                < policy.min_size_bytes
        {
            eligible = false;
            blocked_code = Some("BELOW_MIN_SIZE".to_string());
            blocked_reason = Some("Hedef, ayarlardaki minimum öğe boyutundan küçük.".to_string());
        } else {
            match target.cleanup_method {
                CleanupMethod::None => {
                    eligible = false;
                    blocked_code = Some("NO_METHOD".to_string());
                    blocked_reason =
                        Some("Bu hedef için temizleme yöntemi tanımlı değil.".to_string());
                }
                CleanupMethod::OfficialTool => {
                    eligible = false;
                    blocked_code = Some("OFFICIAL_ACTION_REQUIRED".to_string());
                    blocked_reason =
                        Some("Bu hedef yalnızca resmî araç komutuyla temizlenebilir.".to_string());
                }
                CleanupMethod::Permanent if mode == DeleteMode::RecycleBin => {
                    eligible = false;
                    blocked_code = Some("MODE_NOT_ALLOWED".to_string());
                    blocked_reason = Some(
                        "Bu hedef yalnızca açık kalıcı silme onayıyla temizlenebilir.".to_string(),
                    );
                }
                _ => {}
            }
        }

        let logical = target.logical_bytes.unwrap_or(0);
        let estimated = target.allocated_bytes.unwrap_or(logical);

        if eligible {
            eligible_count += 1;
            total_logical = total_logical.saturating_add(logical);
            total_estimated = total_estimated.saturating_add(estimated);
        } else {
            blocked_count += 1;
        }

        items.push(PlanItem {
            target_id: target.id.clone(),
            display_path,
            display_name,
            rule_id: target.rule_id.clone(),
            provider: target.provider.clone(),
            project_name: target.project_root.as_ref().and_then(|p| {
                Path::new(p)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
            }),
            safety_class: target.safety_class,
            cleanup_method: target.cleanup_method,
            logical_bytes: logical,
            estimated_reclaim_bytes: estimated,
            active_use: target.active_use,
            eligible,
            blocked_code,
            blocked_reason,
            regenerate_hint: None,
            snapshot: TargetSnapshot::capture(&target.path),
        });
    }

    if eligible_count == 0 {
        return Err(AppError::Blocked(
            "Seçilen hedeflerin hiçbiri güvenli biçimde silinemiyor.".to_string(),
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
    })
}
