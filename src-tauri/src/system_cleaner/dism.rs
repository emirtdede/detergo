//! Component store cleanup through DISM.
//!
//! The base-reset switch is deliberately not used: it makes installed updates
//! uninstallable, and that is not a trade a one-click cleaner should make on the
//! user's behalf. The plain `/StartComponentCleanup` removes superseded
//! components while keeping the uninstall path intact.
//!
//! DISM prints localised text, so the app does not parse a "reclaimed bytes"
//! number. It reports the exit code and a short log tail; the UI labels the
//! size of this row as reported by Windows rather than measured.

use std::time::Duration;

use crate::error::AppError;
use crate::scanner::cancellation::CancellationToken;

use super::process::{self, CommandOutcome};

const TIMEOUT: Duration = Duration::from_secs(90 * 60);

pub struct DismOutcome {
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub log_tail: String,
}

pub fn executable() -> std::path::PathBuf {
    exe()
}

fn exe() -> std::path::PathBuf {
    std::env::var_os("SystemRoot")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(r"C:\Windows"))
        .join("System32")
        .join("Dism.exe")
}

pub fn run(token: &CancellationToken) -> Result<DismOutcome, AppError> {
    let outcome = process::run(
        &exe().to_string_lossy(),
        &["/Online", "/Cleanup-Image", "/StartComponentCleanup"],
        TIMEOUT,
        token,
    )?;
    Ok(finish(outcome))
}

fn finish(outcome: CommandOutcome) -> DismOutcome {
    let mut log = String::new();
    if !outcome.stdout.trim().is_empty() {
        log.push_str(outcome.stdout.trim_end());
        log.push('\n');
    }
    if !outcome.stderr.trim().is_empty() {
        log.push_str(outcome.stderr.trim_end());
        log.push('\n');
    }
    if outcome.timed_out {
        log.push_str("DISM did not finish within 90 minutes and was stopped.\n");
    }
    DismOutcome {
        exit_code: outcome.exit_code,
        timed_out: outcome.timed_out,
        log_tail: log.trim_end().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::exe;

    #[test]
    fn dism_path_is_absolute_and_system32() {
        let path = exe();
        assert!(path.is_absolute());
        assert!(path.ends_with("Dism.exe"));
    }
}
