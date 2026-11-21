use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::safety::{validate_target, GuardContext};

pub struct RecycleBinService;

impl RecycleBinService {
    pub fn new() -> Self {
        Self
    }

    /// Moves a validated target to the OS Trash / Recycle Bin.
    ///
    /// There is deliberately no permanent fallback: if the recycle operation
    /// fails the caller receives an error and nothing is deleted.
    pub fn recycle(&self, raw_path: &Path, ctx: &GuardContext<'_>) -> Result<PathBuf, AppError> {
        let canonical = validate_target(raw_path, ctx)?;

        recycle_via_shell(&canonical)?;

        if !wait_until_removed(&canonical) {
            return Err(AppError::RecycleBinFailed(canonical.display().to_string()));
        }

        Ok(canonical)
    }
}

/// Reusable multi-item Recycle Bin session.
///
/// On Windows, keeps a single warm STA COM thread alive across an entire
/// cleanup batch instead of spawning a new OS thread and re-initializing COM
/// for every target, while preserving exact per-item error isolation and
/// zero fallback to permanent deletion.
pub struct RecycleBinSession {
    #[cfg(windows)]
    worker: Option<StaRecycleWorker>,
}

impl RecycleBinSession {
    pub fn new() -> Self {
        Self {
            #[cfg(windows)]
            worker: None,
        }
    }

    pub fn recycle(
        &mut self,
        raw_path: &Path,
        ctx: &GuardContext<'_>,
    ) -> Result<PathBuf, AppError> {
        let canonical = validate_target(raw_path, ctx)?;

        #[cfg(windows)]
        {
            if self.worker.is_none() {
                self.worker = Some(StaRecycleWorker::spawn()?);
            }
            if let Some(worker) = &self.worker {
                worker.recycle(&canonical)?;
            }
        }
        #[cfg(not(windows))]
        {
            recycle_via_shell(&canonical)?;
        }

        if !wait_until_removed(&canonical) {
            return Err(AppError::RecycleBinFailed(canonical.display().to_string()));
        }

        Ok(canonical)
    }
}

impl Default for RecycleBinSession {
    fn default() -> Self {
        Self::new()
    }
}

/// Waits up to three seconds for the recycle operation to disappear from the
/// filesystem. A path that is still present after that is a real failure.
///
/// `IFileOperation::PerformOperations` can return before the shell has fully
/// released its handle on a very large tree; polling for three seconds avoids
/// reporting a successful recycle as `VERIFY_FAILED`. The wait is per item and
/// only happens while the path still exists, so a failed/locked item is not
/// penalised more than the budget itself.
fn wait_until_removed(path: &Path) -> bool {
    const ATTEMPTS: u32 = 60;
    const DELAY: std::time::Duration = std::time::Duration::from_millis(50);
    for attempt in 0..ATTEMPTS {
        if !path.exists() {
            return true;
        }
        if attempt + 1 < ATTEMPTS {
            std::thread::sleep(DELAY);
        }
    }
    !path.exists()
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
    // Measure the path the shell actually receives. Canonicalization adds the
    // `\\?\` prefix, which is not part of the user-visible name and pushed
    // borderline paths over the Recycle Bin limit.
    shell_path(path).encode_utf16().count()
}

fn path_too_long(path: &Path) -> bool {
    utf16_len(path) > 259
}

#[cfg(windows)]
type RecycleRequest = (PathBuf, std::sync::mpsc::Sender<Result<(), AppError>>);

#[cfg(windows)]
struct StaRecycleWorker {
    tx: Option<std::sync::mpsc::Sender<RecycleRequest>>,
    handle: Option<std::thread::JoinHandle<()>>,
}

#[cfg(windows)]
impl StaRecycleWorker {
    fn spawn() -> Result<Self, AppError> {
        use windows::Win32::System::Com::{
            CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED,
        };

        let (tx, rx) = std::sync::mpsc::channel::<RecycleRequest>();
        let (init_tx, init_rx) = std::sync::mpsc::channel::<Result<(), AppError>>();

        let handle = std::thread::Builder::new()
            .name("recycle-bin-sta".into())
            .spawn(move || {
                let init = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
                if init.is_err() {
                    let _ = init_tx.send(Err(AppError::RecycleBinComFailed(format!(
                        "COM 0x{:08X}",
                        init.0 as u32
                    ))));
                    return;
                }
                let _ = init_tx.send(Ok(()));
                while let Ok((target, reply)) = rx.recv() {
                    let _ = reply.send(perform_win32_recycle(&target));
                }
                unsafe { CoUninitialize() };
            })
            .map_err(|e| {
                let detail = e
                    .raw_os_error()
                    .map(|code| format!("OS error {}", code))
                    .unwrap_or_else(|| "worker-thread".to_string());
                AppError::RecycleBinComFailed(detail)
            })?;

        init_rx
            .recv()
            .map_err(|_| AppError::RecycleBinComFailed("sta-init-failed".to_string()))??;

        Ok(Self {
            tx: Some(tx),
            handle: Some(handle),
        })
    }

    fn recycle(&self, target: &Path) -> Result<(), AppError> {
        let Some(tx) = &self.tx else {
            return Err(AppError::RecycleBinComFailed("worker-closed".to_string()));
        };
        let (reply_tx, reply_rx) = std::sync::mpsc::channel();
        tx.send((target.to_path_buf(), reply_tx))
            .map_err(|_| AppError::RecycleBinComFailed("worker-disconnected".to_string()))?;
        reply_rx
            .recv()
            .map_err(|_| AppError::RecycleBinComFailed(target.display().to_string()))?
    }
}

#[cfg(windows)]
impl Drop for StaRecycleWorker {
    fn drop(&mut self) {
        self.tx.take();
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

#[cfg(windows)]
fn perform_win32_recycle(target: &Path) -> Result<(), AppError> {
    use windows::core::{GUID, PCWSTR};
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
    use windows::Win32::UI::Shell::{
        IFileOperation, IShellItem, SHCreateItemFromParsingName, FOFX_RECYCLEONDELETE, FOF_NO_UI,
    };

    // `CLSID_FileOperation` is not exported by the `windows` crate metadata,
    // so it is declared here from the Windows SDK.
    const CLSID_FILE_OPERATION: GUID = GUID::from_u128(0x3AD0_5575_8857_4850_9277_11B8_5BDB_8E09);

    fn map_hresult(err: windows::core::Error, display: &str) -> AppError {
        let code = err.code().0 as u32;
        let context = format!("{} (HRESULT 0x{:08X})", display, code);
        match code {
            // Win32 disk/quota full + Shell COPYENGINE_E_RECYCLE_SIZE_TOO_BIG
            // (0x80270037) and COPYENGINE_E_RECYCLE_FORCE_NUKE (0x80270036).
            0x8007_0070 | 0x8007_0027 | 0x8027_0037 | 0x8027_0036 => {
                AppError::RecycleBinTooSmall(context)
            }
            0x8007_0005 | 0x8007_0522 => AppError::RecycleBinAccessDenied(context),
            0x8007_0002 | 0x8007_0003 | 0x8007_0490 => AppError::RecycleBinNotFound(context),
            0x8007_0020 | 0x8007_0021 => AppError::RecycleBinSharingViolation(context),
            // Win32 filename too long + Shell COPYENGINE_E_RECYCLE_PATH_TOO_LONG (0x80270038).
            0x8007_00CE | 0x8007_00A1 | 0x8027_0038 => AppError::RecycleBinPathTooLong(context),
            // Win32 cancelled + Shell COPYENGINE_E_USER_CANCELLED (0x80270000).
            0x8007_04C7 | 0x8007_04B5 | 0x8027_0000 => AppError::RecycleBinAborted(context),
            // Win32 not supported + Shell COPYENGINE_E_RECYCLE_BIN_NOT_FOUND (0x8027003A).
            0x8007_0032 | 0x8027_003A => AppError::RecycleBinDisabled(context),
            // Shell COPYENGINE_E_RECYCLE_UNKNOWN_ERROR (0x80270035) & others.
            _ => AppError::RecycleBinComFailed(context),
        }
    }

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

    let operation: IFileOperation = unsafe {
        CoCreateInstance(&CLSID_FILE_OPERATION, None, CLSCTX_ALL)
    }
    .map_err(|e| AppError::RecycleBinComFailed(format!("HRESULT 0x{:08X}", e.code().0 as u32)))?;

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
            return Err(AppError::RecycleBinAborted(display));
        }
    }

    Ok(())
}

#[cfg(windows)]
fn recycle_via_shell(canonical: &Path) -> Result<(), AppError> {
    let worker = StaRecycleWorker::spawn()?;
    worker.recycle(canonical)
}

#[cfg(target_os = "macos")]
fn recycle_via_shell(canonical: &Path) -> Result<(), AppError> {
    use std::process::Command;
    // Pass the path via argv (`on run argv`), never string-interpolated into AppleScript.
    let status = Command::new("osascript")
        .args([
            "-e",
            "on run argv\nset p to POSIX file (item 1 of argv)\ntell application \"Finder\" to delete p\nend run",
            "--",
        ])
        .arg(canonical)
        .status()
        .map_err(|e| AppError::RecycleBinFailed(e.to_string()))?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::RecycleBinFailed(canonical.display().to_string()))
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn recycle_via_shell(canonical: &Path) -> Result<(), AppError> {
    use std::process::Command;
    let status = Command::new("gio")
        .arg("trash")
        .arg("--")
        .arg(canonical)
        .status()
        .map_err(|e| AppError::RecycleBinFailed(format!("gio trash unavailable: {e}")))?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::RecycleBinFailed(canonical.display().to_string()))
    }
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

    #[test]
    fn long_path_detection_ignores_extended_prefix() {
        // 258 characters without the prefix, 262 with it. The shell limit
        // applies to the former, so trimming the prefix is required.
        let body = format!(r"C:\{}", "a".repeat(255));
        let extended = format!(r"\\?\{}", body);
        assert_eq!(body.encode_utf16().count(), 258);
        assert!(extended.encode_utf16().count() > 259);
        assert!(!path_too_long(Path::new(&extended)));
    }
}
