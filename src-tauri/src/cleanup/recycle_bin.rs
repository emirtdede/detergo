use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::safety::{validate_target, GuardContext};

pub struct RecycleBinService;

impl RecycleBinService {
    pub fn new() -> Self {
        Self
    }

    /// Moves a validated target to the Windows Recycle Bin.
    ///
    /// There is deliberately no permanent fallback: if the recycle operation
    /// fails the caller receives an error and nothing is deleted.
    ///
    /// The move is performed by the shell's `IFileOperation` with
    /// `FOFX_RECYCLEONDELETE`, which guarantees the target is recycled even
    /// when the Recycle Bin is disabled for the volume. The previous
    /// `trash` crate call could surface a native "delete permanently?" warning
    /// or block while waiting for UI.
    pub fn recycle(&self, raw_path: &Path, ctx: &GuardContext<'_>) -> Result<PathBuf, AppError> {
        let canonical = validate_target(raw_path, ctx)?;

        recycle_via_shell(&canonical)?;

        // The shell reports success once the item is queued for recycling.
        // Re-check the filesystem so a silently ignored operation is never
        // reported as a successful cleanup.
        if canonical.exists() {
            return Err(AppError::RecycleBinFailed(canonical.display().to_string()));
        }

        Ok(canonical)
    }
}

impl Default for RecycleBinService {
    fn default() -> Self {
        Self::new()
    }
}

/// Converts a canonical Windows path into a form `SHCreateItemFromParsingName`
/// understands. Rust's `canonicalize` returns extended-length `\\?\` paths,
/// which the shell rejects.
fn shell_path(canonical: &Path) -> String {
    let original = canonical.to_string_lossy().replace('/', "\\");
    for prefix in [r"\\?\UNC\", r"\\?\", r"\\.\"] {
        if let Some(stripped) = original.strip_prefix(prefix) {
            return if prefix == r"\\?\UNC\" {
                format!(r"\\{}", stripped)
            } else {
                stripped.to_string()
            };
        }
    }
    original
}

fn utf16_len(path: &Path) -> usize {
    path.as_os_str().to_string_lossy().encode_utf16().count()
}

fn path_too_long(path: &Path) -> bool {
    utf16_len(path) > 259
}

#[cfg(windows)]
fn recycle_via_shell(canonical: &Path) -> Result<(), AppError> {
    use windows::core::{GUID, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        IFileOperation, IShellItem, SHCreateItemFromParsingName, FOFX_RECYCLEONDELETE, FOF_NO_UI,
    };

    // `CLSID_FileOperation` is not exported by the `windows` crate metadata,
    // so it is declared here from the Windows SDK.
    const CLSID_FILE_OPERATION: GUID = GUID::from_u128(0x3AD0_5575_8857_4850_9277_11B8_5BDB_8E09);

    fn map_hresult(err: windows::core::Error, display: &str) -> AppError {
        let code = err.code().0 as u32;
        // The payload is machine-readable technical context only. The localized
        // explanation comes from the frontend `AppError` code, so progress and
        // error messages never carry English prose into the UI.
        let context = format!("{} (HRESULT 0x{:08X})", display, code);
        match code {
            // ERROR_DISK_FULL / ERROR_HANDLE_DISK_FULL: the bin cannot grow
            // enough to accept the target.
            0x8007_0070 | 0x8007_0027 => AppError::RecycleBinTooSmall(context),
            // ERROR_ACCESS_DENIED, ERROR_PRIVILEGE_NOT_HELD
            0x8007_0005 | 0x8007_0522 => AppError::RecycleBinAccessDenied(context),
            // ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_NOT_FOUND
            0x8007_0002 | 0x8007_0003 | 0x8007_0490 => AppError::RecycleBinNotFound(context),
            // ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION
            0x8007_0020 | 0x8007_0021 => AppError::RecycleBinSharingViolation(context),
            // ERROR_FILENAME_EXCED_RANGE, ERROR_INVALID_NAME
            0x8007_00CE | 0x8007_00A1 => AppError::RecycleBinPathTooLong(context),
            // ERROR_CANCELLED, ERROR_REQUEST_ABORTED
            0x8007_04C7 | 0x8007_04B5 => AppError::RecycleBinAborted(context),
            // ERROR_NOT_SUPPORTED: the volume cannot host a Recycle Bin.
            0x8007_0032 => AppError::RecycleBinDisabled(context),
            _ => AppError::RecycleBinComFailed(context),
        }
    }

    fn perform(target: &Path) -> Result<(), AppError> {
        let display = target.display().to_string();
        let shell_target = shell_path(target);
        let wide: Vec<u16> = shell_target
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let item: IShellItem = unsafe { SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None) }
            .map_err(|err| {
                if path_too_long(target) {
                    AppError::RecycleBinPathTooLong(format!(
                        "{} ({} UTF-16 units)",
                        display,
                        utf16_len(target)
                    ))
                } else {
                    AppError::RecycleBinComFailed(format!(
                        "{} (HRESULT 0x{:08X})",
                        display,
                        err.code().0 as u32
                    ))
                }
            })?;

        let operation: IFileOperation =
            unsafe { CoCreateInstance(&CLSID_FILE_OPERATION, None, CLSCTX_ALL) }.map_err(|e| {
                AppError::RecycleBinComFailed(format!("HRESULT 0x{:08X}", e.code().0 as u32))
            })?;

        unsafe {
            operation
                .SetOperationFlags(FOF_NO_UI | FOFX_RECYCLEONDELETE)
                .map_err(|e| {
                    AppError::RecycleBinComFailed(format!("HRESULT 0x{:08X}", e.code().0 as u32))
                })?;
            operation.DeleteItem(&item, None).map_err(|e| {
                AppError::RecycleBinComFailed(format!(
                    "{} (HRESULT 0x{:08X})",
                    display,
                    e.code().0 as u32
                ))
            })?;
            operation
                .PerformOperations()
                .map_err(|e| map_hresult(e, &display))?;

            let aborted = operation.GetAnyOperationsAborted().map_err(|e| {
                AppError::RecycleBinComFailed(format!("HRESULT 0x{:08X}", e.code().0 as u32))
            })?;
            if aborted.as_bool() {
                return Err(AppError::RecycleBinAborted(display.to_string()));
            }
        }

        Ok(())
    }

    let target = canonical.to_path_buf();
    let display = target.display().to_string();

    let worker = std::thread::Builder::new()
        .name("recycle-bin-sta".into())
        .spawn(move || -> Result<(), AppError> {
            // Each item gets its own short-lived STA so the COM apartment is
            // deterministic and never shared with Tauri's message loop.
            let init = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            if init.is_err() {
                return Err(AppError::RecycleBinComFailed(format!(
                    "COM 0x{:08X}",
                    init.0 as u32
                )));
            }
            let result = perform(&target);
            unsafe { CoUninitialize() };
            result
        })
        .map_err(|e| {
            let detail = e
                .raw_os_error()
                .map(|code| format!("OS error {}", code))
                .unwrap_or_else(|| "worker-thread".to_string());
            AppError::RecycleBinComFailed(detail)
        })?;

    worker
        .join()
        .map_err(|_| AppError::RecycleBinComFailed(display.clone()))?
}

#[cfg(not(windows))]
fn recycle_via_shell(_canonical: &Path) -> Result<(), AppError> {
    Err(AppError::RecycleBinComFailed("windows-only".to_string()))
}

#[cfg(test)]
mod tests {
    use super::{path_too_long, shell_path};
    use std::path::Path;

    #[test]
    fn strips_extended_length_prefix_for_the_shell() {
        assert_eq!(
            shell_path(Path::new(r"\\?\C:\Users\Emir\AppData\Local\Temp\build")),
            r"C:\Users\Emir\AppData\Local\Temp\build"
        );
    }

    #[test]
    fn converts_unc_extended_prefix_back_to_a_share_path() {
        assert_eq!(
            shell_path(Path::new(r"\\?\UNC\server\share\folder")),
            r"\\server\share\folder"
        );
    }

    #[test]
    fn keeps_ordinary_paths_untouched() {
        assert_eq!(
            shell_path(Path::new(r"C:\Work\demo\node_modules")),
            r"C:\Work\demo\node_modules"
        );
    }

    #[test]
    fn long_path_detection_counts_utf16_units() {
        let long = format!(r"C:\{}", "a".repeat(260));
        assert!(path_too_long(Path::new(&long)));
        let short = format!(r"C:\{}", "a".repeat(200));
        assert!(!path_too_long(Path::new(&short)));
    }
}
