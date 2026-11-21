//! Administrator detection and an on-demand elevated relaunch.
//!
//! The application never requires elevation to start. The System Cleanup view
//! offers a single "restart as administrator" action; the elevated instance is
//! the same executable with `--open-view system --wait-pid <old_pid>`, so UAC
//! displays "Detergo" (never `cmd.exe`), there is no second binary, and the
//! elevated instance waits on the old PID handle before acquiring the
//! single-instance mutex.

use crate::error::AppError;

#[cfg(windows)]
pub fn is_elevated() -> bool {
    use windows::Win32::UI::Shell::IsUserAnAdmin;
    // `IsUserAnAdmin` is deprecated in favour of token inspection, but it is
    // the same check Explorer uses for the UAC shield and does not need a token
    // handle. The value is advisory: every destructive path still handles
    // `ERROR_ACCESS_DENIED` on its own.
    unsafe { IsUserAnAdmin().as_bool() }
}

#[cfg(not(windows))]
pub fn is_elevated() -> bool {
    false
}

/// Waits up to `timeout_ms` for a previous instance identified by `pid` to exit
/// so its single-instance mutex and window handles are released before this
/// process initializes `tauri-plugin-single-instance`.
#[cfg(windows)]
pub fn wait_for_pid_exit(pid: u32, timeout_ms: u32) {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };

    if pid == 0 || pid == std::process::id() {
        return;
    }
    unsafe {
        if let Ok(handle) = OpenProcess(PROCESS_SYNCHRONIZE, false, pid) {
            let _ = WaitForSingleObject(handle, timeout_ms);
            let _ = CloseHandle(handle);
        }
    }
}

#[cfg(not(windows))]
pub fn wait_for_pid_exit(_pid: u32, _timeout_ms: u32) {}

/// Rejects arguments that cannot be handed safely to the elevated relaunch.
///
/// The only callers are internal (`--open-view system --wait-pid <pid>`), but
/// the check keeps the guarantee explicit if a future caller forwards something
/// dynamic.
fn validate_arg(arg: &str) -> Result<(), AppError> {
    let safe = !arg.is_empty()
        && arg.len() <= 256
        && arg
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '=' | ':' | '.'));
    if safe {
        Ok(())
    } else {
        Err(AppError::InvalidPath(format!(
            "Refusing to pass an unsafe argument to the elevated relaunch: {arg:?}"
        )))
    }
}

/// Starts an elevated copy of this executable directly via `ShellExecuteW`
/// (`runas`) and returns once Windows has launched it.
///
/// The caller is expected to exit the current process immediately afterwards.
/// Returns `AppError::AccessDenied` when the user dismisses the UAC prompt.
#[cfg(windows)]
pub fn relaunch_elevated(extra_args: &[String]) -> Result<(), AppError> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{w, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let exe = std::env::current_exe()
        .map_err(|e| AppError::Blocked(format!("Could not locate the application binary: {e}")))?;

    for arg in extra_args {
        validate_arg(arg)?;
    }

    let exe_wide: Vec<u16> = exe
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut params = extra_args.join(" ");
    if !params.is_empty() {
        params.push(' ');
    }
    params.push_str(&format!("--wait-pid {}", std::process::id()));
    let params_wide: Vec<u16> = params.encode_utf16().chain(std::iter::once(0)).collect();

    let dir_wide: Option<Vec<u16>> = exe.parent().map(|dir| {
        dir.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    });
    let dir_ptr = dir_wide
        .as_ref()
        .map(|w| PCWSTR(w.as_ptr()))
        .unwrap_or(PCWSTR::null());

    let result = unsafe {
        ShellExecuteW(
            None,
            w!("runas"),
            PCWSTR(exe_wide.as_ptr()),
            PCWSTR(params_wide.as_ptr()),
            dir_ptr,
            SW_SHOWNORMAL,
        )
    };

    // ShellExecuteW returns a value <= 32 on failure; ERROR_ACCESS_DENIED (5)
    // is what a dismissed UAC prompt produces.
    let code = result.0 as isize;
    if code <= 32 {
        return Err(AppError::AccessDenied(format!(
            "Administrator approval was not granted (ShellExecuteW error {code})."
        )));
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn relaunch_elevated(_extra_args: &[String]) -> Result<(), AppError> {
    Err(AppError::PlatformUnsupported(
        "System cleanup requires Windows.".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::validate_arg;

    #[test]
    fn accepts_internal_arguments() {
        validate_arg("--open-view").expect("flag");
        validate_arg("system").expect("view");
        validate_arg("--clean=quick").expect("assignment");
    }

    #[test]
    fn rejects_shell_metacharacters() {
        for bad in ["a&b", "a|b", "a>b", "a b", "a\"b", ""] {
            assert!(validate_arg(bad).is_err(), "{bad:?} must be rejected");
        }
    }
}
