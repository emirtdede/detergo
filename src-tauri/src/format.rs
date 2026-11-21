//! Human-readable byte formatting shared by the CLI, the MCP server and the
//! webhook payload. Keeping one implementation matters because the three
//! surfaces describe the same numbers to the same user.

/// Formats a byte count the way the terminal and the webhook payload show it.
pub fn human_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.2} GB", b / GB)
    } else if b >= MB {
        format!("{:.1} MB", b / MB)
    } else if b >= KB {
        format!("{:.0} KB", b / KB)
    } else {
        format!("{} B", bytes)
    }
}

/// Parses an age threshold such as `7d`, `30d`, `2w`, `3m` (90 days), `1y`
/// (365 days), or a bare positive integer (days). Inspired by `kondo --older`
/// and `cargo-sweep --time`.
pub fn parse_age_days(raw: &str) -> Result<u64, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.starts_with('-') {
        return Err(format!(
            "Invalid age '{raw}'; use e.g. 7d, 30d, 2w, 3m, or 1y."
        ));
    }
    let split = trimmed
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(trimmed.len());
    let (num_str, unit_str) = trimmed.split_at(split);
    let value: u64 = num_str
        .parse()
        .map_err(|_| format!("Invalid age '{raw}'; expected a positive number."))?;
    if value == 0 {
        return Err("Age threshold must be at least 1 day.".to_string());
    }
    let multiplier: u64 = match unit_str.trim().to_ascii_lowercase().as_str() {
        "" | "d" | "day" | "days" => 1,
        "w" | "wk" | "week" | "weeks" => 7,
        "m" | "mo" | "month" | "months" => 30,
        "y" | "yr" | "year" | "years" => 365,
        other => {
            return Err(format!(
                "Unknown age unit '{other}' in '{raw}'; use d (days), w (weeks), m (months), or y (years)."
            ));
        }
    };
    value
        .checked_mul(multiplier)
        .ok_or_else(|| format!("Age value '{raw}' is too large."))
}

/// Returns true when a target's `last_modified_ms` is at least `min_age_days`
/// older than `now_ms`. Targets with an unknown mtime fail closed (`false`) so
/// fresh or unreadable projects are never mistakenly matched by `--older`.
pub fn is_older_than_days(last_modified_ms: Option<i64>, min_age_days: u64, now_ms: i64) -> bool {
    if min_age_days == 0 {
        return true;
    }
    let Some(modified) = last_modified_ms else {
        return false;
    };
    let delta_ms = (min_age_days as i128).saturating_mul(86_400_000);
    let cutoff = (now_ms as i128).saturating_sub(delta_ms);
    (modified as i128) <= cutoff
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_largest_unit() {
        assert_eq!(human_bytes(0), "0 B");
        assert_eq!(human_bytes(512), "512 B");
        assert_eq!(human_bytes(2048), "2 KB");
        assert_eq!(human_bytes(5 * 1024 * 1024), "5.0 MB");
        assert_eq!(human_bytes(3 * 1024 * 1024 * 1024), "3.00 GB");
    }

    #[test]
    fn parses_age_durations_and_rejects_invalid_values() {
        assert_eq!(parse_age_days("30").unwrap(), 30);
        assert_eq!(parse_age_days("7d").unwrap(), 7);
        assert_eq!(parse_age_days("2w").unwrap(), 14);
        assert_eq!(parse_age_days("3M").unwrap(), 90);
        assert_eq!(parse_age_days("1y").unwrap(), 365);
        assert!(parse_age_days("0d").is_err());
        assert!(parse_age_days("-5d").is_err());
        assert!(parse_age_days("3x").is_err());
    }

    #[test]
    fn age_predicate_fails_closed_when_mtime_is_missing() {
        let now: i64 = 1_750_000_000_000;
        let forty_days_ago = now - 40 * 86_400_000;
        let five_days_ago = now - 5 * 86_400_000;
        assert!(is_older_than_days(Some(forty_days_ago), 30, now));
        assert!(!is_older_than_days(Some(five_days_ago), 30, now));
        assert!(!is_older_than_days(None, 30, now));
        assert!(is_older_than_days(None, 0, now));
    }
}
