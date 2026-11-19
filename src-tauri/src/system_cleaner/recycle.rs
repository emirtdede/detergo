//! Recycle Bin size and empty, through the shell API.
//!
//! Emptying the bin is the one action where "permanent" is the opposite of what
//! the user expects, so it is labelled `review` and never included in the quick
//! profile. The confirmation dialog of Windows itself is suppressed because the
//! app already asked; the progress UI and sound are suppressed too so the run
//! stays inside the app's own feedback.

#[cfg(windows)]
pub fn size_bytes() -> Option<u64> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};

    let mut info = SHQUERYRBINFO {
        cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
        i64Size: 0,
        i64NumItems: 0,
    };
    let result = unsafe { SHQueryRecycleBinW(PCWSTR::null(), &mut info) };
    if result.is_ok() && info.i64Size >= 0 {
        Some(info.i64Size as u64)
    } else {
        None
    }
}

#[cfg(not(windows))]
pub fn size_bytes() -> Option<u64> {
    None
}

/// Empties every Recycle Bin on the machine. Returns `Ok(())` when the shell
/// reports success; an already-empty bin also succeeds.
#[cfg(windows)]
pub fn empty() -> Result<(), crate::error::AppError> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::{
        SHEmptyRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND,
    };

    let flags = SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND;
    let result = unsafe { SHEmptyRecycleBinW(HWND(std::ptr::null_mut()), PCWSTR::null(), flags) };
    result.map_err(|e| {
        crate::error::AppError::PermanentDeleteFailed(format!(
            "Windows could not empty the Recycle Bin: {e}"
        ))
    })
}

#[cfg(not(windows))]
pub fn empty() -> Result<(), crate::error::AppError> {
    Err(crate::error::AppError::PlatformUnsupported(
        "The Recycle Bin is a Windows feature.".to_string(),
    ))
}
