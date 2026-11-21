use serde_json::json;

use crate::commands::AppState;
use crate::error::AppError;

use super::format_size;
use super::help::print_caches_help;
use super::i18n::{t, tf};

pub(super) fn measure_detected_caches() -> Vec<crate::cleanup::official_actions::CacheProviderInfo>
{
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

pub(super) fn run_caches_cli(args: &[String]) -> Result<(), AppError> {
    let mut help = false;
    let mut as_json = false;
    let mut dry_run = false;
    let mut confirmed = false;
    let mut clean_target: Option<String> = None;

    let mut i = 0;
    let mut after_double_dash = false;
    while i < args.len() {
        let arg = &args[i];
        if after_double_dash {
            if clean_target.is_some() {
                return Err(AppError::InvalidPath(format!(
                    "Unexpected argument '{arg}'."
                )));
            }
            clean_target = Some(arg.clone());
            i += 1;
            continue;
        }
        if arg == "--" {
            after_double_dash = true;
            i += 1;
            continue;
        }
        if let Some(value) = arg.strip_prefix("--clean=") {
            if value.is_empty() {
                return Err(AppError::InvalidPath(
                    "Missing tool name after '--clean='.".to_string(),
                ));
            }
            clean_target = Some(value.to_string());
            i += 1;
            continue;
        }
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
                    "Unknown flag '{other}'. Run `detergo c -h` for usage."
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
                                "Unknown flag '-{unknown}'. Run `detergo c -h` for usage."
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
        if target != "all" {
            let matched = providers
                .iter()
                .find(|p| p.id.eq_ignore_ascii_case(target) || p.name.eq_ignore_ascii_case(target));
            match matched {
                None => {
                    return Err(AppError::InvalidPath(format!(
                        "Unknown cache provider '{target}'. Run `detergo c` to list supported tools."
                    )));
                }
                Some(p) if p.read_only => {
                    return Err(AppError::Blocked(format!(
                        "'{}' is read-only and cannot be cleaned automatically.",
                        p.name
                    )));
                }
                Some(p) if !p.detected => {
                    return Err(AppError::PathNotFound(format!(
                        "'{}' was not detected on this system.",
                        p.name
                    )));
                }
                Some(_) => {}
            }
        }

        let registry = crate::cleanup::official_actions::OfficialActionRegistry::new();
        let mut executed = Vec::new();
        let mut skipped_opt_in = Vec::new();
        let mut failures = 0usize;

        for p in &providers {
            if !p.detected {
                continue;
            }
            if target == "all" && crate::cleanup::official_actions::is_opt_in_only_provider(&p.id) {
                skipped_opt_in.push(p.id.clone());
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
                    "product": "Detergo by Vellium",
                    "status": if dry_run {
                        "dry_run"
                    } else if failures == 0 {
                        "success"
                    } else {
                        "partial"
                    },
                    "clean_target": target,
                    "skipped_opt_in_providers": skipped_opt_in,
                    "executed": executed
                }))
                .unwrap_or_default()
            );
        } else {
            println!(
                "\n{}",
                tf("[Detergo] Official CLI Cache Cleanup: {}", &[&target])
            );
            for item in &executed {
                let success = item
                    .get("success")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let is_dry = item
                    .get("dry_run")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let prov = item.get("provider").and_then(|v| v.as_str()).unwrap_or("");
                let act = item.get("action").and_then(|v| v.as_str()).unwrap_or("");
                let reclaimed = item
                    .get("reclaimed_bytes")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                if is_dry {
                    println!("  [DRY-RUN] {} ({}): Would execute", prov, act);
                } else if success {
                    println!(
                        "  {}",
                        tf(
                            "[OK] {} ({}): Success - Reclaimed: {}",
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
            if !skipped_opt_in.is_empty() {
                println!(
                    "  [INFO] Skipped opt-in model caches during `all`: {} (clean explicitly with `detergo c <id> -y`)",
                    skipped_opt_in.join(", ")
                );
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

    println!("\n--- {} ---", t("Detergo: Developer Tool Caches"));
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
        "\nMeasured total: {} - {}\n",
        format_size(total_bytes),
        tf(
            "Checked {} tools in total. To clean: detergo c <tool|all> -y",
            &[&providers_count]
        )
    );
    Ok(())
}
