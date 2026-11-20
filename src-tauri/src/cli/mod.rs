use crate::cleanup::DeleteMode;
use crate::commands::AppState;
use crate::error::AppError;
use crate::scanner::models::ScanScope;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io::{self, Write};
use std::path::PathBuf;

pub mod i18n;

use i18n::{t, tf};

/// Attaches to the parent terminal console while preserving any redirected
/// `stdin`, `stdout`, or `stderr` handles (pipes or file redirections such as
/// `dev-cleaner s . -j | ConvertFrom-Json` or `> report.json`).
///
/// Never called for GUI launch flags (`--open-view`, `--wait-pid`) or `mcp`
/// stdio server mode.
#[cfg(windows)]
pub fn attach_console() {
    use windows::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE};
    use windows::Win32::Storage::FileSystem::{GetFileType, FILE_TYPE_DISK, FILE_TYPE_PIPE};
    use windows::Win32::System::Console::{
        AttachConsole, GetStdHandle, SetStdHandle, ATTACH_PARENT_PROCESS, STD_ERROR_HANDLE,
        STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
    };

    unsafe {
        let is_redirected = |h: HANDLE| -> bool {
            if h.is_invalid() || h == INVALID_HANDLE_VALUE || h.0.is_null() {
                return false;
            }
            let kind = GetFileType(h);
            kind == FILE_TYPE_PIPE || kind == FILE_TYPE_DISK
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
                    println!("Usage: dev-cleaner mcp [--allow-destructive]");
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
                    "error: unexpected argument '{}'. Run `dev-cleaner -h` for usage.",
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
                        println!("Usage: dev-cleaner mcp [--allow-destructive]");
                        Some(0)
                    }
                    other => {
                        eprintln!("Unknown command: {other}");
                        Some(3)
                    }
                }
            } else {
                eprintln!(
                    "error: unexpected argument '{}'. Run `dev-cleaner -h` for usage.",
                    args[3]
                );
                Some(3)
            }
        }
        "-v" | "--version" | "version" => {
            println!(
                "Dev Cleaner — {} {}",
                t("Version"),
                env!("CARGO_PKG_VERSION")
            );
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
fn scan_exit_code(err: &AppError) -> i32 {
    match err {
        AppError::InvalidPath(_) | AppError::PathNotFound(_) => 3,
        AppError::Blocked(_) | AppError::UnsafeDeleteTarget(_) | AppError::PlanInvalid(_) => 4,
        AppError::PermanentDeleteFailed(_) | AppError::RecycleBinFailed(_) => 2,
        _ => 1,
    }
}

/// Parsed multi-target selection for `-t` / `--targets`.
#[derive(Debug, Default, PartialEq, Eq)]
struct TargetSelection {
    projects: bool,
    agents: bool,
    caches: bool,
    system: bool,
    all_drives: bool,
}

impl TargetSelection {
    fn parse(raw: &str) -> Result<Self, AppError> {
        let mut sel = Self::default();
        for token in raw.split(',').map(|s| s.trim().to_lowercase()) {
            if token.is_empty() {
                continue;
            }
            match token.as_str() {
                "p" | "project" | "projects" => sel.projects = true,
                "a" | "agent" | "agents" => sel.agents = true,
                "c" | "cache" | "caches" => sel.caches = true,
                "s" | "sys" | "system" => sel.system = true,
                "drives" | "all-drives" => {
                    sel.projects = true;
                    sel.all_drives = true;
                }
                "combined" => {
                    sel.projects = true;
                    sel.agents = true;
                }
                "all" => {
                    sel.projects = true;
                    sel.agents = true;
                    sel.caches = true;
                    sel.system = true;
                }
                other => {
                    return Err(AppError::InvalidPath(format!(
                        "Unknown target '{other}'; use p(projects), a(agents), c(caches), s(system), drives or all."
                    )));
                }
            }
        }
        if !sel.projects && !sel.agents && !sel.caches && !sel.system {
            return Err(AppError::InvalidPath(
                "No target selected; use -t p,a,c,s or -t all.".to_string(),
            ));
        }
        Ok(sel)
    }

    fn scanner_scope(&self) -> Option<ScanScope> {
        if self.all_drives {
            Some(ScanScope::AllDrives)
        } else if self.projects && self.agents {
            Some(ScanScope::Combined)
        } else if self.projects {
            Some(ScanScope::Project)
        } else if self.agents {
            Some(ScanScope::Agents)
        } else {
            None
        }
    }
}

/// Maps the CLI `--scope` value to the scanner scope. `all` means a full-drive
/// scan, matching the frontend's `allDrives` mode.
///
/// `caches` is deliberately absent: package-cache maintenance is a separate
/// command with its own confirmation flags (`caches --clean all --yes`), and
/// the scanner scope always rejected it with `PlatformUnsupported`.
fn parse_scan_scope(scope: &str) -> Result<ScanScope, AppError> {
    match scope {
        "projects" | "project" | "p" => Ok(ScanScope::Project),
        "agents" | "agent" | "a" => Ok(ScanScope::Agents),
        "all" | "drives" => Ok(ScanScope::AllDrives),
        // Same meaning as the GUI's "scan everything": projects and agent
        // storage in one session. Package caches stay a separate command.
        "combined" => Ok(ScanScope::Combined),
        "caches" => Err(AppError::InvalidPath(
            "'--scope caches' is not a scan scope. Use 'caches' to list package caches or \
             'caches --clean all --yes' to clean them."
                .to_string(),
        )),
        other => Err(AppError::InvalidPath(format!(
            "Unknown scope '{other}'; expected projects, agents, combined or all."
        ))),
    }
}

fn print_help() {
    let width = 66;
    let rule = "=".repeat(width);
    let mut out = String::new();
    out.push_str(&format!("\n{rule}\n"));
    out.push_str(&format!(
        "  {} (v{})\n",
        t("DEV CLEANER by VELLIUM — CLI, MCP & Automation Engine"),
        env!("CARGO_PKG_VERSION")
    ));
    out.push_str(&format!("{rule}\n\n"));

    out.push_str(&format!("{}\n", t("USAGE:")));
    out.push_str(&format!("  {}\n\n", t("dev-cleaner [COMMAND] [OPTIONS]")));

    out.push_str(&format!("{}\n", t("COMMANDS:")));
    for line in [
        "  s, scan [DIR]            Scan selected targets (-t p,a,c,s | all | drives)",
        "  c, cache [TOOL|all]      List or clean developer tool caches (-n dry, -y confirm)",
        "  sys [PROFILE|IDS]        Clean C: drive temp, Prefetch, Windows Update (-l, -n, -y)",
        "  h, hist [N]              Show past cleanup & audit records (-l N, -j)",
        "  mcp                      Start the Model Context Protocol (MCP) stdio server",
    ] {
        out.push_str(&format!("{line}\n"));
    }
    out.push('\n');

    out.push_str(&format!("{}\n", t("SCAN OPTIONS:")));
    for line in [
        "  -t, --targets <LIST>     p(projects), a(agents), c(caches), s(system), all, drives",
        "  -c, --clean              Move matching safe targets to Recycle Bin (--auto-clean)",
        "  -n, --dry                Preview without deleting anything (--dry-run)",
        "  -s, --safety <LEVELS>    safe,regenerate,review (default: safe,regenerate)",
        "  -m, --min <MB>           Only include targets >= MB (--min-size)",
        "  -i, --interactive        Pick targets by number, then move to Recycle Bin",
        "  -a, --all                List every discovered target (--top N limits rows)",
        "  -j, --json               Emit machine-readable JSON output",
        "  -w, --webhook <URL>      POST summary to n8n, Slack, or Discord",
        "  --scope <SCOPE>          Legacy alias: projects | agents | combined | all",
        "  -h, --help / -v          Show help or version",
    ] {
        out.push_str(&format!("{line}\n"));
    }
    out.push('\n');

    out.push_str(&format!("{}\n", t("EXAMPLES:")));
    for line in [
        "dev-cleaner s .",
        "dev-cleaner s D:\\Projects -t p,a",
        "dev-cleaner s -t all",
        "dev-cleaner s D:\\Projects -c -n",
        "dev-cleaner s . -i",
        "dev-cleaner c npm",
        "dev-cleaner c all -n",
        "dev-cleaner sys quick -n",
        "dev-cleaner sys quick -y",
        "dev-cleaner hist -l 15 -j",
    ] {
        out.push_str(&format!("  {line}\n"));
    }
    print!("{out}");
}

fn format_size(bytes: u64) -> String {
    crate::format::human_bytes(bytes)
}

/// Parses a size argument for `-m`/`--min`/`--min-size`.
///
/// Bare numbers keep backwards compatibility as megabytes (e.g. `-m 50` = 50 MiB).
/// Explicit suffixes (`B`, `K`/`KB`/`KiB`, `M`/`MB`/`MiB`, `G`/`GB`/`GiB`,
/// `T`/`TB`/`TiB`, including decimals like `1.5GB`) are converted to bytes.
/// Invalid text fails closed with `AppError::InvalidPath` (exit code 3).
fn parse_human_size(raw: &str) -> Result<u64, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.starts_with('-') {
        return Err(AppError::InvalidPath(format!(
            "Invalid size '{raw}'; use e.g. 50 (MB), 500KB, 500MB, or 1.5GB."
        )));
    }
    let split_idx = trimmed
        .find(|c: char| !c.is_ascii_digit() && c != '.')
        .unwrap_or(trimmed.len());
    let (num_part, unit_part) = trimmed.split_at(split_idx);
    let value: f64 = num_part.parse().map_err(|_| {
        AppError::InvalidPath(format!(
            "Invalid size '{raw}'; use e.g. 50 (MB), 500KB, 500MB, or 1.5GB."
        ))
    })?;
    if !value.is_finite() || value < 0.0 {
        return Err(AppError::InvalidPath(format!(
            "Invalid size '{raw}'; size must be a non-negative number."
        )));
    }
    let multiplier: f64 = match unit_part.trim().to_ascii_lowercase().as_str() {
        "" | "m" | "mb" | "mib" => 1024.0 * 1024.0,
        "b" => 1.0,
        "k" | "kb" | "kib" => 1024.0,
        "g" | "gb" | "gib" => 1024.0 * 1024.0 * 1024.0,
        "t" | "tb" | "tib" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        other => {
            return Err(AppError::InvalidPath(format!(
                "Unknown size unit '{other}' in '{raw}'; use B, KB, MB, GB, or TB."
            )));
        }
    };
    let bytes = value * multiplier;
    if bytes >= u64::MAX as f64 {
        Ok(u64::MAX)
    } else {
        Ok(bytes.round() as u64)
    }
}

fn measure_detected_caches() -> Vec<crate::cleanup::official_actions::CacheProviderInfo> {
    let mut providers = crate::cleanup::official_actions::list_cache_providers();
    let detected_ids: Vec<String> = providers
        .iter()
        .filter(|p| p.detected)
        .map(|p| p.id.clone())
        .collect();
    if detected_ids.is_empty() {
        return providers;
    }
    type PathSizeEntry = (bool, Option<u64>, Option<String>);
    let token = crate::scanner::cancellation::CancellationToken::new();
    let mut totals: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    let mut path_sizes: std::collections::HashMap<(String, String), PathSizeEntry> =
        std::collections::HashMap::new();

    crate::cleanup::official_actions::measure_cache_providers(
        &token,
        Some(&detected_ids),
        |event| match event {
            crate::cleanup::official_actions::CacheMeasureEvent::PathMeasured {
                provider_id,
                path,
                exists,
                bytes,
                unmeasured_reason,
            } => {
                path_sizes.insert((provider_id, path), (exists, bytes, unmeasured_reason));
            }
            crate::cleanup::official_actions::CacheMeasureEvent::ProviderFinished {
                provider_id,
                total_bytes,
            } => {
                totals.insert(provider_id, total_bytes);
            }
            _ => {}
        },
    );

    for provider in &mut providers {
        if let Some(&total) = totals.get(&provider.id) {
            provider.total_bytes = total;
            provider.measured = true;
        }
        for cp in &mut provider.cache_paths {
            if let Some((exists, bytes, reason)) =
                path_sizes.get(&(provider.id.clone(), cp.path.clone()))
            {
                cp.exists = *exists;
                cp.bytes = *bytes;
                cp.unmeasured_reason = reason.clone();
            }
        }
    }
    providers
}

fn print_scan_help() {
    println!(
        "\
Usage:
  dev-cleaner s [DIR] [OPTIONS]

Targets (-t, --targets):
  p(projects), a(agents), c(caches), s(system), drives, all

Options:
  -c, --clean              Move matching safe targets to Recycle Bin (--auto-clean)
  -n, --dry                Preview without deleting anything (--dry-run)
  -s, --safety <LEVELS>    safe,regenerate,review,keep (default: safe,regenerate)
  -m, --min <SIZE>         Minimum size threshold (e.g. 50, 500KB, 500MB, 1.5GB)
  -i, --interactive        Pick targets by number, then move to Recycle Bin
  -a, --all                List every discovered target (--top N limits rows)
  -j, --json               Emit machine-readable JSON output
  -w, --webhook <URL>      POST summary to n8n, Slack, or Discord
  --scope <SCOPE>          Legacy alias: projects | agents | combined | all

Examples:
  dev-cleaner s .
  dev-cleaner s D:\\Projects -t p,a -m 50MB
  dev-cleaner s -t all -j
  dev-cleaner s D:\\Projects -cn
"
    );
}

fn print_caches_help() {
    println!(
        "\
Usage:
  dev-cleaner c [-j]                       List & measure developer tool caches
  dev-cleaner c <tool|all> -n [-j]         Preview cache cleanup (--dry-run)
  dev-cleaner c <tool|all> -y [-j]         Clean cache via official tool command (--yes)
"
    );
}

fn print_history_help() {
    println!(
        "\
Usage:
  dev-cleaner hist [N] [-l N] [-j]         Show past cleanup audit records
"
    );
}

fn run_caches_cli(args: &[String]) -> Result<(), AppError> {
    let mut help = false;
    let mut as_json = false;
    let mut dry_run = false;
    let mut confirmed = false;
    let mut clean_target: Option<String> = None;

    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        match arg.as_str() {
            "-h" | "--help" => help = true,
            "-j" | "--json" => as_json = true,
            "-n" | "--dry" | "--dry-run" => dry_run = true,
            "-y" | "--yes" => confirmed = true,
            "-c" | "--clean" => {
                let value = args.get(i + 1).ok_or_else(|| {
                    AppError::InvalidPath(format!("Missing tool name after '{arg}'."))
                })?;
                clean_target = Some(value.clone());
                i += 1;
            }
            other if other.starts_with("--") => {
                return Err(AppError::InvalidPath(format!(
                    "Unknown flag '{other}'. Run `dev-cleaner c -h` for usage."
                )));
            }
            other if other.starts_with('-') && other.len() > 1 => {
                for ch in other[1..].chars() {
                    match ch {
                        'h' => help = true,
                        'j' => as_json = true,
                        'n' => dry_run = true,
                        'y' => confirmed = true,
                        unknown => {
                            return Err(AppError::InvalidPath(format!(
                                "Unknown flag '-{unknown}'. Run `dev-cleaner c -h` for usage."
                            )));
                        }
                    }
                }
            }
            positional => {
                if clean_target.is_some() {
                    return Err(AppError::InvalidPath(format!(
                        "Unexpected argument '{positional}'."
                    )));
                }
                clean_target = Some(positional.to_string());
            }
        }
        i += 1;
    }

    if help {
        print_caches_help();
        return Ok(());
    }

    if let Some(ref target) = clean_target {
        if !confirmed && !dry_run {
            eprintln!(
                "  Refusing to clean cache '{target}' without -y/--yes. Re-run with -y/--yes, or use -n/--dry-run to preview."
            );
            return Err(AppError::InvalidPath(format!(
                "--yes is required for `caches {target}`"
            )));
        }
        let state = AppState::new();
        let settings = state.settings.load();
        if !settings.agent_policy.allow_cache_cleanup {
            return Err(AppError::Blocked(
                "Cache cleanup is disabled in Settings → Safety & Policy → AI agent policy."
                    .to_string(),
            ));
        }
        let providers = crate::cleanup::official_actions::list_cache_providers();
        let registry = crate::cleanup::official_actions::OfficialActionRegistry::new();
        let mut executed = Vec::new();
        let mut failures = 0usize;

        for p in &providers {
            if !p.detected {
                continue;
            }
            if target != "all"
                && !p.id.eq_ignore_ascii_case(target)
                && !p.name.eq_ignore_ascii_case(target)
            {
                continue;
            }

            for action in &p.actions {
                if dry_run {
                    executed.push(json!({
                        "provider": p.id,
                        "action": action.id,
                        "success": true,
                        "dry_run": true,
                        "available": action.available
                    }));
                    continue;
                }
                match crate::cleanup::official_actions::preview_action(
                    &registry,
                    &p.id,
                    &action.id,
                    &crate::scanner::cancellation::CancellationToken::new(),
                ) {
                    Ok(preview) => {
                        match crate::cleanup::official_actions::execute_action(
                            &registry,
                            &preview.token,
                        ) {
                            Ok(res) => {
                                if settings.history_enabled {
                                    let record = crate::audit::ActionAuditRecord {
                                        id: format!("a-{}", uuid::Uuid::new_v4().simple()),
                                        timestamp: chrono::Local::now().to_rfc3339(),
                                        provider_id: res.provider_id.clone(),
                                        action_id: res.action_id.clone(),
                                        label: res.label.clone(),
                                        success: res.success,
                                        exit_code: res.exit_code,
                                        before_bytes: res.before_bytes,
                                        after_bytes: res.after_bytes,
                                        delta_bytes: res.delta_bytes,
                                        duration_ms: res.duration_ms,
                                    };
                                    let _ = state.audit.append_action(&record);
                                }
                                if !res.success {
                                    failures += 1;
                                }
                                let reclaimed = res.before_bytes.saturating_sub(res.after_bytes);
                                executed.push(json!({
                                    "provider": p.id,
                                    "action": action.id,
                                    "success": res.success,
                                    "reclaimed_bytes": reclaimed,
                                    "exit_code": res.exit_code,
                                    "stdout": res.stdout_tail
                                }));
                            }
                            Err(e) => {
                                failures += 1;
                                executed.push(json!({
                                    "provider": p.id,
                                    "action": action.id,
                                    "success": false,
                                    "error": format!("{e}")
                                }));
                            }
                        }
                    }
                    Err(e) => {
                        failures += 1;
                        executed.push(json!({
                            "provider": p.id,
                            "action": action.id,
                            "success": false,
                            "error": format!("{e}")
                        }));
                    }
                }
            }
        }

        if as_json {
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "product": "Dev Cleaner by Vellium",
                    "status": if dry_run {
                        "dry_run"
                    } else if failures == 0 {
                        "success"
                    } else {
                        "partial"
                    },
                    "clean_target": target,
                    "executed": executed
                }))
                .unwrap_or_default()
            );
        } else {
            println!(
                "\n{}",
                tf("[Dev Cleaner] Official CLI Cache Cleanup: {}", &[&target])
            );
            for item in &executed {
                let success = item
                    .get("success")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let prov = item.get("provider").and_then(|v| v.as_str()).unwrap_or("");
                let act = item.get("action").and_then(|v| v.as_str()).unwrap_or("");
                let reclaimed = item
                    .get("reclaimed_bytes")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                if success {
                    println!(
                        "  {}",
                        tf(
                            "[OK] {} ({}): Success — Reclaimed: {}",
                            &[&prov, &act, &format_size(reclaimed)]
                        )
                    );
                } else {
                    let err = item
                        .get("error")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| t("Unknown error"));
                    println!(
                        "  {}",
                        tf("[WARN] {} ({}): Failed ({})", &[&prov, &act, &err])
                    );
                }
            }
            println!();
        }
        if failures > 0 {
            return Err(AppError::RecycleBinFailed(format!(
                "{} cache action(s) failed.",
                failures
            )));
        }
        return Ok(());
    }

    let providers = measure_detected_caches();
    if as_json {
        let json = serde_json::to_string_pretty(&providers).unwrap_or_default();
        println!("{}", json);
        return Ok(());
    }

    println!("\n--- {} ---", t("Dev Cleaner: Developer Tool Caches"));
    println!(
        "{:<20} {:<15} {:>12}  {:<24}",
        t("Tool / Package"),
        t("Version"),
        t("Size"),
        t("Status")
    );
    println!("{:-<75}", "");
    let installed = t("Installed / Detected");
    let missing = t("Not found");
    let providers_count = providers.len();
    let mut total_bytes = 0u64;
    for p in providers {
        let status = if p.detected {
            installed.as_str()
        } else {
            missing.as_str()
        };
        let ver = p.version.unwrap_or_else(|| "-".to_string());
        let size_str = if p.measured {
            total_bytes = total_bytes.saturating_add(p.total_bytes);
            format_size(p.total_bytes)
        } else {
            "-".to_string()
        };
        println!(
            "{:<20} {:<15} {:>12}  {:<24}",
            p.name, ver, size_str, status
        );
    }
    println!(
        "\nMeasured total: {} — {}\n",
        format_size(total_bytes),
        tf(
            "Checked {} tools in total. To clean: dev-cleaner c <tool|all> -y",
            &[&providers_count]
        )
    );
    Ok(())
}

fn run_history_cli(args: &[String]) -> Result<(), AppError> {
    let mut help = false;
    let mut as_json = false;
    let mut limit = 20usize;

    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        match arg.as_str() {
            "-h" | "--help" => help = true,
            "-j" | "--json" => as_json = true,
            "-l" | "--limit" => {
                let raw = args.get(i + 1).ok_or_else(|| {
                    AppError::InvalidPath(format!("Missing count after '{arg}'."))
                })?;
                limit = raw.parse::<usize>().map_err(|_| {
                    AppError::InvalidPath(format!(
                        "Invalid limit '{raw}'; expected positive integer."
                    ))
                })?;
                i += 1;
            }
            other if other.starts_with("--") => {
                return Err(AppError::InvalidPath(format!(
                    "Unknown flag '{other}'. Run `dev-cleaner hist -h` for usage."
                )));
            }
            other if other.starts_with('-') && other.len() > 1 => {
                for ch in other[1..].chars() {
                    match ch {
                        'h' => help = true,
                        'j' => as_json = true,
                        unknown => {
                            return Err(AppError::InvalidPath(format!(
                                "Unknown flag '-{unknown}'. Run `dev-cleaner hist -h` for usage."
                            )));
                        }
                    }
                }
            }
            positional => {
                limit = positional.parse::<usize>().map_err(|_| {
                    AppError::InvalidPath(format!(
                        "Invalid limit '{positional}'; expected positive integer."
                    ))
                })?;
            }
        }
        i += 1;
    }

    if help {
        print_history_help();
        return Ok(());
    }

    let state = AppState::new();
    let records = state.audit.list_records(limit);

    if as_json {
        println!(
            "{}",
            serde_json::to_string_pretty(&records).unwrap_or_default()
        );
        return Ok(());
    }

    println!(
        "\n--- {} ---",
        tf("Dev Cleaner: Past Cleanup Records (Last {})", &[&limit])
    );
    println!(
        "{:<22} {:<15} {:<12} {:<15} {:<15}",
        t("Date"),
        t("Plan ID"),
        t("Targets"),
        t("Reclaimed Space"),
        t("Delete Mode")
    );
    println!("{:-<80}", "");

    if records.is_empty() {
        println!("  {}", t("No cleanup history recorded yet."));
    } else {
        let recycle = t("Recycle Bin");
        let permanent = t("Permanent");
        for r in records {
            let mode = match r.mode {
                DeleteMode::RecycleBin => recycle.as_str(),
                DeleteMode::Permanent => permanent.as_str(),
            };
            let date = if r.timestamp.len() >= 19 {
                &r.timestamp[..19]
            } else {
                &r.timestamp
            };
            let display_bytes = r.moved_bytes.max(r.reclaim_bytes);
            println!(
                "{:<22} {:<15} {:<12} {:<15} {:<15}",
                date,
                r.plan_id,
                r.success_count,
                format_size(display_bytes),
                mode
            );
        }
    }
    println!();
    Ok(())
}

fn safety_label(item: &crate::scanner::models::CleanupItem) -> String {
    serde_json::to_string(&item.safety_class)
        .unwrap_or_default()
        .replace('"', "")
        .to_lowercase()
}

fn print_targets(items: &[&crate::scanner::models::CleanupItem], limit: Option<usize>) {
    println!("\n{}", t("Targets (largest first):"));
    println!("{:>10}  {:<12}  {}", t("Size"), t("Safety"), t("Target"));
    println!("{}", "-".repeat(78));
    let shown = limit
        .map(|count| count.min(items.len()))
        .unwrap_or(items.len());
    for item in items.iter().take(shown) {
        let marker = if item.selectable {
            ""
        } else {
            "  [not selectable]"
        };
        println!(
            "{:>10}  {:<12}  {}{}",
            format_size(item.estimated_reclaim_bytes.unwrap_or(0)),
            safety_label(item),
            item.display_path,
            marker
        );
    }
    if shown < items.len() {
        println!(
            "  {}",
            tf(
                "... {} more; use --all or --top N to list them.",
                &[&(items.len() - shown)]
            )
        );
    }
}

fn print_numbered_targets(items: &[&crate::scanner::models::CleanupItem]) {
    println!("\n{}", t("Selectable targets (largest first):"));
    println!(
        "{:>3}  {:>10}  {:<12}  {}",
        "#",
        t("Size"),
        t("Safety"),
        t("Target")
    );
    println!("{}", "-".repeat(80));
    for (index, item) in items.iter().enumerate() {
        println!(
            "{:>3}  {:>10}  {:<12}  {}",
            index + 1,
            format_size(item.estimated_reclaim_bytes.unwrap_or(0)),
            safety_label(item),
            item.display_path
        );
    }
}

/// Parses `1,3-5` (commas or spaces) into unique, sorted, zero-based indices.
/// Invalid fragments and out-of-range numbers are ignored, so a typo can never
/// select a target the user did not name.
fn parse_selection(input: &str, len: usize) -> Vec<usize> {
    let trimmed = input.trim().to_lowercase();
    if trimmed.is_empty() || trimmed == "none" {
        return Vec::new();
    }
    if trimmed == "all" {
        return (0..len).collect();
    }
    let mut chosen = Vec::new();
    for part in trimmed.split(|c: char| c == ',' || c.is_whitespace()) {
        if part.is_empty() {
            continue;
        }
        if let Some((start, end)) = part.split_once('-') {
            if let (Ok(start), Ok(end)) = (start.parse::<usize>(), end.parse::<usize>()) {
                if start >= 1 && end >= start {
                    for value in start..=end.min(len) {
                        let index = value - 1;
                        if index < len && !chosen.contains(&index) {
                            chosen.push(index);
                        }
                    }
                }
            }
        } else if let Ok(value) = part.parse::<usize>() {
            let index = value.saturating_sub(1);
            if value >= 1 && index < len && !chosen.contains(&index) {
                chosen.push(index);
            }
        }
    }
    chosen.sort_unstable();
    chosen
}

#[derive(Debug)]
struct ScanCliArgs {
    help: bool,
    root_path: PathBuf,
    scope: String,
    targets_arg: Option<String>,
    as_json: bool,
    auto_clean: bool,
    dry_run: bool,
    min_size_bytes: u64,
    safety_levels: Vec<String>,
    webhook_url: Option<String>,
    top: Option<usize>,
    show_all: bool,
    interactive: bool,
}

fn parse_scan_args(args: &[String]) -> Result<ScanCliArgs, AppError> {
    let mut parsed = ScanCliArgs {
        help: false,
        root_path: PathBuf::from("."),
        scope: "projects".to_string(),
        targets_arg: None,
        as_json: false,
        auto_clean: false,
        dry_run: false,
        min_size_bytes: 0,
        safety_levels: vec!["safe".to_string(), "regenerate".to_string()],
        webhook_url: None,
        top: None,
        show_all: false,
        interactive: false,
    };
    let mut root_set = false;

    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        match arg.as_str() {
            "-h" | "--help" => parsed.help = true,
            "-j" | "--json" => parsed.as_json = true,
            "-c" | "--clean" | "--auto-clean" => parsed.auto_clean = true,
            "-n" | "--dry" | "--dry-run" => parsed.dry_run = true,
            "-a" | "--all" => parsed.show_all = true,
            "-i" | "--interactive" => parsed.interactive = true,
            "--top" => {
                let raw = args.get(i + 1).ok_or_else(|| {
                    AppError::InvalidPath("Missing number after '--top'.".to_string())
                })?;
                let count = raw
                    .parse::<usize>()
                    .map_err(|_| AppError::InvalidPath(format!("Invalid --top value '{raw}'.")))?;
                parsed.top = Some(count.max(1));
                i += 1;
            }
            "-t" | "--targets" => {
                let raw = args.get(i + 1).ok_or_else(|| {
                    AppError::InvalidPath(format!("Missing target list after '{arg}'."))
                })?;
                parsed.targets_arg = Some(raw.clone());
                i += 1;
            }
            "--scope" => {
                let raw = args.get(i + 1).ok_or_else(|| {
                    AppError::InvalidPath("Missing scope after '--scope'.".to_string())
                })?;
                parsed.scope = raw.clone();
                i += 1;
            }
            "-s" | "--safety" => {
                let raw = args.get(i + 1).ok_or_else(|| {
                    AppError::InvalidPath(format!("Missing levels after '{arg}'."))
                })?;
                parsed.safety_levels = raw.split(',').map(|s| s.trim().to_lowercase()).collect();
                i += 1;
            }
            "-m" | "--min" | "--min-size" => {
                let raw = args
                    .get(i + 1)
                    .ok_or_else(|| AppError::InvalidPath(format!("Missing size after '{arg}'.")))?;
                parsed.min_size_bytes = parse_human_size(raw)?;
                i += 1;
            }
            "-w" | "--webhook" => {
                let raw = args
                    .get(i + 1)
                    .ok_or_else(|| AppError::InvalidPath(format!("Missing URL after '{arg}'.")))?;
                parsed.webhook_url = Some(raw.clone());
                i += 1;
            }
            other if other.starts_with("--") => {
                return Err(AppError::InvalidPath(format!(
                    "Unknown flag '{other}'. Run `dev-cleaner s -h` for valid options."
                )));
            }
            other if other.starts_with('-') && other.len() > 1 => {
                for ch in other[1..].chars() {
                    match ch {
                        'h' => parsed.help = true,
                        'j' => parsed.as_json = true,
                        'c' => parsed.auto_clean = true,
                        'n' => parsed.dry_run = true,
                        'a' => parsed.show_all = true,
                        'i' => parsed.interactive = true,
                        unknown => {
                            return Err(AppError::InvalidPath(format!(
                                "Unknown flag '-{unknown}'. Run `dev-cleaner s -h` for valid options."
                            )));
                        }
                    }
                }
            }
            positional => {
                if root_set {
                    return Err(AppError::InvalidPath(format!(
                        "Unexpected positional argument '{positional}'."
                    )));
                }
                parsed.root_path = PathBuf::from(positional);
                root_set = true;
            }
        }
        i += 1;
    }

    Ok(parsed)
}

fn run_scan_cli(args: &[String]) -> Result<(), AppError> {
    let parsed = parse_scan_args(args)?;
    if parsed.help {
        print_scan_help();
        return Ok(());
    }
    let root_path = parsed.root_path;
    let scope = parsed.scope;
    let targets_arg = parsed.targets_arg;
    let as_json = parsed.as_json;
    let mut auto_clean = parsed.auto_clean;
    let dry_run = parsed.dry_run;
    let min_bytes = parsed.min_size_bytes;
    let safety_levels = parsed.safety_levels;
    let webhook_url = parsed.webhook_url;
    let top = parsed.top;
    let show_all = parsed.show_all;
    let interactive = parsed.interactive;

    let selected_targets = if let Some(raw) = &targets_arg {
        Some(TargetSelection::parse(raw)?)
    } else {
        None
    };
    let include_caches = selected_targets.as_ref().is_some_and(|t| t.caches);
    let include_system = selected_targets.as_ref().is_some_and(|t| t.system);

    // When `-t` picks only caches and/or system (no project/agent walk), run
    // those measurements directly without requiring a project directory walk.
    if let Some(ref sel) = selected_targets {
        if sel.scanner_scope().is_none() {
            let caches_data = if include_caches {
                Some(measure_detected_caches())
            } else {
                None
            };
            let system_data = if include_system {
                let elevated = crate::platform::is_elevated();
                let token = crate::scanner::cancellation::CancellationToken::new();
                Some(crate::system_cleaner::measure::scan(elevated, &token).actions)
            } else {
                None
            };
            if as_json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&json!({
                        "product": "Dev Cleaner by Vellium",
                        "version": env!("CARGO_PKG_VERSION"),
                        "targets": targets_arg,
                        "caches": caches_data,
                        "system": system_data,
                    }))
                    .unwrap_or_default()
                );
            } else {
                if let Some(providers) = caches_data {
                    let detected = providers.iter().filter(|p| p.detected).count();
                    let cache_total: u64 = providers
                        .iter()
                        .filter(|p| p.measured)
                        .map(|p| p.total_bytes)
                        .sum();
                    println!(
                        "\n[Caches] {detected} / {} detected, {} measured (run `dev-cleaner c` for details)",
                        providers.len(),
                        format_size(cache_total)
                    );
                }
                if let Some(actions) = system_data {
                    let total: u64 = actions.iter().filter(|a| a.measured).map(|a| a.bytes).sum();
                    println!("\n[System C:] {} reclaimable across {} actions (run `dev-cleaner sys quick -n` to preview)", format_size(total), actions.len());
                }
            }
            return Ok(());
        }
    }

    // Reject typos instead of silently matching nothing (or, previously,
    // matching every class because the matcher used substring `contains`).
    const VALID_SAFETY_LEVELS: [&str; 4] = ["safe", "regenerate", "review", "keep"];
    if let Some(invalid) = safety_levels
        .iter()
        .find(|level| !VALID_SAFETY_LEVELS.contains(&level.as_str()))
    {
        return Err(AppError::InvalidPath(format!(
            "Unknown safety level '{invalid}'; use safe, regenerate, review or keep."
        )));
    }

    if interactive && as_json {
        return Err(AppError::InvalidPath(
            "--interactive writes a prompt to stdout and cannot be combined with --json."
                .to_string(),
        ));
    }
    if interactive && auto_clean {
        return Err(AppError::InvalidPath(
            "Choose either --interactive or --auto-clean, not both.".to_string(),
        ));
    }

    let scan_scope = if let Some(ref sel) = selected_targets {
        sel.scanner_scope().unwrap_or(ScanScope::Project)
    } else {
        parse_scan_scope(&scope)?
    };
    let effective_scope_label = targets_arg.as_deref().unwrap_or(scope.as_str());

    if !as_json {
        println!(
            "\n{}",
            tf("[Dev Cleaner] Starting scan: {}", &[&root_path.display()])
        );
        println!(
            "{}",
            tf("[Dev Cleaner] Scope: {}", &[&effective_scope_label])
        );
        if auto_clean {
            println!(
                "{}",
                tf(
                    "[Dev Cleaner] Autonomous Cleanup: Active (Dry-Run: {}, Safety: {})",
                    &[&dry_run, &safety_levels.join(", ")]
                )
            );
        }
    }

    if matches!(scan_scope, ScanScope::Project) && !root_path.exists() {
        if as_json {
            println!(
                "{}",
                json!({
                    "product": "Dev Cleaner by Vellium",
                    "status": "error",
                    "error": format!("Target not found: {}", root_path.display()),
                    "items": []
                })
            );
        } else {
            println!(
                "\n{}",
                tf(
                    "[ERROR] Error: Specified target directory not found: {}",
                    &[&root_path.display()]
                )
            );
        }
        return Err(AppError::PathNotFound(
            root_path.to_string_lossy().to_string(),
        ));
    }

    let state = AppState::new();
    let catalog = match state.catalog() {
        Ok(idx) => idx,
        Err(err) => {
            eprintln!("{}", tf("Failed to load catalog: {}", &[&err]));
            return Err(err);
        }
    };

    // H3: one scan path for GUI, CLI and MCP. The previous discovery-only call
    // left every size as `None`, so every row was 0 B, `--min-size` matched
    // nothing and `--auto-clean` had nothing to plan.
    let settings = state.settings.load();
    let policy = crate::cleanup::CleanupPolicy::from(&settings);
    let request = crate::scanner::models::ScanRequest {
        root_path: root_path.to_string_lossy().to_string(),
        exclusions: Vec::new(),
        scope: scan_scope,
        include_agents: selected_targets.as_ref().map(|sel| sel.agents),
        profile: None,
        max_depth: None,
        max_candidates: None,
        timeout_minutes: None,
        min_size_bytes: if min_bytes > 0 { Some(min_bytes) } else { None },
        protected_paths: Vec::new(),
    };

    let session =
        match crate::scanner::run_scan_blocking(request, catalog.clone(), &settings, &policy) {
            Ok((_, scanned)) => scanned,
            Err(err) => {
                eprintln!("\n[ERROR] {}: {}", t("Unknown error"), err);
                return Err(err);
            }
        };

    let items = session.items.clone();
    let total_items = items.len();
    let own = crate::scanner::own_bytes(&items);
    let total_bytes: u64 = items.iter().fold(0u64, |sum, item| {
        let bytes = own
            .get(&item.id)
            .map(|(_, allocated)| *allocated)
            .unwrap_or_else(|| item.estimated_reclaim_bytes.unwrap_or(0));
        sum.saturating_add(bytes)
    });

    // Prepare autonomous cleanup plan.
    let safety_name = |item: &crate::scanner::models::CleanupItem| {
        serde_json::to_string(&item.safety_class)
            .unwrap_or_default()
            .replace('"', "")
            .to_lowercase()
    };
    let is_candidate = |item: &crate::scanner::models::CleanupItem| {
        item.selectable
            && safety_levels
                .iter()
                .any(|level| level == &safety_name(item))
            && item.estimated_reclaim_bytes.unwrap_or(0) >= min_bytes
    };

    // Largest first: this is the order the terminal table and the interactive
    // numbers use, so "1" is always the biggest reclaimable target.
    let mut all_ranked: Vec<&crate::scanner::models::CleanupItem> = items.iter().collect();
    all_ranked.sort_by_key(|item| std::cmp::Reverse(item.estimated_reclaim_bytes.unwrap_or(0)));
    let mut candidates: Vec<&crate::scanner::models::CleanupItem> =
        items.iter().filter(|item| is_candidate(item)).collect();
    candidates.sort_by_key(|item| std::cmp::Reverse(item.estimated_reclaim_bytes.unwrap_or(0)));

    let mut matched_target_ids = Vec::new();
    let mut matched_bytes = 0u64;

    if !as_json {
        if interactive {
            print_numbered_targets(&candidates);
        } else {
            let limit = if show_all {
                None
            } else {
                Some(top.unwrap_or(20))
            };
            print_targets(&all_ranked, limit);
        }
    }

    if interactive {
        if candidates.is_empty() {
            println!("  {}", t("No selectable target matched the filters."));
        } else {
            print!("{} ", t("Select targets (e.g. 1,3-5 / all / none) [none]:"));
            let _ = io::stdout().flush();
            let mut input = String::new();
            let _ = io::stdin().read_line(&mut input);
            let chosen = parse_selection(input.trim(), candidates.len());
            if chosen.is_empty() {
                println!("  {}", t("Nothing selected."));
            } else {
                matched_target_ids = chosen
                    .iter()
                    .map(|&index| candidates[index].id.clone())
                    .collect();
                let selected_items: Vec<crate::scanner::models::CleanupItem> = chosen
                    .iter()
                    .map(|&index| candidates[index].clone())
                    .collect();
                let selected_own = crate::scanner::own_bytes(&selected_items);
                matched_bytes = selected_items.iter().fold(0u64, |sum, item| {
                    let bytes = selected_own
                        .get(&item.id)
                        .map(|(_, allocated)| *allocated)
                        .unwrap_or_else(|| item.estimated_reclaim_bytes.unwrap_or(0));
                    sum.saturating_add(bytes)
                });
                auto_clean = true;
            }
        }
    } else {
        // Exact class match: `contains` let `--safety e` select every class
        // whose name happened to contain "e". A target the scanner marked as
        // unselectable (active/locked/protected) must never enter an
        // autonomous plan even if its safety class is otherwise allowed.
        let candidate_items: Vec<crate::scanner::models::CleanupItem> =
            candidates.iter().map(|item| (*item).clone()).collect();
        let candidate_own = crate::scanner::own_bytes(&candidate_items);
        for item in &candidate_items {
            matched_target_ids.push(item.id.clone());
            let bytes = candidate_own
                .get(&item.id)
                .map(|(_, allocated)| *allocated)
                .unwrap_or_else(|| item.estimated_reclaim_bytes.unwrap_or(0));
            matched_bytes = matched_bytes.saturating_add(bytes);
        }
    }

    let mut cleaned_count = 0usize;
    let mut cleaned_bytes = 0u64;
    let mut clean_errors = Vec::new();
    let mut audit_error: Option<String> = None;

    if auto_clean && !matched_target_ids.is_empty() {
        if dry_run {
            cleaned_count = matched_target_ids.len();
            cleaned_bytes = matched_bytes;
            if !as_json {
                println!("\n{}", t("[DRY RUN SIMULATION]"));
                println!(
                    "  {}",
                    tf("Targets to move to Recycle Bin : {}", &[&cleaned_count])
                );
                println!(
                    "  {}",
                    tf(
                        "Disk Space to Reclaim          : {}",
                        &[&format_size(cleaned_bytes)]
                    )
                );
            }
        } else {
            match crate::cleanup::build_plan(
                &session,
                &matched_target_ids,
                DeleteMode::RecycleBin,
                &catalog,
                &policy,
            ) {
                Ok(plan) => {
                    let confirmation = plan.confirmation_token.clone();
                    match crate::cleanup::execute_plan(
                        &plan,
                        &session,
                        &catalog,
                        &policy,
                        &confirmation,
                        false,
                        &crate::scanner::cancellation::CancellationToken::new(),
                    ) {
                        Ok(report) => {
                            cleaned_count = report.success_count as usize;
                            // M6: a Recycle Bin move does not free disk space,
                            // so the honest figure is `moved_bytes`.
                            cleaned_bytes = if report.mode == DeleteMode::RecycleBin {
                                report.moved_bytes
                            } else {
                                report.reclaim_bytes
                            };
                            let audit_entry = crate::audit::AuditRecord {
                                id: format!("h-{}", uuid::Uuid::new_v4().simple()),
                                timestamp: report.finished_at.clone(),
                                session_id: plan.session_id.clone(),
                                plan_id: plan.id.clone(),
                                mode: report.mode,
                                success_count: report.success_count,
                                error_count: report.error_count,
                                reclaim_bytes: report.reclaim_bytes,
                                moved_bytes: report.moved_bytes,
                                duration_ms: report.duration_ms,
                                entries: report
                                    .results
                                    .iter()
                                    .map(|r| crate::audit::AuditEntry {
                                        target_id: r.target_id.clone(),
                                        rule_id: r.rule_id.clone(),
                                        path: r.display_path.clone(),
                                        success: r.success,
                                        verified: r.verified,
                                        error_code: r.error_code.clone(),
                                        bytes: r.measured_bytes,
                                    })
                                    .collect(),
                                cancelled: report.cancelled,
                                processed_count: report.processed_count,
                                skipped_count: report.skipped_count,
                            };
                            if let Err(err) = state.audit.append_record(&audit_entry) {
                                // The cleanup itself succeeded; only the audit
                                // trail is missing. Report it instead of
                                // pretending the run was fully recorded.
                                audit_error = Some(err.to_string());
                            }

                            for res in &report.results {
                                if !res.success {
                                    // Keep only the machine-readable error code here; the
                                    // backend `error` text is English-only and would leak
                                    // the source language into the localized CLI output.
                                    let reason = res
                                        .error_code
                                        .clone()
                                        .unwrap_or_else(|| t("Unknown error"));
                                    clean_errors.push(format!("{}: {}", res.display_path, reason));
                                }
                            }
                        }
                        Err(_) => {
                            clean_errors
                                .push(tf("Cleanup execution failed: {}", &[&t("Unknown error")]));
                        }
                    }
                }
                Err(_) => {
                    clean_errors.push(tf(
                        "Failed to build cleanup plan: {}",
                        &[&t("Unknown error")],
                    ));
                }
            }
        }
    }

    // Measure optional caches and C: system targets BEFORE emitting JSON or
    // dispatching webhooks so `-t all -j` carries the complete multi-target view.
    let caches_data = if include_caches {
        Some(measure_detected_caches())
    } else {
        None
    };
    let system_data = if include_system {
        let elevated = crate::platform::is_elevated();
        let token = crate::scanner::cancellation::CancellationToken::new();
        Some(crate::system_cleaner::measure::scan(elevated, &token).actions)
    } else {
        None
    };
    let caches_total_bytes: u64 = caches_data
        .as_ref()
        .map(|list| {
            list.iter()
                .filter(|p| p.measured)
                .map(|p| p.total_bytes)
                .sum()
        })
        .unwrap_or(0);
    let system_total_bytes: u64 = system_data
        .as_ref()
        .map(|list| list.iter().filter(|a| a.measured).map(|a| a.bytes).sum())
        .unwrap_or(0);
    let combined_total_bytes = total_bytes
        .saturating_add(caches_total_bytes)
        .saturating_add(system_total_bytes);

    if as_json {
        let format_json_item = |it: &crate::scanner::models::CleanupItem| {
            json!({
                "id": it.id,
                "name": it.display_name,
                "path": it.display_path,
                "provider": it.provider,
                "ecosystem": it.ecosystem,
                "category": it.category,
                "safety": it.safety_class,
                "bytes": it.estimated_reclaim_bytes.unwrap_or(0),
                "human": format_size(it.estimated_reclaim_bytes.unwrap_or(0))
            })
        };
        let all_json_items: Vec<serde_json::Value> = items.iter().map(format_json_item).collect();
        let projects_json: Vec<serde_json::Value> = items
            .iter()
            .filter(|it| it.ecosystem != "ai" && it.provider == "project")
            .map(format_json_item)
            .collect();
        let agents_json: Vec<serde_json::Value> = items
            .iter()
            .filter(|it| it.ecosystem == "ai" || it.provider != "project")
            .map(format_json_item)
            .collect();
        let include_projects_key =
            selected_targets
                .as_ref()
                .map(|sel| sel.projects)
                .unwrap_or(matches!(
                    scan_scope,
                    ScanScope::Project | ScanScope::Combined | ScanScope::AllDrives
                ));
        let include_agents_key =
            selected_targets
                .as_ref()
                .map(|sel| sel.agents)
                .unwrap_or(matches!(
                    scan_scope,
                    ScanScope::Agents | ScanScope::Combined
                ));

        let mut payload = json!({
            "product": "Dev Cleaner by Vellium",
            "status": "success",
            "root": root_path.to_string_lossy(),
            "scope": effective_scope_label,
            "target_count": total_items,
            "estimated_reclaim_bytes": combined_total_bytes,
            "estimated_reclaim_human": format_size(combined_total_bytes),
            "auto_clean": auto_clean,
            "dry_run": dry_run,
            "cleaned_count": cleaned_count,
            "cleaned_bytes": cleaned_bytes,
            "cleaned_human": format_size(cleaned_bytes),
            "clean_errors": clean_errors,
            "audit_error": audit_error,
            "items": all_json_items
        });
        if let Some(obj) = payload.as_object_mut() {
            if include_projects_key {
                obj.insert("projects".to_string(), json!(projects_json));
            }
            if include_agents_key {
                obj.insert("agents".to_string(), json!(agents_json));
            }
            if let Some(ref caches) = caches_data {
                obj.insert("caches".to_string(), json!(caches));
                obj.insert("caches_total_bytes".to_string(), json!(caches_total_bytes));
            }
            if let Some(ref system) = system_data {
                obj.insert("system".to_string(), json!(system));
                obj.insert("system_total_bytes".to_string(), json!(system_total_bytes));
            }
        }
        println!(
            "{}",
            serde_json::to_string_pretty(&payload).unwrap_or_default()
        );
    } else {
        println!("\n{}", t("[OK] Scan completed!"));
        println!("  {}", tf("Found Targets       : {}", &[&total_items]));
        println!(
            "  {}",
            tf("Reclaimable Space   : {}", &[&format_size(total_bytes)])
        );
        if let Some(ref providers) = caches_data {
            let detected = providers.iter().filter(|p| p.detected).count();
            println!(
                "  [Caches]            : {detected} / {} detected, {} (`dev-cleaner c`)",
                providers.len(),
                format_size(caches_total_bytes)
            );
        }
        if system_data.is_some() {
            println!(
                "  [System C:]         : {} (`dev-cleaner sys quick -n`)",
                format_size(system_total_bytes)
            );
        }
        if auto_clean {
            if dry_run {
                println!(
                    "  {}",
                    tf(
                        "Dry-Run Simulation  : {} targets cleanable ({})",
                        &[&cleaned_count, &format_size(cleaned_bytes)]
                    )
                );
            } else {
                println!(
                    "  {}",
                    tf(
                        "[OK] Cleanup Result : {} targets moved to Recycle Bin ({})",
                        &[&cleaned_count, &format_size(cleaned_bytes)]
                    )
                );
                if !clean_errors.is_empty() {
                    println!(
                        "  {}",
                        tf("[WARN] Locked/Skipped Items ({}):", &[&clean_errors.len()])
                    );
                    for err in &clean_errors {
                        println!("    • {}", err);
                    }
                }
            }
        }
        println!();
    }

    if let Some(url) = webhook_url {
        if !as_json {
            println!(
                "{}",
                tf(
                    "[Dev Cleaner] Dispatching webhook notification -> {}",
                    &[&redact_webhook_url(&url)]
                )
            );
        }
        send_webhook_sync(
            &url,
            &WebhookPayload {
                // L7: the backend filters on `scan`/`clean`; sending
                // `scan_completed`/`cleanup_completed` bypassed the toggles.
                event: if auto_clean && !dry_run {
                    "clean".to_string()
                } else {
                    "scan".to_string()
                },
                timestamp: chrono::Utc::now().to_rfc3339(),
                product: "Dev Cleaner by Vellium".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                scope: effective_scope_label.to_string(),
                target_count: total_items,
                total_bytes: combined_total_bytes,
                total_human: format_size(combined_total_bytes),
                status: "success".to_string(),
                cleaned_count: if auto_clean {
                    Some(cleaned_count)
                } else {
                    None
                },
                cleaned_bytes: if auto_clean {
                    Some(cleaned_bytes)
                } else {
                    None
                },
                dry_run: if auto_clean { Some(dry_run) } else { None },
            },
            // In `--json` mode stdout must stay a single machine-readable
            // document; webhook diagnostics go to stderr.
            as_json,
        );
    }

    // M5: a cleanup that reported failures must not exit 0. The output above is
    // already written, so CI sees both the detail and the correct status code.
    if auto_clean && !dry_run && !clean_errors.is_empty() {
        return Err(AppError::RecycleBinFailed(format!(
            "{} target(s) could not be cleaned.",
            clean_errors.len()
        )));
    }

    Ok(())
}

/// A webhook URL is a bearer credential: Discord/Slack embed a channel token in
/// the path. Logs are long-lived (Task Scheduler, CI), so only the origin is
/// ever printed.
fn redact_webhook_url(url: &str) -> String {
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

    match crate::commands::webhook_commands::post_webhook_blocking(url, &body) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_aliases_map_to_expected_variants() {
        assert_eq!(parse_scan_scope("project").unwrap(), ScanScope::Project);
        assert_eq!(parse_scan_scope("projects").unwrap(), ScanScope::Project);
        assert_eq!(parse_scan_scope("agents").unwrap(), ScanScope::Agents);
        assert_eq!(parse_scan_scope("all").unwrap(), ScanScope::AllDrives);
        // Projects and agent storage in one session, matching the GUI action.
        assert_eq!(parse_scan_scope("combined").unwrap(), ScanScope::Combined);
    }

    #[test]
    fn caches_scope_points_at_the_caches_command() {
        let err = parse_scan_scope("caches").unwrap_err();
        assert!(format!("{err}").contains("caches --clean all --yes"));
        assert_eq!(scan_exit_code(&err), 3);
    }

    #[test]
    fn unknown_scope_is_an_argument_error() {
        let err = parse_scan_scope("everything").unwrap_err();
        assert_eq!(scan_exit_code(&err), 3);
    }

    #[test]
    fn exit_codes_follow_the_automation_contract() {
        assert_eq!(scan_exit_code(&AppError::ScanFailed("x".into())), 1);
        assert_eq!(scan_exit_code(&AppError::RecycleBinFailed("x".into())), 2);
        assert_eq!(
            scan_exit_code(&AppError::PermanentDeleteFailed("x".into())),
            2
        );
        assert_eq!(scan_exit_code(&AppError::InvalidPath("x".into())), 3);
        assert_eq!(scan_exit_code(&AppError::PathNotFound("x".into())), 3);
        assert_eq!(scan_exit_code(&AppError::Blocked("x".into())), 4);
        assert_eq!(scan_exit_code(&AppError::UnsafeDeleteTarget("x".into())), 4);
        assert_eq!(scan_exit_code(&AppError::PlanInvalid("x".into())), 4);
    }

    #[test]
    fn target_selection_parses_short_and_long_subsets() {
        let pa = TargetSelection::parse("p,a").unwrap();
        assert!(pa.projects && pa.agents && !pa.caches && !pa.system);
        assert_eq!(pa.scanner_scope(), Some(ScanScope::Combined));

        let cs = TargetSelection::parse("caches,sys").unwrap();
        assert!(!cs.projects && !cs.agents && cs.caches && cs.system);
        assert_eq!(cs.scanner_scope(), None);

        let all = TargetSelection::parse("all").unwrap();
        assert!(all.projects && all.agents && all.caches && all.system);
        assert_eq!(all.scanner_scope(), Some(ScanScope::Combined));

        let drives = TargetSelection::parse("drives").unwrap();
        assert_eq!(drives.scanner_scope(), Some(ScanScope::AllDrives));

        assert!(TargetSelection::parse("bogus").is_err());
    }

    #[test]
    fn selection_supports_lists_ranges_and_words() {
        assert_eq!(parse_selection("", 5), Vec::<usize>::new());
        assert_eq!(parse_selection("none", 5), Vec::<usize>::new());
        assert_eq!(parse_selection("all", 3), vec![0, 1, 2]);
        assert_eq!(parse_selection("1,3-4", 5), vec![0, 2, 3]);
        assert_eq!(parse_selection(" 2 2 9 0 ", 4), vec![1]);
        assert_eq!(parse_selection("4-2", 5), Vec::<usize>::new());
        assert_eq!(parse_selection("x,2,y", 5), vec![1]);
    }

    #[test]
    fn gui_launch_flags_are_never_captured_by_cli() {
        assert!(is_gui_launch_args(&["dev-cleaner.exe".into()]));
        assert!(is_gui_launch_args(&[
            "dev-cleaner.exe".into(),
            "--open-view".into(),
            "system".into(),
        ]));
        assert!(is_gui_launch_args(&[
            "dev-cleaner.exe".into(),
            "--wait-pid".into(),
            "1234".into(),
        ]));
        assert!(!is_gui_launch_args(&["dev-cleaner.exe".into(), "s".into()]));
    }

    #[test]
    fn unknown_scan_flags_fail_closed_with_exit_code_3() {
        let args = vec![".".into(), "-c".into(), "--dryrun".into()];
        let err = parse_scan_args(&args).unwrap_err();
        assert_eq!(scan_exit_code(&err), 3);

        let args = vec!["-cn".into(), "-m".into(), "500MB".into()];
        let parsed = parse_scan_args(&args).unwrap();
        assert!(parsed.auto_clean && parsed.dry_run);
        assert_eq!(parsed.min_size_bytes, 500 * 1024 * 1024);
    }

    #[test]
    fn human_size_parses_units_and_rejects_garbage() {
        assert_eq!(parse_human_size("50").unwrap(), 50 * 1024 * 1024);
        assert_eq!(parse_human_size("500KB").unwrap(), 500 * 1024);
        assert_eq!(parse_human_size("1.5GB").unwrap(), 1_610_612_736);
        assert!(parse_human_size("abc").is_err());
        assert!(parse_human_size("-5MB").is_err());
    }
}
