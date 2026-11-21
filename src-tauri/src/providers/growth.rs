use serde::Serialize;
use std::collections::HashMap;

use crate::audit::StorageSnapshot;

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowthEntry {
    pub provider: String,
    pub category: String,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub current_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub previous_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<i64>))]
    pub delta_bytes: i64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub window_seconds: u64,
    pub rate_per_hour: f64,
    pub level: String,
}

const GIB: f64 = 1024.0 * 1024.0 * 1024.0;
/// Minimum elapsed seconds between two snapshots before extrapolating an hourly
/// growth rate. Two snapshots captured seconds apart (or from different targets
/// within the same scan) would otherwise inflate a 1.5 MiB difference into a
/// false >5 GiB/hr critical alert.
const MIN_RATE_WINDOW_SECS: i64 = 60;

fn parse_time(value: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    chrono::DateTime::parse_from_rfc3339(value).ok()
}

/// Compares the latest snapshot per `(provider, category)` against the most
/// recent earlier snapshot that is at least `MIN_RATE_WINDOW_SECS` older.
/// Alerts never trigger automated deletion; they are informational only.
pub fn analyze_growth(snapshots: &[StorageSnapshot]) -> Vec<GrowthEntry> {
    let mut grouped: HashMap<(String, String), Vec<&StorageSnapshot>> = HashMap::new();
    for snapshot in snapshots {
        grouped
            .entry((snapshot.provider.clone(), snapshot.category.clone()))
            .or_default()
            .push(snapshot);
    }

    let mut out = Vec::new();
    for ((provider, category), mut list) in grouped {
        list.sort_by_key(|s| parse_time(&s.timestamp).map(|t| t.timestamp()).unwrap_or(0));
        if list.len() < 2 {
            continue;
        }
        let current = list[list.len() - 1];
        let Some(cur_time) = parse_time(&current.timestamp) else {
            continue;
        };
        let Some((previous, prev_time)) = list[..list.len() - 1]
            .iter()
            .rev()
            .filter_map(|candidate| {
                let ts = parse_time(&candidate.timestamp)?;
                (cur_time.timestamp() - ts.timestamp() >= MIN_RATE_WINDOW_SECS)
                    .then_some((*candidate, ts))
            })
            .next()
        else {
            continue;
        };

        let window = (cur_time.timestamp() - prev_time.timestamp()) as u64;
        let delta = current.bytes as i64 - previous.bytes as i64;
        let rate_per_hour = (delta as f64 / window as f64) * 3600.0;

        let level = if rate_per_hour >= 5.0 * GIB {
            "critical"
        } else if rate_per_hour >= GIB || delta as f64 >= 10.0 * GIB {
            "attention"
        } else {
            "ok"
        };

        out.push(GrowthEntry {
            provider,
            category,
            current_bytes: current.bytes,
            previous_bytes: previous.bytes,
            delta_bytes: delta,
            window_seconds: window,
            rate_per_hour,
            level: level.to_string(),
        });
    }

    out.sort_by_key(|a| std::cmp::Reverse(a.delta_bytes));
    out
}

pub fn single_file_threshold_bytes() -> u64 {
    1024 * 1024 * 1024
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(ts: &str, bytes: u64) -> StorageSnapshot {
        StorageSnapshot {
            timestamp: ts.to_string(),
            provider: "cursor".to_string(),
            category: "cache".to_string(),
            bytes,
            item_count: 3,
        }
    }

    #[test]
    fn sub_minute_snapshots_do_not_trigger_fake_critical_alerts() {
        let entries = analyze_growth(&[
            snap("2026-11-21T10:00:00+00:00", 1_000_000),
            snap("2026-11-21T10:00:02+00:00", 6_000_000),
        ]);
        assert!(
            entries.is_empty(),
            "2-second window must not extrapolate to GiB/hr alerts"
        );
    }

    #[test]
    fn looks_back_past_recent_duplicates_to_valid_window() {
        let entries = analyze_growth(&[
            snap("2026-11-21T09:00:00+00:00", 100 * 1024 * 1024),
            snap("2026-11-21T10:00:00+00:00", 200 * 1024 * 1024),
            snap("2026-11-21T10:00:03+00:00", 205 * 1024 * 1024),
        ]);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].level, "ok");
        assert!(entries[0].window_seconds >= 3600);
    }
}
