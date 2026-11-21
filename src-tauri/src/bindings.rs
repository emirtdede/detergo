//! TypeScript contract for the Tauri IPC surface (T-37).
//!
//! Opt-in via the `bindings` feature. `bin/export_bindings.rs` writes
//! `src/lib/tauri/bindings.ts` from [`collect`], and
//! `src/test/bindings-contract.test.ts` asserts that the handwritten
//! `src/types/index.ts` still matches the generated shapes. A Rust field change
//! therefore fails the build until the frontend type is updated.
//!
//! The list is explicit rather than `specta::collect()`: the generated file must
//! be deterministic and must not gain types because some internal helper derived
//! `Type` for its own purposes.

use specta::Types;

use crate::audit::{ActionAuditRecord, AuditEntry, AuditRecord, CleanupTotals, StorageSnapshot};
use crate::build_info::BuildInfo;
use crate::catalog::{CleanupMethod, Confidence, Rule, SafetyClass, TargetKind};
use crate::cleanup::coordinator::{CleanupEvent, CleanupReport, CleanupResultItem};
use crate::cleanup::official_actions::{
    CacheMeasureEvent, CachePathInfo, CacheProviderInfo, OfficialActionInfo, OfficialActionPreview,
    OfficialActionResult,
};
use crate::cleanup::plan::{CleanupPlan, PlanItem, TargetSnapshot};
use crate::cleanup::DeleteMode;
use crate::commands::support_commands::{SupportBundle, SupportBundleRequest, SupportMailResult};
use crate::commands::system_commands::{CliEnvironmentStatus, DiskSpaceInfo};
use crate::error::AppError;
use crate::last_scan::LastScanSnapshot;
use crate::platform::app_icon::AppIconApplyResult;
use crate::platform::KnownLocation;
use crate::providers::growth::GrowthEntry;
use crate::providers::{AgentProviderInfo, AgentRootInfo};
use crate::scanner::models::{
    CleanupItem, ItemStatus, MeasurementUpdate, ProviderTotal, ScanEvent, ScanProgress,
    ScanRequest, ScanScope, ScanSummary,
};
use crate::settings::{
    AgentPolicy, AppSettings, CustomAgentProvider, CustomThemeConfig, FavoriteItem,
    NotificationChannel, NotificationPreferences, SortConfig,
};
use crate::system_cleaner::{
    SystemActionId, SystemActionInfo, SystemActionResult, SystemAutomationConfig,
    SystemCleanReport, SystemEvent, SystemPreview, SystemSafety, SystemScanReport,
};
use crate::updates::{DownloadedUpdate, InstallChannel, SignatureStatus, UpdateAsset, UpdateInfo};

/// Every type that crosses the IPC boundary, in a stable order.
pub fn collect() -> Types {
    Types::default()
        .register::<ScanScope>()
        .register::<ItemStatus>()
        .register::<SafetyClass>()
        .register::<Confidence>()
        .register::<TargetKind>()
        .register::<CleanupMethod>()
        .register::<DeleteMode>()
        .register::<CleanupItem>()
        .register::<MeasurementUpdate>()
        .register::<ScanRequest>()
        .register::<ScanProgress>()
        .register::<ProviderTotal>()
        .register::<ScanSummary>()
        .register::<ScanEvent>()
        .register::<Rule>()
        .register::<TargetSnapshot>()
        .register::<PlanItem>()
        .register::<CleanupPlan>()
        .register::<CleanupResultItem>()
        .register::<CleanupReport>()
        .register::<CleanupEvent>()
        .register::<CachePathInfo>()
        .register::<OfficialActionInfo>()
        .register::<CacheProviderInfo>()
        .register::<CacheMeasureEvent>()
        .register::<OfficialActionPreview>()
        .register::<OfficialActionResult>()
        .register::<AgentRootInfo>()
        .register::<AgentProviderInfo>()
        .register::<GrowthEntry>()
        .register::<StorageSnapshot>()
        .register::<DiskSpaceInfo>()
        .register::<CliEnvironmentStatus>()
        .register::<AppIconApplyResult>()
        .register::<KnownLocation>()
        .register::<BuildInfo>()
        .register::<InstallChannel>()
        .register::<SignatureStatus>()
        .register::<UpdateInfo>()
        .register::<UpdateAsset>()
        .register::<DownloadedUpdate>()
        .register::<SupportBundleRequest>()
        .register::<SupportBundle>()
        .register::<SupportMailResult>()
        .register::<SystemActionId>()
        .register::<SystemSafety>()
        .register::<SystemActionInfo>()
        .register::<SystemScanReport>()
        .register::<SystemPreview>()
        .register::<SystemEvent>()
        .register::<SystemActionResult>()
        .register::<SystemCleanReport>()
        .register::<SystemAutomationConfig>()
        .register::<LastScanSnapshot>()
        .register::<CustomAgentProvider>()
        .register::<CustomThemeConfig>()
        .register::<AgentPolicy>()
        .register::<FavoriteItem>()
        .register::<SortConfig>()
        .register::<NotificationChannel>()
        .register::<NotificationPreferences>()
        .register::<AppSettings>()
        .register::<AuditEntry>()
        .register::<AuditRecord>()
        .register::<ActionAuditRecord>()
        .register::<CleanupTotals>()
        .register::<AppError>()
}
