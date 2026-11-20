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

#[cfg(windows)]
pub fn attach_console() {
    use windows::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
    unsafe {
        let _ = AttachConsole(ATTACH_PARENT_PROCESS);
    }
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
    if args.len() <= 1 {
        return None;
    }

    // `dev-cleaner scan --help` must print the manual instead of treating the
    // flag as a directory (the old parser silently ignored unknown `--flags`).
    if args[1..].iter().any(|arg| arg == "-h" || arg == "--help") {
        #[cfg(windows)]
        attach_console();
        print_help();
        return Some(0);
    }

    #[cfg(windows)]
    attach_console();

    let first_arg = args[1].to_lowercase();
    match first_arg.as_str() {
        "-h" | "--help" | "help" => {
            print_help();
            Some(0)
        }
        "-v" | "--version" | "version" => {
            println!(
                "Dev Cleaner — {} {}",
                t("Version"),
                env!("CARGO_PKG_VERSION")
            );
            Some(0)
        }
        "mcp" | "--mcp" => {
            let allow_destructive = args[2..].iter().any(|arg| arg == "--allow-destructive");
            crate::mcp::run_mcp_server_with_options(crate::mcp::McpOptions { allow_destructive });
            Some(0)
        }
        "caches" | "cache" | "c" => match run_caches_cli(&args[2..]) {
            Ok(()) => Some(0),
            Err(err) => {
                eprintln!("caches failed: {err}");
                Some(scan_exit_code(&err))
            }
        },
        "history" | "hist" | "h" => {
            run_history_cli(&args[2..]);
            Some(0)
        }
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

fn run_caches_cli(args: &[String]) -> Result<(), AppError> {
    let as_json = args.iter().any(|a| a == "--json" || a == "-j");
    let dry_run = args
        .iter()
        .any(|a| a == "--dry-run" || a == "--dry" || a == "-n");
    let confirmed = args.iter().any(|a| a == "--yes" || a == "-y");
    let mut clean_target: Option<String> = None;

    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if (arg == "--clean" || arg == "-c") && i + 1 < args.len() {
            clean_target = Some(args[i + 1].clone());
            i += 1;
        } else if !arg.starts_with('-') && clean_target.is_none() {
            // Concise positional form: `dev-cleaner c npm` or `dev-cleaner c all -y`
            clean_target = Some(arg.clone());
        }
        i += 1;
    }

    let providers = crate::cleanup::official_actions::list_cache_providers();

    if let Some(ref target) = clean_target {
        // L6: `--clean all` runs every action of every detected tool. It is a
        // bulk destructive operation, so it needs explicit confirmation, and a
        // preview must stay possible without deleting anything.
        if target == "all" && !confirmed && !dry_run {
            eprintln!(
                "  {}",
                t("Refusing 'caches --clean all' without --yes. Re-run with --yes, or use --dry-run to preview.")
            );
            return Err(AppError::InvalidPath(
                "--yes is required for `caches --clean all`".to_string(),
            ));
        }
        let state = AppState::new();
        if !state.settings.load().agent_policy.allow_cache_cleanup {
            return Err(AppError::Blocked(
                "Cache cleanup is disabled in Settings → Automation.".to_string(),
            ));
        }
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

    if as_json {
        let json = serde_json::to_string_pretty(&providers).unwrap_or_default();
        println!("{}", json);
        return Ok(());
    }

    println!("\n--- {} ---", t("Dev Cleaner: Developer Tool Caches"));
    println!(
        "{:<20} {:<15} {:<30}",
        t("Tool / Package"),
        t("Version"),
        t("Status")
    );
    println!("{:-<65}", "");
    let installed = t("Installed / Detected");
    let missing = t("Not found");
    let providers_count = providers.len();
    for p in providers {
        let status = if p.detected {
            installed.as_str()
        } else {
            missing.as_str()
        };
        let ver = p.version.unwrap_or_else(|| "-".to_string());
        println!("{:<20} {:<15} {:<30}", p.name, ver, status);
    }
    println!(
        "\n{}\n",
        tf(
            "Checked {} tools in total. To clean: dev-cleaner caches --clean <tool|all>",
            &[&providers_count]
        )
    );
    Ok(())
}

fn run_history_cli(args: &[String]) {
    let as_json = args.iter().any(|a| a == "--json" || a == "-j");
    let mut limit = 20usize;

    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if (arg == "--limit" || arg == "-l") && i + 1 < args.len() {
            if let Ok(l) = args[i + 1].parse::<usize>() {
                limit = l;
            }
            i += 1;
        } else if !arg.starts_with('-') {
            if let Ok(l) = arg.parse::<usize>() {
                limit = l;
            }
        }
        i += 1;
    }

    let state = AppState::new();
    let records = state.audit.list_records(limit);

    if as_json {
        println!(
            "{}",
            serde_json::to_string_pretty(&records).unwrap_or_default()
        );
        return;
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
            println!(
                "{:<22} {:<15} {:<12} {:<15} {:<15}",
                date,
                r.plan_id,
                r.success_count,
                format_size(r.reclaim_bytes),
                mode
            );
        }
    }
    println!();
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

fn run_scan_cli(args: &[String]) -> Result<(), AppError> {
    let mut root_path = PathBuf::from(".");
    let mut scope = "projects".to_string();
    let mut targets_arg: Option<String> = None;
    let mut as_json = false;
    let mut auto_clean = false;
    let mut dry_run = false;
    let mut min_size_mb: u64 = 0;
    let mut safety_levels = vec!["safe".to_string(), "regenerate".to_string()];
    let mut webhook_url: Option<String> = None;
    let mut top: Option<usize> = None;
    let mut show_all = false;
    let mut interactive = false;

    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if arg == "--json" || arg == "-j" {
            as_json = true;
        } else if arg == "--auto-clean" || arg == "--clean" || arg == "-c" {
            auto_clean = true;
        } else if arg == "--dry-run" || arg == "--dry" || arg == "-n" {
            dry_run = true;
        } else if arg == "--all" || arg == "-a" {
            show_all = true;
        } else if arg == "-i" || arg == "--interactive" {
            interactive = true;
        } else if arg == "--top" && i + 1 < args.len() {
            top = args[i + 1].parse::<usize>().ok().map(|count| count.max(1));
            i += 1;
        } else if (arg == "--targets" || arg == "-t") && i + 1 < args.len() {
            targets_arg = Some(args[i + 1].clone());
            i += 1;
        } else if arg == "--scope" && i + 1 < args.len() {
            scope = args[i + 1].clone();
            i += 1;
        } else if (arg == "--safety" || arg == "-s") && i + 1 < args.len() {
            safety_levels = args[i + 1]
                .split(',')
                .map(|s| s.trim().to_lowercase())
                .collect();
            i += 1;
        } else if (arg == "--min-size" || arg == "--min" || arg == "-m") && i + 1 < args.len() {
            min_size_mb = args[i + 1].parse().unwrap_or(0);
            i += 1;
        } else if (arg == "--webhook" || arg == "-w") && i + 1 < args.len() {
            webhook_url = Some(args[i + 1].clone());
            i += 1;
        } else if !arg.starts_with('-') {
            root_path = PathBuf::from(arg);
        }
        i += 1;
    }

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
                Some(crate::cleanup::official_actions::list_cache_providers())
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
                    println!(
                        "\n[Caches] {detected} / {} detected (run `dev-cleaner c` for details)",
                        providers.len()
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
        profile: None,
        max_depth: None,
        max_candidates: None,
        timeout_minutes: None,
        min_size_bytes: if min_size_mb > 0 {
            // Saturating: `--min-size-mb` is a raw u64 from clap, and a huge
            // value wrapped to a tiny threshold (release) or panicked (debug).
            Some(min_size_mb.saturating_mul(1024 * 1024))
        } else {
            None
        },
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

    // Prepare autonomous cleanup plan (see the saturation note above).
    let min_bytes = min_size_mb.saturating_mul(1024 * 1024);
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

    if as_json {
        let payload = json!({
            "product": "Dev Cleaner by Vellium",
            "status": "success",
            "root": root_path.to_string_lossy(),
            "scope": scope,
            "target_count": total_items,
            "estimated_reclaim_bytes": total_bytes,
            "estimated_reclaim_human": format_size(total_bytes),
            "auto_clean": auto_clean,
            "dry_run": dry_run,
            "cleaned_count": cleaned_count,
            "cleaned_bytes": cleaned_bytes,
            "cleaned_human": format_size(cleaned_bytes),
            "clean_errors": clean_errors,
            "audit_error": audit_error,
            "items": items.iter().map(|it| json!({
                "id": it.id,
                "name": it.display_name,
                "path": it.display_path,
                "category": it.category,
                "safety": it.safety_class,
                "bytes": it.estimated_reclaim_bytes.unwrap_or(0),
                "human": format_size(it.estimated_reclaim_bytes.unwrap_or(0))
            })).collect::<Vec<_>>()
        });
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
                scope: scope.to_string(),
                target_count: total_items,
                total_bytes,
                total_human: format_size(total_bytes),
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

    if !as_json {
        if include_caches {
            let providers = crate::cleanup::official_actions::list_cache_providers();
            let detected = providers.iter().filter(|p| p.detected).count();
            println!(
                "  [Caches]            : {detected} / {} detected (`dev-cleaner c`)",
                providers.len()
            );
        }
        if include_system {
            let elevated = crate::platform::is_elevated();
            let token = crate::scanner::cancellation::CancellationToken::new();
            let actions = crate::system_cleaner::measure::scan(elevated, &token).actions;
            let sys_total: u64 = actions.iter().filter(|a| a.measured).map(|a| a.bytes).sum();
            println!(
                "  [System C:]         : {} (`dev-cleaner sys quick -n`)",
                format_size(sys_total)
            );
        }
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
}
