use std::sync::{Arc, Mutex};

use crate::audit::AuditRepository;
use crate::catalog::{load_embedded, CatalogIndex};
use crate::cleanup::official_actions::OfficialActionRegistry;
use crate::error::AppError;
use crate::last_scan::LastScanRepository;
use crate::scanner::cancellation::CancellationToken;
use crate::scanner::session::ScanRegistry;
use crate::settings::SettingsRepository;

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
        }
    }

    pub fn catalog(&self) -> Result<Arc<CatalogIndex>, AppError> {
        self.catalog.clone().ok_or_else(|| {
            AppError::Blocked(format!(
                "Katalog doğrulanamadı; temizleme devre dışı. {}",
                self.catalog_error.clone().unwrap_or_default()
            ))
        })
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
