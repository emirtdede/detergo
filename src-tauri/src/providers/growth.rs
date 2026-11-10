use serde::Serialize;
use std::collections::HashMap;

use crate::audit::StorageSnapshot;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowthEntry {
    pub provider: String,
    pub category: String,
    pub current_bytes: u64,
    pub previous_bytes: u64,
    pub delta_bytes: i64,
    pub window_seconds: u64,
    pub rate_per_hour: f64,
    pub level: String,
}

const GIB: f64 = 1024.0 * 1024.0 * 1024.0;

fn parse_time(value: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    chrono::DateTime::parse_from_rfc3339(value).ok()
}

/// Compares the two most recent snapshots per provider/category. Alerts never
/// trigger automated deletion; they are informational only.
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
        let previous = list[list.len() - 2];
        let current = list[list.len() - 1];
        let (Some(prev_time), Some(cur_time)) = (
            parse_time(&previous.timestamp),
            parse_time(&current.timestamp),
        ) else {
            continue;
        };
        let window = (cur_time.timestamp() - prev_time.timestamp()).max(1) as u64;
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
