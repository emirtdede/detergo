//! Administrator detection and an on-demand elevated relaunch.
//!
//! The application never requires elevation to start. The System Cleanup view
//! offers a single "restart as administrator" action; the elevated instance is
//! the same executable with an extra `--open-view` argument, so there is no
//! second binary and no shell string built from user input.
//!
//! The relaunch goes through `cmd.exe /c ping ... & start`. `ShellExecuteW`
//! creates the target process before it returns, and the single-instance plugin
//! in the new process would then forward its arguments to the still-running old
//! instance and exit. The short delay guarantees the old process is gone before
//! the elevated one starts. The console window is created hidden.

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

/// Rejects arguments that cannot be handed to `cmd /c start` safely.
///
/// The only callers are internal (`--open-view system`), but the check keeps
/// the guarantee explicit if a future caller forwards something dynamic.
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

/// Starts an elevated copy of this executable and returns once Windows has
/// launched the helper.
///
/// The caller is expected to exit the current process immediately afterwards.
/// Returns `AppError::AccessDenied` when the user dismisses the UAC prompt.
#[cfg(windows)]
pub fn relaunch_elevated(extra_args: &[String]) -> Result<(), AppError> {
    use windows::core::{w, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

    let exe = std::env::current_exe()
        .map_err(|e| AppError::Blocked(format!("Could not locate the application binary: {e}")))?;

    for arg in extra_args {
        validate_arg(arg)?;
    }

    // `&` and quotes are the two characters that break this string. The
    // executable path is always quoted, so `&` inside it is literal; a quote
    // cannot appear in a Windows path.
    let exe_text = exe.to_string_lossy();
    if exe_text.contains('"') {
        return Err(AppError::InvalidPath(
            "The application path contains a quote.".to_string(),
        ));
    }

    let mut inner = format!("\"{exe_text}\"");
    for arg in extra_args {
        inner.push(' ');
        inner.push_str(arg);
    }

    // ~2 s delay: `ping` needs no console input, unlike `timeout`.
    let params = format!("/c ping -n 3 127.0.0.1 >nul & start \"\" {inner}");
    let wide: Vec<u16> = params.encode_utf16().chain(std::iter::once(0)).collect();

    let result = unsafe {
        ShellExecuteW(
            None,
            w!("runas"),
            w!("cmd.exe"),
            PCWSTR(wide.as_ptr()),
            None,
            SW_HIDE,
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
