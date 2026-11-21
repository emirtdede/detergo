//! Subprocess execution, version probing, and safe Recycle Bin cache cleanup.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

use crate::cleanup::recycle_bin::RecycleBinSession;
use crate::error::AppError;
use crate::safety::GuardContext;

pub(super) const COMMAND_TIMEOUT: Duration = Duration::from_secs(600);
const VERSION_TIMEOUT: Duration = Duration::from_millis(1500);
const VERSION_BUDGET: Duration = Duration::from_secs(2);

pub fn find_executable(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        #[cfg(windows)]
        {
            for ext in ["exe", "cmd", "bat"] {
                let candidate = dir.join(format!("{}.{}", name, ext));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
        #[cfg(not(windows))]
        {
            use std::os::unix::fs::PermissionsExt;
            let candidate = dir.join(name);
            if candidate.is_file()
                && candidate
                    .metadata()
                    .map(|m| (m.permissions().mode() & 0o111) != 0)
                    .unwrap_or(false)
            {
                return Some(candidate);
            }
        }
    }
    None
}

fn terminate_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let taskkill = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
            .join("System32")
            .join("taskkill.exe");
        let mut cmd = Command::new(taskkill);
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let _ = cmd.status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        std::thread::sleep(Duration::from_millis(250));
        let _ = Command::new("kill")
            .args(["-KILL", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

pub(super) fn run_command_with_timeout(
    mut cmd: Command,
    timeout: Duration,
) -> Result<Output, AppError> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd
        .spawn()
        .map_err(|e| AppError::Unknown(format!("Failed to spawn command: {}", e)))?;
    let pid = child.id();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(e)) => Err(AppError::Unknown(format!(
            "Failed to read command output: {}",
            e
        ))),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            terminate_process_tree(pid);
            let _ = rx.recv_timeout(Duration::from_secs(10));
            Err(AppError::Unknown(format!(
                "Tool command timed out after {} seconds; process tree was terminated.",
                timeout.as_secs()
            )))
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Err(AppError::Unknown(
            "Command monitor channel closed unexpectedly.".to_string(),
        )),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CmdQuoteError {
    PercentExpansion,
    ControlChar,
    ShellMetachar,
}

impl std::fmt::Display for CmdQuoteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PercentExpansion => write!(
                f,
                "the tool path contains '%', which cmd.exe would expand; \
                 move the tool to a path without percent signs"
            ),
            Self::ControlChar => write!(f, "the tool path contains a control character"),
            Self::ShellMetachar => write!(
                f,
                "the batch tool path or argument contains an unsafe cmd.exe metacharacter"
            ),
        }
    }
}

pub(super) fn quote_cmd_arg(value: &str) -> Result<String, CmdQuoteError> {
    if value.contains('%') {
        return Err(CmdQuoteError::PercentExpansion);
    }
    if value.chars().any(|c| c.is_control()) {
        return Err(CmdQuoteError::ControlChar);
    }
    let escaped = value.replace('"', "\"\"");
    Ok(format!("\"{escaped}\""))
}

fn validate_batch_token(value: &str) -> Result<(), CmdQuoteError> {
    quote_cmd_arg(value)?;
    if value
        .chars()
        .any(|c| matches!(c, '&' | '|' | '<' | '>' | '^' | '!'))
    {
        return Err(CmdQuoteError::ShellMetachar);
    }
    Ok(())
}

pub(super) fn command_for_executable(exe: &Path, args: &[String]) -> Result<Command, AppError> {
    #[cfg(not(windows))]
    {
        let mut command = Command::new(exe);
        command.args(args);
        return Ok(command);
    }

    #[cfg(windows)]
    {
        let is_batch = exe
            .extension()
            .map(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"))
            .unwrap_or(false);
        if is_batch {
            // Validate against `%VAR%` expansion, control chars, and shell
            // metacharacters, then delegate execution directly to Rust's
            // CVE-2024-24576 hardened `Command::new(exe).args(args)` pipeline.
            // Manually building `cmd /C "..." "..."` caused `cmd.exe` to strip
            // outer quotes and break paths with spaces (e.g. `C:\Program Files\nodejs\npm.cmd`).
            validate_batch_token(&exe.to_string_lossy()).map_err(|err| {
                AppError::InvalidPath(format!("Cannot run {}: {err}", exe.display()))
            })?;
            for arg in args {
                validate_batch_token(arg).map_err(|err| {
                    AppError::InvalidPath(format!(
                        "Cannot pass an argument to {}: {err}",
                        exe.display()
                    ))
                })?;
            }
        }
        let mut command = Command::new(exe);
        command.args(args);
        Ok(command)
    }
}

fn version_args(name: &str) -> &'static [&'static str] {
    match name {
        "go" => &["version"],
        _ => &["--version"],
    }
}

fn decode_output(bytes: &[u8]) -> String {
    let nul = bytes.iter().filter(|b| **b == 0).count();
    if bytes.len() >= 2 && nul * 3 >= bytes.len() {
        let units: Vec<u16> = bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|chunk| u16::from_le_bytes(*chunk))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).to_string()
    }
}

pub(super) fn extract_version(line: &str) -> Option<String> {
    for raw in line.split_whitespace() {
        let token = raw.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '-');
        let token = match token.find(|c: char| c.is_ascii_digit()) {
            Some(0) => token,
            Some(index) if token[..index].chars().all(|c| c.is_ascii_alphabetic()) => {
                &token[index..]
            }
            _ => continue,
        };
        let token = token.trim_start_matches(['v', 'V']).trim_matches('.');
        if token.is_empty() || !token.contains('.') {
            continue;
        }
        if token.chars().all(|c| c.is_ascii_digit() || c == '.') {
            return Some(token.to_string());
        }
    }
    None
}

pub(super) fn probe_versions(names: &[&str]) -> HashMap<String, String> {
    let mut unique: Vec<String> = Vec::new();
    for name in names {
        if !unique.iter().any(|existing| existing == name) {
            unique.push((*name).to_string());
        }
    }

    let (tx, rx) = std::sync::mpsc::channel::<(String, Option<String>)>();
    let total = unique.len();
    for name in unique {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let version = tool_version(&name);
            let _ = tx.send((name, version));
        });
    }
    drop(tx);

    let deadline = Instant::now() + VERSION_BUDGET;
    let mut out = HashMap::with_capacity(total);
    let mut received = 0usize;
    while received < total {
        let now = Instant::now();
        let Some(remaining) = deadline.checked_duration_since(now) else {
            break;
        };
        match rx.recv_timeout(remaining) {
            Ok((name, Some(version))) => {
                out.insert(name, version);
                received += 1;
            }
            Ok((_, None)) => received += 1,
            Err(_) => break,
        }
    }
    out
}

fn tool_version(name: &str) -> Option<String> {
    let exe = find_executable(name)?;
    let args: Vec<String> = version_args(name).iter().map(|s| s.to_string()).collect();
    let cmd = command_for_executable(&exe, &args).ok()?;
    let output = run_command_with_timeout(cmd, VERSION_TIMEOUT).ok()?;
    let text = if output.stdout.is_empty() {
        decode_output(&output.stderr)
    } else {
        decode_output(&output.stdout)
    };
    let first = text.lines().map(str::trim).find(|line| !line.is_empty())?;
    let cleaned = first.trim_start_matches('\u{feff}').trim();
    if cleaned.is_empty() {
        None
    } else if let Some(version) = extract_version(cleaned) {
        Some(version)
    } else {
        Some(
            cleaned
                .chars()
                .take(24)
                .collect::<String>()
                .trim_end()
                .to_string(),
        )
    }
}

/// Safely moves audited cache directories to the OS Recycle Bin via `PathGuard`.
pub(super) fn execute_safe_cache_recycle(
    paths: &[PathBuf],
    blocked_processes: &[&str],
) -> Result<(bool, String, String), AppError> {
    if !blocked_processes.is_empty() {
        let running = crate::platform::running_process_names(blocked_processes);
        if !running.is_empty() {
            let names: Vec<&str> = running.iter().map(|(n, _)| n.as_str()).collect();
            return Err(AppError::Blocked(format!(
                "Cannot clean cache while active process is running: {}. Close it and retry.",
                names.join(", ")
            )));
        }
    }

    let mut allowed_roots = Vec::new();
    for env_key in [
        "USERPROFILE",
        "LOCALAPPDATA",
        "APPDATA",
        "HOME",
        "XDG_CACHE_HOME",
    ] {
        if let Ok(val) = std::env::var(env_key) {
            let root = PathBuf::from(val);
            if root.is_dir() && !allowed_roots.contains(&root) {
                allowed_roots.push(root);
            }
        }
    }
    let settings = crate::settings::SettingsRepository::new().load();
    let guard_ctx = GuardContext {
        scan_roots: &allowed_roots,
        protected_paths: &settings.protected_paths,
    };

    let mut session = RecycleBinSession::new();
    let mut moved: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    for path in paths {
        if !path.exists() {
            continue;
        }
        if crate::platform::is_reparse_point(path) {
            errors.push(format!("Skipped reparse point: {}", path.display()));
            continue;
        }
        match session.recycle(path, &guard_ctx) {
            Ok(canonical) => moved.push(format!("Recycled: {}", canonical.display())),
            Err(err) => errors.push(format!("{}: {}", path.display(), err)),
        }
    }

    let success = errors.is_empty();
    let stdout = if moved.is_empty() {
        "No existing cache directories needed cleanup.".to_string()
    } else {
        moved.join("\n")
    };
    let stderr = errors.join("\n");
    Ok((success, stdout, stderr))
}

pub(super) fn tail(text: &str, max: usize) -> String {
    let trimmed = text.trim();
    if trimmed.len() <= max {
        return trimmed.to_string();
    }
    let mut start = trimmed.len() - max;
    while start < trimmed.len() && !trimmed.is_char_boundary(start) {
        start += 1;
    }
    trimmed[start..].to_string()
}
