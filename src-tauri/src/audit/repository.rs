//! Persistent audit history backed by SQLite.
//!
//! Until 2.2.2 the history lived in three append-only JSONL files
//! (`history.jsonl`, `snapshots.jsonl`, `actions.jsonl`). Appending was cheap
//! but every read parsed the whole tail, lifetime totals streamed the entire
//! file, and the only growth control was rewriting 50,000 lines whenever a file
//! crossed 32 MiB. This module keeps the same public API on top of one SQLite
//! database:
//!
//! - `cleanup_runs`   — one row per executed cleanup plan (`entries` is JSON);
//! - `storage_snapshots` — per-category bytes captured after each scan;
//! - `action_runs`    — one row per official CLI tool action;
//! - legacy JSONL files are imported once (`PRAGMA user_version`), then renamed
//!   to `*.bak` so the import can never run twice and the user keeps a copy.
//!
//! Reads still fail soft (empty list) because they feed the UI, while writes
//! report errors so a failed audit entry is never silently lost.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::cleanup::DeleteMode;
use crate::error::AppError;

/// Schema version written to `PRAGMA user_version`.
const SCHEMA_VERSION: i32 = 1;

/// Rows kept per table after a prune. The JSONL history rotated at this count,
/// so the observable history depth does not change.
const MAX_HISTORY_LINES: i64 = 50_000;

/// Upper bound for any single history read.
///
/// Keeps a caller-supplied limit (MCP, CLI `--limit`, a future IPC command)
/// from materialising the whole table, and keeps the value inside `i64` so a
/// negative SQLite `LIMIT` (which means "unlimited") is unreachable.
const MAX_QUERY_LIMIT: usize = 1_000;

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub target_id: String,
    pub rule_id: String,
    pub path: String,
    pub success: bool,
    pub verified: bool,
    pub error_code: Option<String>,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub bytes: u64,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditRecord {
    pub id: String,
    pub timestamp: String,
    pub session_id: String,
    pub plan_id: String,
    pub mode: DeleteMode,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub success_count: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub error_count: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub reclaim_bytes: u64,
    /// Older history records predate this field; default instead of dropping
    /// the whole record from totals.
    #[serde(default)]
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub moved_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub duration_ms: u64,
    pub entries: Vec<AuditEntry>,
    /// True when the user cancelled before every eligible item was processed.
    #[serde(default)]
    pub cancelled: bool,
    #[serde(default)]
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub processed_count: u64,
    #[serde(default)]
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub skipped_count: u64,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSnapshot {
    pub timestamp: String,
    pub provider: String,
    pub category: String,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub item_count: u64,
}

/// Audit record for an explicitly user-triggered official tool action (for
/// example `npm cache clean`). Kept separate from per-target cleanup history so
/// the two record types are never conflated.
#[cfg_attr(feature = "bindings", derive(specta::Type))]
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
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub before_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub after_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<i64>))]
    pub delta_bytes: i64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub duration_ms: u64,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupTotals {
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub reclaimed_bytes: u64,
    /// Bytes successfully moved to the Recycle Bin *or* permanently deleted.
    /// `reclaimed_bytes` only counts the permanent mode, so this is the number
    /// the UI uses for "lifetime cleaned" totals.
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub moved_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub runs: u64,
    /// Total official tool-action records, independent of the capped page.
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub action_runs: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub success_count: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub error_count: u64,
}

pub struct AuditRepository {
    db_path: PathBuf,
    legacy_history: PathBuf,
    legacy_snapshots: PathBuf,
    legacy_actions: PathBuf,
    /// One connection guarded by a mutex: `Connection` is `Send` but not `Sync`,
    /// and every command handler reaches the repository through `State<AppState>`.
    connection: Mutex<Option<Connection>>,
}

impl AuditRepository {
    pub fn new() -> Self {
        let base = std::env::var("APPDATA")
            .map(PathBuf::from)
            .or_else(|_| std::env::var("USERPROFILE").map(|p| PathBuf::from(p).join(".config")))
            .unwrap_or_else(|_| PathBuf::from("."));
        let dir = crate::platform::resolve_app_dir(&base);
        Self::from_dir(&dir)
    }

    /// Test and embedding constructor. The legacy JSONL paths only matter for
    /// the one-time import; the database lives next to them as `audit.sqlite3`.
    pub fn with_paths(history_path: PathBuf, snapshots_path: PathBuf) -> Self {
        let dir = history_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        let actions_path = dir.join("actions.jsonl");
        Self {
            db_path: dir.join("audit.sqlite3"),
            legacy_history: history_path,
            legacy_snapshots: snapshots_path,
            legacy_actions: actions_path,
            connection: Mutex::new(None),
        }
    }

    fn from_dir(dir: &Path) -> Self {
        Self::with_paths(dir.join("history.jsonl"), dir.join("snapshots.jsonl"))
    }

    /// Runs `f` against the open connection, opening (and migrating) it once.
    fn with_connection<T>(
        &self,
        f: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> rusqlite::Result<T> {
        let mut guard = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.is_none() {
            let connection = open_database(&self.db_path)?;
            migrate_legacy_jsonl(
                &connection,
                &self.legacy_history,
                &self.legacy_snapshots,
                &self.legacy_actions,
            );
            *guard = Some(connection);
        }
        // `guard` was initialised above when it was `None`; a poisoned mutex is
        // recovered instead of panicking (a panic in a Tauri command aborts the
        // request with no diagnostic). Report rather than `expect` so a future
        // refactor cannot turn this invariant into a user-visible crash.
        let Some(connection) = guard.as_ref() else {
            return Err(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_MISUSE),
                Some("audit database handle was not initialised".into()),
            ));
        };
        f(connection)
    }

    pub fn append_record(&self, record: &AuditRecord) -> Result<(), AppError> {
        let entries = serde_json::to_string(&record.entries).map_err(serialize_error)?;
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO cleanup_runs (
                    id, timestamp, session_id, plan_id, mode, success_count, error_count,
                    reclaim_bytes, moved_bytes, duration_ms, cancelled, processed_count,
                    skipped_count, entries
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                 ON CONFLICT(id) DO UPDATE SET entries = excluded.entries",
                params![
                    record.id,
                    record.timestamp,
                    record.session_id,
                    record.plan_id,
                    delete_mode_key(record.mode),
                    as_i64(record.success_count),
                    as_i64(record.error_count),
                    as_i64(record.reclaim_bytes),
                    as_i64(record.moved_bytes),
                    as_i64(record.duration_ms),
                    record.cancelled as i64,
                    as_i64(record.processed_count),
                    as_i64(record.skipped_count),
                    entries,
                ],
            )?;
            prune(connection, PruneTable::CleanupRuns)
        })
        .map_err(write_error)
    }

    /// Newest `limit` records, oldest first (the order the UI renders).
    ///
    /// The limit is clamped here, not only in the Tauri command: the MCP server
    /// passes a value that comes straight from a JSON-RPC client, and a
    /// `usize::MAX`-sized value became a negative `i64` in SQLite, where a
    /// negative `LIMIT` means "no limit" and returned the whole table.
    pub fn list_records(&self, limit: usize) -> Vec<AuditRecord> {
        if limit == 0 {
            return Vec::new();
        }
        let limit = limit.min(MAX_QUERY_LIMIT);
        let rows = self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, timestamp, session_id, plan_id, mode, success_count, error_count,
                        reclaim_bytes, moved_bytes, duration_ms, cancelled, processed_count,
                        skipped_count, entries
                 FROM cleanup_runs ORDER BY seq DESC LIMIT ?1",
            )?;
            let mapped = statement.query_map(params![limit as i64], |row| {
                Ok(AuditRecord {
                    id: row.get(0)?,
                    timestamp: row.get(1)?,
                    session_id: row.get(2)?,
                    plan_id: row.get(3)?,
                    mode: parse_delete_mode(&row.get::<_, String>(4)?),
                    success_count: as_u64(row.get(5)?),
                    error_count: as_u64(row.get(6)?),
                    reclaim_bytes: as_u64(row.get(7)?),
                    moved_bytes: as_u64(row.get(8)?),
                    duration_ms: as_u64(row.get(9)?),
                    cancelled: row.get::<_, i64>(10)? != 0,
                    processed_count: as_u64(row.get(11)?),
                    skipped_count: as_u64(row.get(12)?),
                    entries: parse_entries(&row.get::<_, String>(13)?),
                })
            })?;
            mapped.collect::<rusqlite::Result<Vec<_>>>()
        });
        match rows {
            Ok(mut records) => {
                records.reverse();
                records
            }
            Err(err) => {
                crate::logging::warn("could not read cleanup history", err);
                Vec::new()
            }
        }
    }

    /// Lifetime totals computed by the database, never from the capped page.
    pub fn cleanup_totals(&self) -> CleanupTotals {
        let totals = self.with_connection(|connection| {
            let (reclaimed, moved, success, errors, runs): (i64, i64, i64, i64, i64) = connection
                .query_row(
                "SELECT COALESCE(SUM(reclaim_bytes), 0), COALESCE(SUM(moved_bytes), 0),
                            COALESCE(SUM(success_count), 0), COALESCE(SUM(error_count), 0),
                            COUNT(*)
                     FROM cleanup_runs",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )?;
            let action_runs: i64 =
                connection.query_row("SELECT COUNT(*) FROM action_runs", [], |row| row.get(0))?;
            Ok(CleanupTotals {
                reclaimed_bytes: as_u64(reclaimed),
                moved_bytes: as_u64(moved),
                runs: as_u64(runs),
                action_runs: as_u64(action_runs),
                success_count: as_u64(success),
                error_count: as_u64(errors),
            })
        });
        match totals {
            Ok(totals) => totals,
            Err(err) => {
                crate::logging::warn("could not read cleanup totals", err);
                CleanupTotals::default()
            }
        }
    }

    pub fn append_snapshots(&self, snapshots: &[StorageSnapshot]) -> Result<(), AppError> {
        if snapshots.is_empty() {
            return Ok(());
        }
        self.with_connection(|connection| {
            let transaction = connection.unchecked_transaction()?;
            {
                let mut statement = transaction.prepare(
                    "INSERT INTO storage_snapshots (timestamp, provider, category, bytes, item_count)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                )?;
                for snapshot in snapshots {
                    statement.execute(params![
                        snapshot.timestamp,
                        snapshot.provider,
                        snapshot.category,
                        as_i64(snapshot.bytes),
                        as_i64(snapshot.item_count),
                    ])?;
                }
            }
            transaction.commit()?;
            prune(connection, PruneTable::StorageSnapshots)
        })
        .map_err(write_error)
    }

    pub fn list_snapshots(&self, limit: usize) -> Vec<StorageSnapshot> {
        if limit == 0 {
            return Vec::new();
        }
        // Same untrusted-limit rule as `list_records`: a `usize` that overflows
        // `i64` becomes a negative SQLite `LIMIT`, which means "no limit" and
        // would read the whole table.
        let limit = limit.min(MAX_QUERY_LIMIT);
        let rows = self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT timestamp, provider, category, bytes, item_count
                 FROM storage_snapshots ORDER BY seq DESC LIMIT ?1",
            )?;
            let mapped = statement.query_map(params![limit as i64], |row| {
                Ok(StorageSnapshot {
                    timestamp: row.get(0)?,
                    provider: row.get(1)?,
                    category: row.get(2)?,
                    bytes: as_u64(row.get(3)?),
                    item_count: as_u64(row.get(4)?),
                })
            })?;
            mapped.collect::<rusqlite::Result<Vec<_>>>()
        });
        match rows {
            Ok(mut snapshots) => {
                snapshots.reverse();
                snapshots
            }
            Err(err) => {
                crate::logging::warn("could not read storage snapshots", err);
                Vec::new()
            }
        }
    }

    pub fn append_action(&self, record: &ActionAuditRecord) -> Result<(), AppError> {
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO action_runs (
                    id, timestamp, provider_id, action_id, label, success, exit_code,
                    before_bytes, after_bytes, delta_bytes, duration_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                 ON CONFLICT(id) DO NOTHING",
                params![
                    record.id,
                    record.timestamp,
                    record.provider_id,
                    record.action_id,
                    record.label,
                    record.success as i64,
                    record.exit_code,
                    as_i64(record.before_bytes),
                    as_i64(record.after_bytes),
                    record.delta_bytes,
                    as_i64(record.duration_ms),
                ],
            )?;
            prune(connection, PruneTable::ActionRuns)
        })
        .map_err(write_error)
    }

    pub fn list_actions(&self, limit: usize) -> Vec<ActionAuditRecord> {
        if limit == 0 {
            return Vec::new();
        }
        // See `list_records`: the MCP surface is untrusted input, and a value
        // that overflows `i64` turns into a negative SQLite `LIMIT`.
        let limit = limit.min(MAX_QUERY_LIMIT);
        let rows = self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, timestamp, provider_id, action_id, label, success, exit_code,
                        before_bytes, after_bytes, delta_bytes, duration_ms
                 FROM action_runs ORDER BY seq DESC LIMIT ?1",
            )?;
            let mapped = statement.query_map(params![limit as i64], |row| {
                Ok(ActionAuditRecord {
                    id: row.get(0)?,
                    timestamp: row.get(1)?,
                    provider_id: row.get(2)?,
                    action_id: row.get(3)?,
                    label: row.get(4)?,
                    success: row.get::<_, i64>(5)? != 0,
                    exit_code: row.get(6)?,
                    before_bytes: as_u64(row.get(7)?),
                    after_bytes: as_u64(row.get(8)?),
                    delta_bytes: row.get(9)?,
                    duration_ms: as_u64(row.get(10)?),
                })
            })?;
            mapped.collect::<rusqlite::Result<Vec<_>>>()
        });
        match rows {
            Ok(mut actions) => {
                actions.reverse();
                actions
            }
            Err(err) => {
                crate::logging::warn("could not read action history", err);
                Vec::new()
            }
        }
    }

    /// Removes only cleanup history and storage snapshots, keeping action logs intact.
    pub fn clear_cleanups(&self) -> Result<(), AppError> {
        self.with_connection(|connection| {
            connection.execute("DELETE FROM cleanup_runs", [])?;
            connection.execute("DELETE FROM storage_snapshots", [])?;
            Ok(())
        })
        .map_err(write_error)?;
        let _ = remove_if_present(&self.legacy_history);
        let _ = remove_if_present(&self.legacy_snapshots);
        Ok(())
    }

    /// Removes only official CLI action logs, keeping cleanup and snapshot records intact.
    pub fn clear_actions(&self) -> Result<(), AppError> {
        self.with_connection(|connection| {
            connection.execute("DELETE FROM action_runs", [])?;
            Ok(())
        })
        .map_err(write_error)?;
        let _ = remove_if_present(&self.legacy_actions);
        Ok(())
    }

    /// Removes every persisted history/snapshot/action record. Clearing an
    /// already-empty repository succeeds.
    pub fn clear_all(&self) -> Result<(), AppError> {
        self.with_connection(|connection| {
            connection.execute("DELETE FROM cleanup_runs", [])?;
            connection.execute("DELETE FROM storage_snapshots", [])?;
            connection.execute("DELETE FROM action_runs", [])?;
            // Reclaim the file space now that the user asked for a reset.
            connection.execute_batch("VACUUM")?;
            Ok(())
        })
        .map_err(write_error)?;
        for path in [
            &self.legacy_history,
            &self.legacy_snapshots,
            &self.legacy_actions,
        ] {
            let _ = remove_if_present(path);
        }
        Ok(())
    }

    /// Deletes the database, its WAL/SHM sidecars, and the legacy JSONL files
    /// plus the `.bak` copies left by the one-time import.
    ///
    /// The rows are cleared first so a file that is still held open by another
    /// process cannot turn a reset into "nothing happened"; the deletion then
    /// reclaims the bytes. The cached connection is dropped first because
    /// Windows refuses to remove a SQLite file while a handle is open.
    pub fn reset(&self) -> Result<(), AppError> {
        self.clear_all()?;
        {
            let mut guard = self
                .connection
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *guard = None;
        }

        let mut paths = vec![
            self.db_path.clone(),
            sidecar(&self.db_path, "-wal"),
            sidecar(&self.db_path, "-shm"),
            self.legacy_history.clone(),
            self.legacy_snapshots.clone(),
            self.legacy_actions.clone(),
            sidecar(&self.legacy_history, ".bak"),
            sidecar(&self.legacy_snapshots, ".bak"),
            sidecar(&self.legacy_actions, ".bak"),
        ];
        // Duplicate paths are harmless, but sorting keeps the error report clean.
        paths.sort();
        paths.dedup();

        for path in paths {
            remove_if_present(&path).map_err(|err| {
                AppError::SettingsWriteFailed(format!(
                    "Failed to delete audit file {}: {err}",
                    path.display()
                ))
            })?;
        }
        Ok(())
    }
}

impl Default for AuditRepository {
    fn default() -> Self {
        Self::new()
    }
}

fn open_database(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    // A power loss or a disk fault can leave pages inconsistent. Without this
    // check the database opens "successfully" and every read fails soft, so the
    // user sees an empty history forever. Move the damaged file aside and start
    // clean; the original stays available as evidence.
    if path.exists() && !integrity_ok(path) {
        let backup = path.with_extension(format!("sqlite3.corrupt.{}", now_secs()));
        match fs::rename(path, &backup) {
            Ok(()) => crate::logging::info(&format!(
                "audit database failed the integrity check; archived to {}",
                backup.display()
            )),
            // If the file cannot be moved, continuing would fail every read
            // anyway; report and let the open below surface the real error.
            Err(err) => crate::logging::warn("could not archive the corrupt audit database", err),
        }
    }
    let connection = Connection::open(path)?;
    // one fsync per commit for crash safety on process kill (not power loss) is
    // the right trade for an audit log. 5s busy timeout covers two processes
    // appending at once (CLI + GUI).
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;
         PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS cleanup_runs (
             seq INTEGER PRIMARY KEY AUTOINCREMENT,
             id TEXT NOT NULL UNIQUE,
             timestamp TEXT NOT NULL,
             session_id TEXT NOT NULL,
             plan_id TEXT NOT NULL,
             mode TEXT NOT NULL,
             success_count INTEGER NOT NULL,
             error_count INTEGER NOT NULL,
             reclaim_bytes INTEGER NOT NULL,
             moved_bytes INTEGER NOT NULL,
             duration_ms INTEGER NOT NULL,
             cancelled INTEGER NOT NULL,
             processed_count INTEGER NOT NULL,
             skipped_count INTEGER NOT NULL,
             entries TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS storage_snapshots (
             seq INTEGER PRIMARY KEY AUTOINCREMENT,
             timestamp TEXT NOT NULL,
             provider TEXT NOT NULL,
             category TEXT NOT NULL,
             bytes INTEGER NOT NULL,
             item_count INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS action_runs (
             seq INTEGER PRIMARY KEY AUTOINCREMENT,
             id TEXT NOT NULL UNIQUE,
             timestamp TEXT NOT NULL,
             provider_id TEXT NOT NULL,
             action_id TEXT NOT NULL,
             label TEXT NOT NULL,
             success INTEGER NOT NULL,
             exit_code INTEGER,
             before_bytes INTEGER NOT NULL,
             after_bytes INTEGER NOT NULL,
             delta_bytes INTEGER NOT NULL,
             duration_ms INTEGER NOT NULL
         );",
    )?;
    Ok(connection)
}

/// Imports the pre-2.2.2 JSONL files exactly once.
///
/// The `user_version` bump happens in the same transaction as the inserts, so a
/// crash either imports everything or nothing. After a successful commit the
/// legacy files are renamed to `*.bak`: the user keeps their data and a
/// re-import (for example from a restored backup) cannot duplicate rows.
fn migrate_legacy_jsonl(connection: &Connection, history: &Path, snapshots: &Path, actions: &Path) {
    let version: i32 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap_or(0);
    if version >= SCHEMA_VERSION {
        return;
    }

    let history_records: Vec<AuditRecord> = read_jsonl(history);
    let snapshot_records: Vec<StorageSnapshot> = read_jsonl(snapshots);
    let action_records: Vec<ActionAuditRecord> = read_jsonl(actions);

    let import = || -> rusqlite::Result<()> {
        let transaction = connection.unchecked_transaction()?;
        for record in &history_records {
            let entries = serde_json::to_string(&record.entries).unwrap_or_else(|_| "[]".into());
            transaction.execute(
                "INSERT OR IGNORE INTO cleanup_runs (
                    id, timestamp, session_id, plan_id, mode, success_count, error_count,
                    reclaim_bytes, moved_bytes, duration_ms, cancelled, processed_count,
                    skipped_count, entries
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    record.id,
                    record.timestamp,
                    record.session_id,
                    record.plan_id,
                    delete_mode_key(record.mode),
                    as_i64(record.success_count),
                    as_i64(record.error_count),
                    as_i64(record.reclaim_bytes),
                    as_i64(record.moved_bytes),
                    as_i64(record.duration_ms),
                    record.cancelled as i64,
                    as_i64(record.processed_count),
                    as_i64(record.skipped_count),
                    entries,
                ],
            )?;
        }
        for snapshot in &snapshot_records {
            transaction.execute(
                "INSERT INTO storage_snapshots (timestamp, provider, category, bytes, item_count)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    snapshot.timestamp,
                    snapshot.provider,
                    snapshot.category,
                    as_i64(snapshot.bytes),
                    as_i64(snapshot.item_count),
                ],
            )?;
        }
        for record in &action_records {
            transaction.execute(
                "INSERT OR IGNORE INTO action_runs (
                    id, timestamp, provider_id, action_id, label, success, exit_code,
                    before_bytes, after_bytes, delta_bytes, duration_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    record.id,
                    record.timestamp,
                    record.provider_id,
                    record.action_id,
                    record.label,
                    record.success as i64,
                    record.exit_code,
                    as_i64(record.before_bytes),
                    as_i64(record.after_bytes),
                    record.delta_bytes,
                    as_i64(record.duration_ms),
                ],
            )?;
        }
        transaction.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))?;
        transaction.commit()
    };

    if let Err(err) = import() {
        // Leave the JSONL files untouched: the next launch retries the import.
        crate::logging::warn("audit history migration failed, will retry", err);
        return;
    }

    for path in [history, snapshots, actions] {
        if path.exists() {
            let backup = path.with_extension("jsonl.bak");
            if let Err(err) = fs::rename(path, &backup) {
                // The import is committed and guarded by user_version, so a
                // failed rename only costs the redundant copy.
                crate::logging::warn(&format!("could not archive {}", path.display()), err);
            }
        }
    }
}

fn read_jsonl<T: for<'de> Deserialize<'de>>(path: &Path) -> Vec<T> {
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|line| serde_json::from_str::<T>(line.trim()).ok())
        .collect()
}

/// Tables the retention job may prune. An enum instead of a `&str` because the
/// name is interpolated into the statement: a caller that ever passes a value
/// from config could otherwise turn retention into SQL injection. Every variant
/// below is also a real table created by `migrate`.
#[derive(Clone, Copy, Debug)]
enum PruneTable {
    CleanupRuns,
    StorageSnapshots,
    ActionRuns,
}

impl PruneTable {
    fn as_str(self) -> &'static str {
        match self {
            PruneTable::CleanupRuns => "cleanup_runs",
            PruneTable::StorageSnapshots => "storage_snapshots",
            PruneTable::ActionRuns => "action_runs",
        }
    }
}

fn prune(connection: &Connection, table: PruneTable) -> rusqlite::Result<()> {
    let table = table.as_str();
    connection.execute(
        &format!("DELETE FROM {table} WHERE seq <= (SELECT MAX(seq) FROM {table}) - ?1"),
        params![MAX_HISTORY_LINES],
    )?;
    Ok(())
}

fn remove_if_present(path: &Path) -> std::io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

/// Builds a sibling path by appending a suffix to the full file name. Using
/// `Path::with_extension` would turn `audit.sqlite3` into `audit-wal`, which is
/// not the name SQLite writes.
fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

fn delete_mode_key(mode: DeleteMode) -> &'static str {
    match mode {
        DeleteMode::RecycleBin => "recycleBin",
        DeleteMode::Permanent => "permanent",
    }
}

fn parse_delete_mode(value: &str) -> DeleteMode {
    match value {
        "permanent" => DeleteMode::Permanent,
        _ => DeleteMode::RecycleBin,
    }
}

/// Parses the JSON entry list of one history row.
///
/// A corrupt `entries` column used to become an empty list silently, so the row
/// read "3.2 GB reclaimed, 0 targets" with no trace anywhere. The per-row
/// totals still come from their own columns, so the record is kept; only the
/// detail is lost, and the failure is written to the support log.
fn parse_entries(raw: &str) -> Vec<AuditEntry> {
    match serde_json::from_str::<Vec<AuditEntry>>(raw) {
        Ok(entries) => entries,
        Err(err) => {
            crate::logging::warn("audit entry list is corrupt", err);
            Vec::new()
        }
    }
}

/// SQLite has no unsigned integers; values are clamped to `i64::MAX`.
fn as_i64(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}

/// Cheap structural check used before trusting an existing database file.
/// `quick_check` skips the expensive index cross-verification `integrity_check`
/// performs while still catching corrupt pages and broken btrees.
fn integrity_ok(path: &Path) -> bool {
    let Ok(connection) = Connection::open(path) else {
        return false;
    };
    connection
        .query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))
        .map(|result| result == "ok")
        .unwrap_or(false)
}

/// Seconds since the Unix epoch, used to name an archived corrupt database.
fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn as_u64(value: i64) -> u64 {
    value.max(0) as u64
}

fn serialize_error(err: serde_json::Error) -> AppError {
    AppError::SettingsWriteFailed(format!("Failed to serialize audit record: {err}"))
}

fn write_error(err: rusqlite::Error) -> AppError {
    AppError::SettingsWriteFailed(format!("Failed to write audit record: {err}"))
}

/// Used by tests to prove the legacy import only runs once.
#[cfg(test)]
fn schema_version(repo: &AuditRepository) -> Option<i32> {
    use rusqlite::OptionalExtension;
    repo.with_connection(|connection| {
        connection.query_row("PRAGMA user_version", [], |row| row.get(0))
    })
    .optional()
    .ok()
    .flatten()
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

    fn record(id: &str, reclaim: u64, moved: u64) -> AuditRecord {
        AuditRecord {
            id: id.to_string(),
            timestamp: "2026-01-01T00:00:00+00:00".to_string(),
            session_id: "s".to_string(),
            plan_id: "p".to_string(),
            mode: DeleteMode::Permanent,
            success_count: 2,
            error_count: 1,
            reclaim_bytes: reclaim,
            moved_bytes: moved,
            duration_ms: 7,
            entries: vec![AuditEntry {
                target_id: "t".to_string(),
                rule_id: "js.node_modules".to_string(),
                path: "C:\\proj\\node_modules".to_string(),
                success: true,
                verified: true,
                error_code: None,
                bytes: reclaim,
            }],
            cancelled: false,
            processed_count: 3,
            skipped_count: 1,
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
            repo.append_action(&action(&format!("a-{i}"), true, 0))
                .unwrap();
        }
        let list = repo.list_actions(2);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "a-3");
        assert_eq!(list[1].id, "a-4");
    }

    #[test]
    fn an_unbounded_limit_cannot_read_more_than_the_cap() {
        let (_dir, repo) = repo();
        for i in 0..(MAX_QUERY_LIMIT + 5) {
            repo.append_action(&action(&format!("a-{i}"), true, 0))
                .unwrap();
        }
        // `usize::MAX` used to become `-1` in SQLite, where a negative `LIMIT`
        // means "no limit"; the MCP server passes the client value through.
        assert_eq!(repo.list_actions(usize::MAX).len(), MAX_QUERY_LIMIT);
        assert_eq!(repo.list_records(usize::MAX).len(), 0);
    }

    #[test]
    fn an_unbounded_snapshot_limit_cannot_read_more_than_the_cap() {
        let (_dir, repo) = repo();
        let snapshots: Vec<StorageSnapshot> = (0..(MAX_QUERY_LIMIT + 2))
            .map(|index| StorageSnapshot {
                timestamp: "2026-01-01T00:00:00+00:00".to_string(),
                provider: "npm".to_string(),
                category: "package-cache".to_string(),
                bytes: index as u64,
                item_count: 1,
            })
            .collect();
        repo.append_snapshots(&snapshots).unwrap();

        // Same negative-LIMIT trap as the other lists; this one was missed.
        assert_eq!(repo.list_snapshots(usize::MAX).len(), MAX_QUERY_LIMIT);
        // The newest rows are kept, not an arbitrary page.
        assert_eq!(
            repo.list_snapshots(1)[0].bytes,
            (MAX_QUERY_LIMIT + 1) as u64
        );
    }

    #[test]
    fn action_history_is_separate_from_cleanup_history() {
        let (_dir, repo) = repo();
        repo.append_action(&action("a-1", true, 0)).unwrap();
        assert!(repo.list_records(10).is_empty());
        assert_eq!(repo.list_actions(10).len(), 1);
    }

    #[test]
    fn clear_all_removes_every_record_and_is_idempotent() {
        let (_dir, repo) = repo();
        repo.append_action(&action("a-1", true, 0)).unwrap();
        repo.append_record(&record("r-1", 10, 10)).unwrap();
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
        assert!(repo.list_records(10).is_empty());
        assert!(repo.list_snapshots(10).is_empty());
        // Clearing an already-empty repository is not an error.
        repo.clear_all().unwrap();
    }

    #[test]
    fn clearing_cleanups_keeps_action_history() {
        let (_dir, repo) = repo();
        repo.append_action(&action("a-1", true, 0)).unwrap();
        repo.append_record(&record("r-1", 10, 10)).unwrap();

        repo.clear_cleanups().unwrap();

        assert!(repo.list_records(10).is_empty());
        assert_eq!(repo.list_actions(10).len(), 1);
    }

    #[test]
    fn clearing_actions_keeps_cleanup_history() {
        let (_dir, repo) = repo();
        repo.append_action(&action("a-1", true, 0)).unwrap();
        repo.append_record(&record("r-1", 10, 10)).unwrap();

        repo.clear_actions().unwrap();

        assert!(repo.list_actions(10).is_empty());
        assert_eq!(repo.list_records(10).len(), 1);
    }

    #[test]
    fn totals_sum_every_record_not_just_the_requested_page() {
        let (_dir, repo) = repo();
        repo.append_record(&record("r-1", 100, 200)).unwrap();
        repo.append_record(&record("r-2", 50, 75)).unwrap();
        repo.append_action(&action("a-1", true, 0)).unwrap();

        // `list_records(1)` only sees one row; totals must still see both.
        assert_eq!(repo.list_records(1).len(), 1);
        let totals = repo.cleanup_totals();
        assert_eq!(totals.reclaimed_bytes, 150);
        assert_eq!(totals.moved_bytes, 275);
        assert_eq!(totals.runs, 2);
        assert_eq!(totals.success_count, 4);
        assert_eq!(totals.error_count, 2);
        assert_eq!(totals.action_runs, 1);
    }

    #[test]
    fn appending_the_same_record_id_twice_does_not_duplicate_totals() {
        let (_dir, repo) = repo();
        repo.append_record(&record("r-1", 100, 100)).unwrap();
        repo.append_record(&record("r-1", 100, 100)).unwrap();

        assert_eq!(repo.cleanup_totals().runs, 1);
    }

    #[test]
    fn legacy_jsonl_history_is_imported_once_and_archived() {
        let dir = tempfile::tempdir().unwrap();
        let history = dir.path().join("history.jsonl");
        let body = serde_json::to_string(&record("r-legacy", 400, 400)).unwrap();
        fs::write(&history, format!("{body}\nnot-json\n")).unwrap();

        let repo = AuditRepository::with_paths(history.clone(), dir.path().join("snapshots.jsonl"));
        let imported = repo.list_records(10);
        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0].id, "r-legacy");

        // Re-opening the same directory must not duplicate the imported row.
        let reopened =
            AuditRepository::with_paths(history.clone(), dir.path().join("snapshots.jsonl"));
        assert_eq!(reopened.cleanup_totals().runs, 1);
        assert_eq!(schema_version(&reopened), Some(SCHEMA_VERSION));
        assert!(!history.exists(), "the imported file must be archived");
        assert!(dir.path().join("history.jsonl.bak").exists());
    }

    #[test]
    fn malformed_legacy_lines_are_skipped_without_failing_the_import() {
        let dir = tempfile::tempdir().unwrap();
        let history = dir.path().join("history.jsonl");
        fs::write(&history, "{bad}\n\n").unwrap();

        let repo = AuditRepository::with_paths(history, dir.path().join("snapshots.jsonl"));

        assert!(repo.list_records(10).is_empty());
        assert_eq!(schema_version(&repo), Some(SCHEMA_VERSION));
    }

    #[test]
    fn retention_keeps_the_newest_rows() {
        let (_dir, repo) = repo();
        repo.with_connection(|connection| {
            let transaction = connection.unchecked_transaction()?;
            {
                let mut statement = transaction.prepare(
                    "INSERT INTO action_runs (
                        id, timestamp, provider_id, action_id, label, success, exit_code,
                        before_bytes, after_bytes, delta_bytes, duration_ms
                     ) VALUES (?1, '2026-01-01T00:00:00+00:00', 'npm', 'x', 'x', 1, 0, 0, 0, 0, 0)",
                )?;
                for index in 0..(MAX_HISTORY_LINES + 25) {
                    statement.execute(params![format!("bulk-{index}")])?;
                }
            }
            transaction.commit()
        })
        .unwrap();

        repo.with_connection(|connection| prune(connection, PruneTable::ActionRuns))
            .unwrap();

        let ids: Vec<String> = repo
            .list_actions(2)
            .into_iter()
            .map(|record| record.id)
            .collect();
        assert_eq!(ids, vec!["bulk-50023", "bulk-50024"]);
        let count = repo
            .with_connection(|connection| {
                connection.query_row("SELECT COUNT(*) FROM action_runs", [], |row| {
                    row.get::<_, i64>(0)
                })
            })
            .unwrap();
        assert_eq!(count, MAX_HISTORY_LINES);
    }

    #[test]
    fn reset_deletes_database_sidecars_and_legacy_backups() {
        let dir = tempfile::tempdir().unwrap();
        let repo = AuditRepository::with_paths(
            dir.path().join("history.jsonl"),
            dir.path().join("snapshots.jsonl"),
        );
        repo.append_action(&action("a-reset", true, 500)).unwrap();
        // Simulate the archive left by the one-time JSONL import and an
        // interrupted snapshot save: both must disappear with the reset.
        fs::write(dir.path().join("history.jsonl.bak"), "{}").unwrap();
        fs::write(dir.path().join("snapshots.jsonl.bak"), "{}").unwrap();

        repo.reset().expect("reset succeeds");

        assert!(!dir.path().join("audit.sqlite3").exists());
        assert!(!dir.path().join("audit.sqlite3-wal").exists());
        assert!(!dir.path().join("audit.sqlite3-shm").exists());
        assert!(!dir.path().join("history.jsonl.bak").exists());
        assert!(!dir.path().join("snapshots.jsonl.bak").exists());
        assert!(repo.list_actions(10).is_empty());
    }
}
