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
fn unix_trash_dirs() -> Vec<std::path::PathBuf> {
    let Some(home) = std::env::var_os("HOME").map(std::path::PathBuf::from) else {
        return Vec::new();
    };
    #[cfg(target_os = "macos")]
    {
        vec![home.join(".Trash")]
    }
    #[cfg(not(target_os = "macos"))]
    {
        let data = std::env::var_os("XDG_DATA_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| home.join(".local").join("share"));
        let trash = data.join("Trash");
        vec![trash.join("files"), trash.join("info")]
    }
}

#[cfg(not(windows))]
pub fn size_bytes() -> Option<u64> {
    let token = crate::scanner::cancellation::CancellationToken::new();
    let mut total = 0u64;
    let mut found_any = false;
    for dir in unix_trash_dirs() {
        if dir.is_dir() {
            found_any = true;
            if let Some(size) = crate::scanner::measurement::measure_path(
                &dir,
                crate::catalog::TargetKind::Directory,
                &token,
            ) {
                total = total.saturating_add(size.logical_bytes);
            }
        }
    }
    if found_any {
        Some(total)
    } else {
        Some(0)
    }
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
    for dir in unix_trash_dirs() {
        if !dir.is_dir() || crate::platform::is_reparse_point(&dir) {
            continue;
        }
        let entries = std::fs::read_dir(&dir)
            .map_err(|e| crate::error::AppError::PermanentDeleteFailed(e.to_string()))?;
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = std::fs::symlink_metadata(&path) else {
                continue;
            };
            if meta.is_dir() && !meta.file_type().is_symlink() {
                let _ = std::fs::remove_dir_all(&path);
            } else {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
    Ok(())
}
