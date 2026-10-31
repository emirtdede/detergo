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
pub use limits::{ScanLimits, StopReason};
pub use models::*;
pub use session::{ScanRegistry, ScanSession};

use crate::audit::AuditRepository;
use crate::catalog::CatalogIndex;
use crate::error::AppError;
use crate::providers;

const BATCH_SIZE: usize = 100;

fn provider_totals(items: &[CleanupItem]) -> Vec<ProviderTotal> {
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
        let logical = item.logical_bytes.unwrap_or(0);
        let allocated = item.allocated_bytes.unwrap_or(logical);
        entry.item_count += 1;
        if item.protected {
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

fn build_summary(
    request: &ScanRequest,
    scan_id: &str,
    items: &[CleanupItem],
    directories_visited: u64,
    duration_ms: u64,
    stop_reason: Option<StopReason>,
) -> ScanSummary {
    let total_logical: u64 = items.iter().map(|i| i.logical_bytes.unwrap_or(0)).sum();
    let total_allocated: u64 = items
        .iter()
        .map(|i| i.allocated_bytes.unwrap_or(i.logical_bytes.unwrap_or(0)))
        .sum();
    let protected: u64 = items
        .iter()
        .filter(|i| i.protected)
        .map(|i| i.allocated_bytes.unwrap_or(i.logical_bytes.unwrap_or(0)))
        .sum();
    let errors = items.iter().filter(|i| i.status == ItemStatus::Error).count() as u64;
    let warnings = items.iter().filter(|i| !i.warning_codes.is_empty()).count() as u64;

    ScanSummary {
        scan_id: scan_id.to_string(),
        root_path: request.root_path.clone(),
        scope: request.scope,
        total_entries: items.len() as u64,
        total_bytes: total_logical,
        total_allocated_bytes: total_allocated,
        protected_bytes: protected,
        duration_ms,
        errors_count: errors,
        warnings_count: warnings,
        directories_visited,
        partial: stop_reason.is_some(),
        stop_reason: stop_reason.map(|r| r.code().to_string()),
        provider_totals: provider_totals(items),
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
    let (tx, mut rx) = mpsc::unbounded_channel::<ScanEvent>();

    let forward_emit = emit.clone();
    let forwarder = tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            forward_emit(event);
        }
    });

    let scan_id = session.lock().unwrap().id.clone();
    let _ = tx.send(ScanEvent::Started {
        scan_id: scan_id.clone(),
    });

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
        let summary = build_summary(&request, &scan_id, &[], 0, started.elapsed().as_millis() as u64, None);
        let _ = tx.send(ScanEvent::Completed {
            summary: summary.clone(),
        });
        drop(tx);
        let _ = forwarder.await;
        return Ok(summary);
    }

    if request.scope == ScanScope::Agents {
        let token_agents = token.clone();
        let policy_agents = policy.clone();
        let scan_id_agents = scan_id.clone();
        let outcome = tokio::task::spawn_blocking(move || {
            providers::scan_agents(&scan_id_agents, &token_agents, &policy_agents, limits)
        })
        .await
        .map_err(|e| AppError::ScanFailed(format!("Ajan taraması başarısız: {}", e)))?;
        for warning in &outcome.warnings {
            let _ = tx.send(ScanEvent::Warning {
                code: warning.0.clone(),
                path: warning.1.clone(),
            });
        }
        let items = outcome.items;
        let targets = outcome.targets;

        {
            let mut guard = session.lock().unwrap();
            for target in targets {
                guard.targets.insert(target.id.clone(), target);
            }
            guard.items = items.clone();
        }

        for batch in items.chunks(BATCH_SIZE) {
            let _ = tx.send(ScanEvent::Candidates {
                items: batch.to_vec(),
            });
            let updates: Vec<MeasurementUpdate> = batch
                .iter()
                .map(|item| MeasurementUpdate {
                    id: item.id.clone(),
                    logical_bytes: item.logical_bytes.unwrap_or(0),
                    allocated_bytes: item.allocated_bytes,
                    estimated_reclaim_bytes: item.estimated_reclaim_bytes.unwrap_or(0),
                    file_count: 0,
                    hardlink_dedup_bytes: 0,
                    status: item.status,
                })
                .collect();
            let _ = tx.send(ScanEvent::Measured { updates });
        }

        if policy.record_history && !outcome.snapshots.is_empty() {
            let _ = AuditRepository::new().append_snapshots(&outcome.snapshots);
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
        );
        session.lock().unwrap().summary = Some(summary.clone());
        let event = if stop.is_some() {
            ScanEvent::Cancelled { summary: summary.clone() }
        } else {
            ScanEvent::Completed { summary: summary.clone() }
        };
        let _ = tx.send(event);
        drop(tx);
        let _ = forwarder.await;
        return Ok(summary);
    }

    // Project scan ---------------------------------------------------------
    let root_path = PathBuf::from(&request.root_path);
    if !root_path.exists() {
        drop(tx);
        let _ = forwarder.await;
        return Err(AppError::PathNotFound(request.root_path));
    }

    let root_for_discovery = root_path.clone();
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
                let _ = tx_discovery.send(ScanEvent::Candidates {
                    items: batch.to_vec(),
                });
            },
            |progress| {
                let _ = tx_discovery.send(ScanEvent::Progress { progress });
            },
        )
    });

    let outcome = discovery_task
        .await
        .map_err(|e| AppError::ScanFailed(format!("Tarama görevi başarısız: {}", e)))??;

    for warning in &outcome.warnings {
        let _ = tx.send(ScanEvent::Warning {
            code: warning.0.clone(),
            path: warning.1.clone(),
        });
    }

    let mut items = outcome.items;
    let mut targets = outcome.targets;

    {
        let mut guard = session.lock().unwrap();
        for target in targets.drain(..) {
            guard.targets.insert(target.id.clone(), target);
        }
        guard.items = items.clone();
    }

    let mut stop_reason = outcome.stop_reason;

    if stop_reason != Some(StopReason::Cancelled)
        && stop_reason != Some(StopReason::Timeout)
        && !token.is_cancelled()
    {
        let tasks: Vec<(String, PathBuf, crate::catalog::TargetKind)> = {
            let guard = session.lock().unwrap();
            guard
                .targets
                .values()
                .map(|t| (t.id.clone(), t.path.clone(), t.kind))
                .collect()
        };

        let engine = measurement::MeasurementEngine::new(token.clone())
            .with_deadline(scan_deadline);
        let tx_measure = tx.clone();
        let tx_progress = tx.clone();
        let measured: Arc<std::sync::Mutex<HashMap<String, MeasurementUpdate>>> =
            Arc::new(std::sync::Mutex::new(HashMap::new()));
        let measured_writer = measured.clone();

        let measurement_stop = engine
            .measure_entries(
                tasks,
                items.len() as u64,
                outcome.directories_visited,
                move |updates| {
                    {
                        let mut map = measured_writer.lock().unwrap();
                        for update in &updates {
                            map.insert(update.id.clone(), update.clone());
                        }
                    }
                    let _ = tx_measure.send(ScanEvent::Measured {
                        updates: updates.clone(),
                    });
                },
                move |progress| {
                    let _ = tx_progress.send(ScanEvent::Progress { progress });
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

        let map = measured.lock().unwrap().clone();
        let mut guard = session.lock().unwrap();
        for target in guard.targets.values_mut() {
            if let Some(update) = map.get(&target.id) {
                target.logical_bytes = Some(update.logical_bytes);
                target.allocated_bytes = update.allocated_bytes;
            }
        }
        for item in guard.items.iter_mut() {
            if let Some(update) = map.get(&item.id) {
                item.logical_bytes = Some(update.logical_bytes);
                item.allocated_bytes = update.allocated_bytes;
                item.estimated_reclaim_bytes = Some(update.estimated_reclaim_bytes);
                if update.status == ItemStatus::Error {
                    item.status = ItemStatus::Error;
                } else if item.status == ItemStatus::Discovered {
                    item.status = ItemStatus::Ready;
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

    let summary = build_summary(
        &request,
        &scan_id,
        &items,
        outcome.directories_visited,
        started.elapsed().as_millis() as u64,
        stop_reason,
    );

    {
        let mut guard = session.lock().unwrap();
        guard.summary = Some(summary.clone());
    }

    let event = if stop_reason == Some(StopReason::Cancelled) {
        ScanEvent::Cancelled {
            summary: summary.clone(),
        }
    } else {
        ScanEvent::Completed {
            summary: summary.clone(),
        }
    };
    let _ = tx.send(event);
    drop(tx);
    let _ = forwarder.await;

    Ok(summary)
}
