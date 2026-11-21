use std::path::PathBuf;

use crate::error::AppError;
use crate::scanner::models::ScanScope;

/// Parsed multi-target selection for `-t` / `--targets`.
#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct TargetSelection {
    pub(super) projects: bool,
    pub(super) agents: bool,
    pub(super) caches: bool,
    pub(super) system: bool,
    pub(super) all_drives: bool,
}

impl TargetSelection {
    pub(super) fn parse(raw: &str) -> Result<Self, AppError> {
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

    pub(super) fn scanner_scope(&self) -> Option<ScanScope> {
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
pub(super) fn parse_scan_scope(scope: &str) -> Result<ScanScope, AppError> {
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

/// Parses a size argument for `-m`/`--min`/`--min-size`.
///
/// Bare numbers keep backwards compatibility as megabytes (e.g. `-m 50` = 50 MiB).
/// Explicit suffixes (`B`, `K`/`KB`/`KiB`, `M`/`MB`/`MiB`, `G`/`GB`/`GiB`,
/// `T`/`TB`/`TiB`, including decimals like `1.5GB`) are converted to bytes.
/// Invalid text fails closed with `AppError::InvalidPath` (exit code 3).
pub(super) fn parse_human_size(raw: &str) -> Result<u64, AppError> {
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

/// Parses `1,3-5` (commas or spaces) into unique, sorted, zero-based indices.
/// Invalid fragments and out-of-range numbers are ignored, so a typo can never
/// select a target the user did not name.
pub(super) fn parse_selection(input: &str, len: usize) -> Vec<usize> {
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
pub(super) struct ScanCliArgs {
    pub(super) help: bool,
    pub(super) root_path: PathBuf,
    pub(super) scope: String,
    pub(super) targets_arg: Option<String>,
    pub(super) as_json: bool,
    pub(super) auto_clean: bool,
    pub(super) dry_run: bool,
    pub(super) min_size_bytes: u64,
    pub(super) older_than_days: Option<u64>,
    pub(super) incremental_older_than_days: Option<u32>,
    pub(super) safety_levels: Vec<String>,
    pub(super) webhook_url: Option<String>,
    pub(super) top: Option<usize>,
    pub(super) show_all: bool,
    pub(super) interactive: bool,
}

pub(super) fn parse_scan_args(args: &[String]) -> Result<ScanCliArgs, AppError> {
    let mut parsed = ScanCliArgs {
        help: false,
        root_path: PathBuf::from("."),
        scope: "projects".to_string(),
        targets_arg: None,
        as_json: false,
        auto_clean: false,
        dry_run: false,
        min_size_bytes: 0,
        older_than_days: None,
        incremental_older_than_days: None,
        safety_levels: vec!["safe".to_string(), "regenerate".to_string()],
        webhook_url: None,
        top: None,
        show_all: false,
        interactive: false,
    };
    let mut root_set = false;
    let mut after_double_dash = false;

    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if after_double_dash {
            if root_set {
                return Err(AppError::InvalidPath(format!(
                    "Unexpected positional argument '{arg}'."
                )));
            }
            parsed.root_path = PathBuf::from(arg);
            root_set = true;
            i += 1;
            continue;
        }
        if arg == "--" {
            after_double_dash = true;
            i += 1;
            continue;
        }

        // Normalize `--flag=value` into `(flag, Some(inline_val))`.
        let (flag_name, inline_value): (&str, Option<&str>) =
            if arg.starts_with("--") && arg.contains('=') {
                let (k, v) = arg.split_once('=').unwrap();
                (k, Some(v))
            } else {
                (arg.as_str(), None)
            };

        let mut take_value = |label: &str| -> Result<String, AppError> {
            if let Some(v) = inline_value {
                if v.is_empty() {
                    return Err(AppError::InvalidPath(format!(
                        "Missing value after '{label}'."
                    )));
                }
                Ok(v.to_string())
            } else {
                let raw = args.get(i + 1).ok_or_else(|| {
                    AppError::InvalidPath(format!("Missing value after '{label}'."))
                })?;
                i += 1;
                Ok(raw.clone())
            }
        };

        match flag_name {
            "-h" | "--help" if inline_value.is_none() => parsed.help = true,
            "-j" | "--json" if inline_value.is_none() => parsed.as_json = true,
            "-c" | "--clean" | "--auto-clean" if inline_value.is_none() => parsed.auto_clean = true,
            "-n" | "--dry" | "--dry-run" if inline_value.is_none() => parsed.dry_run = true,
            "-a" | "--all" if inline_value.is_none() => parsed.show_all = true,
            "-i" | "--interactive" if inline_value.is_none() => parsed.interactive = true,
            "--top" => {
                let raw = take_value("--top")?;
                let count = raw
                    .parse::<usize>()
                    .map_err(|_| AppError::InvalidPath(format!("Invalid --top value '{raw}'.")))?;
                parsed.top = Some(count.max(1));
            }
            "-t" | "--targets" => {
                let raw = take_value(flag_name)?;
                parsed.targets_arg = Some(raw);
            }
            "--scope" => {
                let raw = take_value("--scope")?;
                parsed.scope = raw;
            }
            "-s" | "--safety" => {
                let raw = take_value(flag_name)?;
                parsed.safety_levels = raw.split(',').map(|s| s.trim().to_lowercase()).collect();
            }
            "-m" | "--min" | "--min-size" => {
                let raw = take_value(flag_name)?;
                parsed.min_size_bytes = parse_human_size(&raw)?;
            }
            "-o" | "--older" | "--older-than" => {
                let raw = take_value(flag_name)?;
                let days = crate::format::parse_age_days(&raw).map_err(AppError::InvalidPath)?;
                parsed.older_than_days = Some(days);
            }
            "-I" | "--incremental-older" | "--incremental-days" => {
                let raw = take_value(flag_name)?;
                let days = crate::format::parse_age_days(&raw).map_err(AppError::InvalidPath)?;
                let bounded = u32::try_from(days.clamp(1, 3650)).unwrap_or(3650);
                parsed.incremental_older_than_days = Some(bounded);
            }
            "-w" | "--webhook" => {
                let raw = take_value(flag_name)?;
                parsed.webhook_url = Some(raw);
            }
            other if other.starts_with("--") => {
                return Err(AppError::InvalidPath(format!(
                    "Unknown flag '{arg}'. Run `detergo s -h` for valid options."
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
                                "Unknown flag '-{unknown}'. Run `detergo s -h` for valid options."
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
