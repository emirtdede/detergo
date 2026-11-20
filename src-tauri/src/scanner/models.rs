use serde::{Deserialize, Serialize};

use super::notices::ScanNoticeSeverity;
use crate::catalog::{CleanupMethod, Confidence, SafetyClass, TargetKind};
use crate::error::AppError;
use crate::safety::{ActiveUse, EvidenceSnapshot};

fn default_true() -> bool {
    true
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ScanScope {
    #[default]
    Project,
    Agents,
    GlobalCaches,
    /// Full-disk scan across every local volume.
    AllDrives,
    /// Projects (the selected root) **and** AI agent storage in one session.
    /// The top command bar uses this so a single action covers every scan the
    /// app can perform. Package cache measurement stays a separate step.
    Combined,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemStatus {
    Discovered,
    Measuring,
    Ready,
    Blocked,
    Error,
    Deleted,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupItem {
    pub id: String,
    pub scan_session_id: String,
    pub rule_id: String,
    pub provider: String,
    pub ecosystem: String,
    pub category: String,
    pub kind: TargetKind,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub project_root: Option<String>,
    /// True when `project_root` was confirmed by a project manifest
    /// (`package.json`, `Cargo.toml`, ...). Discovery falls back to the target's
    /// parent folder for rows outside any project; those fallback rows are
    /// still useful for cleanup but must never be counted as "projects".
    /// Defaults to `true` so snapshots written by older builds keep their
    /// previous meaning instead of reporting zero projects.
    #[serde(default = "default_true")]
    pub project_detected: bool,
    pub display_name: String,
    pub display_path: String,
    #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<u64>>))]
    pub logical_bytes: Option<u64>,
    #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<u64>>))]
    pub allocated_bytes: Option<u64>,
    #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<u64>>))]
    pub estimated_reclaim_bytes: Option<u64>,
    pub safety_class: SafetyClass,
    pub confidence: Confidence,
    pub active_use: ActiveUse,
    pub evidence_codes: Vec<String>,
    pub warning_codes: Vec<String>,
    pub cleanup_method: CleanupMethod,
    pub regenerate_hint: Option<String>,
    pub protected: bool,
    pub selectable: bool,
    /// Only proven, non-agent SAFE cache targets may be selected automatically.
    pub auto_selectable: bool,
    pub last_modified_at: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<i64>>))]
    pub last_modified_ms: Option<i64>,
    pub status: ItemStatus,
    pub parent_item_id: Option<String>,
    pub note: Option<String>,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasurementUpdate {
    pub id: String,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub logical_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<u64>>))]
    pub allocated_bytes: Option<u64>,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub estimated_reclaim_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub file_count: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub hardlink_dedup_bytes: u64,
    pub status: ItemStatus,
    #[serde(default)]
    pub selectable: Option<bool>,
    #[serde(default)]
    pub auto_selectable: Option<bool>,
    #[serde(default)]
    pub warning_codes: Option<Vec<String>>,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRequest {
    pub root_path: String,
    #[serde(default)]
    pub exclusions: Vec<String>,
    #[serde(default)]
    pub scope: ScanScope,
    /// When true alongside `AllDrives` (or `Project`), also runs the AI agent
    /// storage scan in the same session.
    #[serde(default)]
    pub include_agents: Option<bool>,
    #[serde(default)]
    pub profile: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<usize>>))]
    pub max_depth: Option<usize>,
    #[serde(default)]
    #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<u64>>))]
    pub max_candidates: Option<u64>,
    #[serde(default)]
    #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<u64>>))]
    pub timeout_minutes: Option<u64>,
    #[serde(default)]
    #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<u64>>))]
    pub min_size_bytes: Option<u64>,
    #[serde(default)]
    pub protected_paths: Vec<String>,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub phase: String,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub directories_visited: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub entries_found: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub entries_measured: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub bytes_measured: u64,
    pub current_path: Option<String>,
    pub stop_reason: Option<String>,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTotal {
    pub provider: String,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub logical_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub allocated_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub item_count: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub protected_bytes: u64,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub scan_id: String,
    pub root_path: String,
    pub scope: ScanScope,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub total_entries: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub total_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub total_allocated_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub protected_bytes: u64,
    /// Bytes the user can actually select and clean. This is the only number
    /// that may be presented as "reclaimable": non-selectable targets and
    /// protected data are excluded even though they count towards the totals.
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub cleanable_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub duration_ms: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub errors_count: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub warnings_count: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub directories_visited: u64,
    pub partial: bool,
    pub stop_reason: Option<String>,
    pub provider_totals: Vec<ProviderTotal>,
    /// Number of distinct project roots confirmed by a manifest in this scan.
    /// `None` for snapshots written by builds that predate the field, so the UI
    /// can say "rescan to refresh" instead of presenting a stale number.
    #[serde(default)]
    #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<u64>>))]
    pub detected_project_count: Option<u64>,
    /// Per-step outcome of a combined scan. Empty for single-scope scans and
    /// for old snapshots.
    #[serde(default)]
    pub sections: Vec<ScanSectionResult>,
    /// Progress events the backend could not deliver because the frontend
    /// channel was gone. The scan is never aborted for this reason, but the UI
    /// must be able to say that its progress display may be incomplete.
    #[serde(default)]
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub dropped_events: u64,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSectionResult {
    pub scope: ScanScope,
    /// `completed`, `partial`, `failed` or `skipped`.
    pub status: String,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub item_count: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub cleanable_bytes: u64,
    /// Machine code (`ACCESS_DENIED`, `NO_ROOT`, ...) when the step failed.
    #[serde(default)]
    pub error_code: Option<String>,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ScanEvent {
    #[serde(rename = "started", rename_all = "camelCase")]
    Started { scan_id: String },
    #[serde(rename = "candidates", rename_all = "camelCase")]
    Candidates { items: Vec<CleanupItem> },
    #[serde(rename = "measured", rename_all = "camelCase")]
    Measured { updates: Vec<MeasurementUpdate> },
    #[serde(rename = "progress", rename_all = "camelCase")]
    Progress { progress: ScanProgress },
    #[serde(rename = "warning", rename_all = "camelCase")]
    Warning {
        code: String,
        path: Option<String>,
        #[serde(default)]
        severity: ScanNoticeSeverity,
        #[serde(default)]
        root: Option<String>,
    },
    #[serde(rename = "completed", rename_all = "camelCase")]
    Completed { summary: ScanSummary },
    /// A scan that finished because a limit or the timeout stopped it. This is
    /// deliberately separate from `Cancelled`: the user did not cancel, but the
    /// result is incomplete and must be presented as partial.
    #[serde(rename = "partial", rename_all = "camelCase")]
    Partial { summary: ScanSummary },
    #[serde(rename = "cancelled", rename_all = "camelCase")]
    Cancelled { summary: ScanSummary },
    #[serde(rename = "failed", rename_all = "camelCase")]
    Failed { error: AppError },
}

/// Backend-internal representation of a discovered target. The filesystem path
/// lives only here and is never used as an authorization token.
#[derive(Debug, Clone)]
pub struct StoredTarget {
    pub id: String,
    pub path: std::path::PathBuf,
    pub rule_id: String,
    pub provider: String,
    pub category: String,
    pub kind: TargetKind,
    pub safety_class: SafetyClass,
    pub cleanup_method: CleanupMethod,
    pub project_root: Option<String>,
    pub evidence: EvidenceSnapshot,
    pub logical_bytes: Option<u64>,
    pub allocated_bytes: Option<u64>,
    pub modified_at: Option<String>,
    pub active_use: ActiveUse,
    pub parent_id: Option<String>,
    pub protected: bool,
}
