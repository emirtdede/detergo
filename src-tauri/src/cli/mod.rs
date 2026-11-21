use serde::{Deserialize, Serialize};

use crate::error::AppError;

mod args;
mod caches;
mod help;
mod history;
pub mod i18n;
mod scan;
#[cfg(test)]
mod tests;

use caches::run_caches_cli;
use help::{print_caches_help, print_help, print_history_help, print_scan_help};
use history::run_history_cli;
use i18n::{t, tf};
use scan::run_scan_cli;

/// Attaches to the parent terminal console while preserving any redirected
/// `stdin`, `stdout`, or `stderr` handles (pipes or file redirections such as
/// `detergo s . -j | ConvertFrom-Json` or `> report.json`).
///
/// Never called for GUI launch flags (`--open-view`, `--wait-pid`) or `mcp`
/// stdio server mode.
#[cfg(windows)]
pub fn attach_console() {
    use windows::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE};
    use windows::Win32::Storage::FileSystem::{
        GetFileType, FILE_TYPE_CHAR, FILE_TYPE_DISK, FILE_TYPE_PIPE,
    };
    use windows::Win32::System::Console::{
        AttachConsole, GetConsoleMode, GetStdHandle, SetStdHandle, ATTACH_PARENT_PROCESS,
        CONSOLE_MODE, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
    };

    unsafe {
        let is_redirected = |h: HANDLE| -> bool {
            if h.is_invalid() || h == INVALID_HANDLE_VALUE || h.0.is_null() {
                return false;
            }
            let kind = GetFileType(h);
            if kind == FILE_TYPE_PIPE || kind == FILE_TYPE_DISK {
                return true;
            }
            // Character devices such as `NUL` (`> NUL`, `2> NUL`) report
            // `FILE_TYPE_CHAR` just like a real console, but `GetConsoleMode`
            // fails on non-console character devices. Preserve them so
            // `AttachConsole` does not silently undo `> NUL`.
            if kind == FILE_TYPE_CHAR {
                let mut mode = CONSOLE_MODE(0);
                return GetConsoleMode(h, &mut mode).is_err();
            }
            false
        };

        let saved_in = GetStdHandle(STD_INPUT_HANDLE)
            .ok()
            .filter(|&h| is_redirected(h));
        let saved_out = GetStdHandle(STD_OUTPUT_HANDLE)
            .ok()
            .filter(|&h| is_redirected(h));
        let saved_err = GetStdHandle(STD_ERROR_HANDLE)
            .ok()
            .filter(|&h| is_redirected(h));

        let _ = AttachConsole(ATTACH_PARENT_PROCESS);

        if let Some(h) = saved_in {
            let _ = SetStdHandle(STD_INPUT_HANDLE, h);
        }
        if let Some(h) = saved_out {
            let _ = SetStdHandle(STD_OUTPUT_HANDLE, h);
        }
        if let Some(h) = saved_err {
            let _ = SetStdHandle(STD_ERROR_HANDLE, h);
        }
    }
}

/// Returns true when the process was invoked with internal GUI launch flags
/// (such as `--open-view system --wait-pid <pid>` from an elevated relaunch).
pub fn is_gui_launch_args(args: &[String]) -> bool {
    if args.len() <= 1 {
        return true;
    }
    matches!(args[1].as_str(), "--open-view" | "--wait-pid")
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WebhookPayload {
    pub event: String,
    pub timestamp: String,
    pub product: String,
    pub version: String,
    pub scope: String,
    pub target_count: usize,
    pub total_bytes: u64,
    pub total_human: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleaned_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleaned_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dry_run: Option<bool>,
}

pub fn handle_cli() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    if is_gui_launch_args(&args) {
        return None;
    }

    let first_arg = args[1].to_lowercase();

    // MCP speaks raw JSON-RPC over stdin/stdout pipes: never attach a console.
    if matches!(first_arg.as_str(), "mcp" | "--mcp") {
        let mut allow_destructive = false;
        for arg in &args[2..] {
            match arg.as_str() {
                "--allow-destructive" => allow_destructive = true,
                "-h" | "--help" => {
                    #[cfg(windows)]
                    attach_console();
                    println!("Usage: detergo mcp [--allow-destructive]");
                    return Some(0);
                }
                other => {
                    #[cfg(windows)]
                    attach_console();
                    eprintln!("error: unknown mcp flag '{other}'");
                    return Some(3);
                }
            }
        }
        crate::mcp::run_mcp_server_with_options(crate::mcp::McpOptions { allow_destructive });
        return Some(0);
    }

    #[cfg(windows)]
    attach_console();

    match first_arg.as_str() {
        "-h" | "--help" => {
            if args.len() == 2 {
                print_help();
                Some(0)
            } else {
                eprintln!(
                    "error: unexpected argument '{}'. Run `detergo -h` for usage.",
                    args[2]
                );
                Some(3)
            }
        }
        "help" => {
            if args.len() == 2 {
                print_help();
                Some(0)
            } else if args.len() == 3 {
                match args[2].to_lowercase().as_str() {
                    "s" | "scan" => {
                        print_scan_help();
                        Some(0)
                    }
                    "c" | "cache" | "caches" => {
                        print_caches_help();
                        Some(0)
                    }
                    "h" | "hist" | "history" => {
                        print_history_help();
                        Some(0)
                    }
                    "sys" | "system" => {
                        print!("{}", crate::system_cleaner::cli::USAGE);
                        Some(0)
                    }
                    "mcp" => {
                        println!("Usage: detergo mcp [--allow-destructive]");
                        Some(0)
                    }
                    other => {
                        eprintln!("Unknown command: {other}");
                        Some(3)
                    }
                }
            } else {
                eprintln!(
                    "error: unexpected argument '{}'. Run `detergo -h` for usage.",
                    args[3]
                );
                Some(3)
            }
        }
        "-v" | "--version" | "version" => {
            println!("Detergo - {} {}", t("Version"), env!("CARGO_PKG_VERSION"));
            Some(0)
        }
        "caches" | "cache" | "c" => match run_caches_cli(&args[2..]) {
            Ok(()) => Some(0),
            Err(err) => {
                eprintln!("caches failed: {err}");
                Some(scan_exit_code(&err))
            }
        },
        "history" | "hist" | "h" => match run_history_cli(&args[2..]) {
            Ok(()) => Some(0),
            Err(err) => {
                eprintln!("history failed: {err}");
                Some(scan_exit_code(&err))
            }
        },
        "scan" | "s" => match run_scan_cli(&args[2..]) {
            Ok(()) => Some(0),
            Err(err) => {
                eprintln!("scan failed: {err}");
                Some(scan_exit_code(&err))
            }
        },
        "system" | "sys" => match crate::system_cleaner::cli::run(&args[2..]) {
            Ok(()) => Some(0),
            Err(err) => {
                eprintln!("system cleanup failed: {err}");
                Some(scan_exit_code(&err))
            }
        },
        other => {
            eprintln!("Unknown command: {other}");
            print_help();
            Some(3)
        }
    }
}

/// Exit codes are part of the automation contract:
/// 0 success, 1 scan failure, 2 cleanup failure, 3 argument error, 4 blocked.
pub(super) fn scan_exit_code(err: &AppError) -> i32 {
    match err {
        AppError::InvalidPath(_) | AppError::PathNotFound(_) => 3,
        AppError::Blocked(_) | AppError::UnsafeDeleteTarget(_) | AppError::PlanInvalid(_) => 4,
        AppError::PermanentDeleteFailed(_) | AppError::RecycleBinFailed(_) => 2,
        _ => 1,
    }
}

pub(super) fn format_size(bytes: u64) -> String {
    crate::format::human_bytes(bytes)
}

/// A webhook URL is a bearer credential: Discord/Slack embed a channel token in
/// the path. Logs are long-lived (Task Scheduler, CI), so only the origin is
/// ever printed.
pub(super) fn redact_webhook_url(url: &str) -> String {
    match reqwest::Url::parse(url) {
        Ok(parsed) => match (parsed.host_str(), parsed.port()) {
            (Some(host), Some(port)) => format!("{}://{}:{}", parsed.scheme(), host, port),
            (Some(host), None) => format!("{}://{}", parsed.scheme(), host),
            (None, _) => "<webhook>".to_string(),
        },
        Err(_) => "<webhook>".to_string(),
    }
}

pub fn send_webhook_sync(url: &str, payload: &WebhookPayload, quiet: bool) {
    let allow_private = crate::settings::SettingsRepository::new()
        .load()
        .allow_private_webhooks;
    send_webhook_sync_with_policy(url, payload, quiet, allow_private);
}

pub(super) fn send_webhook_sync_with_policy(
    url: &str,
    payload: &WebhookPayload,
    quiet: bool,
    allow_private: bool,
) {
    let body = match serde_json::to_value(payload) {
        Ok(value) => value,
        Err(err) => {
            eprintln!(
                "  {}",
                tf("[WARN] Webhook serialization error: {}", &[&err])
            );
            return;
        }
    };

    match crate::commands::webhook_commands::post_webhook_blocking_with_policy(
        url,
        &body,
        allow_private,
    ) {
        Ok(result) if result.ok => {
            let message = tf(
                "[OK] Webhook successfully dispatched: {}",
                &[&redact_webhook_url(url)],
            );
            if quiet {
                eprintln!("  {message}");
            } else {
                println!("  {message}");
            }
        }
        Ok(result) => {
            eprintln!(
                "  {}",
                tf(
                    "[WARN] Webhook warning: Target server returned {}.",
                    &[&result.status]
                )
            );
        }
        Err(err) => {
            eprintln!(
                "  {}",
                tf("[WARN] Webhook warning: Request failed: {}", &[&err])
            );
        }
    }
}
