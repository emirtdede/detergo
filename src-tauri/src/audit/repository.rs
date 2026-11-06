use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use crate::cleanup::DeleteMode;
use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub target_id: String,
    pub rule_id: String,
    pub path: String,
    pub success: bool,
    pub verified: bool,
    pub error_code: Option<String>,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditRecord {
    pub id: String,
    pub timestamp: String,
    pub session_id: String,
    pub plan_id: String,
    pub mode: DeleteMode,
    pub success_count: u64,
    pub error_count: u64,
    pub reclaim_bytes: u64,
    pub moved_bytes: u64,
    pub duration_ms: u64,
    pub entries: Vec<AuditEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSnapshot {
    pub timestamp: String,
    pub provider: String,
    pub category: String,
    pub bytes: u64,
    pub item_count: u64,
}

/// Audit record for an explicitly user-triggered official tool action (for
/// example `npm cache clean`). Kept separate from per-target cleanup history so
/// the two record types are never conflated.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionAuditRecord {
    pub id: String,
    pub timestamp: String,
    pub provider_id: String,
    pub action_id: String,
    pub label: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub before_bytes: u64,
    pub after_bytes: u64,
    pub delta_bytes: i64,
    pub duration_ms: u64,
}

pub struct AuditRepository {
    history_path: PathBuf,
    snapshots_path: PathBuf,
    actions_path: PathBuf,
}

impl AuditRepository {
    pub fn new() -> Self {
        let base = std::env::var("APPDATA")
            .map(PathBuf::from)
            .or_else(|_| std::env::var("USERPROFILE").map(|p| PathBuf::from(p).join(".config")))
            .unwrap_or_else(|_| PathBuf::from("."));
        let dir = crate::platform::resolve_app_dir(&base);
        Self {
            history_path: dir.join("history.jsonl"),
            snapshots_path: dir.join("snapshots.jsonl"),
            actions_path: dir.join("actions.jsonl"),
        }
    }

    pub fn with_paths(history_path: PathBuf, snapshots_path: PathBuf) -> Self {
        if let Some(parent) = history_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let actions_path = history_path
            .parent()
            .map(|p| p.join("actions.jsonl"))
            .unwrap_or_else(|| PathBuf::from("actions.jsonl"));
        Self {
            history_path,
            snapshots_path,
            actions_path,
        }
    }

    pub fn append_record(&self, record: &AuditRecord) -> Result<(), AppError> {
        append_json_line(&self.history_path, record)
    }

    pub fn list_records(&self, limit: usize) -> Vec<AuditRecord> {
        read_json_lines(&self.history_path, limit)
    }

    pub fn append_snapshots(&self, snapshots: &[StorageSnapshot]) -> Result<(), AppError> {
        if snapshots.is_empty() {
            return Ok(());
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.snapshots_path)
            .map_err(|e| AppError::SettingsWriteFailed(format!("Snapshot yazılamadı: {}", e)))?;
        for snapshot in snapshots {
            let line = serde_json::to_string(snapshot)
                .map_err(|e| AppError::SettingsWriteFailed(e.to_string()))?;
            writeln!(file, "{}", line)
                .map_err(|e| AppError::SettingsWriteFailed(e.to_string()))?;
        }
        Ok(())
    }

    pub fn list_snapshots(&self, limit: usize) -> Vec<StorageSnapshot> {
        read_json_lines(&self.snapshots_path, limit)
    }

    pub fn append_action(&self, record: &ActionAuditRecord) -> Result<(), AppError> {
        append_json_line(&self.actions_path, record)
    }

    pub fn list_actions(&self, limit: usize) -> Vec<ActionAuditRecord> {
        read_json_lines(&self.actions_path, limit)
    }

    /// Removes every persisted history/snapshot/action record. Missing files are
    /// treated as already cleared, but a real delete failure is reported.
    /// Removes only cleanup history and storage snapshot files, keeping action logs intact.
    pub fn clear_cleanups(&self) -> Result<(), AppError> {
        for path in [&self.history_path, &self.snapshots_path] {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => {
                    return Err(AppError::SettingsWriteFailed(format!(
                        "Temizlik geçmişi dosyası silinemedi ({}): {}",
                        path.display(),
                        err
                    )))
                }
            }
        }
        Ok(())
    }

    /// Removes only official CLI action logs, keeping cleanup and snapshot records intact.
    pub fn clear_actions(&self) -> Result<(), AppError> {
        match fs::remove_file(&self.actions_path) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => {
                return Err(AppError::SettingsWriteFailed(format!(
                    "Komut geçmişi dosyası silinemedi ({}): {}",
                    self.actions_path.display(),
                    err
                )))
            }
        }
        Ok(())
    }

    pub fn clear_all(&self) -> Result<(), AppError> {
        for path in [&self.history_path, &self.snapshots_path, &self.actions_path] {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => {
                    return Err(AppError::SettingsWriteFailed(format!(
                        "Geçmiş dosyası silinemedi ({}): {}",
                        path.display(),
                        err
                    )))
                }
            }
        }
        Ok(())
    }
}

impl Default for AuditRepository {
    fn default() -> Self {
        Self::new()
    }
}

fn append_json_line<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let line = serde_json::to_string(value)
        .map_err(|e| AppError::SettingsWriteFailed(format!("Geçmiş serileştirilemedi: {}", e)))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| AppError::SettingsWriteFailed(format!("Geçmiş dosyası açılamadı: {}", e)))?;
    writeln!(file, "{}", line)
        .map_err(|e| AppError::SettingsWriteFailed(format!("Geçmiş yazılamadı: {}", e)))?;
    Ok(())
}

fn read_json_lines<T: for<'de> Deserialize<'de>>(path: &Path, limit: usize) -> Vec<T> {
    let Ok(file) = fs::File::open(path) else {
        return Vec::new();
    };
    let reader = BufReader::new(file);
    let mut out: Vec<T> = Vec::new();
    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<T>(trimmed) {
            out.push(value);
        }
    }
    if out.len() > limit {
        out.split_off(out.len() - limit)
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> (tempfile::TempDir, AuditRepository) {
        let dir = tempfile::tempdir().unwrap();
        let repo = AuditRepository::with_paths(
            dir.path().join("history.jsonl"),
            dir.path().join("snapshots.jsonl"),
        );
        (dir, repo)
    }

    fn action(id: &str, success: bool, delta: i64) -> ActionAuditRecord {
        ActionAuditRecord {
            id: id.to_string(),
            timestamp: "2026-01-01T00:00:00+00:00".to_string(),
            provider_id: "npm".to_string(),
            action_id: "npm-cache-clean".to_string(),
            label: "npm cache clean --force".to_string(),
            success,
            exit_code: if success { Some(0) } else { Some(1) },
            before_bytes: 1_000,
            after_bytes: 500,
            delta_bytes: delta,
            duration_ms: 42,
        }
    }

    #[test]
    fn action_records_round_trip_in_order() {
        let (_dir, repo) = repo();
        repo.append_action(&action("a-1", true, 500)).unwrap();
        repo.append_action(&action("a-2", false, -500)).unwrap();

        let list = repo.list_actions(10);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "a-1");
        assert_eq!(list[1].id, "a-2");
        assert!(list[0].success);
        assert!(!list[1].success);
        // Negative deltas (cache grew because of a re-download) are preserved.
        assert_eq!(list[1].delta_bytes, -500);
    }

    #[test]
    fn action_list_is_limited_to_the_newest_records() {
        let (_dir, repo) = repo();
        for i in 0..5 {
            repo.append_action(&action(&format!("a-{i}"), true, 0)).unwrap();
        }
        let list = repo.list_actions(2);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "a-3");
        assert_eq!(list[1].id, "a-4");
    }

    #[test]
    fn action_history_is_separate_from_cleanup_history() {
        let (_dir, repo) = repo();
        repo.append_action(&action("a-1", true, 0)).unwrap();
        assert!(repo.list_records(10).is_empty());
        assert_eq!(repo.list_actions(10).len(), 1);
    }

    #[test]
    fn clear_all_removes_every_record_file_and_is_idempotent() {
        let (_dir, repo) = repo();
        repo.append_action(&action("a-1", true, 0)).unwrap();
        repo.append_snapshots(&[StorageSnapshot {
            timestamp: "2026-01-01T00:00:00+00:00".to_string(),
            provider: "npm".to_string(),
            category: "package-cache".to_string(),
            bytes: 100,
            item_count: 1,
        }])
        .unwrap();

        repo.clear_all().unwrap();
        assert!(repo.list_actions(10).is_empty());
        assert!(repo.list_snapshots(10).is_empty());
        // Clearing an already-empty repository is not an error.
        repo.clear_all().unwrap();
    }
}
