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

/// A scan-level warning (an unreadable path, a failed volume, ...). These are
/// emitted live through `ScanEvent::Warning`; persisting them alongside the
/// snapshot keeps the explanation available after a restart.
#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanWarning {
    pub code: String,
    pub path: Option<String>,
    /// How much this warning affects the trustworthiness of the result. Older
    /// snapshots have no severity; they are re-classified by the UI as warnings,
    /// which is the conservative choice.
    #[serde(default)]
    pub severity: crate::scanner::notices::ScanNoticeSeverity,
    /// Root of the walk that produced the warning, for a complete support record.
    #[serde(default)]
    pub root: Option<String>,
}

/// The single most recent completed or cancelled scan. Only one snapshot is
/// ever kept so the app opens with the latest picture instead of an empty
/// screen, without turning into an unbounded history store.
#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastScanSnapshot {
    pub schema_version: u32,
    pub saved_at: String,
    pub summary: ScanSummary,
    pub items: Vec<CleanupItem>,
    /// Added after schema version 1 shipped. `default` keeps older snapshots
    /// (which never contained this key) loadable instead of invalidating them.
    #[serde(default)]
    pub warnings: Vec<ScanWarning>,
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
        let file = File::open(&self.path).ok()?;
        // The same ceiling `save` enforces, applied on the read side too: a
        // truncated or tampered file must not make startup allocate its full
        // size before the version check can reject it. The extra byte detects
        // an oversized file instead of silently truncating it into invalid JSON.
        let mut content = String::new();
        file.take(MAX_SNAPSHOT_BYTES as u64 + 1)
            .read_to_string(&mut content)
            .ok()?;
        if content.len() > MAX_SNAPSHOT_BYTES {
            return None;
        }
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

    /// Removes the snapshot and any temporary file an interrupted save left
    /// behind. The next launch then has no stale scan to restore.
    pub fn reset(&self) -> Result<(), AppError> {
        self.clear()?;
        let Some(parent) = self.path.parent() else {
            return Ok(());
        };
        let Ok(entries) = fs::read_dir(parent) else {
            return Ok(());
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("last-scan.tmp.") && name.ends_with(".json") {
                let _ = fs::remove_file(entry.path());
            }
        }
        Ok(())
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
            cleanable_bytes: 2048,
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
            detected_project_count: Some(1),
            sections: Vec::new(),
            dropped_events: 0,
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
            project_detected: false,
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
        // Each test gets its own directory. `reset()` removes stray
        // `last-scan.tmp.*.json` files next to the snapshot, which is correct
        // for the real, per-app data directory; pointing every test at the
        // shared system temp dir let one test delete another test's in-flight
        // temporary file and made `save` fail at random.
        let dir = std::env::temp_dir().join(format!(
            "dev-cleaner-last-scan-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let _ = fs::create_dir_all(&dir);
        dir.join("last-scan.json")
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
            warnings: vec![ScanWarning {
                code: "ACCESS_DENIED".into(),
                path: Some("C:\\Windows".into()),
                severity: crate::scanner::notices::ScanNoticeSeverity::Info,
                root: Some("C:\\".into()),
            }],
        };
        repo.save(&snapshot).expect("save succeeds");

        let loaded = repo.load().expect("snapshot loads");
        assert_eq!(loaded.schema_version, LAST_SCAN_SCHEMA_VERSION);
        assert_eq!(loaded.saved_at, snapshot.saved_at);
        assert_eq!(loaded.items.len(), 1);
        assert_eq!(loaded.items[0].display_name, "npm cache");
        assert_eq!(loaded.summary.total_bytes, 2048);
        assert_eq!(loaded.warnings, snapshot.warnings);

        repo.clear().expect("clear succeeds");
        assert!(repo.load().is_none());
    }

    #[test]
    fn reset_removes_snapshot_and_temporary_files() {
        let path = temp_path();
        let repo = LastScanRepository::with_path(path.clone());
        let snapshot = LastScanSnapshot {
            schema_version: LAST_SCAN_SCHEMA_VERSION,
            saved_at: "2026-01-01T00:00:00Z".into(),
            summary: summary(),
            items: vec![item()],
            warnings: vec![],
        };
        repo.save(&snapshot).expect("save succeeds");
        let temp = path.parent().unwrap().join("last-scan.tmp.1.2.json");
        std::fs::write(&temp, "{}").expect("temp file");

        repo.reset().expect("reset succeeds");

        assert!(repo.load().is_none());
        assert!(!path.exists());
        assert!(!temp.exists());
    }

    #[test]
    fn loads_a_legacy_snapshot_without_the_warnings_field() {
        let path = temp_path();
        let repo = LastScanRepository::with_path(path.clone());
        // Shape written by builds that predate persisted warnings.
        let legacy = serde_json::json!({
            "schemaVersion": LAST_SCAN_SCHEMA_VERSION,
            "savedAt": "2026-01-01T00:00:00Z",
            "summary": summary(),
            "items": [item()],
        });
        fs::write(&path, serde_json::to_vec(&legacy).unwrap()).expect("write legacy file");

        let loaded = repo.load().expect("legacy snapshot still loads");
        assert!(loaded.warnings.is_empty());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn an_oversized_snapshot_is_rejected_without_being_loaded() {
        let path = temp_path();
        let repo = LastScanRepository::with_path(path.clone());
        // Sparse file: allocating 64 MiB of real bytes here would slow the
        // suite down for no extra coverage. `read_to_string` fills the gap with
        // NULs, which are valid UTF-8, so the size check is what rejects it.
        let file = File::create(&path).expect("create oversized file");
        file.set_len(MAX_SNAPSHOT_BYTES as u64 + 1)
            .expect("set_len");
        drop(file);

        assert!(repo.load().is_none());
        let _ = fs::remove_file(path);
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
            warnings: vec![],
        };
        repo.save(&snapshot).expect("save succeeds");
        assert!(repo.load().is_none());
        let _ = fs::remove_file(path);
    }
}
