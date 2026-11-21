use crate::cleanup::DeleteMode;
use crate::commands::AppState;
use crate::error::AppError;

use super::format_size;
use super::help::print_history_help;
use super::i18n::{t, tf};

pub(super) fn run_history_cli(args: &[String]) -> Result<(), AppError> {
    let mut help = false;
    let mut as_json = false;
    let mut limit = 20usize;

    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if let Some(raw) = arg.strip_prefix("--limit=") {
            limit = raw.parse::<usize>().map_err(|_| {
                AppError::InvalidPath(format!("Invalid limit '{raw}'; expected positive integer."))
            })?;
            i += 1;
            continue;
        }
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
                    "Unknown flag '{other}'. Run `detergo hist -h` for usage."
                )));
            }
            other if other.starts_with('-') && other.len() > 1 => {
                for ch in other[1..].chars() {
                    match ch {
                        'h' => help = true,
                        'j' => as_json = true,
                        unknown => {
                            return Err(AppError::InvalidPath(format!(
                                "Unknown flag '-{unknown}'. Run `detergo hist -h` for usage."
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
        tf("Detergo: Past Cleanup Records (Last {})", &[&limit])
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
