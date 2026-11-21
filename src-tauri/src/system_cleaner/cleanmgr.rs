//! Windows Disk Cleanup, driven without the interactive `/sageset` dialog.
//!
//! `cleanmgr /sageset:N` opens a window where the user ticks handlers by hand,
//! which is exactly what this feature exists to avoid. The same state is a
//! registry value per handler (`StateFlagsNNNN`), so the app writes a private
//! profile number and then runs `cleanmgr /sagerun:NNNN`. The profile number is
//! deliberately unusual so it does not collide with a user-made `sageset`.
//!
//! Only handlers that are safe and well understood are enabled. `Previous
//! Installations` and `Windows Upgrade Log Files` are left off because removing
//! them can break rollback and in-place upgrade repair.

use std::path::PathBuf;
use std::time::Duration;

use crate::error::AppError;
use crate::scanner::cancellation::CancellationToken;

pub const PROFILE: u32 = 1997;

const TIMEOUT: Duration = Duration::from_secs(30 * 60);

const VOLUME_CACHES: &str = r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\VolumeCaches";

/// Handlers enabled in the app's private cleanup profile.
const HANDLERS: &[&str] = &[
    "Active Setup Temp Folders",
    "D3D Shader Cache",
    "Delivery Optimization Files",
    "Downloaded Program Files",
    "Internet Cache Files",
    "Old ChkDsk Files",
    "Setup Log Files",
    "System error memory dump files",
    "System error minidump files",
    "Temporary Files",
    "Temporary Setup Files",
    "Thumbnail Cache",
    "Windows Error Reporting Files",
];

pub struct CleanMgrOutcome {
    pub enabled_handlers: usize,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub log_tail: String,
}

pub fn executable() -> PathBuf {
    exe("cleanmgr.exe")
}

/// Maps an allowlisted interactive mode to fixed `cleanmgr.exe` arguments.
pub fn native_args(mode: &str) -> Option<&'static [&'static str]> {
    match mode {
        "dialog" => Some(&["/d", "c:"]),
        "sageset" => Some(&["/sageset:1"]),
        "sagerun" => Some(&["/sagerun:1"]),
        _ => None,
    }
}

/// Launches the built-in Windows Disk Cleanup UI (`cleanmgr /d c:`,
/// `cleanmgr /sageset:1`, or `cleanmgr /sagerun:1`) detached so the user does
/// not need to open Command Prompt manually.
pub fn launch_native(mode: &str) -> Result<(), AppError> {
    let args = native_args(mode)
        .ok_or_else(|| AppError::InvalidPath(format!("Unsupported Disk Cleanup mode: {mode}")))?;
    let bin = executable();
    if !bin.is_file() {
        return Err(AppError::PathNotFound(
            "Windows Disk Cleanup (cleanmgr.exe) was not found on this device.".to_string(),
        ));
    }
    std::process::Command::new(&bin)
        .args(args)
        .spawn()
        .map_err(|err| AppError::Unknown(format!("Could not start cleanmgr.exe: {err}")))?;
    Ok(())
}

fn exe(name: &str) -> PathBuf {
    std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32")
        .join(name)
}

/// Writes `StateFlags1997 = 2` for every handler, then runs the profile.
pub fn run(token: &CancellationToken) -> Result<CleanMgrOutcome, AppError> {
    let mut enabled = 0usize;
    let mut failures: Vec<String> = Vec::new();

    let reg_bin = exe("reg.exe");
    let reg_str = reg_bin.to_string_lossy();
    for handler in HANDLERS {
        let key = format!(r"{VOLUME_CACHES}\{handler}");
        let outcome = super::process::run(
            &reg_str,
            &[
                "add",
                &key,
                "/v",
                &format!("StateFlags{PROFILE}"),
                "/t",
                "REG_DWORD",
                "/d",
                "2",
                "/f",
            ],
            Duration::from_secs(20),
            token,
        )?;
        if outcome.exit_code.unwrap_or(1) == 0 {
            enabled += 1;
        } else {
            failures.push(handler.to_string());
        }
    }

    if enabled == 0 {
        return Err(AppError::AccessDenied(
            "Windows Disk Cleanup could not be configured. Administrator rights are required."
                .to_string(),
        ));
    }

    let outcome = super::process::run(
        &exe("cleanmgr.exe").to_string_lossy(),
        &[&format!("/sagerun:{PROFILE}")],
        TIMEOUT,
        token,
    )?;

    let mut log = String::new();
    if !failures.is_empty() {
        log.push_str(&format!("Unavailable handlers: {}\n", failures.join(", ")));
    }
    if !outcome.stdout.trim().is_empty() {
        log.push_str(outcome.stdout.trim_end());
        log.push('\n');
    }
    if !outcome.stderr.trim().is_empty() {
        log.push_str(outcome.stderr.trim_end());
        log.push('\n');
    }
    if outcome.timed_out {
        log.push_str("Windows Disk Cleanup did not finish within 30 minutes and was stopped.\n");
    }

    Ok(CleanMgrOutcome {
        enabled_handlers: enabled,
        exit_code: outcome.exit_code,
        timed_out: outcome.timed_out,
        log_tail: log.trim_end().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_number_is_documented_range() {
        // `StateFlagsNNNN` must stay within the DWORD profile range Windows
        // accepts; a larger number would be silently ignored.
        assert_eq!(PROFILE, 1997);
    }

    #[test]
    fn risky_handlers_stay_off() {
        for risky in [
            "Previous Installations",
            "Windows Upgrade Log Files",
            "Recycle Bin",
            "Language Pack",
        ] {
            assert!(
                !HANDLERS.contains(&risky),
                "{risky} must not be silently enabled"
            );
        }
    }

    #[test]
    fn system32_paths_are_absolute() {
        let path = exe("cleanmgr.exe");
        assert!(path.is_absolute());
        assert!(path.ends_with("cleanmgr.exe"));
    }

    #[test]
    fn native_cleanmgr_modes_are_strictly_allowlisted() {
        assert_eq!(native_args("dialog"), Some(&["/d", "c:"][..]));
        assert_eq!(native_args("sageset"), Some(&["/sageset:1"][..]));
        assert_eq!(native_args("sagerun"), Some(&["/sagerun:1"][..]));
        assert_eq!(native_args("custom"), None);
        assert_eq!(native_args("/d c: && calc"), None);
    }
}
