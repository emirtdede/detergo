//! `dev-cleaner system` — the scheduled/automation entry point.
//!
//! It shares [`super::execute`] with the GUI, so a task created by the app can
//! never perform a deletion the GUI would refuse. `--yes` is mandatory for a
//! mutating run; `--dry-run` measures and exits without touching anything.

use crate::error::AppError;
use crate::format::human_bytes;
use crate::scanner::cancellation::CancellationToken;

use super::actions::{spec, ACTIONS};
use super::profile_actions;
use super::SystemActionId;

pub const USAGE: &str = "\
Usage:
  dev-cleaner sys                  (or `dev-cleaner sys -l`) List actions
  dev-cleaner sys <profile|ids> -n Preview measured sizes (--dry-run)
  dev-cleaner sys <profile|ids> -y Clean after confirmation (--yes)

Profiles: quick (user temp + Windows Update leftovers)
          standard (+ Windows temp, Prefetch, error reports)
          deep (+ Disk Cleanup and component store; needs administrator)
Ids:      userTemp, windowsTemp, prefetch, windowsUpdate, errorReports,
          recycleBin, diskCleanup, componentStore

Legacy form also supported:
  dev-cleaner system --clean quick --yes [--scheduled]
";

fn fail(message: &str) -> Result<(), AppError> {
    Err(AppError::InvalidPath(message.to_string()))
}

pub fn run(args: &[String]) -> Result<(), AppError> {
    let mut help = false;
    let mut list_only = false;
    let mut as_json = false;
    let mut dry_run = false;
    let mut confirmed = false;
    let mut scheduled = false;
    let mut profile: Option<String> = None;

    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        match arg.as_str() {
            "-h" | "--help" => help = true,
            "-l" | "--list" => list_only = true,
            "-j" | "--json" => as_json = true,
            "-n" | "--dry" | "--dry-run" => dry_run = true,
            "-y" | "--yes" => confirmed = true,
            "--scheduled" => scheduled = true,
            "-c" | "--clean" => {
                let value = args.get(i + 1).ok_or_else(|| {
                    AppError::InvalidPath(format!("Missing value after '{arg}'."))
                })?;
                profile = Some(value.clone());
                i += 1;
            }
            other if other.starts_with("--") => {
                return fail(&format!(
                    "Unknown flag '{other}'. Run `dev-cleaner sys -h` for usage."
                ));
            }
            other if other.starts_with('-') && other.len() > 1 => {
                for ch in other[1..].chars() {
                    match ch {
                        'h' => help = true,
                        'l' => list_only = true,
                        'j' => as_json = true,
                        'n' => dry_run = true,
                        'y' => confirmed = true,
                        unknown => {
                            return fail(&format!(
                                "Unknown flag '-{unknown}'. Run `dev-cleaner sys -h` for usage."
                            ));
                        }
                    }
                }
            }
            positional => {
                if profile.is_some() {
                    return fail(&format!("Unexpected positional argument '{positional}'."));
                }
                profile = Some(positional.to_string());
            }
        }
        i += 1;
    }

    if help {
        print!("{USAGE}");
        return Ok(());
    }

    let elevated = crate::platform::is_elevated();

    if list_only || profile.is_none() {
        let token = CancellationToken::new();
        let outcome = super::measure::scan(elevated, &token);
        if as_json {
            let total: u64 = outcome
                .actions
                .iter()
                .filter(|a| a.measured)
                .map(|a| a.bytes)
                .sum();
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "elevated": elevated,
                    "total_bytes": total,
                    "total_human": human_bytes(total),
                    "actions": outcome.actions,
                    "warnings": outcome.warnings,
                }))
                .unwrap_or_default()
            );
            return Ok(());
        }
        println!(
            "{:<18} {:<12} {:<8} {:>12}  Action",
            "ID", "Safety", "Admin", "Size"
        );
        println!("{}", "-".repeat(74));
        let mut total: u64 = 0;
        for info in &outcome.actions {
            let meta = spec(info.id);
            let size = if info.measured {
                total = total.saturating_add(info.bytes);
                human_bytes(info.bytes)
            } else {
                info.reason
                    .clone()
                    .unwrap_or_else(|| "not measured".to_string())
            };
            println!(
                "{:<18} {:<12} {:<8} {:>12}  {}",
                info.id.as_str(),
                info.safety.as_str(),
                if info.requires_admin { "yes" } else { "no" },
                size,
                meta.label
            );
        }
        println!("\nMeasured total: {}", human_bytes(total));
        return Ok(());
    }

    let profile = profile.ok_or_else(|| {
        AppError::InvalidPath(
            "Missing <profile|ids> (e.g. `dev-cleaner sys quick -n`).".to_string(),
        )
    })?;

    let ids = parse_selection(&profile)?;

    let needs_admin = ids.iter().any(|id| spec(*id).requires_admin);
    if needs_admin && !elevated {
        return Err(AppError::Blocked(
            "This selection needs administrator rights. Run the app and use \
             'Restart as administrator', or start this command from an elevated terminal."
                .to_string(),
        ));
    }

    if dry_run {
        let token = CancellationToken::new();
        let actions = super::measure::measure_actions(&ids, elevated, &token);
        let total: u64 = actions.iter().map(|action| action.bytes).sum();
        if as_json {
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "dry_run": true,
                    "elevated": elevated,
                    "total_bytes": total,
                    "total_human": human_bytes(total),
                    "actions": actions,
                }))
                .unwrap_or_default()
            );
            return Ok(());
        }
        for action in &actions {
            let size = if action.measured {
                human_bytes(action.bytes)
            } else {
                action
                    .reason
                    .clone()
                    .unwrap_or_else(|| "not measured".to_string())
            };
            println!(
                "{:<18} {:>12}  {}",
                action.id.as_str(),
                size,
                spec(action.id).label
            );
        }
        println!("\nTotal: {}", human_bytes(total));
        return Ok(());
    }

    if !confirmed {
        return fail("Refusing to delete without -y/--yes. Add -n/--dry-run to preview the sizes.");
    }

    let token = CancellationToken::new();
    let report = super::execute::execute(&ids, elevated, &token, |_event| {});
    let state = crate::commands::AppState::new();
    let settings = state.settings.load();
    super::execute::record_audit(&state.audit, &report, settings.history_enabled);

    let mut failures = 0usize;
    if as_json {
        for result in &report.results {
            if !result.success {
                failures += 1;
            }
        }
        println!(
            "{}",
            serde_json::to_string_pretty(&report).unwrap_or_default()
        );
    } else {
        for result in &report.results {
            if result.success {
                println!(
                    "OK   {:<18} {:>10}  {} files, {} skipped",
                    result.id.as_str(),
                    human_bytes(result.freed_bytes),
                    result.deleted_files,
                    result.skipped
                );
            } else {
                failures += 1;
                println!(
                    "FAIL {:<18} {:>10}  {}",
                    result.id.as_str(),
                    human_bytes(result.freed_bytes),
                    result.error_code.as_deref().unwrap_or("failed")
                );
            }
        }
        println!("\nFreed {} in total.", human_bytes(report.freed_bytes));
    }

    if scheduled {
        let repository = super::schedule::SystemAutomationRepository::new();
        let mut config = repository.load();
        config.last_run = Some(report.finished_at.clone());
        config.last_freed_bytes = Some(report.freed_bytes);
        let _ = repository.save(&config);
    }

    if failures > 0 {
        return Err(AppError::PermanentDeleteFailed(format!(
            "{failures} action(s) did not complete."
        )));
    }
    Ok(())
}

fn parse_selection(value: &str) -> Result<Vec<SystemActionId>, AppError> {
    let lower = value.to_lowercase();
    if matches!(lower.as_str(), "quick" | "standard" | "deep") {
        return Ok(profile_actions(&lower));
    }
    if lower == "all" {
        return Ok(ACTIONS.iter().map(|action| action.id).collect());
    }

    let mut ids = Vec::new();
    for part in value.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let id = SystemActionId::parse(part)
            .ok_or_else(|| AppError::InvalidPath(format!("Unknown system action: {part}")))?;
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    if ids.is_empty() {
        return Err(AppError::InvalidPath(
            "No system action was selected.".to_string(),
        ));
    }
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profiles_expand_to_known_ids() {
        assert_eq!(parse_selection("quick").expect("quick").len(), 2);
        assert_eq!(parse_selection("standard").expect("standard").len(), 5);
        assert!(parse_selection("deep").expect("deep").len() >= 7);
        assert_eq!(parse_selection("all").expect("all").len(), ACTIONS.len());
    }

    #[test]
    fn ids_are_deduplicated_and_validated() {
        let ids = parse_selection("prefetch,prefetch,userTemp").expect("ids");
        assert_eq!(
            ids,
            vec![SystemActionId::Prefetch, SystemActionId::UserTemp]
        );
        assert!(parse_selection("obliterate").is_err());
    }

    #[test]
    fn unknown_flag_is_rejected_fail_closed() {
        let args = vec!["quick".to_string(), "--dryrun".to_string()];
        let err = run(&args).unwrap_err();
        assert!(matches!(err, AppError::InvalidPath(_)));
    }
}
