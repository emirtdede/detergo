//! Small process helper for the two tool-driven actions.
//!
//! `cleanmgr` and `DISM` can run for a long time. Their output is read on
//! dedicated threads so a full pipe buffer cannot deadlock the wait loop, and
//! the window is hidden so the user never sees a stray console flash.

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::error::AppError;
use crate::scanner::cancellation::CancellationToken;

#[derive(Debug, Default)]
pub struct CommandOutcome {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub cancelled: bool,
}

/// How much of the combined output is kept for the UI.
const LOG_LIMIT: usize = 16 * 1024;

pub fn run(
    exe: &str,
    args: &[&str],
    timeout: Duration,
    token: &CancellationToken,
) -> Result<CommandOutcome, AppError> {
    let mut command = Command::new(exe);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|e| AppError::Blocked(format!("Could not start {exe}: {e}")))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_reader = stdout.map(|mut pipe| {
        std::thread::spawn(move || {
            let mut text = String::new();
            let _ = pipe.read_to_string(&mut text);
            text
        })
    });
    let stderr_reader = stderr.map(|mut pipe| {
        std::thread::spawn(move || {
            let mut text = String::new();
            let _ = pipe.read_to_string(&mut text);
            text
        })
    });

    let started = Instant::now();
    let mut outcome = CommandOutcome::default();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                outcome.exit_code = status.code();
                break;
            }
            Ok(None) => {}
            Err(e) => {
                let _ = child.kill();
                return Err(AppError::Blocked(format!(
                    "{exe} could not be monitored: {e}"
                )));
            }
        }
        if token.is_cancelled() {
            // `cleanmgr` and `DISM` are not safe to kill mid-operation: a
            // half-applied component cleanup is worse than waiting. The flag is
            // reported so the UI can explain why the cancel button did not stop
            // the current step.
            outcome.cancelled = true;
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            outcome.timed_out = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    let mut stdout_text = stdout_reader
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default();
    let stderr_text = stderr_reader
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default();

    truncate_tail(&mut stdout_text);
    outcome.stdout = stdout_text;
    let mut stderr_text = stderr_text;
    truncate_tail(&mut stderr_text);
    outcome.stderr = stderr_text;
    Ok(outcome)
}

fn truncate_tail(text: &mut String) {
    if text.len() <= LOG_LIMIT {
        return;
    }
    let mut cut = text.len() - LOG_LIMIT;
    while cut < text.len() && !text.is_char_boundary(cut) {
        cut += 1;
    }
    let tail = text.split_off(cut);
    *text = format!("…{tail}");
}

#[cfg(test)]
mod tests {
    use super::truncate_tail;

    #[test]
    fn keeps_the_tail_of_a_long_log() {
        let mut text = "x".repeat(super::LOG_LIMIT + 100);
        truncate_tail(&mut text);
        assert!(text.starts_with('…'));
        assert_eq!(text.chars().count(), super::LOG_LIMIT + 1);
    }

    #[test]
    fn leaves_a_short_log_alone() {
        let mut text = "hello".to_string();
        truncate_tail(&mut text);
        assert_eq!(text, "hello");
    }
}
