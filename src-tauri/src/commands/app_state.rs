use std::sync::{Arc, Mutex};

use crate::audit::AuditRepository;
use crate::catalog::{load_embedded, CatalogIndex};
use crate::cleanup::official_actions::OfficialActionRegistry;
use crate::error::AppError;
use crate::last_scan::LastScanRepository;
use crate::scanner::cancellation::CancellationToken;
use crate::scanner::session::ScanRegistry;
use crate::settings::SettingsRepository;
use crate::system_cleaner::schedule::SystemAutomationRepository;

/// A view requested on the command line, e.g. by the elevated relaunch.
static LAUNCH_VIEW: Mutex<Option<String>> = Mutex::new(None);

pub fn set_launch_view(view: &str) {
    if let Ok(mut slot) = LAUNCH_VIEW.lock() {
        *slot = Some(view.to_string());
    }
}

pub fn take_launch_view() -> Option<String> {
    LAUNCH_VIEW.lock().ok().and_then(|mut slot| slot.take())
}

pub struct AppState {
    pub registry: ScanRegistry,
    pub official: Arc<OfficialActionRegistry>,
    pub settings: SettingsRepository,
    pub audit: AuditRepository,
    pub last_scan: LastScanRepository,
    pub catalog: Option<Arc<CatalogIndex>>,
    pub catalog_error: Option<String>,
    pub scan_token: Mutex<Option<CancellationToken>>,
    pub cache_token: Mutex<Option<CancellationToken>>,
    /// Held while a cache action preview measures its "before" size. The UI's
    /// Cancel button uses it to stop the directory walk instead of only hiding
    /// the spinner while the walk keeps running.
    pub preview_token: Mutex<Option<CancellationToken>>,
    /// Held for the duration of a cleanup run. A second run is rejected while
    /// the slot is occupied, and `cancel_cleanup` uses the token to stop the
    /// current run between items.
    pub cleanup_token: Mutex<Option<CancellationToken>>,
    /// Held while a system cleanup runs. Separate from `cleanup_token` so the
    /// two features cannot cancel each other.
    pub system_token: Mutex<Option<CancellationToken>>,
    pub system_preview:
        Mutex<Option<crate::commands::system_cleaner_commands::PendingSystemPreview>>,
    pub system_automation: SystemAutomationRepository,
}

impl AppState {
    pub fn new() -> Self {
        let (catalog, catalog_error) = match load_embedded() {
            Ok(catalog) => (Some(catalog), None),
            Err(err) => (None, Some(err.to_string())),
        };
        Self {
            registry: ScanRegistry::new(),
            official: Arc::new(OfficialActionRegistry::new()),
            settings: SettingsRepository::new(),
            audit: AuditRepository::new(),
            last_scan: LastScanRepository::new(),
            catalog,
            catalog_error,
            scan_token: Mutex::new(None),
            cache_token: Mutex::new(None),
            preview_token: Mutex::new(None),
            cleanup_token: Mutex::new(None),
            system_token: Mutex::new(None),
            system_preview: Mutex::new(None),
            system_automation: SystemAutomationRepository::new(),
        }
    }

    pub fn catalog(&self) -> Result<Arc<CatalogIndex>, AppError> {
        self.catalog.clone().ok_or_else(|| {
            AppError::Blocked(format!(
                "Catalog could not be validated; cleanup is disabled. {}",
                self.catalog_error.clone().unwrap_or_default()
            ))
        })
    }

    /// Returns the human-readable name of the operation that currently owns a
    /// cancellation token, or `None` when the app is idle.
    ///
    /// A factory reset deletes the settings and history the running operation
    /// is writing to, so it must be refused instead of racing that writer.
    pub fn active_operation(&self) -> Option<&'static str> {
        let is_active = |slot: &Mutex<Option<CancellationToken>>| {
            slot.lock()
                .map(|guard| guard.is_some())
                // A poisoned lock means the owning operation panicked mid-run;
                // treating it as active is the safe choice.
                .unwrap_or(true)
        };

        if is_active(&self.scan_token) {
            Some("scan")
        } else if is_active(&self.cleanup_token) {
            Some("cleanup")
        } else if is_active(&self.cache_token) {
            Some("cache measurement")
        } else if is_active(&self.preview_token) {
            Some("cache preview")
        } else if is_active(&self.system_token) {
            Some("system cleanup")
        } else {
            None
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
