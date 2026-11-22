use std::collections::HashMap;

use super::limits::StopReason;
use super::models::{
    CleanupItem, ItemStatus, MeasurementUpdate, ProviderTotal, ScanEvent, ScanRequest,
    ScanSectionResult, ScanSummary,
};

/// Builds measurement events for an agent-scan batch.
///
/// Only targets that were actually measured may produce an update. Turning a
/// missing size into `0` made an unreadable agent cache look like an empty
/// folder in the table and skewed provider totals; `None` must stay `None` so
/// the UI can show "Not measured" and keep the row blocked.
pub(crate) fn agent_measurement_updates(batch: &[CleanupItem]) -> Vec<MeasurementUpdate> {
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
                selectable: Some(item.selectable),
                auto_selectable: Some(item.auto_selectable),
                warning_codes: if item.warning_codes.is_empty() {
                    None
                } else {
                    Some(item.warning_codes.clone())
                },
            })
        })
        .collect()
}

pub(crate) fn item_allocated(item: &CleanupItem) -> u64 {
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
pub(crate) fn own_bytes(items: &[CleanupItem]) -> HashMap<String, (u64, u64)> {
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

pub(crate) fn is_protected_item(item: &CleanupItem) -> bool {
    item.protected || !item.selectable || item.safety_class == crate::catalog::SafetyClass::Keep
}

pub(crate) fn cleanable_own_bytes(items: &[CleanupItem]) -> u64 {
    let own = own_bytes(items);
    items
        .iter()
        .filter(|i| !is_protected_item(i))
        .fold(0u64, |sum, i| {
            sum.saturating_add(own.get(&i.id).map(|(_, allocated)| *allocated).unwrap_or(0))
        })
}

pub(crate) fn provider_totals(
    items: &[CleanupItem],
    own: &HashMap<String, (u64, u64)>,
) -> Vec<ProviderTotal> {
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
        // A non-selectable or Keep target can never be cleaned, so it belongs
        // on the protected side of the ledger. Otherwise the cleanable total
        // promises space the user cannot reclaim.
        if is_protected_item(item) {
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
pub(crate) fn terminal_event(summary: &ScanSummary) -> ScanEvent {
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
pub(crate) fn merge_stop_reason(
    current: Option<StopReason>,
    next: Option<StopReason>,
) -> Option<StopReason> {
    match next {
        None => current,
        Some(next) if current.is_none() => Some(next),
        Some(next) if next != StopReason::DepthLimit => Some(next),
        Some(next) if current == Some(StopReason::DepthLimit) => Some(next),
        Some(_) => current,
    }
}

pub(crate) fn build_summary(
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
        .filter(|i| is_protected_item(i))
        .map(|i| own.get(&i.id).map(|(_, allocated)| *allocated).unwrap_or(0))
        .sum();
    let cleanable: u64 = items
        .iter()
        .filter(|i| !is_protected_item(i))
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
