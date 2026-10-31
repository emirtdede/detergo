use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::error::AppError;
use crate::scanner::models::{CleanupItem, ScanScope, ScanSummary, StoredTarget};

pub const SESSION_TTL: Duration = Duration::from_secs(30 * 60);

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
}

#[derive(Default)]
pub struct ScanRegistry {
    sessions: Mutex<HashMap<String, Arc<Mutex<ScanSession>>>>,
    plans: Mutex<HashMap<String, crate::cleanup::plan::CleanupPlan>>,
}

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
        let mut sessions = self.sessions.lock().unwrap();
        sessions.retain(|_, s| !s.lock().map(|s| s.is_expired()).unwrap_or(true));
        sessions.insert(id, handle.clone());
        handle
    }

    pub fn get_session(&self, id: &str) -> Result<Arc<Mutex<ScanSession>>, AppError> {
        let sessions = self.sessions.lock().unwrap();
        let handle = sessions
            .get(id)
            .ok_or_else(|| AppError::SessionInvalid("Tarama oturumu bulunamadı.".to_string()))?;
        if handle.lock().map(|s| s.is_expired()).unwrap_or(true) {
            return Err(AppError::SessionExpired(
                "Tarama oturumunun süresi doldu; yeniden tarama gerekli.".to_string(),
            ));
        }
        Ok(handle.clone())
    }

    pub fn latest_session(&self) -> Option<Arc<Mutex<ScanSession>>> {
        let sessions = self.sessions.lock().unwrap();
        sessions
            .values()
            .filter(|s| s.lock().map(|s| !s.is_expired()).unwrap_or(false))
            .max_by_key(|s| s.lock().map(|s| s.created).unwrap_or_else(|_| Instant::now()))
            .cloned()
    }

    pub fn store_items(&self, session_id: &str, items: Vec<CleanupItem>, targets: Vec<StoredTarget>) {
        let Ok(handle) = self.get_session(session_id) else {
            return;
        };
        let mut session = handle.lock().unwrap();
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
        let mut plans = self.plans.lock().unwrap();
        plans.retain(|_, p| !p.is_expired());
        plans.insert(plan.id.clone(), plan);
    }

    /// Removes and returns a plan. A plan may be executed at most once: the
    /// removal and the expiry check happen under the same lock, so two
    /// concurrent execute calls cannot both receive the same plan.
    pub fn consume_plan(&self, id: &str) -> Result<crate::cleanup::plan::CleanupPlan, AppError> {
        let mut plans = self.plans.lock().unwrap();
        let plan = plans
            .remove(id)
            .ok_or_else(|| AppError::PlanInvalid("Temizlik planı bulunamadı.".to_string()))?;
        if plan.is_expired() {
            return Err(AppError::PlanExpired(
                "Temizlik planının süresi doldu; yeniden önizleme gerekli.".to_string(),
            ));
        }
        Ok(plan)
    }
}
