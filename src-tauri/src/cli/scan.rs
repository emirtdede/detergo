use std::io::{self, Write};

use serde_json::json;

use crate::cleanup::DeleteMode;
use crate::commands::AppState;
use crate::error::AppError;
use crate::scanner::models::{CleanupItem, ScanScope};

use super::args::{parse_scan_args, parse_scan_scope, parse_selection, TargetSelection};
use super::caches::measure_detected_caches;
use super::help::print_scan_help;
use super::i18n::{t, tf};
use super::{format_size, redact_webhook_url, send_webhook_sync_with_policy, WebhookPayload};

fn safety_label(item: &CleanupItem) -> String {
    serde_json::to_string(&item.safety_class)
        .unwrap_or_default()
        .replace('"', "")
        .to_lowercase()
}

fn print_targets(items: &[&CleanupItem], limit: Option<usize>) {
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

fn print_numbered_targets(items: &[&CleanupItem]) {
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

pub(super) fn run_scan_cli(args: &[String]) -> Result<(), AppError> {
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
    let older_than_days = parsed.older_than_days;
    let incremental_older_than_days = parsed.incremental_older_than_days;
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
                        "product": "Detergo by Vellium",
                        "version": env!("CARGO_PKG_VERSION"),
                        "targets": targets_arg,
                        "caches": caches_data,
                        "system": system_data,
                    }))
                    .unwrap_or_default()
                );
            } else {
                if let Some(ref providers) = caches_data {
                    let detected = providers.iter().filter(|p| p.detected).count();
                    let cache_total: u64 = providers
                        .iter()
                        .filter(|p| p.measured)
                        .map(|p| p.total_bytes)
                        .sum();
                    println!(
                        "\n[Caches] {detected} / {} detected, {} measured (run `detergo c` for details)",
                        providers.len(),
                        format_size(cache_total)
                    );
                }
                if let Some(ref actions) = system_data {
                    let total: u64 = actions.iter().filter(|a| a.measured).map(|a| a.bytes).sum();
                    println!("\n[System C:] {} reclaimable across {} actions (run `detergo sys quick -n` to preview)", format_size(total), actions.len());
                }
            }
            if let Some(url) = webhook_url {
                let cache_bytes: u64 = caches_data
                    .as_ref()
                    .map(|list| {
                        list.iter()
                            .filter(|p| p.measured)
                            .map(|p| p.total_bytes)
                            .sum()
                    })
                    .unwrap_or(0);
                let sys_bytes: u64 = system_data
                    .as_ref()
                    .map(|list| list.iter().filter(|a| a.measured).map(|a| a.bytes).sum())
                    .unwrap_or(0);
                let total_bytes = cache_bytes.saturating_add(sys_bytes);
                let target_count = caches_data.as_ref().map(|v| v.len()).unwrap_or(0)
                    + system_data.as_ref().map(|v| v.len()).unwrap_or(0);
                let allow_private = AppState::new().settings.load().allow_private_webhooks;
                send_webhook_sync_with_policy(
                    &url,
                    &WebhookPayload {
                        event: "scan".to_string(),
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        product: "Detergo by Vellium".to_string(),
                        version: env!("CARGO_PKG_VERSION").to_string(),
                        scope: targets_arg
                            .clone()
                            .unwrap_or_else(|| "caches,system".to_string()),
                        target_count,
                        total_bytes,
                        total_human: format_size(total_bytes),
                        status: "success".to_string(),
                        cleaned_count: None,
                        cleaned_bytes: None,
                        dry_run: None,
                    },
                    as_json,
                    allow_private,
                );
            }
            return Ok(());
        }
    }

    // Reject typos instead of silently matching nothing.
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
            tf("[Detergo] Starting scan: {}", &[&root_path.display()])
        );
        println!("{}", tf("[Detergo] Scope: {}", &[&effective_scope_label]));
        if let Some(days) = older_than_days {
            println!("[Detergo] Age filter: older than {days} day(s)");
        }
        if let Some(days) = incremental_older_than_days {
            println!("[Detergo] Intra-target incremental prune: older than {days} day(s)");
        }
        if auto_clean {
            println!(
                "{}",
                tf(
                    "[Detergo] Autonomous Cleanup: Active (Dry-Run: {}, Safety: {})",
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
                    "product": "Detergo by Vellium",
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

    let now_ms = chrono::Utc::now().timestamp_millis();
    let items: Vec<CleanupItem> = match older_than_days {
        Some(min_days) => session
            .items
            .iter()
            .filter(|it| crate::format::is_older_than_days(it.last_modified_ms, min_days, now_ms))
            .cloned()
            .collect(),
        None => session.items.clone(),
    };

    let total_items = items.len();
    let own = crate::scanner::own_bytes(&items);
    let total_bytes: u64 = items.iter().fold(0u64, |sum, item| {
        let bytes = own
            .get(&item.id)
            .map(|(_, allocated)| *allocated)
            .unwrap_or_else(|| item.estimated_reclaim_bytes.unwrap_or(0));
        sum.saturating_add(bytes)
    });

    let is_candidate = |item: &CleanupItem| {
        item.selectable
            && safety_levels
                .iter()
                .any(|level| level == &safety_label(item))
            && item.estimated_reclaim_bytes.unwrap_or(0) >= min_bytes
    };

    let mut all_ranked: Vec<&CleanupItem> = items.iter().collect();
    all_ranked.sort_by_key(|item| std::cmp::Reverse(item.estimated_reclaim_bytes.unwrap_or(0)));
    let mut candidates: Vec<&CleanupItem> =
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
                let selected_items: Vec<CleanupItem> = chosen
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
        let candidate_items: Vec<CleanupItem> =
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
            if let Some(days) = incremental_older_than_days {
                if let Ok(plan) = crate::cleanup::build_plan_with_options(
                    &session,
                    &matched_target_ids,
                    DeleteMode::RecycleBin,
                    &catalog,
                    &policy,
                    Some(days),
                ) {
                    cleaned_count = plan.eligible_count as usize;
                    cleaned_bytes = plan.total_estimated_bytes;
                }
            } else {
                cleaned_count = matched_target_ids.len();
                cleaned_bytes = matched_bytes;
            }
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
            match crate::cleanup::build_plan_with_options(
                &session,
                &matched_target_ids,
                DeleteMode::RecycleBin,
                &catalog,
                &policy,
                incremental_older_than_days,
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
                            cleaned_bytes = if report.mode == DeleteMode::RecycleBin {
                                report.moved_bytes
                            } else {
                                report.reclaim_bytes
                            };
                            if settings.history_enabled {
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
                                    audit_error = Some(err.to_string());
                                }
                            }

                            for res in &report.results {
                                if !res.success {
                                    let reason = res
                                        .error_code
                                        .clone()
                                        .unwrap_or_else(|| t("Unknown error"));
                                    clean_errors.push(format!("{}: {}", res.display_path, reason));
                                }
                            }
                        }
                        Err(err) => {
                            clean_errors.push(tf("Cleanup execution failed: {}", &[&err]));
                        }
                    }
                }
                Err(err) => {
                    clean_errors.push(tf("Failed to build cleanup plan: {}", &[&err]));
                }
            }
        }
    }

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
        let format_json_item = |it: &CleanupItem| {
            json!({
                "id": it.id,
                "name": it.display_name,
                "path": it.display_path,
                "provider": it.provider,
                "ecosystem": it.ecosystem,
                "category": it.category,
                "safety": it.safety_class,
                "bytes": it.estimated_reclaim_bytes.unwrap_or(0),
                "human": format_size(it.estimated_reclaim_bytes.unwrap_or(0)),
                "last_modified_ms": it.last_modified_ms,
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
            "product": "Detergo by Vellium",
            "status": "success",
            "root": root_path.to_string_lossy(),
            "scope": effective_scope_label,
            "older_than_days": older_than_days,
            "incremental_older_than_days": incremental_older_than_days,
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
                "  [Caches]            : {detected} / {} detected, {} (`detergo c`)",
                providers.len(),
                format_size(caches_total_bytes)
            );
        }
        if system_data.is_some() {
            println!(
                "  [System C:]         : {} (`detergo sys quick -n`)",
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
                    "[Detergo] Dispatching webhook notification -> {}",
                    &[&redact_webhook_url(&url)]
                )
            );
        }
        send_webhook_sync_with_policy(
            &url,
            &WebhookPayload {
                event: if auto_clean && !dry_run {
                    "clean".to_string()
                } else {
                    "scan".to_string()
                },
                timestamp: chrono::Utc::now().to_rfc3339(),
                product: "Detergo by Vellium".to_string(),
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
            as_json,
            settings.allow_private_webhooks,
        );
    }

    if auto_clean && !dry_run && !clean_errors.is_empty() {
        return Err(AppError::RecycleBinFailed(format!(
            "{} target(s) could not be cleaned.",
            clean_errors.len()
        )));
    }

    Ok(())
}
