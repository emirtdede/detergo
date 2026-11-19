//! Windows-wide cleanup that lives outside the developer-artifact scan.
//!
//! The developer scan never leaves its roots, so the system locations below
//! (`%LOCALAPPDATA%\Temp`, `C:\Windows\Temp`, Prefetch, …) are unreachable by
//! the generic cleanup pipeline on purpose. This module is a deliberately
//! separate, hard-coded surface:
//!
//! * the frontend sends only an [`SystemActionId`], never a path;
//! * every root is a compile-time or environment-derived constant that is
//!   canonicalised and compared against the expected value before use;
//! * deletions reuse the handle-based permanent delete and never follow a
//!   reparse point;
//! * files that are in use are skipped and reported, not retried forever.

pub mod actions;
pub mod cleanmgr;
pub mod cli;
pub mod delete;
pub mod dism;
pub mod execute;
pub mod guard;
pub mod measure;
pub mod process;
pub mod recycle;
pub mod schedule;

#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SystemActionId {
    UserTemp,
    WindowsTemp,
    Prefetch,
    WindowsUpdate,
    ErrorReports,
    RecycleBin,
    DiskCleanup,
    ComponentStore,
}

impl SystemActionId {
    /// Stable identifier used in the audit log and the CLI.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::UserTemp => "userTemp",
            Self::WindowsTemp => "windowsTemp",
            Self::Prefetch => "prefetch",
            Self::WindowsUpdate => "windowsUpdate",
            Self::ErrorReports => "errorReports",
            Self::RecycleBin => "recycleBin",
            Self::DiskCleanup => "diskCleanup",
            Self::ComponentStore => "componentStore",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "userTemp" | "user-temp" | "temp" => Some(Self::UserTemp),
            "windowsTemp" | "windows-temp" => Some(Self::WindowsTemp),
            "prefetch" => Some(Self::Prefetch),
            "windowsUpdate" | "windows-update" | "update" => Some(Self::WindowsUpdate),
            "errorReports" | "error-reports" | "wer" => Some(Self::ErrorReports),
            "recycleBin" | "recycle-bin" | "bin" => Some(Self::RecycleBin),
            "diskCleanup" | "disk-cleanup" | "cleanmgr" => Some(Self::DiskCleanup),
            "componentStore" | "component-store" | "dism" => Some(Self::ComponentStore),
            _ => None,
        }
    }
}

/// How recoverable the affected data is. Mirrors the developer catalog's
/// vocabulary so the UI can use the same badge colours.
#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SystemSafety {
    /// Recreated on demand; losing it only costs a little time.
    Safe,
    /// Windows rebuilds it automatically.
    Regenerate,
    /// The user should read what it is before running it.
    Review,
}

impl SystemSafety {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Safe => "safe",
            Self::Regenerate => "regenerate",
            Self::Review => "review",
        }
    }
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemActionInfo {
    pub id: SystemActionId,
    pub safety: SystemSafety,
    pub requires_admin: bool,
    /// False when the environment cannot offer this action at all (for
    /// example the cache folder does not exist).
    pub available: bool,
    /// Machine-readable reason when `available` or `measured` is false:
    /// `notPresent`, `needsAdmin`, `windowsReports`, `timedOut`, `cancelled`.
    pub reason: Option<String>,
    /// The folder or tool this action operates on, shown under the label.
    pub path: Option<String>,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub file_count: u64,
    pub measured: bool,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemScanReport {
    pub elevated: bool,
    pub actions: Vec<SystemActionInfo>,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub total_bytes: u64,
    /// Free/total space of the volume that holds `%SystemDrive%`.
    pub disk: Option<crate::commands::system_commands::DiskSpaceInfo>,
    pub scanned_at: String,
    pub warnings: Vec<String>,
}

/// A confirmed action set. The frontend must call `system_preview` first; the
/// token carries the exact actions so a stale UI cannot widen the scope.
#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPreview {
    pub token: String,
    pub actions: Vec<SystemActionInfo>,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub total_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub expires_ms: u64,
    pub requires_admin: bool,
    pub elevated: bool,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SystemEvent {
    Started {
        #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<usize>))]
        total: usize,
    },
    ActionStarted {
        id: SystemActionId,
        #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<usize>))]
        index: usize,
        #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<usize>))]
        total: usize,
    },
    ActionFinished {
        id: SystemActionId,
        success: bool,
        #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
        freed_bytes: u64,
        #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
        skipped: u64,
    },
    Finished {
        #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
        freed_bytes: u64,
        cancelled: bool,
    },
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemActionResult {
    pub id: SystemActionId,
    pub success: bool,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub freed_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub deleted_files: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub skipped: u64,
    /// A bounded sample of the names that could not be removed (in use).
    pub skipped_sample: Vec<String>,
    pub exit_code: Option<i32>,
    /// Short tail of the tool output for the two engine actions. Never a path
    /// outside the audited roots.
    pub log_tail: Option<String>,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub duration_ms: u64,
    pub error_code: Option<String>,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemCleanReport {
    pub results: Vec<SystemActionResult>,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub freed_bytes: u64,
    pub cancelled: bool,
    pub started_at: String,
    pub finished_at: String,
    pub elevated: bool,
}

/// Persistent description of the Windows scheduled task. The task itself is
/// the source of truth for execution; this mirror exists so the UI can show
/// what it asked Windows to do and can repair a task deleted by the user.
#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SystemAutomationConfig {
    pub enabled: bool,
    /// `daily` or `weekly`.
    pub frequency: String,
    /// Local time, `HH:MM`.
    pub time: String,
    /// 0 = Sunday … 6 = Saturday. Only used when `frequency` is `weekly`.
    pub weekday: u8,
    /// `quick`, `standard` or `deep`.
    pub profile: String,
    /// Whether the scheduled task currently exists in Windows.
    pub installed: bool,
    /// Last scheduled run reported by the app itself, RFC 3339.
    pub last_run: Option<String>,
    #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<u64>>))]
    pub last_freed_bytes: Option<u64>,
}

impl Default for SystemAutomationConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            frequency: "weekly".to_string(),
            time: "12:00".to_string(),
            weekday: 0,
            profile: "quick".to_string(),
            installed: false,
            last_run: None,
            last_freed_bytes: None,
        }
    }
}

impl SystemAutomationConfig {
    /// Clamps hand-edited or older values into the supported set.
    pub fn normalize(&mut self) {
        if self.frequency != "daily" && self.frequency != "weekly" {
            self.frequency = "weekly".to_string();
        }
        if self.profile != "quick" && self.profile != "standard" && self.profile != "deep" {
            self.profile = "quick".to_string();
        }
        if self.weekday > 6 {
            self.weekday = 0;
        }
        let valid_time = self.time.len() == 5
            && self.time.as_bytes().get(2) == Some(&b':')
            && self
                .time
                .get(..2)
                .and_then(|hour| hour.parse::<u8>().ok())
                .map(|hour| hour < 24)
                .unwrap_or(false)
            && self
                .time
                .get(3..)
                .and_then(|minute| minute.parse::<u8>().ok())
                .map(|minute| minute < 60)
                .unwrap_or(false);
        if !valid_time {
            self.time = "12:00".to_string();
        }
    }
}

/// Ids used by the automation profiles. Ordered from least to most invasive.
pub fn profile_actions(profile: &str) -> Vec<SystemActionId> {
    use SystemActionId::*;
    match profile {
        "standard" => vec![UserTemp, WindowsUpdate, WindowsTemp, Prefetch, ErrorReports],
        "deep" => vec![
            UserTemp,
            WindowsUpdate,
            WindowsTemp,
            Prefetch,
            ErrorReports,
            DiskCleanup,
            ComponentStore,
        ],
        // Unknown values fall back to the safest profile instead of widening.
        _ => vec![UserTemp, WindowsUpdate],
    }
}
