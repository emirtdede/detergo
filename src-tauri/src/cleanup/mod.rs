pub mod coordinator;
pub mod official_actions;
pub mod permanent;
pub mod plan;
pub mod recycle_bin;

#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};

pub use coordinator::{execute_plan, CleanupReport, CleanupResultItem};
pub use plan::{build_plan, CleanupPlan, PlanItem, TargetSnapshot};
pub use recycle_bin::RecycleBinService;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeleteMode {
    RecycleBin,
    Permanent,
}

/// Backend-owned deletion policy. Settings are loaded in Rust; the frontend
/// cannot bypass these checks by sending a different scan request.
#[derive(Debug, Clone)]
pub struct CleanupPolicy {
    pub protected_paths: Vec<String>,
    pub allow_agent_cache_cleanup: bool,
    pub protect_browser_recordings: bool,
    pub min_size_bytes: u64,
    /// When false, no cleanup history or storage snapshots are persisted.
    pub record_history: bool,
}

impl Default for CleanupPolicy {
    fn default() -> Self {
        Self {
            protected_paths: Vec::new(),
            allow_agent_cache_cleanup: true,
            protect_browser_recordings: true,
            min_size_bytes: 0,
            record_history: true,
        }
    }
}

impl From<&crate::settings::AppSettings> for CleanupPolicy {
    fn from(settings: &crate::settings::AppSettings) -> Self {
        Self {
            protected_paths: settings.protected_paths.clone(),
            allow_agent_cache_cleanup: settings.agent_policy.allow_cache_cleanup,
            protect_browser_recordings: settings.agent_policy.protect_browser_recordings,
            min_size_bytes: settings.min_size_bytes,
            record_history: settings.history_enabled,
        }
    }
}

impl CleanupPolicy {
    /// Returns a block reason when the user's agent policy forbids this target.
    pub fn agent_policy_block(
        &self,
        target: &crate::scanner::models::StoredTarget,
    ) -> Option<(&'static str, String)> {
        if target.provider == "project" {
            return None;
        }
        if target.category == "cache" && !self.allow_agent_cache_cleanup {
            return Some((
                "AGENT_CACHE_DISABLED",
                "Ayarlarda AI önbellek temizliği kapalı.".to_string(),
            ));
        }
        if target.rule_id == "antigravity.browser_recordings"
            && self.protect_browser_recordings
            && crate::providers::root_locator::recently_modified(&target.path, 120)
        {
            return Some((
                "RECORDING_ACTIVE",
                "Tarayıcı kaydı hâlâ etkin; kayıt durduktan sonra yeniden deneyin."
                    .to_string(),
            ));
        }
        None
    }
}
