use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::error::AppError;
use crate::scanner::models::{CleanupItem, ItemStatus, ScanScope, ScanSummary, StoredTarget};

pub const SESSION_TTL: Duration = Duration::from_secs(30 * 60);

/// Cleanup plans kept in memory at once.
///
/// A preview stores a full `CleanupPlan` (one entry per selected row), and the
/// GUI replaces the plan it shows without telling the backend. Opening the
/// dialog repeatedly therefore accumulated one abandoned plan per attempt for
/// the whole 30 minute TTL. The newest plan is the only one the dialog can act
/// on, so the oldest untouched plan is evicted.
pub const MAX_PENDING_PLANS: usize = 8;

/// A stored plan plus whether an execution already picked it up.
///
/// `peek_plan` marks the plan as taken so capacity eviction never removes a plan
/// that is being validated by a running `execute_cleanup`; that plan is removed
/// by `consume_plan` (or expires) instead.
struct PendingPlan {
    plan: crate::cleanup::plan::CleanupPlan,
    taken: bool,
}

#[derive(Clone)]
pub struct ScanSession {
    pub id: String,
    pub scope: ScanScope,
    pub root: PathBuf,
    /// Every root that may legitimately contain a target for this session.
    pub allowed_roots: Vec<PathBuf>,
    pub created: Instant,
    pub items: Vec<CleanupItem>,
    pub targets: HashMap<String, StoredTarget>,
    pub summary: Option<ScanSummary>,
}

impl ScanSession {
    pub fn is_expired(&self) -> bool {
        self.created.elapsed() > SESSION_TTL
    }

    /// The cleanup window starts when the scan finishes, not when it started:
    /// a long scan must not consume the time the user needs to review results.
    pub fn refresh_deadline(&mut self) {
        self.created = Instant::now();
    }

    /// Marks successfully deleted targets and every target nested below them.
    ///
    /// A successful parent deletion removes its whole subtree from disk. The
    /// session used to drop only the selected parent, so descendants stayed
    /// selectable as ghost rows and a later preview accepted IDs whose paths no
    /// longer existed. Descendants are identified by path (authoritative) and
    /// by the item parent chain (covers rows whose path comparison is not
    /// enough on case-insensitive filesystems).
    pub fn apply_successful_deletions(&mut self, target_ids: &[String]) {
        use std::collections::HashSet;

        let mut removed: HashSet<String> = target_ids.iter().cloned().collect();
        let removed_paths: Vec<PathBuf> = target_ids
            .iter()
            .filter_map(|id| self.targets.get(id).map(|target| target.path.clone()))
            .collect();

        let descendants: Vec<String> = self
            .targets
            .iter()
            .filter(|(id, target)| {
                !removed.contains(*id)
                    && removed_paths
                        .iter()
                        .any(|root| target.path != *root && target.path.starts_with(root))
            })
            .map(|(id, _)| id.clone())
            .collect();
        removed.extend(descendants);

        // `parent_item_id` may point at an item whose target was removed, so
        // walk the chain until no new child is found (grandchildren included).
        loop {
            let newly: Vec<String> = self
                .items
                .iter()
                .filter(|item| {
                    !removed.contains(&item.id)
                        && item
                            .parent_item_id
                            .as_ref()
                            .is_some_and(|parent| removed.contains(parent))
                })
                .map(|item| item.id.clone())
                .collect();
            if newly.is_empty() {
                break;
            }
            removed.extend(newly);
        }

        for item in &mut self.items {
            if removed.contains(&item.id) {
                item.status = ItemStatus::Deleted;
            }
        }
        for id in &removed {
            self.targets.remove(id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{CleanupMethod, Confidence, SafetyClass, TargetKind};
    use crate::safety::{ActiveUse, EvidenceSnapshot};

    fn target(id: &str, path: &str) -> StoredTarget {
        StoredTarget {
            id: id.to_string(),
            path: PathBuf::from(path),
            rule_id: "test.rule".to_string(),
            provider: "project".to_string(),
            category: "build".to_string(),
            kind: TargetKind::Directory,
            safety_class: SafetyClass::Regenerate,
            cleanup_method: CleanupMethod::Trash,
            project_root: Some(r"C:\Projects\app".to_string()),
            evidence: EvidenceSnapshot {
                rule_id: "test.rule".to_string(),
                target_name: "target".to_string(),
                project_root: Some(r"C:\Projects\app".to_string()),
                workspace_root: None,
                marker_hits: Vec::new(),
                content_hits: Vec::new(),
            },
            logical_bytes: Some(10),
            allocated_bytes: Some(10),
            modified_at: None,
            active_use: ActiveUse::No,
            parent_id: None,
            protected: false,
        }
    }

    fn item(id: &str, parent: Option<&str>) -> CleanupItem {
        CleanupItem {
            id: id.to_string(),
            scan_session_id: "s-test".to_string(),
            rule_id: "test.rule".to_string(),
            provider: "project".to_string(),
            ecosystem: "javascript".to_string(),
            category: "build".to_string(),
            kind: TargetKind::Directory,
            project_id: None,
            project_name: Some("app".to_string()),
            project_root: Some(r"C:\Projects\app".to_string()),
            project_detected: true,
            display_name: id.to_string(),
            display_path: format!(r"C:\Projects\app\{}", id),
            logical_bytes: Some(10),
            allocated_bytes: Some(10),
            estimated_reclaim_bytes: Some(10),
            safety_class: SafetyClass::Regenerate,
            confidence: Confidence::High,
            active_use: ActiveUse::No,
            evidence_codes: Vec::new(),
            warning_codes: Vec::new(),
            cleanup_method: CleanupMethod::Trash,
            regenerate_hint: None,
            protected: false,
            selectable: true,
            auto_selectable: false,
            last_modified_at: None,
            last_modified_ms: None,
            status: ItemStatus::Discovered,
            parent_item_id: parent.map(|value| value.to_string()),
            note: None,
        }
    }

    #[test]
    fn parent_deletion_removes_descendant_targets_and_items() {
        let mut session = ScanSession {
            id: "s-test".to_string(),
            scope: ScanScope::Project,
            root: PathBuf::from(r"C:\Projects\app"),
            allowed_roots: vec![PathBuf::from(r"C:\Projects\app")],
            created: Instant::now(),
            items: vec![
                item("parent", None),
                item("child", Some("parent")),
                item("sibling", None),
            ],
            targets: HashMap::from([
                (
                    "parent".to_string(),
                    target("parent", r"C:\Projects\app\.next"),
                ),
                (
                    "child".to_string(),
                    target("child", r"C:\Projects\app\.next\cache"),
                ),
                (
                    "sibling".to_string(),
                    target("sibling", r"C:\Projects\app\node_modules"),
                ),
            ]),
            summary: None,
        };

        session.apply_successful_deletions(&["parent".to_string()]);

        assert!(!session.targets.contains_key("parent"));
        assert!(!session.targets.contains_key("child"));
        assert!(session.targets.contains_key("sibling"));
        assert_eq!(session.items[0].status, ItemStatus::Deleted);
        assert_eq!(session.items[1].status, ItemStatus::Deleted);
        assert_eq!(session.items[2].status, ItemStatus::Discovered);
    }

    /// Plan with a live TTL; `rank` only orders plans by age (lower = older).
    fn plan(id: &str, rank: u64) -> crate::cleanup::plan::CleanupPlan {
        let created_ms = crate::cleanup::plan::now_ms() - 10_000 + rank;
        crate::cleanup::plan::CleanupPlan {
            id: id.to_string(),
            session_id: "s-test".to_string(),
            mode: crate::cleanup::DeleteMode::RecycleBin,
            created_ms,
            expires_ms: created_ms + crate::cleanup::plan::PLAN_TTL_SECS * 1000,
            items: Vec::new(),
            total_logical_bytes: 0,
            total_estimated_bytes: 0,
            eligible_count: 0,
            blocked_count: 0,
            confirmation_token: "token".to_string(),
        }
    }

    #[test]
    fn pending_plans_stay_bounded_and_drop_the_oldest_untouched() {
        let registry = ScanRegistry::new();
        let total = MAX_PENDING_PLANS + 3;
        for index in 0..total {
            // Later indices are newer, so the first three are the oldest.
            registry.insert_plan(plan(&format!("p-{index}"), index as u64 + 1));
        }

        assert!(
            registry.peek_plan("p-0").is_err(),
            "the oldest abandoned plan must be evicted"
        );
        assert!(registry.peek_plan("p-1").is_err());
        assert!(registry.peek_plan("p-2").is_err());
        assert!(registry.peek_plan(&format!("p-{}", total - 1)).is_ok());
        let kept = crate::lock!(registry.plans).len();
        assert_eq!(kept, MAX_PENDING_PLANS);
    }

    #[test]
    fn a_plan_picked_up_for_execution_is_not_evicted_by_capacity() {
        let registry = ScanRegistry::new();
        registry.insert_plan(plan("in-flight", 1));
        // `execute_cleanup` peeks before it validates the session, catalog and
        // settings; the plan must survive previews that arrive in that window.
        assert!(registry.peek_plan("in-flight").is_ok());

        for index in 0..(MAX_PENDING_PLANS + 2) {
            registry.insert_plan(plan(&format!("p-{index}"), index as u64 + 10));
        }

        assert!(
            registry.consume_plan("in-flight").is_ok(),
            "an execution in progress must be able to consume its plan"
        );
        assert!(registry.consume_plan("in-flight").is_err());
    }
}

#[derive(Default)]
pub struct ScanRegistry {
    sessions: Mutex<HashMap<String, Arc<Mutex<ScanSession>>>>,
    plans: Mutex<HashMap<String, PendingPlan>>,
}

const MAX_RETAINED_SESSIONS: usize = 3;

impl ScanRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn create_session(
        &self,
        scope: ScanScope,
        root: PathBuf,
        allowed_roots: Vec<PathBuf>,
    ) -> Arc<Mutex<ScanSession>> {
        let id = format!("s-{}", uuid::Uuid::new_v4().simple());
        let session = ScanSession {
            id: id.clone(),
            scope,
            root,
            allowed_roots,
            created: Instant::now(),
            items: Vec::new(),
            targets: HashMap::new(),
            summary: None,
        };
        let handle = Arc::new(Mutex::new(session));
        let mut sessions = crate::lock!(self.sessions);
        sessions.retain(|_, s| !s.lock().map(|s| s.is_expired()).unwrap_or(true));
        while sessions.len() >= MAX_RETAINED_SESSIONS {
            let oldest = sessions
                .iter()
                .min_by_key(|(_, s)| {
                    s.lock()
                        .map(|guard| guard.created)
                        .unwrap_or_else(|_| Instant::now())
                })
                .map(|(key, _)| key.clone());
            match oldest {
                Some(key) => {
                    sessions.remove(&key);
                }
                None => break,
            }
        }
        sessions.insert(id, handle.clone());
        handle
    }

    pub fn get_session(&self, id: &str) -> Result<Arc<Mutex<ScanSession>>, AppError> {
        let sessions = crate::lock!(self.sessions);
        let handle = sessions
            .get(id)
            .ok_or_else(|| AppError::SessionInvalid("Scan session not found.".to_string()))?;
        if handle.lock().map(|s| s.is_expired()).unwrap_or(true) {
            return Err(AppError::SessionExpired(
                "Scan session expired; rescan required.".to_string(),
            ));
        }
        Ok(handle.clone())
    }

    pub fn latest_session(&self) -> Option<Arc<Mutex<ScanSession>>> {
        let sessions = crate::lock!(self.sessions);
        sessions
            .values()
            .filter(|s| s.lock().map(|s| !s.is_expired()).unwrap_or(false))
            .max_by_key(|s| {
                s.lock()
                    .map(|s| s.created)
                    .unwrap_or_else(|_| Instant::now())
            })
            .cloned()
    }

    pub fn store_items(
        &self,
        session_id: &str,
        items: Vec<CleanupItem>,
        targets: Vec<StoredTarget>,
    ) {
        let Ok(handle) = self.get_session(session_id) else {
            return;
        };
        let mut session = crate::lock!(handle);
        for target in targets {
            session.targets.insert(target.id.clone(), target);
        }
        session.items.extend(items);
    }

    pub fn set_summary(&self, session_id: &str, summary: ScanSummary) {
        if let Ok(handle) = self.get_session(session_id) {
            if let Ok(mut session) = handle.lock() {
                session.summary = Some(summary);
            }
        }
    }

    pub fn insert_plan(&self, plan: crate::cleanup::plan::CleanupPlan) {
        let mut plans = crate::lock!(self.plans);
        plans.retain(|_, pending| !pending.plan.is_expired());
        if plans.len() >= MAX_PENDING_PLANS {
            // Skip plans an execution already picked up: evicting one of those
            // would fail a cleanup that was just confirmed. They are removed by
            // `consume_plan` or by expiry, so the map still shrinks.
            let oldest = plans
                .iter()
                .filter(|(_, pending)| !pending.taken)
                .min_by_key(|(_, pending)| pending.plan.created_ms)
                .map(|(id, _)| id.clone());
            if let Some(id) = oldest {
                plans.remove(&id);
            }
        }
        plans.insert(plan.id.clone(), PendingPlan { plan, taken: false });
    }

    /// Returns a plan without removing it, after validating that it has not
    /// expired. Callers use this to validate the owning session first, so a
    /// stale session never burns the single-use plan.
    pub fn peek_plan(&self, id: &str) -> Result<crate::cleanup::plan::CleanupPlan, AppError> {
        let mut plans = crate::lock!(self.plans);
        let pending = plans
            .get_mut(id)
            .ok_or_else(|| AppError::PlanInvalid("Cleanup plan not found.".to_string()))?;
        if pending.plan.is_expired() {
            return Err(AppError::PlanExpired(
                "Cleanup plan expired; a new preview is required.".to_string(),
            ));
        }
        // Protect the plan from capacity eviction while the caller validates the
        // session/catalog/settings that the run depends on.
        pending.taken = true;
        Ok(pending.plan.clone())
    }

    /// Removes and returns a plan. A plan may be executed at most once: the
    /// expiry check and the removal happen under the same lock, so two
    /// concurrent execute calls cannot both receive the same plan. The plan is
    /// only removed when it is still valid, so an expiry error never destroys
    /// state the caller might still inspect.
    pub fn consume_plan(&self, id: &str) -> Result<crate::cleanup::plan::CleanupPlan, AppError> {
        let mut plans = crate::lock!(self.plans);
        let pending = plans
            .get(id)
            .ok_or_else(|| AppError::PlanInvalid("Cleanup plan not found.".to_string()))?;
        if pending.plan.is_expired() {
            plans.remove(id);
            return Err(AppError::PlanExpired(
                "Cleanup plan expired; a new preview is required.".to_string(),
            ));
        }
        plans
            .remove(id)
            .map(|pending| pending.plan)
            .ok_or_else(|| AppError::PlanInvalid("Cleanup plan not found.".to_string()))
    }
}
