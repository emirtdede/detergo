//! Backend diagnostics that survive a release build.
//!
//! `eprintln!` was the only way errors reached the outside world, but a Tauri
//! GUI binary is built as a Windows *GUI* subsystem process: no console is
//! attached, so those lines were thrown away for every real user. Support had
//! nothing to inspect when the audit database failed to open, and the messages
//! bypassed the path-masking policy the frontend applies to its own logs.
//!
//! This module is the single sink for backend warnings:
//! - the message is written to `dev-cleaner.log` next to the app data,
//! - the account segment of any path is masked before it is written,
//! - in debug builds the line is also echoed to stderr for `cargo run`.
//!
//! It is deliberately dependency-free and never panics: logging must not be the
//! reason a scan or a cleanup fails.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// Above this size the log is rotated once to `dev-cleaner.log.1`.
const MAX_LOG_BYTES: u64 = 4 * 1024 * 1024;

/// Rotate checks run once per this many lines.
///
/// `rotate_if_needed` used to `stat` the file on every write, which is one extra
/// syscall per log line. The file may overshoot `MAX_LOG_BYTES` by at most
/// `ROTATE_CHECK_INTERVAL` lines, and the next check trims it; a log filled by
/// an older process is still rotated on the first write of this one.
const ROTATE_CHECK_INTERVAL: u64 = 256;

static WRITE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Resolved lazily so a test process can point it at a temp directory without
/// touching the real user profile.
static LOG_PATH: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Overrides the log destination. Test-only; production resolves the app dir.
#[cfg(test)]
pub fn set_log_path(path: Option<PathBuf>) {
    let _ = LOG_PATH.set(path);
}

fn resolve_log_path() -> Option<PathBuf> {
    if let Some(configured) = LOG_PATH.get() {
        return configured.clone();
    }
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("USERPROFILE").map(|p| PathBuf::from(p).join(".config")))
        .ok()?;
    // Deliberately *not* `platform::resolve_app_dir`: that function logs its own
    // failures through this module, so calling it here would recurse forever on
    // a machine where the app directory cannot be created. Mirroring the last
    // path segment is enough — the directory is created on first write anyway.
    Some(base.join("dev-cleaner").join("dev-cleaner.log"))
}

/// Masks the account name in Windows/POSIX home paths.
///
/// Mirrors `maskPath` in `src/lib/format/path.ts`: a support log is attached to
/// bug reports, so `C:\Users\alice\...` must not reach it verbatim.
pub fn mask_path(value: &str) -> String {
    let mut masked = String::with_capacity(value.len());
    let chars: Vec<char> = value.chars().collect();
    let mut index = 0;
    while index < chars.len() {
        // Only a ':', '/' or '\\' can start one of the markers. Building the
        // 40-char lookahead for every character allocated a String per char,
        // which is measurable on a log full of long paths.
        let could_start_marker = matches!(chars[index], ':' | '/' | '\\');
        let marker_len = if could_start_marker {
            // Long enough for `:\documents and settings\` (25 chars). The window
            // was 20, so that branch could never match and legacy profiles
            // leaked.
            let rest: String = chars[index..].iter().take(40).collect();
            let lower = rest.to_ascii_lowercase();
            if lower.starts_with(":\\users\\") {
                Some(":\\users\\".len())
            } else if lower.starts_with(":\\documents and settings\\") {
                Some(":\\documents and settings\\".len())
            } else if lower.starts_with("\\users\\") {
                // UNC home (`\\server\Users\alice`) or any `\Users\` segment:
                // the drive-letter form above has no colon here, so it would
                // otherwise pass through unmasked.
                Some("\\users\\".len())
            } else if lower.starts_with("/home/") {
                Some("/home/".len())
            } else if lower.starts_with("/users/") {
                Some("/users/".len())
            } else {
                None
            }
        } else {
            None
        };

        match marker_len {
            Some(len) => {
                masked.extend(chars[index..index + len].iter());
                index += len;
                // Skip the account segment up to the next separator.
                while index < chars.len() && chars[index] != '\\' && chars[index] != '/' {
                    index += 1;
                }
                masked.push_str("•••");
            }
            None => {
                masked.push(chars[index]);
                index += 1;
            }
        }
    }
    masked
}

fn timestamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    // Unix seconds without pulling in a date crate: the log only needs a
    // sortable prefix, and every line of a support bundle is ordered by it.
    format!("{secs}")
}

fn rotate_if_needed(path: &Path) {
    let writes = WRITE_COUNTER.fetch_add(1, Ordering::Relaxed);
    if !writes.is_multiple_of(ROTATE_CHECK_INTERVAL) {
        return;
    }
    let too_big = std::fs::metadata(path)
        .map(|meta| meta.len() > MAX_LOG_BYTES)
        .unwrap_or(false);
    if !too_big {
        return;
    }
    let backup = path.with_extension("log.1");
    let _ = std::fs::rename(path, backup);
}

/// Builds one fully sanitized log line.
///
/// Masking happens here, not in the individual helpers, because callers put
/// absolute paths in the *message* too (`format!("could not archive {}", path)`),
/// not only in the error detail. Masking only `detail` published
/// `C:\Users\<account>\...` into a file that users attach to support tickets.
fn format_line(level: &str, message: &str, detail: &str) -> String {
    let message = mask_path(message);
    let detail = mask_path(detail);
    if detail.is_empty() {
        format!("{} [{level}] {message}\n", timestamp())
    } else {
        format!("{} [{level}] {message}: {detail}\n", timestamp())
    }
}

fn write_line(level: &str, message: &str, detail: &str) {
    let path = match resolve_log_path() {
        Some(path) => path,
        None => return,
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    rotate_if_needed(&path);

    let line = format_line(level, message, detail);

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(line.as_bytes());
    }
    #[cfg(debug_assertions)]
    eprint!("{line}");
}

/// Records a recoverable failure. Both the message and the error are masked.
pub fn warn(message: &str, err: impl std::fmt::Display) {
    write_line("warn", message, &err.to_string());
}

/// Records a message with no attached error value.
pub fn info(message: &str) {
    write_line("info", message, "");
}

/// Records a failure that the user may never see but support must be able to
/// find, for example a corrupt audit row.
pub fn error(message: &str, err: impl std::fmt::Display) {
    write_line("error", message, &err.to_string());
}

#[cfg(test)]
mod tests {
    use super::{format_line, mask_path};

    #[test]
    fn masks_windows_and_posix_home_segments() {
        assert_eq!(
            mask_path(r"C:\Users\alice\AppData\Roaming\dev-cleaner\audit.sqlite3"),
            r"C:\Users\•••\AppData\Roaming\dev-cleaner\audit.sqlite3"
        );
        assert_eq!(
            mask_path("/home/bob/.config/dev-cleaner"),
            "/home/•••/.config/dev-cleaner"
        );
        assert_eq!(mask_path("/Users/carol/Library"), "/Users/•••/Library");
    }

    #[test]
    fn leaves_paths_without_a_home_segment_untouched() {
        assert_eq!(mask_path(r"D:\projects\app"), r"D:\projects\app");
        assert_eq!(mask_path("plain message"), "plain message");
    }

    #[test]
    fn masks_legacy_profile_and_unc_home_paths() {
        // `:\documents and settings\` is 25 characters; the old 20-char window
        // made this branch unreachable.
        assert_eq!(
            mask_path(r"C:\Documents and Settings\alice\AppData"),
            r"C:\Documents and Settings\•••\AppData"
        );
        assert_eq!(
            mask_path(r"\\fileserver\Users\alice\AppData"),
            r"\\fileserver\Users\•••\AppData"
        );
    }

    #[test]
    fn is_idempotent_when_already_masked() {
        let once = mask_path(r"C:\Users\alice\x");
        assert_eq!(mask_path(&once), once);
    }

    #[test]
    fn a_path_in_the_message_is_masked_too() {
        // Regression: only the error detail was masked, so callers that build
        // the message with `path.display()` wrote the real account name into
        // the log file attached to bug reports.
        let line = format_line(
            "warn",
            r"could not archive C:\Users\alice\AppData\Roaming\dev-cleaner\history.jsonl",
            "access denied",
        );
        assert!(!line.contains("alice"), "account name leaked: {line}");
        assert!(
            line.contains(r"C:\Users\•••\"),
            "path was not masked: {line}"
        );
        assert!(line.ends_with("access denied\n"));
    }

    #[test]
    fn an_info_line_is_masked_as_well() {
        let line = format_line("info", "/home/bob/.config/dev-cleaner", "");
        assert!(!line.contains("bob"));
        assert!(line.contains("/home/•••/"));
    }

    #[test]
    fn a_line_without_a_home_segment_is_unchanged() {
        let line = format_line("warn", "catalog reload failed", "invalid TOML");
        // No second `timestamp()` call: the two lines could straddle a second
        // boundary and make the assertion flaky.
        assert!(line.ends_with("[warn] catalog reload failed: invalid TOML\n"));
    }
}
