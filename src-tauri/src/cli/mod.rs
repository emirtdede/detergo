use crate::cleanup::DeleteMode;
use crate::commands::AppState;
use crate::error::AppError;
use crate::scanner::models::ScanScope;
use serde::{Deserialize, Serialize};
use serde_json::json;
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
        "caches" => {
            run_caches_cli(&args[2..]);
            Some(0)
        }
        "history" => {
            run_history_cli(&args[2..]);
            Some(0)
        }
        "scan" => match run_scan_cli(&args[2..]) {
            Ok(()) => Some(0),
            Err(err) => {
                eprintln!("scan failed: {err}");
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

/// Maps the CLI `--scope` value to the scanner scope. `all` means a full-drive
/// scan, matching the frontend's `allDrives` mode.
fn parse_scan_scope(scope: &str) -> Result<ScanScope, AppError> {
    match scope {
        "projects" | "project" => Ok(ScanScope::Project),
        "agents" => Ok(ScanScope::Agents),
        "caches" => Ok(ScanScope::GlobalCaches),
        "all" => Ok(ScanScope::AllDrives),
        other => Err(AppError::InvalidPath(format!(
            "Unknown scope '{other}'; expected projects, agents, caches or all."
        ))),
    }
}

fn print_help() {
    let width = 66;
    let rule = "=".repeat(width);
    let mut out = String::new();
    out.push_str(&format!("\n{rule}\n"));
    out.push_str(&format!(
        "  {}\n",
        tf(
            "DEV CLEANER by VELLIUM — CLI, MCP & Automation Engine (v{})",
            &[&env!("CARGO_PKG_VERSION")]
        )
    ));
    out.push_str(&format!("{rule}\n\n"));

    out.push_str(&format!("{}\n", t("USAGE:")));
    out.push_str(&format!("  {}\n\n", t("dev-cleaner [COMMAND] [OPTIONS]")));

    out.push_str(&format!("{}\n", t("COMMANDS:")));
    for line in [
        "  scan [DIRECTORY]         Scan projects, AI tools, and caches / clean safe targets",
        "  caches                   List or clean cache status for 21 developer tools",
        "  history                  List past cleanup and audit records",
        "  mcp                      Start the Model Context Protocol (MCP) stdio server",
    ] {
        out.push_str(&format!("{}\n", t(line)));
    }
    out.push('\n');

    out.push_str(&format!("{}\n", t("SCAN OPTIONS:")));
    for line in [
        "  --scope <SCOPE>          projects | agents | caches | all (default: projects)",
        "  --auto-clean             Automatically move found safe targets to Recycle Bin",
        "  --safety <LEVELS>        safe,regenerate,review (comma-separated, default: safe,regenerate)",
        "  --dry-run                Simulate actions without deleting anything",
        "  --min-size <MB>          Process only targets larger than specified MB",
        "  --json                   Output results in JSON format",
        "  --webhook <URL>          Send result summary to n8n, Slack, or Discord webhook",
        "  -h, --help               Display help information",
        "  -v, --version            Display version information",
    ] {
        out.push_str(&format!("{}\n", t(line)));
    }
    out.push('\n');

    out.push_str(&format!("{}\n", t("CACHES OPTIONS:")));
    for line in [
        "  --clean <TOOL|all>       Clean cache for a specific tool (npm, pip, cargo, etc.) or all",
        "  --json                   Output results in JSON format",
    ] {
        out.push_str(&format!("{}\n", t(line)));
    }
    out.push('\n');

    out.push_str(&format!("{}\n", t("HISTORY OPTIONS:")));
    for line in [
        "  --limit <COUNT>          Number of records to show (default: 20)",
        "  --json                   Output results in JSON format",
    ] {
        out.push_str(&format!("{}\n", t(line)));
    }
    out.push('\n');

    out.push_str(&format!("{}\n", t("EXAMPLES:")));
    for line in [
        "dev-cleaner scan \"D:\\Projects\"",
        "dev-cleaner scan \"D:\\Projects\" --auto-clean --safety safe,regenerate --dry-run",
        "dev-cleaner scan \"D:\\Projects\" --auto-clean --min-size 100 --webhook \"https://n8n.example.com/webhook/clean\"",
        "dev-cleaner caches --clean npm",
        "dev-cleaner caches --json",
        "dev-cleaner history --limit 10",
    ] {
        out.push_str(&format!("  {line}\n"));
    }
    print!("{out}");
}

fn format_size(bytes: u64) -> String {
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

fn run_caches_cli(args: &[String]) {
    let as_json = args.iter().any(|a| a == "--json");
    let mut clean_target: Option<String> = None;

    let mut i = 0;
    while i < args.len() {
        if args[i] == "--clean" && i + 1 < args.len() {
            clean_target = Some(args[i + 1].clone());
            i += 1;
        }
        i += 1;
    }

    let providers = crate::cleanup::official_actions::list_cache_providers();

    if let Some(ref target) = clean_target {
        let registry = crate::cleanup::official_actions::OfficialActionRegistry::new();
        let mut executed = Vec::new();

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
                match crate::cleanup::official_actions::preview_action(&registry, &p.id, &action.id)
                {
                    Ok(preview) => {
                        match crate::cleanup::official_actions::execute_action(
                            &registry,
                            &preview.token,
                        ) {
                            Ok(res) => {
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
                                executed.push(json!({
                                    "provider": p.id,
                                    "action": action.id,
                                    "success": false,
                                    "error": format!("{:?}", e)
                                }));
                            }
                        }
                    }
                    Err(e) => {
                        executed.push(json!({
                            "provider": p.id,
                            "action": action.id,
                            "success": false,
                            "error": format!("{:?}", e)
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
                    "status": "success",
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
        return;
    }

    if as_json {
        let json = serde_json::to_string_pretty(&providers).unwrap_or_default();
        println!("{}", json);
        return;
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
}

fn run_history_cli(args: &[String]) {
    let as_json = args.iter().any(|a| a == "--json");
    let mut limit = 20usize;

    let mut i = 0;
    while i < args.len() {
        if args[i] == "--limit" && i + 1 < args.len() {
            if let Ok(l) = args[i + 1].parse::<usize>() {
                limit = l;
            }
            i += 1;
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

fn run_scan_cli(args: &[String]) -> Result<(), AppError> {
    let mut root_path = PathBuf::from(".");
    let mut scope = "projects".to_string();
    let mut as_json = false;
    let mut auto_clean = false;
    let mut dry_run = false;
    let mut min_size_mb: u64 = 0;
    let mut safety_levels = vec!["safe".to_string(), "regenerate".to_string()];
    let mut webhook_url: Option<String> = None;

    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if arg == "--json" {
            as_json = true;
        } else if arg == "--auto-clean" {
            auto_clean = true;
        } else if arg == "--dry-run" {
            dry_run = true;
        } else if arg == "--scope" && i + 1 < args.len() {
            scope = args[i + 1].clone();
            i += 1;
        } else if arg == "--safety" && i + 1 < args.len() {
            safety_levels = args[i + 1]
                .split(',')
                .map(|s| s.trim().to_lowercase())
                .collect();
            i += 1;
        } else if arg == "--min-size" && i + 1 < args.len() {
            min_size_mb = args[i + 1].parse().unwrap_or(0);
            i += 1;
        } else if arg == "--webhook" && i + 1 < args.len() {
            webhook_url = Some(args[i + 1].clone());
            i += 1;
        } else if !arg.starts_with("--") {
            root_path = PathBuf::from(arg);
        }
        i += 1;
    }

    if !as_json {
        println!(
            "\n{}",
            tf(
                "[Dev Cleaner] Starting scan: {}",
                &[&format!("{:?}", root_path)]
            )
        );
        println!("{}", tf("[Dev Cleaner] Scope: {}", &[&scope]));
        if auto_clean {
            println!(
                "{}",
                tf(
                    "[Dev Cleaner] Autonomous Cleanup: Active (Dry-Run: {}, Safety: {})",
                    &[&dry_run, &format!("{:?}", safety_levels)]
                )
            );
        }
    }

    if !root_path.exists() {
        if as_json {
            println!(
                "{}",
                json!({
                    "product": "Dev Cleaner by Vellium",
                    "status": "error",
                    "error": format!("Target not found: {:?}", root_path),
                    "items": []
                })
            );
        } else {
            println!(
                "\n{}",
                tf(
                    "[ERROR] Error: Specified target directory not found: {}",
                    &[&format!("{:?}", root_path)]
                )
            );
        }
        return Err(AppError::PathNotFound(
            root_path.to_string_lossy().to_string(),
        ));
    }

    let scan_scope = parse_scan_scope(&scope)?;

    let state = AppState::new();
    let catalog = match state.catalog() {
        Ok(idx) => idx,
        Err(err) => {
            eprintln!(
                "{}",
                tf("Failed to load catalog: {}", &[&format!("{:?}", err)])
            );
            return Err(err);
        }
    };
    let token = crate::scanner::CancellationToken::new();
    let limits = crate::scanner::limits::ScanLimits::default();
    let mut engine =
        crate::scanner::discovery::DiscoveryEngine::new(&catalog, token.clone(), limits);

    let config = crate::scanner::discovery::DiscoveryConfig {
        root: &root_path,
        exclusions: &[],
        protected_paths: &[],
        scan_session_id: "cli_scan",
        limits,
    };

    match engine.discover(config, |_| {}, |_| {}) {
        Ok(outcome) => {
            let min_bytes = min_size_mb * 1024 * 1024;
            let session = crate::scanner::session::ScanSession {
                id: "cli_scan".to_string(),
                scope: scan_scope,
                root: root_path.clone(),
                allowed_roots: vec![root_path.clone()],
                created: std::time::Instant::now(),
                items: outcome.items.clone(),
                targets: outcome
                    .targets
                    .into_iter()
                    .map(|t| (t.id.clone(), t))
                    .collect(),
                summary: None,
            };

            let total_items = outcome.items.len();
            let mut total_bytes = 0u64;
            for item in &outcome.items {
                total_bytes += item.estimated_reclaim_bytes.unwrap_or(0);
            }

            // Prepare autonomous cleanup plan
            let mut matched_target_ids = Vec::new();
            let mut matched_bytes = 0u64;

            for item in &outcome.items {
                let safety_str = serde_json::to_string(&item.safety_class)
                    .unwrap_or_default()
                    .replace('"', "")
                    .to_lowercase();
                let bytes = item.estimated_reclaim_bytes.unwrap_or(0);

                let safety_match = safety_levels.iter().any(|s| safety_str.contains(s));
                let size_match = bytes >= min_bytes;

                if safety_match && size_match {
                    matched_target_ids.push(item.id.clone());
                    matched_bytes += bytes;
                }
            }

            let mut cleaned_count = 0usize;
            let mut cleaned_bytes = 0u64;
            let mut clean_errors = Vec::new();

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
                    let settings = state.settings.load();
                    let policy = crate::cleanup::CleanupPolicy::from(&settings);
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
                                    cleaned_bytes = report.reclaim_bytes;
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
                                    let _ = state.audit.append_record(&audit_entry);

                                    for res in &report.results {
                                        if !res.success {
                                            // Keep only the machine-readable error code here; the
                                            // backend `error` text is English-only and would leak
                                            // the source language into the localized CLI output.
                                            let reason = res
                                                .error_code
                                                .clone()
                                                .unwrap_or_else(|| t("Unknown error"));
                                            clean_errors
                                                .push(format!("{}: {}", res.display_path, reason));
                                        }
                                    }
                                }
                                Err(_) => {
                                    clean_errors.push(tf(
                                        "Cleanup execution failed: {}",
                                        &[&t("Unknown error")],
                                    ));
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
                    "items": outcome.items.iter().map(|it| json!({
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
                            &[&url]
                        )
                    );
                }
                send_webhook_sync(
                    &url,
                    &WebhookPayload {
                        event: if auto_clean && !dry_run {
                            "cleanup_completed".to_string()
                        } else {
                            "scan_completed".to_string()
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
                );
            }
        }
        Err(err) => {
            eprintln!("\n[ERROR] {}: {:?}", t("Unknown error"), err);
            return Err(err);
        }
    }
    Ok(())
}

pub fn send_webhook_sync(url: &str, payload: &WebhookPayload) {
    let body = match serde_json::to_value(payload) {
        Ok(value) => value,
        Err(err) => {
            eprintln!(
                "  {}",
                tf(
                    "[WARN] Webhook serialization error: {}",
                    &[&format!("{:?}", err)]
                )
            );
            return;
        }
    };

    match crate::commands::webhook_commands::post_webhook_blocking(url, &body) {
        Ok(result) if result.ok => {
            println!(
                "  {}",
                tf("[OK] Webhook successfully dispatched: {}", &[&url])
            );
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
                tf(
                    "[WARN] Webhook warning: Request failed: {}",
                    &[&format!("{:?}", err)]
                )
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
        assert_eq!(parse_scan_scope("caches").unwrap(), ScanScope::GlobalCaches);
        assert_eq!(parse_scan_scope("all").unwrap(), ScanScope::AllDrives);
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
}
