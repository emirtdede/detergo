use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::scanner::models::{CleanupItem, ScanSummary};

/// Snapshot format revision. Bumped when the persisted shape changes; an old
/// snapshot that does not match is ignored instead of being half-restored.
pub const LAST_SCAN_SCHEMA_VERSION: u32 = 1;

/// Guard against a runaway scan filling the profile directory with JSON. The
/// snapshot is a convenience cache, not an audit log, so refusing an oversized
/// write is preferable to silently consuming hundreds of megabytes.
const MAX_SNAPSHOT_BYTES: usize = 64 * 1024 * 1024;

/// The single most recent completed or cancelled scan. Only one snapshot is
/// ever kept so the app opens with the latest picture instead of an empty
/// screen, without turning into an unbounded history store.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastScanSnapshot {
    pub schema_version: u32,
    pub saved_at: String,
    pub summary: ScanSummary,
    pub items: Vec<CleanupItem>,
}

pub struct LastScanRepository {
    path: PathBuf,
}

impl LastScanRepository {
    pub fn new() -> Self {
        let base_dir = dirs_or_fallback();
        let app_dir = crate::platform::resolve_app_dir(&base_dir);
        Self {
            path: app_dir.join("last-scan.json"),
        }
    }

    pub fn with_path(path: PathBuf) -> Self {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Returns `None` for missing, unreadable, corrupt, or version-mismatched
    /// files. A stale snapshot must never break startup.
    pub fn load(&self) -> Option<LastScanSnapshot> {
        let mut file = File::open(&self.path).ok()?;
        let mut content = String::new();
        file.read_to_string(&mut content).ok()?;
        let snapshot = serde_json::from_str::<LastScanSnapshot>(&content).ok()?;
        if snapshot.schema_version != LAST_SCAN_SCHEMA_VERSION {
            return None;
        }
        Some(snapshot)
    }

    pub fn save(&self, snapshot: &LastScanSnapshot) -> Result<(), AppError> {
        let parent = self.path.parent().unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent).map_err(|e| {
            AppError::SettingsWriteFailed(format!("Failed to create last-scan directory: {}", e))
        })?;

        let json = serde_json::to_vec(snapshot)
            .map_err(|e| AppError::SettingsWriteFailed(e.to_string()))?;
        if json.len() > MAX_SNAPSHOT_BYTES {
            return Err(AppError::SettingsWriteFailed(format!(
                "Last-scan record is too large ({} bytes).",
                json.len()
            )));
        }

        let temp_path = parent.join(format!(
            "last-scan.tmp.{}.{}.json",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ));

        let write_result = (|| -> std::io::Result<()> {
            let mut temp_file = File::create(&temp_path)?;
            temp_file.write_all(&json)?;
            temp_file.flush()?;
            temp_file.sync_all()?;
            Ok(())
        })();
        if let Err(e) = write_result {
            let _ = fs::remove_file(&temp_path);
            return Err(AppError::SettingsWriteFailed(format!(
                "Failed to write temporary last-scan file: {}",
                e
            )));
        }

        if let Err(e) = replace_file(&temp_path, &self.path) {
            let _ = fs::remove_file(&temp_path);
            return Err(AppError::SettingsWriteFailed(format!(
                "Failed to replace last-scan file: {}",
                e
            )));
        }
        Ok(())
    }

    pub fn clear(&self) -> Result<(), AppError> {
        match fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(AppError::SettingsWriteFailed(format!(
                "Failed to delete last-scan record: {}",
                e
            ))),
        }
    }
}

impl Default for LastScanRepository {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MOVE_FILE_FLAGS,
    };

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let from_w = wide(from);
    let to_w = wide(to);
    let flags = MOVE_FILE_FLAGS(MOVEFILE_REPLACE_EXISTING.0 | MOVEFILE_WRITE_THROUGH.0);
    unsafe { MoveFileExW(PCWSTR(from_w.as_ptr()), PCWSTR(to_w.as_ptr()), flags) }
        .map_err(|e| std::io::Error::from_raw_os_error(e.code().0))
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::rename(from, to)
}

fn dirs_or_fallback() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata);
    }
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        return PathBuf::from(userprofile).join(".config");
    }
    PathBuf::from(".")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::TargetKind;
    use crate::scanner::models::ProviderTotal;

    fn summary() -> ScanSummary {
        ScanSummary {
            scan_id: "scan-1".into(),
            root_path: "C:\\dev".into(),
            scope: crate::scanner::models::ScanScope::Project,
            total_entries: 2,
            total_bytes: 2048,
            total_allocated_bytes: 2048,
            protected_bytes: 0,
            duration_ms: 12,
            errors_count: 0,
            warnings_count: 0,
            directories_visited: 3,
            partial: false,
            stop_reason: None,
            provider_totals: vec![ProviderTotal {
                provider: "npm".into(),
                logical_bytes: 2048,
                allocated_bytes: 2048,
                item_count: 2,
                protected_bytes: 0,
            }],
        }
    }

    fn item() -> CleanupItem {
        CleanupItem {
            id: "item-1".into(),
            scan_session_id: "scan-1".into(),
            rule_id: "npm-cache".into(),
            provider: "npm".into(),
            ecosystem: "node".into(),
            category: "cache".into(),
            kind: TargetKind::Directory,
            project_id: None,
            project_name: None,
            project_root: None,
            display_name: "npm cache".into(),
            display_path: "C:\\dev\\node_modules\\.cache".into(),
            logical_bytes: Some(2048),
            allocated_bytes: Some(2048),
            estimated_reclaim_bytes: Some(2048),
            safety_class: crate::catalog::SafetyClass::Safe,
            confidence: crate::catalog::Confidence::High,
            active_use: crate::safety::ActiveUse::No,
            evidence_codes: vec![],
            warning_codes: vec![],
            cleanup_method: crate::catalog::CleanupMethod::Trash,
            regenerate_hint: None,
            protected: false,
            selectable: true,
            auto_selectable: true,
            last_modified_at: None,
            last_modified_ms: None,
            status: crate::scanner::models::ItemStatus::Ready,
            parent_item_id: None,
            note: None,
        }
    }

    fn temp_path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "node-cleaner-last-scan-{}.json",
            uuid::Uuid::new_v4().simple()
        ))
    }

    #[test]
    fn saves_and_loads_a_single_snapshot() {
        let path = temp_path();
        let repo = LastScanRepository::with_path(path.clone());
        assert!(repo.load().is_none());

        let snapshot = LastScanSnapshot {
            schema_version: LAST_SCAN_SCHEMA_VERSION,
            saved_at: "2026-01-01T00:00:00Z".into(),
            summary: summary(),
            items: vec![item()],
        };
        repo.save(&snapshot).expect("save succeeds");

        let loaded = repo.load().expect("snapshot loads");
        assert_eq!(loaded.schema_version, LAST_SCAN_SCHEMA_VERSION);
        assert_eq!(loaded.saved_at, snapshot.saved_at);
        assert_eq!(loaded.items.len(), 1);
        assert_eq!(loaded.items[0].display_name, "npm cache");
        assert_eq!(loaded.summary.total_bytes, 2048);

        repo.clear().expect("clear succeeds");
        assert!(repo.load().is_none());
    }

    #[test]
    fn ignores_corrupt_and_version_mismatched_files() {
        let path = temp_path();
        let repo = LastScanRepository::with_path(path.clone());
        fs::write(&path, b"{not json").expect("write corrupt file");
        assert!(repo.load().is_none());

        let snapshot = LastScanSnapshot {
            schema_version: LAST_SCAN_SCHEMA_VERSION + 1,
            saved_at: "2026-01-01T00:00:00Z".into(),
            summary: summary(),
            items: vec![],
        };
        repo.save(&snapshot).expect("save succeeds");
        assert!(repo.load().is_none());
        let _ = fs::remove_file(path);
    }
}
