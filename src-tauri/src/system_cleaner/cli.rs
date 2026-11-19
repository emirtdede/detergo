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
  dev-cleaner system --list
  dev-cleaner system --clean <profile|ids> --yes [--scheduled]
  dev-cleaner system --clean <profile|ids> --dry-run

Profiles: quick (user temp + Windows Update leftovers)
          standard (+ Windows temp, Prefetch, error reports)
          deep (+ Disk Cleanup and component store; needs administrator)
Ids:      userTemp, windowsTemp, prefetch, windowsUpdate, errorReports,
          recycleBin, diskCleanup, componentStore

The scheduled task created by the app calls:
  dev-cleaner system --clean quick --yes --scheduled
";

fn fail(message: &str) -> Result<(), AppError> {
    Err(AppError::InvalidPath(message.to_string()))
}

pub fn run(args: &[String]) -> Result<(), AppError> {
    if args.is_empty() || args.iter().any(|arg| arg == "--help" || arg == "-h") {
        print!("{USAGE}");
        return Ok(());
    }

    let list_only = args.iter().any(|arg| arg == "--list");
    if list_only {
        println!("{:<18} {:<12} {:<10} Action", "ID", "Safety", "Admin");
        for action in ACTIONS {
            println!(
                "{:<18} {:<12} {:<10} {}",
                action.id.as_str(),
                action.safety.as_str(),
                if action.requires_admin { "yes" } else { "no" },
                action.label
            );
        }
        return Ok(());
    }

    let profile = value_after(args, "--clean")
        .ok_or_else(|| AppError::InvalidPath("Missing --clean <profile|ids>.".to_string()))?;

    let ids = parse_selection(&profile)?;
    let elevated = crate::platform::is_elevated();

    let needs_admin = ids.iter().any(|id| spec(*id).requires_admin);
    if needs_admin && !elevated {
        return Err(AppError::Blocked(
            "This selection needs administrator rights. Run the app and use \
             'Restart as administrator', or start this command from an elevated terminal."
                .to_string(),
        ));
    }

    if args.iter().any(|arg| arg == "--dry-run") {
        let token = CancellationToken::new();
        let actions = super::measure::measure_actions(&ids, elevated, &token);
        let total: u64 = actions.iter().map(|action| action.bytes).sum();
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

    if !args.iter().any(|arg| arg == "--yes") {
        return fail("Refusing to delete without --yes. Add --dry-run to preview the sizes.");
    }

    let token = CancellationToken::new();
    let report = super::execute::execute(&ids, elevated, &token, |_event| {});

    let mut failures = 0usize;
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

    if args.iter().any(|arg| arg == "--scheduled") {
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

fn value_after(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|arg| arg == flag)
        .and_then(|index| args.get(index + 1))
        .cloned()
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
    fn value_after_reads_the_next_argument() {
        let args = vec!["--clean".to_string(), "quick".to_string()];
        assert_eq!(value_after(&args, "--clean").as_deref(), Some("quick"));
        assert_eq!(value_after(&args, "--list"), None);
    }
}
