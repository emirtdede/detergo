//! Low-level Windows metadata used by measurement and safety checks.
//!
//! All functions are best-effort: a `None`/empty result means "could not be
//! determined" and callers must degrade conservatively instead of assuming a
//! successful measurement.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FileIdentity {
    pub volume_serial: u64,
    pub file_index: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileFacts {
    pub allocated_bytes: u64,
    pub logical_bytes: u64,
    pub link_count: u32,
    pub identity: FileIdentity,
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, ERROR_SUCCESS};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, GetCompressedFileSizeW, GetDriveTypeW, GetFileInformationByHandle,
        BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_SHARE_DELETE, FILE_SHARE_MODE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
    }

    fn open_for_query(path: &Path) -> Option<HANDLE> {
        let w = wide(path);
        unsafe {
            CreateFileW(
                PCWSTR(w.as_ptr()),
                0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                None,
            )
            .ok()
        }
    }

    fn compressed_size(path: &Path) -> Option<u64> {
        let w = wide(path);
        let mut high: u32 = 0;
        unsafe {
            let low = GetCompressedFileSizeW(PCWSTR(w.as_ptr()), Some(&mut high));
            if low == u32::MAX && GetLastError() != ERROR_SUCCESS {
                None
            } else {
                Some(((high as u64) << 32) | low as u64)
            }
        }
    }

    pub fn facts(path: &Path) -> Option<FileFacts> {
        let handle = open_for_query(path)?;
        unsafe {
            let mut info = BY_HANDLE_FILE_INFORMATION::default();
            let ok = GetFileInformationByHandle(handle, &mut info).is_ok();
            let _ = CloseHandle(handle);
            if !ok {
                return None;
            }
            let identity = FileIdentity {
                volume_serial: info.dwVolumeSerialNumber as u64,
                file_index: ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
            };
            let logical = ((info.nFileSizeHigh as u64) << 32) | info.nFileSizeLow as u64;
            Some(FileFacts {
                allocated_bytes: compressed_size(path).unwrap_or(logical),
                logical_bytes: logical,
                link_count: info.nNumberOfLinks.max(1),
                identity,
            })
        }
    }

    pub fn identity(path: &Path) -> Option<FileIdentity> {
        facts(path).map(|f| f.identity)
    }

    pub fn is_reparse_point(path: &Path) -> bool {
        use std::os::windows::fs::MetadataExt;
        match std::fs::symlink_metadata(path) {
            Ok(meta) => {
                if meta.file_type().is_symlink() {
                    return true;
                }
                meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
            }
            Err(_) => true,
        }
    }

    pub fn is_remote_path(path: &Path) -> bool {
        let s = path.to_string_lossy();
        let stripped = s.strip_prefix(r"\\?\").unwrap_or(&s);
        if stripped.starts_with(r"\\") {
            return true;
        }
        let Some(first) = stripped.chars().next() else {
            return true;
        };
        if !first.is_ascii_alphabetic() {
            return true;
        }
        let root = format!("{}:\\", first);
        let w = wide(Path::new(&root));
        let drive_type = unsafe { GetDriveTypeW(PCWSTR(w.as_ptr())) };
        // DRIVE_REMOTE == 4, DRIVE_NO_ROOT_DIR == 1
        drive_type == 4 || drive_type == 1
    }

    /// `Some(true)` means a process holds the target with an incompatible
    /// sharing mode, `Some(false)` means it is not locked, and `None` means the
    /// state could not be determined (access denied, unsupported volume, …).
    pub fn is_in_use(path: &Path) -> Option<bool> {
        let w = wide(path);
        unsafe {
            match CreateFileW(
                PCWSTR(w.as_ptr()),
                0,
                FILE_SHARE_MODE(0),
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                None,
            ) {
                Ok(h) => {
                    let _ = CloseHandle(h);
                    Some(false)
                }
                Err(err) => {
                    let code = err.code().0 as u32 & 0xFFFF;
                    match code {
                        // ERROR_SHARING_VIOLATION / ERROR_LOCK_VIOLATION
                        32 | 33 => Some(true),
                        // ERROR_FILE_NOT_FOUND / ERROR_PATH_NOT_FOUND
                        2 | 3 => Some(false),
                        // Anything else (notably ACCESS_DENIED) is unknown and
                        // must block deletion rather than allow it.
                        _ => None,
                    }
                }
            }
        }
    }

    pub fn volume_free_bytes(path: &Path) -> Option<u64> {
        use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let mut free: u64 = 0;
        let w = wide(path);
        let ok = unsafe { GetDiskFreeSpaceExW(PCWSTR(w.as_ptr()), Some(&mut free), None, None) };
        if ok.is_ok() {
            Some(free)
        } else {
            None
        }
    }
}

#[cfg(not(windows))]
mod win {
    use super::*;
    pub fn facts(_path: &Path) -> Option<FileFacts> {
        None
    }
    pub fn identity(_path: &Path) -> Option<FileIdentity> {
        None
    }
    pub fn is_reparse_point(path: &Path) -> bool {
        std::fs::symlink_metadata(path)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(true)
    }
    pub fn is_remote_path(_path: &Path) -> bool {
        true
    }
    pub fn is_in_use(_path: &Path) -> Option<bool> {
        None
    }
    pub fn volume_free_bytes(_path: &Path) -> Option<u64> {
        None
    }
}

pub use win::{facts, identity, is_in_use, is_remote_path, is_reparse_point, volume_free_bytes};

/// Enumerates running processes whose executable file name matches one of the
/// given names (case-insensitive, without `.exe`).
pub fn running_process_names(names: &[&str]) -> Vec<(String, Option<PathBuf>)> {
    #[cfg(windows)]
    {
        use std::ffi::OsString;
        use std::os::windows::ffi::OsStringExt;
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };
        use windows::Win32::System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
            PROCESS_QUERY_LIMITED_INFORMATION,
        };

        let mut out = Vec::new();
        unsafe {
            let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
                return out;
            };
            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };

            if Process32FirstW(snapshot, &mut entry).is_ok() {
                loop {
                    let len = entry
                        .szExeFile
                        .iter()
                        .position(|&c| c == 0)
                        .unwrap_or(entry.szExeFile.len());
                    let exe = OsString::from_wide(&entry.szExeFile[..len])
                        .to_string_lossy()
                        .to_lowercase();
                    let stem = exe.strip_suffix(".exe").unwrap_or(&exe).to_string();

                    // Exact matches plus provider helper processes such as
                    // `codex-code-mode-host` or `claude-code`.
                    if names.iter().any(|n| {
                        stem == *n
                            || (stem.starts_with(n)
                                && stem.as_bytes().get(n.len()).copied() == Some(b'-'))
                    }) {
                        let mut full = None;
                        if let Ok(process) = OpenProcess(
                            PROCESS_QUERY_LIMITED_INFORMATION,
                            false,
                            entry.th32ProcessID,
                        ) {
                            let mut buf = vec![0u16; 32768];
                            let mut size = buf.len() as u32;
                            if QueryFullProcessImageNameW(
                                process,
                                PROCESS_NAME_WIN32,
                                windows::core::PWSTR(buf.as_mut_ptr()),
                                &mut size,
                            )
                            .is_ok()
                            {
                                full =
                                    Some(PathBuf::from(OsString::from_wide(&buf[..size as usize])));
                            }
                            let _ = CloseHandle(process);
                        }
                        out.push((stem, full));
                    }

                    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
                    if Process32NextW(snapshot, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snapshot);
        }
        out
    }
    #[cfg(not(windows))]
    {
        let _ = names;
        Vec::new()
    }
}

/// Best-effort check whether any process image lives inside `root`.
pub fn process_running_under(root: &Path) -> bool {
    let names = [
        "codex", "claude", "antigravity", "electron", "code", "node", "git", "docker",
    ];
    running_process_names(&names)
        .into_iter()
        .filter_map(|(_, path)| path)
        .any(|p| p.starts_with(root))
}
