use serde::{Deserialize, Serialize};

use crate::catalog::{CleanupMethod, Confidence, SafetyClass, TargetKind};
use crate::error::AppError;
use crate::safety::{ActiveUse, EvidenceSnapshot};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ScanScope {
    #[default]
    Project,
    Agents,
    GlobalCaches,
    /// Full-disk scan across every local volume.
    AllDrives,
}

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
    pub display_name: String,
    pub display_path: String,
    pub logical_bytes: Option<u64>,
    pub allocated_bytes: Option<u64>,
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
    pub last_modified_ms: Option<i64>,
    pub status: ItemStatus,
    pub parent_item_id: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasurementUpdate {
    pub id: String,
    pub logical_bytes: u64,
    pub allocated_bytes: Option<u64>,
    pub estimated_reclaim_bytes: u64,
    pub file_count: u64,
    pub hardlink_dedup_bytes: u64,
    pub status: ItemStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRequest {
    pub root_path: String,
    #[serde(default)]
    pub exclusions: Vec<String>,
    #[serde(default)]
    pub scope: ScanScope,
    #[serde(default)]
    pub profile: Option<String>,
    #[serde(default)]
    pub max_depth: Option<usize>,
    #[serde(default)]
    pub max_candidates: Option<u64>,
    #[serde(default)]
    pub timeout_minutes: Option<u64>,
    #[serde(default)]
    pub min_size_bytes: Option<u64>,
    #[serde(default)]
    pub protected_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub phase: String,
    pub directories_visited: u64,
    pub entries_found: u64,
    pub entries_measured: u64,
    pub bytes_measured: u64,
    pub current_path: Option<String>,
    pub stop_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTotal {
    pub provider: String,
    pub logical_bytes: u64,
    pub allocated_bytes: u64,
    pub item_count: u64,
    pub protected_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub scan_id: String,
    pub root_path: String,
    pub scope: ScanScope,
    pub total_entries: u64,
    pub total_bytes: u64,
    pub total_allocated_bytes: u64,
    pub protected_bytes: u64,
    pub duration_ms: u64,
    pub errors_count: u64,
    pub warnings_count: u64,
    pub directories_visited: u64,
    pub partial: bool,
    pub stop_reason: Option<String>,
    pub provider_totals: Vec<ProviderTotal>,
}

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
    Warning { code: String, path: Option<String> },
    #[serde(rename = "completed", rename_all = "camelCase")]
    Completed { summary: ScanSummary },
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
