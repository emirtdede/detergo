pub mod cancellation;
pub mod discovery;
pub mod limits;
pub mod measurement;
pub mod models;
pub mod session;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::mpsc;

pub use cancellation::CancellationToken;
pub use discovery::{DiscoveryConfig, DiscoveryEngine};
pub mod notices;
pub use limits::{ScanLimits, StopReason};
pub use models::*;
pub use notices::{ScanNotice, ScanNoticeSeverity};
pub use session::{ScanRegistry, ScanSession};

use crate::audit::AuditRepository;
use crate::catalog::CatalogIndex;
use crate::error::AppError;
use crate::providers;

const BATCH_SIZE: usize = 100;

/// Depth of the queue between the scan threads and the event forwarder.
///
/// 256 events × `BATCH_SIZE` rows bounds the in-flight backlog to roughly
/// 25 600 rows. Enough to absorb a burst without stalling the walk, small
/// enough that a stalled WebView cannot double the scan's memory.
const EVENT_QUEUE_CAPACITY: usize = 256;

/// Builds measurement events for an agent-scan batch.
///
/// Only targets that were actually measured may produce an update. Turning a
/// missing size into `0` made an unreadable agent cache look like an empty
/// folder in the table and skewed provider totals; `None` must stay `None` so
/// the UI can show "Not measured" and keep the row blocked.
fn agent_measurement_updates(batch: &[CleanupItem]) -> Vec<MeasurementUpdate> {
    batch
        .iter()
        .filter_map(|item| {
            let logical_bytes = item.logical_bytes?;
            Some(MeasurementUpdate {
                id: item.id.clone(),
                logical_bytes,
                allocated_bytes: item.allocated_bytes,
                estimated_reclaim_bytes: item.estimated_reclaim_bytes.unwrap_or(logical_bytes),
                file_count: 0,
                hardlink_dedup_bytes: 0,
                status: item.status,
            })
        })
        .collect()
}

fn item_allocated(item: &CleanupItem) -> u64 {
    item.allocated_bytes
        .unwrap_or(item.logical_bytes.unwrap_or(0))
}

/// Bytes that belong to an item itself rather than to its nested children.
///
/// A parent target is measured recursively, so `.next` already contains
/// `.next/cache`. Summing every item double-counted those bytes in the summary
/// and in provider totals. Subtracting the direct children's allocated bytes
/// telescopes back to one unique total per tree while still letting a nested
/// child carry its own bytes when the parent is blocked.
fn own_bytes(items: &[CleanupItem]) -> HashMap<String, (u64, u64)> {
    let present: std::collections::HashSet<&str> = items.iter().map(|i| i.id.as_str()).collect();
    let mut child_logical: HashMap<&str, u64> = HashMap::new();
    let mut child_allocated: HashMap<&str, u64> = HashMap::new();
    for item in items {
        if let Some(parent) = item.parent_item_id.as_deref() {
            if present.contains(parent) {
                let logical = item.logical_bytes.unwrap_or(0);
                let allocated = item_allocated(item);
                let l = child_logical.entry(parent).or_insert(0);
                *l = l.saturating_add(logical);
                let a = child_allocated.entry(parent).or_insert(0);
                *a = a.saturating_add(allocated);
            }
        }
    }
    items
        .iter()
        .map(|item| {
            let logical = item
                .logical_bytes
                .unwrap_or(0)
                .saturating_sub(*child_logical.get(item.id.as_str()).unwrap_or(&0));
            let allocated = item_allocated(item)
                .saturating_sub(*child_allocated.get(item.id.as_str()).unwrap_or(&0));
            (item.id.clone(), (logical, allocated))
        })
        .collect()
}

fn provider_totals(items: &[CleanupItem], own: &HashMap<String, (u64, u64)>) -> Vec<ProviderTotal> {
    let mut map: HashMap<String, ProviderTotal> = HashMap::new();
    for item in items {
        let entry = map
            .entry(item.provider.clone())
            .or_insert_with(|| ProviderTotal {
                provider: item.provider.clone(),
                logical_bytes: 0,
                allocated_bytes: 0,
                item_count: 0,
                protected_bytes: 0,
            });
        // Nested children are already inside the parent's measurement; using
        // their own slice keeps provider cards from promising extra space.
        let (logical, allocated) = own.get(&item.id).copied().unwrap_or((0, 0));
        entry.item_count += 1;
        // A non-selectable target can never be cleaned, so it belongs on the
        // protected side of the ledger. Otherwise the cleanable total promises
        // space the user cannot reclaim.
        if item.protected || !item.selectable {
            entry.protected_bytes = entry.protected_bytes.saturating_add(allocated);
        } else {
            entry.logical_bytes = entry.logical_bytes.saturating_add(logical);
            entry.allocated_bytes = entry.allocated_bytes.saturating_add(allocated);
        }
    }
    let mut out: Vec<ProviderTotal> = map.into_values().collect();
    out.sort_by_key(|a| std::cmp::Reverse(a.allocated_bytes));
    out
}

/// Chooses the terminal event for a finished scan.
///
/// The old project branch emitted `Completed` for every stop reason except a
/// user cancel, so a timeout or candidate-limit scan was presented as complete
/// even though `summary.partial` was true. The frontend can only show the
/// partial banner when the stop is explicit, hence the dedicated `Partial`
/// event. Depth-limit stays `Completed` by design: it is a configured boundary,
/// not an interrupted walk.
fn terminal_event(summary: &ScanSummary) -> ScanEvent {
    if summary.stop_reason.as_deref() == Some(StopReason::Cancelled.code()) {
        ScanEvent::Cancelled {
            summary: summary.clone(),
        }
    } else if summary.partial {
        ScanEvent::Partial {
            summary: summary.clone(),
        }
    } else {
        ScanEvent::Completed {
            summary: summary.clone(),
        }
    }
}

/// Chooses the stop reason for a scan with more than one step.
///
/// A depth cut is a user-configured boundary, so any real interruption
/// (timeout, cancel, candidate limit) must replace it; it can never mask one.
/// Applying this consistently keeps `summary.partial` and the terminal event
/// honest for multi-root and combined scans.
fn merge_stop_reason(current: Option<StopReason>, next: Option<StopReason>) -> Option<StopReason> {
    match next {
        None => current,
        Some(next) if current.is_none() => Some(next),
        Some(next) if next != StopReason::DepthLimit => Some(next),
        Some(next) if current == Some(StopReason::DepthLimit) => Some(next),
        Some(_) => current,
    }
}

fn build_summary(
    request: &ScanRequest,
    scan_id: &str,
    items: &[CleanupItem],
    directories_visited: u64,
    duration_ms: u64,
    stop_reason: Option<StopReason>,
    sections: Vec<ScanSectionResult>,
) -> ScanSummary {
    let own = own_bytes(items);
    let total_logical: u64 = items
        .iter()
        .map(|i| own.get(&i.id).map(|(logical, _)| *logical).unwrap_or(0))
        .sum();
    let total_allocated: u64 = items
        .iter()
        .map(|i| own.get(&i.id).map(|(_, allocated)| *allocated).unwrap_or(0))
        .sum();
    let protected: u64 = items
        .iter()
        .filter(|i| i.protected || !i.selectable)
        .map(|i| own.get(&i.id).map(|(_, allocated)| *allocated).unwrap_or(0))
        .sum();
    let cleanable: u64 = items
        .iter()
        .filter(|i| !i.protected && i.selectable)
        .map(|i| own.get(&i.id).map(|(_, allocated)| *allocated).unwrap_or(0))
        .sum();
    let errors = items
        .iter()
        .filter(|i| i.status == ItemStatus::Error)
        .count() as u64;
    let warnings = items.iter().filter(|i| !i.warning_codes.is_empty()).count() as u64;

    // Only manifest-confirmed roots count as projects. Fallback records exist
    // so a stray `node_modules` still gets a label, but reporting 1,059 of them
    // as "projects" destroyed trust in the number.
    let mut detected_projects = std::collections::HashSet::new();
    for item in items {
        if item.project_detected {
            if let Some(id) = &item.project_id {
                detected_projects.insert(id.as_str());
            }
        }
    }

    ScanSummary {
        scan_id: scan_id.to_string(),
        root_path: request.root_path.clone(),
        scope: request.scope,
        total_entries: items.len() as u64,
        total_bytes: total_logical,
        total_allocated_bytes: total_allocated,
        protected_bytes: protected,
        cleanable_bytes: cleanable,
        duration_ms,
        errors_count: errors,
        warnings_count: warnings,
        directories_visited,
        // A depth cut is a user-configured boundary, not an interrupted scan:
        // the walk finished every branch it was asked to visit. Treating it as
        // partial produced a permanent warning banner and a "partial" history
        // entry for completely successful scans.
        partial: stop_reason
            .map(|reason| reason != StopReason::DepthLimit)
            .unwrap_or(false),
        stop_reason: stop_reason.map(|r| r.code().to_string()),
        provider_totals: provider_totals(items, &own),
        detected_project_count: Some(detected_projects.len() as u64),
        sections,
        // The channel is owned by the command layer; it stamps the real count.
        dropped_events: 0,
    }
}

pub async fn run_scan<F>(
    request: ScanRequest,
    session: Arc<std::sync::Mutex<ScanSession>>,
    token: CancellationToken,
    catalog: Arc<CatalogIndex>,
    policy: &crate::cleanup::CleanupPolicy,
    emit: F,
) -> Result<ScanSummary, AppError>
where
    F: Fn(ScanEvent) + Send + Sync + 'static,
{
    let started = Instant::now();
    let emit = Arc::new(emit);
    // Bounded on purpose: the walker runs on a blocking thread and produces
    // candidates faster than the WebView2 channel can drain them. With an
    // unbounded queue a suspended window (minimised, laptop asleep during a
    // full-disk scan) accumulated every batch — up to a second copy of the whole
    // result set. 256 events is ~25 600 items, and the producer now waits
    // instead of growing memory without limit.
    let (tx, mut rx) = mpsc::channel::<ScanEvent>(EVENT_QUEUE_CAPACITY);

    let forward_emit = emit.clone();
    let forwarder = tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            forward_emit(event);
        }
    });

    let scan_id = crate::lock!(session).id.clone();
    let _ = tx
        .send(ScanEvent::Started {
            scan_id: scan_id.clone(),
        })
        .await;

    let limits = ScanLimits {
        max_depth: request.max_depth.unwrap_or(limits::DEFAULT_MAX_DEPTH),
        max_candidates: request
            .max_candidates
            .unwrap_or(limits::DEFAULT_MAX_CANDIDATES),
        timeout: std::time::Duration::from_secs(
            request
                .timeout_minutes
                .unwrap_or(limits::DEFAULT_TIMEOUT_MINUTES)
                * 60,
        ),
        min_size_bytes: request.min_size_bytes.unwrap_or(0),
    };
    // Both discovery and measurement share one wall-clock deadline.
    let scan_deadline = started + limits.timeout;

    if request.scope == ScanScope::GlobalCaches {
        // This scope existed as a silent no-op: it returned a successful, empty
        // summary, which looked like "nothing to clean" instead of "the scanner
        // never looked". Global caches are handled by the dedicated caches page
        // (official actions) and by provider scans, so fail loudly instead.
        drop(tx);
        let _ = forwarder.await;
        return Err(AppError::PlatformUnsupported(
            "Global cache scanning is not supported; use the caches page or the agents scope."
                .to_string(),
        ));
    }

    // A combined scan runs the project walk (when a root is selected) and the
    // AI agent scan inside one session, so the UI has a single progress stream,
    // a single cancel and one result set.
    let combined = request.scope == ScanScope::Combined;

    if request.scope == ScanScope::Agents {
        let token_agents = token.clone();
        let policy_agents = policy.clone();
        let scan_id_agents = scan_id.clone();
        let exclusions_agents = request.exclusions.clone();
        let outcome = tokio::task::spawn_blocking(move || {
            providers::scan_agents(
                &scan_id_agents,
                &token_agents,
                &policy_agents,
                limits,
                &exclusions_agents,
            )
        })
        .await
        .map_err(|e| AppError::ScanFailed(format!("Agent scan failed: {}", e)))?;
        for warning in &outcome.warnings {
            let _ = tx
                .send(ScanEvent::Warning {
                    code: warning.0.clone(),
                    path: warning.1.clone(),
                    severity: notices::classify_agent(&warning.0, warning.1.as_deref()),
                    root: None,
                })
                .await;
        }
        let items = outcome.items;
        let targets = outcome.targets;

        {
            let mut guard = crate::lock!(session);
            for target in targets {
                guard.targets.insert(target.id.clone(), target);
            }
            guard.items = items.clone();
        }

        for batch in items.chunks(BATCH_SIZE) {
            let _ = tx
                .send(ScanEvent::Candidates {
                    items: batch.to_vec(),
                })
                .await;
            // Only emit measurement updates for targets that were actually
            // measured. See `agent_measurement_updates`.
            let updates = agent_measurement_updates(batch);
            if !updates.is_empty() {
                let _ = tx.send(ScanEvent::Measured { updates }).await;
            }
        }

        if policy.record_history && !outcome.snapshots.is_empty() {
            if let Err(err) = AuditRepository::new().append_snapshots(&outcome.snapshots) {
                // L11: history is optional, but silently dropping it hides a
                // full disk / corrupt database from the user. Surface it as a
                // scan warning instead of failing the scan.
                let _ = tx
                    .send(ScanEvent::Warning {
                        code: "HISTORY_WRITE_FAILED".to_string(),
                        path: Some(err.to_string()),
                        severity: ScanNoticeSeverity::Warning,
                        root: None,
                    })
                    .await;
            }
        }

        let stop = outcome.stop_reason.or_else(|| {
            if token.is_cancelled() {
                Some(StopReason::Cancelled)
            } else {
                None
            }
        });
        let summary = build_summary(
            &request,
            &scan_id,
            &items,
            outcome.entries_scanned,
            started.elapsed().as_millis() as u64,
            stop,
            Vec::new(),
        );
        crate::lock!(session).summary = Some(summary.clone());
        // The cleanup window starts when the scan finishes. Agents return
        // before the shared project path ran this refresh, so a long agent
        // scan could leave the session already expired when results appeared.
        crate::lock!(session).refresh_deadline();
        // A depth limit is not an interruption, so it is delivered as a
        // completed scan (partial=false). Timeout and candidate-limit stops are
        // emitted as `Partial`, never as `Completed`.
        let _ = tx.send(terminal_event(&summary)).await;
        drop(tx);
        let _ = forwarder.await;
        return Ok(summary);
    }

    // Project or full-disk scan --------------------------------------------
    let all_drives = request.scope == ScanScope::AllDrives;
    let project_root_missing = request.root_path.trim().is_empty();
    let scan_roots: Vec<PathBuf> = if all_drives {
        crate::platform::fixed_drive_roots()
            .into_iter()
            .map(PathBuf::from)
            .collect()
    } else if combined && project_root_missing {
        // "Scan everything" must still run the agent step when the user has
        // never picked a project folder. Blocking the whole action on a folder
        // dialog would hide the two scopes that do not need a root.
        Vec::new()
    } else {
        vec![PathBuf::from(&request.root_path)]
    };

    let mut sections: Vec<ScanSectionResult> = Vec::new();
    // True when the project step already reported skipped/failed above, so the
    // completed section is not appended on top of it.
    let mut project_step_recorded = false;

    let mut items: Vec<CleanupItem> = Vec::new();
    let mut targets: Vec<StoredTarget> = Vec::new();
    let mut warnings: Vec<ScanNotice> = Vec::new();
    let mut directories_visited = 0u64;
    let mut stop_reason: Option<StopReason> = None;

    if scan_roots.is_empty() {
        if combined {
            sections.push(ScanSectionResult {
                scope: ScanScope::Project,
                status: "skipped".to_string(),
                item_count: 0,
                cleanable_bytes: 0,
                error_code: Some("NO_ROOT".to_string()),
            });
            project_step_recorded = true;
        } else {
            drop(tx);
            let _ = forwarder.await;
            return Err(AppError::InvalidPath(
                "No local drives found to scan.".to_string(),
            ));
        }
    }
    for root in &scan_roots {
        if !root.exists() {
            if combined {
                // The project step failed, but the agent step can still run.
                warnings.push(ScanNotice {
                    code: "DRIVE_SCAN_FAILED".to_string(),
                    path: Some(root.to_string_lossy().to_string()),
                    severity: ScanNoticeSeverity::Error,
                    root: Some(root.to_string_lossy().to_string()),
                });
                sections.push(ScanSectionResult {
                    scope: ScanScope::Project,
                    status: "failed".to_string(),
                    item_count: 0,
                    cleanable_bytes: 0,
                    error_code: Some("PATH_NOT_FOUND".to_string()),
                });
                project_step_recorded = true;
                continue;
            }
            drop(tx);
            let _ = forwarder.await;
            return Err(AppError::PathNotFound(root.to_string_lossy().to_string()));
        }
    }

    for root in &scan_roots {
        if token.is_cancelled() {
            stop_reason = Some(StopReason::Cancelled);
            break;
        }
        if let Some(reason) = stop_reason {
            // A depth cut is per-branch/per-root; the remaining roots must
            // still be scanned. Only budget/cancel reasons abort the loop.
            if reason != StopReason::DepthLimit {
                break;
            }
        }
        if items.len() as u64 >= limits.max_candidates {
            stop_reason = Some(StopReason::CandidateLimit);
            break;
        }

        let root_for_discovery = root.clone();
        let exclusions = request.exclusions.clone();
        let protected_paths = request.protected_paths.clone();
        let session_id = scan_id.clone();
        let token_discovery = token.clone();
        let catalog_discovery = catalog.clone();
        let tx_discovery = tx.clone();

        let discovery_task = tokio::task::spawn_blocking(move || {
            let mut engine = DiscoveryEngine::new(&catalog_discovery, token_discovery, limits);
            engine.discover(
                DiscoveryConfig {
                    root: &root_for_discovery,
                    exclusions: &exclusions,
                    protected_paths: &protected_paths,
                    scan_session_id: &session_id,
                    limits,
                },
                |batch| {
                    let _ = tx_discovery.blocking_send(ScanEvent::Candidates {
                        items: batch.to_vec(),
                    });
                },
                |progress| {
                    let _ = tx_discovery.blocking_send(ScanEvent::Progress { progress });
                },
            )
        });

        let outcome = match discovery_task.await {
            Ok(Ok(outcome)) => outcome,
            // A single unreadable volume must not abort a full-disk scan. The
            // same applies to the project step of a combined scan: the agent
            // step is still worth running.
            Ok(Err(err)) if all_drives || combined => {
                warnings.push(ScanNotice {
                    code: "DRIVE_SCAN_FAILED".to_string(),
                    path: Some(format!("{}: {}", root.display(), err)),
                    severity: ScanNoticeSeverity::Error,
                    root: Some(root.to_string_lossy().to_string()),
                });
                if combined {
                    sections.push(ScanSectionResult {
                        scope: ScanScope::Project,
                        status: "failed".to_string(),
                        item_count: 0,
                        cleanable_bytes: 0,
                        error_code: Some("SCAN_FAILED".to_string()),
                    });
                    project_step_recorded = true;
                }
                continue;
            }
            Ok(Err(err)) => {
                drop(tx);
                let _ = forwarder.await;
                return Err(err);
            }
            Err(err) => {
                drop(tx);
                let _ = forwarder.await;
                return Err(AppError::ScanFailed(format!("Scan task failed: {}", err)));
            }
        };

        warnings.extend(outcome.warnings);
        directories_visited += outcome.directories_visited;
        // A depth cut is the weakest reason: a later timeout/cancel/candidate
        // limit must replace it and stop the remaining roots.
        stop_reason = merge_stop_reason(stop_reason, outcome.stop_reason);
        items.extend(outcome.items);
        targets.extend(outcome.targets);
    }

    for warning in &warnings {
        let _ = tx
            .send(ScanEvent::Warning {
                code: warning.code.clone(),
                path: warning.path.clone(),
                severity: warning.severity,
                root: warning.root.clone(),
            })
            .await;
    }

    {
        let mut guard = crate::lock!(session);
        for target in targets.drain(..) {
            guard.targets.insert(target.id.clone(), target);
        }
        guard.items = items.clone();
    }

    if stop_reason != Some(StopReason::Cancelled)
        && stop_reason != Some(StopReason::Timeout)
        && !token.is_cancelled()
    {
        let tasks: Vec<(String, PathBuf, crate::catalog::TargetKind)> = {
            let guard = crate::lock!(session);
            guard
                .targets
                .values()
                .map(|t| (t.id.clone(), t.path.clone(), t.kind))
                .collect()
        };

        let engine =
            measurement::MeasurementEngine::new(token.clone()).with_deadline(scan_deadline);
        let tx_measure = tx.clone();
        let tx_progress = tx.clone();
        let measured: Arc<std::sync::Mutex<HashMap<String, MeasurementUpdate>>> =
            Arc::new(std::sync::Mutex::new(HashMap::new()));
        let measured_writer = measured.clone();

        let measurement_stop = engine
            .measure_entries(
                tasks,
                items.len() as u64,
                directories_visited,
                move |updates| {
                    let sender = tx_measure.clone();
                    let writer = measured_writer.clone();
                    async move {
                        {
                            let mut map = crate::lock!(writer);
                            for update in &updates {
                                map.insert(update.id.clone(), update.clone());
                            }
                        }
                        let _ = sender.send(ScanEvent::Measured { updates }).await;
                    }
                },
                move |progress| {
                    let sender = tx_progress.clone();
                    async move {
                        let _ = sender.send(ScanEvent::Progress { progress }).await;
                    }
                },
            )
            .await;

        match measurement_stop {
            measurement::MeasurementStop::Cancelled => {
                stop_reason = Some(StopReason::Cancelled);
            }
            measurement::MeasurementStop::TimedOut => {
                if stop_reason.is_none() {
                    stop_reason = Some(StopReason::Timeout);
                }
            }
            measurement::MeasurementStop::Completed => {}
        }

        let map = crate::lock!(measured).clone();
        let mut guard = crate::lock!(session);
        for target in guard.targets.values_mut() {
            if let Some(update) = map.get(&target.id) {
                // M7: an unreadable target is "not measured", never 0 B.
                if update.status != ItemStatus::Error {
                    target.logical_bytes = Some(update.logical_bytes);
                    target.allocated_bytes = update.allocated_bytes;
                }
            }
        }
        for item in guard.items.iter_mut() {
            if let Some(update) = map.get(&item.id) {
                if update.status == ItemStatus::Error {
                    item.logical_bytes = None;
                    item.allocated_bytes = None;
                    item.estimated_reclaim_bytes = None;
                    item.status = ItemStatus::Error;
                    item.selectable = false;
                    if !item.warning_codes.iter().any(|code| code == "NOT_MEASURED") {
                        item.warning_codes.push("NOT_MEASURED".to_string());
                    }
                } else {
                    item.logical_bytes = Some(update.logical_bytes);
                    item.allocated_bytes = update.allocated_bytes;
                    item.estimated_reclaim_bytes = Some(update.estimated_reclaim_bytes);
                    if item.status == ItemStatus::Discovered {
                        item.status = ItemStatus::Ready;
                    }
                }
            }
        }
        // M1: the minimum item size is backend-owned and must apply to the
        // project scope too. Keeping sub-threshold rows "cleanable" made the
        // table (which filters them) disagree with the overview totals.
        if limits.min_size_bytes > 0 {
            for item in guard.items.iter_mut() {
                if item.status == ItemStatus::Blocked
                    || item.status == ItemStatus::Error
                    || item.status == ItemStatus::Deleted
                {
                    continue;
                }
                let measured = item
                    .estimated_reclaim_bytes
                    .or(item.allocated_bytes)
                    .or(item.logical_bytes);
                if measured.map(|bytes| bytes < limits.min_size_bytes) == Some(true) {
                    item.selectable = false;
                    item.status = ItemStatus::Blocked;
                    if !item
                        .warning_codes
                        .iter()
                        .any(|code| code == "BELOW_MIN_SIZE")
                    {
                        item.warning_codes.push("BELOW_MIN_SIZE".to_string());
                    }
                }
            }
        }
        items = guard.items.clone();
        if token.is_cancelled() {
            stop_reason = Some(StopReason::Cancelled);
        }
    } else if token.is_cancelled() {
        stop_reason = Some(StopReason::Cancelled);
    }

    // Record the project step of a combined scan before the agent step runs.
    if combined && !project_step_recorded {
        sections.push(ScanSectionResult {
            scope: ScanScope::Project,
            status: match stop_reason {
                Some(StopReason::Cancelled) => "partial",
                Some(StopReason::DepthLimit) => "completed",
                Some(_) => "partial",
                None => "completed",
            }
            .to_string(),
            item_count: items.len() as u64,
            cleanable_bytes: items
                .iter()
                .filter(|i| !i.protected && i.selectable)
                .map(|i| i.allocated_bytes.or(i.logical_bytes).unwrap_or(0))
                .sum(),
            error_code: None,
        });
    }

    // Combined scans append the AI agent step. It runs after the project walk
    // so a single progress stream and a single cancel token cover both, and a
    // failure here is recorded as one section instead of discarding projects.
    if combined && stop_reason != Some(StopReason::Cancelled) && !token.is_cancelled() {
        let token_agents = token.clone();
        let policy_agents = policy.clone();
        let scan_id_agents = scan_id.clone();
        let exclusions_agents = request.exclusions.clone();
        let agent_result = tokio::task::spawn_blocking(move || {
            providers::scan_agents(
                &scan_id_agents,
                &token_agents,
                &policy_agents,
                limits,
                &exclusions_agents,
            )
        })
        .await;

        match agent_result {
            Ok(outcome) => {
                for warning in &outcome.warnings {
                    let _ = tx
                        .send(ScanEvent::Warning {
                            code: warning.0.clone(),
                            path: warning.1.clone(),
                            severity: notices::classify_agent(&warning.0, warning.1.as_deref()),
                            root: None,
                        })
                        .await;
                }
                if policy.record_history && !outcome.snapshots.is_empty() {
                    if let Err(err) = AuditRepository::new().append_snapshots(&outcome.snapshots) {
                        let _ = tx
                            .send(ScanEvent::Warning {
                                code: "HISTORY_WRITE_FAILED".to_string(),
                                path: Some(err.to_string()),
                                severity: ScanNoticeSeverity::Warning,
                                root: None,
                            })
                            .await;
                    }
                }
                let agent_items = outcome.items;
                for batch in agent_items.chunks(BATCH_SIZE) {
                    let _ = tx
                        .send(ScanEvent::Candidates {
                            items: batch.to_vec(),
                        })
                        .await;
                    let updates = agent_measurement_updates(batch);
                    if !updates.is_empty() {
                        let _ = tx.send(ScanEvent::Measured { updates }).await;
                    }
                }
                // A target found by both steps must appear once: the project
                // walk wins because it carries the project/workspace context.
                let existing: std::collections::HashSet<String> = items
                    .iter()
                    .map(|item| item.display_path.to_lowercase())
                    .collect();
                let fresh: Vec<CleanupItem> = agent_items
                    .into_iter()
                    .filter(|item| !existing.contains(&item.display_path.to_lowercase()))
                    .collect();
                let fresh_ids: std::collections::HashSet<String> =
                    fresh.iter().map(|item| item.id.clone()).collect();
                let mut agent_targets = outcome.targets;
                agent_targets.retain(|target| fresh_ids.contains(&target.id));

                sections.push(ScanSectionResult {
                    scope: ScanScope::Agents,
                    status: if token.is_cancelled() {
                        "partial"
                    } else {
                        "completed"
                    }
                    .to_string(),
                    item_count: fresh.len() as u64,
                    cleanable_bytes: fresh
                        .iter()
                        .filter(|i| !i.protected && i.selectable)
                        .map(|i| i.allocated_bytes.or(i.logical_bytes).unwrap_or(0))
                        .sum(),
                    error_code: None,
                });
                directories_visited += outcome.entries_scanned;
                {
                    let mut guard = crate::lock!(session);
                    for target in agent_targets {
                        guard.targets.insert(target.id.clone(), target);
                    }
                    guard.items.extend(fresh.iter().cloned());
                    items = guard.items.clone();
                }
                // The same precedence the per-root loop uses: a depth cut is a
                // configured boundary and must never mask a real interruption.
                // Keeping a project-step `DepthLimit` when the agent step timed
                // out produced `partial=false` and a "Completed" event for a
                // scan that was cut short.
                stop_reason = merge_stop_reason(stop_reason, outcome.stop_reason);
            }
            Err(err) => {
                sections.push(ScanSectionResult {
                    scope: ScanScope::Agents,
                    status: "failed".to_string(),
                    item_count: 0,
                    cleanable_bytes: 0,
                    error_code: Some("SCAN_FAILED".to_string()),
                });
                let _ = tx
                    .send(ScanEvent::Warning {
                        code: "AGENT_SCAN_FAILED".to_string(),
                        path: Some(err.to_string()),
                        severity: ScanNoticeSeverity::Error,
                        root: None,
                    })
                    .await;
            }
        }
    }

    let mut summary_request = request.clone();
    if all_drives {
        summary_request.root_path = scan_roots
            .iter()
            .map(|root| root.to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(", ");
    }

    let summary = build_summary(
        &summary_request,
        &scan_id,
        &items,
        directories_visited,
        started.elapsed().as_millis() as u64,
        stop_reason,
        sections,
    );

    {
        let mut guard = crate::lock!(session);
        guard.summary = Some(summary.clone());
        guard.refresh_deadline();
    }

    let _ = tx.send(terminal_event(&summary)).await;
    drop(tx);
    let _ = forwarder.await;

    Ok(summary)
}

/// Runs a complete scan (discovery **and** measurement) on a dedicated Tokio
/// runtime. CLI and MCP are synchronous, and both used to call the discovery
/// engine directly; discovery intentionally leaves every size as `None`, so the
/// automation surface reported every target as 0 B and `--min-size` matched
/// nothing. This helper keeps a single scan implementation for GUI, CLI and MCP.
pub fn run_scan_blocking(
    mut request: ScanRequest,
    catalog: Arc<CatalogIndex>,
    settings: &crate::settings::AppSettings,
    policy: &crate::cleanup::CleanupPolicy,
) -> Result<(ScanSummary, ScanSession), AppError> {
    // Backend-owned limits and safety settings, exactly like `start_scan`.
    request.exclusions = settings.excluded_names.clone();
    request.protected_paths = settings.protected_paths.clone();
    request.max_depth = Some(settings.max_depth);
    request.max_candidates = Some(settings.max_candidates);
    request.timeout_minutes = Some(settings.timeout_minutes);
    if request.min_size_bytes.is_none() {
        request.min_size_bytes = Some(settings.min_size_bytes);
    }

    let scope = request.scope;
    let root = PathBuf::from(&request.root_path);
    let mut allowed_roots = Vec::new();
    if !request.root_path.trim().is_empty() {
        allowed_roots.push(root.clone());
    }
    match scope {
        ScanScope::AllDrives => {
            for drive in crate::platform::fixed_drive_roots() {
                allowed_roots.push(PathBuf::from(drive));
            }
        }
        ScanScope::Agents | ScanScope::Combined => {
            for agent_root in crate::providers::root_locator::locate_agent_roots() {
                if agent_root.path.is_dir() && !allowed_roots.iter().any(|p| p == &agent_root.path)
                {
                    allowed_roots.push(agent_root.path);
                }
            }
            if let Ok(profile) = std::env::var("USERPROFILE") {
                let profile = PathBuf::from(profile);
                if profile.is_dir() && !allowed_roots.contains(&profile) {
                    allowed_roots.push(profile);
                }
            }
        }
        _ => {}
    }
    if allowed_roots.is_empty() {
        return Err(AppError::InvalidPath(
            "Scan root was not specified.".to_string(),
        ));
    }

    let session_id = format!("auto-{}", uuid::Uuid::new_v4().simple());
    let session = Arc::new(std::sync::Mutex::new(ScanSession {
        id: session_id,
        scope,
        root: allowed_roots[0].clone(),
        allowed_roots,
        created: Instant::now(),
        items: Vec::new(),
        targets: HashMap::new(),
        summary: None,
    }));
    let token = CancellationToken::new();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|err| AppError::ScanFailed(format!("Scan runtime failed: {}", err)))?;
    let summary = runtime.block_on(run_scan(
        request,
        session.clone(),
        token,
        catalog,
        policy,
        |_event| {},
    ))?;
    let session = session
        .lock()
        .map_err(|_| AppError::ScanFailed("Scan session lock poisoned.".to_string()))?
        .clone();
    Ok((summary, session))
}
