use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Instant;

use tokio::task::JoinSet;
use walkdir::WalkDir;

use crate::catalog::TargetKind;
use crate::platform::{facts, FileIdentity};
use crate::scanner::cancellation::CancellationToken;
use crate::scanner::models::{ItemStatus, MeasurementUpdate, ScanProgress};

#[cfg(windows)]
fn entry_is_reparse_point(entry: &walkdir::DirEntry) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
    const FILE_ATTRIBUTE_OFFLINE: u32 = 0x1000;
    const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x0004_0000;
    const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;
    if let Ok(meta) = entry.metadata() {
        let attrs = meta.file_attributes();
        if (attrs
            & (FILE_ATTRIBUTE_REPARSE_POINT
                | FILE_ATTRIBUTE_OFFLINE
                | FILE_ATTRIBUTE_RECALL_ON_OPEN
                | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS))
            == 0
        {
            return false;
        }
    }
    crate::platform::is_reparse_point(entry.path())
}

#[cfg(not(windows))]
fn entry_is_reparse_point(entry: &walkdir::DirEntry) -> bool {
    crate::platform::is_reparse_point(entry.path())
}

#[derive(Debug, Clone, Default)]
pub struct PathSize {
    pub logical_bytes: u64,
    pub allocated_bytes: Option<u64>,
    pub file_count: u64,
    pub hardlink_dedup_bytes: u64,
}

/// Result of a measurement pass. A cancelled or timed-out pass never reports
/// itself as a complete measurement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeasurementStop {
    Completed,
    Cancelled,
    TimedOut,
}

impl MeasurementStop {
    pub fn code(self) -> Option<&'static str> {
        match self {
            MeasurementStop::Completed => None,
            MeasurementStop::Cancelled => Some("cancelled"),
            MeasurementStop::TimedOut => Some("timeout"),
        }
    }
}

fn past_deadline(deadline: Option<Instant>) -> bool {
    deadline.map(|d| Instant::now() >= d).unwrap_or(false)
}

pub fn measure_path(path: &Path, kind: TargetKind, token: &CancellationToken) -> Option<PathSize> {
    measure_path_with_deadline(path, kind, token, None)
}

/// Measures a file or directory. Returns `None` when the path disappeared, the
/// walk could not be completed, the scan was cancelled, or the deadline passed.
/// Partial sizes are never reported as complete measurements.
pub fn measure_path_with_deadline(
    path: &Path,
    kind: TargetKind,
    token: &CancellationToken,
    deadline: Option<Instant>,
) -> Option<PathSize> {
    let workers = std::thread::available_parallelism()
        .map(|n| n.get().clamp(2, 4))
        .unwrap_or(2);
    measure_path_inner(path, kind, token, deadline, workers)
}

fn measure_path_inner(
    path: &Path,
    kind: TargetKind,
    token: &CancellationToken,
    deadline: Option<Instant>,
    max_workers: usize,
) -> Option<PathSize> {
    if !path.exists() {
        return None;
    }
    if token.is_cancelled() || past_deadline(deadline) {
        return None;
    }
    // Reparse points (junctions, symlinks, cloud placeholders) can resolve to
    // a different location and must never be measured as if they were the
    // selected object.
    if crate::platform::is_reparse_point(path) {
        return None;
    }
    if kind != TargetKind::Directory {
        let f = facts(path)?;
        if token.is_cancelled() || past_deadline(deadline) {
            return None;
        }
        return Some(PathSize {
            logical_bytes: f.logical_bytes,
            allocated_bytes: Some(f.allocated_bytes),
            file_count: 1,
            hardlink_dedup_bytes: 0,
        });
    }

    // Fast path on Windows NTFS/ReFS: batch-enumerate directories with
    // `GetFileInformationByHandleEx(FileIdBothDirectoryInfo)` so files are
    // measured and hardlink-deduplicated without opening a handle per file.
    #[cfg(windows)]
    {
        use crate::platform::windows::fast_walk::{measure_dir_fast, FastMeasureError};
        match measure_dir_fast(path, token, deadline, max_workers) {
            Ok(size) => return Some(size),
            Err(FastMeasureError::CancelledOrExpired) => return None,
            Err(FastMeasureError::Unsupported) => {
                // Fall back to portable WalkDir + facts on filesystems that do
                // not implement FileIdBothDirectoryInfo (e.g. FAT32/network).
            }
        }
    }
    #[cfg(not(windows))]
    let _ = max_workers;

    let mut logical: u64 = 0;
    let mut allocated: u64 = 0;
    let mut files: u64 = 0;
    let mut dedup: u64 = 0;
    let mut all_known = true;
    let mut seen: HashSet<FileIdentity> = HashSet::new();

    let walker = WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            e.depth() == 0 || (!e.file_type().is_symlink() && !entry_is_reparse_point(e))
        });

    for entry in walker {
        if token.is_cancelled() || past_deadline(deadline) {
            return None;
        }
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        files += 1;

        match facts(entry.path()) {
            Some(f) => {
                logical = logical.saturating_add(f.logical_bytes);
                if f.link_count > 1 && !seen.insert(f.identity) {
                    dedup = dedup.saturating_add(f.allocated_bytes);
                    continue;
                }
                allocated = allocated.saturating_add(f.allocated_bytes);
            }
            None => {
                all_known = false;
                if let Ok(meta) = entry.metadata() {
                    logical = logical.saturating_add(meta.len());
                }
            }
        }
    }

    if token.is_cancelled() || past_deadline(deadline) {
        return None;
    }

    Some(PathSize {
        logical_bytes: logical,
        allocated_bytes: if all_known { Some(allocated) } else { None },
        file_count: files,
        hardlink_dedup_bytes: dedup,
    })
}

pub struct MeasurementEngine {
    cancellation_token: CancellationToken,
    concurrency_limit: usize,
    deadline: Option<Instant>,
}

impl MeasurementEngine {
    pub fn new(cancellation_token: CancellationToken) -> Self {
        let cpu_count = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        let concurrency = (cpu_count * 2).clamp(4, 32);
        Self {
            cancellation_token,
            concurrency_limit: concurrency,
            deadline: None,
        }
    }

    pub fn with_concurrency(mut self, limit: usize) -> Self {
        self.concurrency_limit = limit.max(1);
        self
    }

    /// Bounds measurement by the same wall-clock deadline the discovery phase
    /// uses, so a huge candidate set cannot extend a scan indefinitely.
    pub fn with_deadline(mut self, deadline: Instant) -> Self {
        self.deadline = Some(deadline);
        self
    }

    /// Both callbacks are `async` on purpose: they forward into the scan event
    /// queue, which is bounded. A synchronous `try_send` would silently drop a
    /// batch when the WebView stalls (rows would never get their measured
    /// size); awaiting the send applies backpressure to the measurement loop
    /// instead, so the queue - not memory - absorbs a slow consumer.
    pub async fn measure_entries<M, MF, P, PF>(
        &self,
        entries: Vec<(String, PathBuf, TargetKind)>,
        total_discovered: u64,
        directories_visited: u64,
        mut on_measured: M,
        mut on_progress: P,
    ) -> MeasurementStop
    where
        M: FnMut(Vec<MeasurementUpdate>) -> MF,
        MF: std::future::Future<Output = ()>,
        P: FnMut(ScanProgress) -> PF,
        PF: std::future::Future<Output = ()>,
    {
        let token = self.cancellation_token.clone();
        let total = entries.len() as u64;
        let deadline = self.deadline;
        let concurrency = self.concurrency_limit.max(1);
        let mut stop = MeasurementStop::Completed;

        // Streaming bounded JoinSet: at most `concurrency` measurement tasks
        // exist in memory at any time, and there is no intermediate bounded
        // channel that could deadlock when `entries.len() > channel_cap`.
        let mut join_set: JoinSet<Option<MeasurementUpdate>> = JoinSet::new();
        let mut pending = entries.into_iter();

        let spawn_one = |set: &mut JoinSet<Option<MeasurementUpdate>>,
                         id: String,
                         path: PathBuf,
                         kind: TargetKind,
                         tok: CancellationToken| {
            set.spawn_blocking(move || {
                if tok.is_cancelled() || past_deadline(deadline) {
                    return None;
                }
                // MeasurementEngine already runs targets in parallel across
                // `concurrency` blocking tasks, so keep each target's fast walk
                // single-threaded to avoid nested thread oversubscription.
                let measured = measure_path_inner(&path, kind, &tok, deadline, 1);
                if tok.is_cancelled() || past_deadline(deadline) {
                    return None;
                }
                let update = match measured {
                    Some(size) => MeasurementUpdate {
                        id,
                        logical_bytes: size.logical_bytes,
                        allocated_bytes: size.allocated_bytes,
                        estimated_reclaim_bytes: size.allocated_bytes.unwrap_or(size.logical_bytes),
                        file_count: size.file_count,
                        hardlink_dedup_bytes: size.hardlink_dedup_bytes,
                        status: ItemStatus::Ready,
                        selectable: None,
                        auto_selectable: None,
                        warning_codes: None,
                    },
                    None => MeasurementUpdate {
                        id,
                        logical_bytes: 0,
                        allocated_bytes: None,
                        estimated_reclaim_bytes: 0,
                        file_count: 0,
                        hardlink_dedup_bytes: 0,
                        status: ItemStatus::Error,
                        selectable: Some(false),
                        auto_selectable: Some(false),
                        warning_codes: Some(vec!["NOT_MEASURED".to_string()]),
                    },
                };
                Some(update)
            });
        };

        for _ in 0..concurrency {
            if token.is_cancelled() {
                stop = MeasurementStop::Cancelled;
                break;
            }
            if past_deadline(deadline) {
                stop = MeasurementStop::TimedOut;
                break;
            }
            match pending.next() {
                Some((id, path, kind)) => spawn_one(&mut join_set, id, path, kind, token.clone()),
                None => break,
            }
        }

        let mut measured = 0u64;
        let mut bytes = 0u64;
        let mut buffer: Vec<MeasurementUpdate> = Vec::with_capacity(100);
        let mut last_progress = Instant::now();

        while let Some(joined) = join_set.join_next().await {
            if let Ok(Some(update)) = joined {
                measured += 1;
                bytes = bytes.saturating_add(update.estimated_reclaim_bytes);
                buffer.push(update);

                if buffer.len() >= 100 {
                    on_measured(std::mem::take(&mut buffer)).await;
                }
                if last_progress.elapsed().as_millis() >= 100 || measured == total {
                    on_progress(ScanProgress {
                        phase: "measuring".to_string(),
                        directories_visited,
                        entries_found: total_discovered,
                        entries_measured: measured,
                        bytes_measured: bytes,
                        current_path: None,
                        stop_reason: stop.code().map(|s| s.to_string()),
                    })
                    .await;
                    last_progress = Instant::now();
                }
            }

            if token.is_cancelled() {
                stop = MeasurementStop::Cancelled;
                join_set.abort_all();
                break;
            }
            if past_deadline(deadline) {
                stop = MeasurementStop::TimedOut;
                join_set.abort_all();
                break;
            }

            if let Some((id, path, kind)) = pending.next() {
                spawn_one(&mut join_set, id, path, kind, token.clone());
            }
        }

        if !buffer.is_empty() {
            on_measured(buffer).await;
        }
        if stop == MeasurementStop::Completed {
            if token.is_cancelled() {
                stop = MeasurementStop::Cancelled;
            } else if past_deadline(deadline) {
                stop = MeasurementStop::TimedOut;
            }
        }
        on_progress(ScanProgress {
            phase: "measuring".to_string(),
            directories_visited,
            entries_found: total_discovered,
            entries_measured: measured,
            bytes_measured: bytes,
            current_path: None,
            stop_reason: stop.code().map(|s| s.to_string()),
        })
        .await;
        stop
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn cancelled_measurement_is_not_reported_as_complete() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("node_modules");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.bin"), vec![b'x'; 64 * 1024]).unwrap();
        let token = CancellationToken::new();
        token.cancel();
        assert!(measure_path(&dir, TargetKind::Directory, &token).is_none());
    }

    #[test]
    fn expired_deadline_is_not_reported_as_complete() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("node_modules");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.bin"), vec![b'x'; 1024]).unwrap();
        let token = CancellationToken::new();
        let deadline = Instant::now() - Duration::from_secs(1);
        assert!(
            measure_path_with_deadline(&dir, TargetKind::Directory, &token, Some(deadline))
                .is_none()
        );
    }
}
