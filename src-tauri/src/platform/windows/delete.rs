//! Handle-based permanent deletion.
//!
//! The previous implementation deleted by path (`fs::remove_file` /
//! `fs::remove_dir_all`). Even after re-validating the target, the path could
//! be swapped for a symlink or a different object between the check and the
//! destructive call (TOCTOU). This module instead opens the object once, checks
//! its file identity against the expected value, and asks the kernel to delete
//! *that handle* with `FileDispositionInfoEx`. Whatever the path points to
//! afterwards is irrelevant.
//!
//! `NtCreateFile` would also work but lives behind the `Wdk_Storage_FileSystem`
//! feature, which pulls in the whole WDK surface; `CreateFileW` +
//! `SetFileInformationByHandle` needs only `Win32_Storage_FileSystem`, already
//! enabled in `Cargo.toml`.

use crate::platform::FileIdentity;

/// Why a handle-based delete could not be completed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandleDeleteError {
    /// The object behind the path is not the object that was validated.
    IdentityChanged,
    /// The API or filesystem does not support `FileDispositionInfoEx`
    /// (Windows before 10 1709, some network/FAT volumes).
    Unsupported(u32),
    /// A process holds the object with an incompatible sharing mode.
    InUse,
    /// Any other Win32 failure, carrying the raw error code.
    Failed(u32),
}

impl HandleDeleteError {
    pub fn is_unsupported(self) -> bool {
        matches!(self, Self::Unsupported(_))
    }

    pub fn code(self) -> Option<u32> {
        match self {
            Self::Unsupported(code) | Self::Failed(code) => Some(code),
            _ => None,
        }
    }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::path::Path;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FileDispositionInfoEx, GetFileInformationByHandle, SetFileInformationByHandle,
        BY_HANDLE_FILE_INFORMATION, DELETE, FILE_DISPOSITION_FLAG_DELETE,
        FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE, FILE_DISPOSITION_FLAG_POSIX_SEMANTICS,
        FILE_DISPOSITION_INFO_EX, FILE_DISPOSITION_INFO_EX_FLAGS, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
        OPEN_EXISTING,
    };

    /// `ERROR_INVALID_FUNCTION`, `ERROR_NOT_SUPPORTED`, `ERROR_INVALID_PARAMETER`.
    const UNSUPPORTED_CODES: [u32; 3] = [1, 50, 87];
    /// `ERROR_SHARING_VIOLATION`, `ERROR_LOCK_VIOLATION`.
    const IN_USE_CODES: [u32; 2] = [32, 33];

    struct HandleGuard(HANDLE);

    impl Drop for HandleGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    fn classify(code: u32) -> HandleDeleteError {
        if IN_USE_CODES.contains(&code) {
            HandleDeleteError::InUse
        } else if UNSUPPORTED_CODES.contains(&code) {
            HandleDeleteError::Unsupported(code)
        } else {
            HandleDeleteError::Failed(code)
        }
    }

    fn win32_code(err: windows::core::Error) -> u32 {
        err.code().0 as u32 & 0xFFFF
    }

    /// Opens `path` (never following a reparse point), verifies its identity
    /// when `expected` is supplied, and marks the opened handle for deletion.
    pub fn delete_by_handle(
        path: &Path,
        expected: Option<FileIdentity>,
    ) -> Result<(), HandleDeleteError> {
        let wide = super::super::wide_verbatim(path);
        let handle = unsafe {
            CreateFileW(
                PCWSTR(wide.as_ptr()),
                DELETE.0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                None,
                OPEN_EXISTING,
                FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
                None,
            )
        }
        .map(HandleGuard)
        .map_err(|err| classify(win32_code(err)))?;

        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        unsafe { GetFileInformationByHandle(handle.0, &mut info) }
            .map_err(|err| classify(win32_code(err)))?;
        let actual = FileIdentity {
            volume_serial: info.dwVolumeSerialNumber as u64,
            file_index: ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
        };
        if let Some(expected) = expected {
            if actual != expected {
                return Err(HandleDeleteError::IdentityChanged);
            }
        }

        // POSIX semantics makes the deletion take effect immediately (the name
        // disappears while the handle stays valid), which is what makes the
        // identity check meaningful. `IGNORE_READONLY_ATTRIBUTE` replaces the
        // separate `remove_file` + attribute-reset dance; it applies to files
        // and directories alike.
        let flags = FILE_DISPOSITION_FLAG_DELETE.0
            | FILE_DISPOSITION_FLAG_POSIX_SEMANTICS.0
            | FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE.0;
        let disposition = FILE_DISPOSITION_INFO_EX {
            Flags: FILE_DISPOSITION_INFO_EX_FLAGS(flags),
        };
        unsafe {
            SetFileInformationByHandle(
                handle.0,
                FileDispositionInfoEx,
                &disposition as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<FILE_DISPOSITION_INFO_EX>() as u32,
            )
        }
        .map_err(|err| classify(win32_code(err)))?;

        // Closing the handle performs the deletion.
        drop(handle);
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    use std::path::Path;

    pub fn delete_by_handle(
        _path: &Path,
        _expected: Option<FileIdentity>,
    ) -> Result<(), HandleDeleteError> {
        // Callers fall back to the portable path-based removal.
        Err(HandleDeleteError::Unsupported(0))
    }
}

pub use imp::delete_by_handle;

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use crate::platform::identity;

    #[test]
    fn deletes_the_opened_file_even_when_it_is_read_only() {
        let dir = tempfile::tempdir().expect("temp dir");
        let file = dir.path().join("readonly.txt");
        std::fs::write(&file, b"x").expect("write");
        let mut perms = std::fs::metadata(&file).expect("meta").permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(&file, perms).expect("readonly");

        let expected = identity(&file).expect("identity");
        delete_by_handle(&file, Some(expected)).expect("delete");

        assert!(!file.exists());
    }

    #[test]
    fn refuses_to_delete_when_the_identity_changed() {
        let dir = tempfile::tempdir().expect("temp dir");
        let file = dir.path().join("kept.txt");
        std::fs::write(&file, b"x").expect("write");

        let wrong = FileIdentity {
            volume_serial: 0,
            file_index: u64::MAX,
        };
        let result = delete_by_handle(&file, Some(wrong));

        assert_eq!(result, Err(HandleDeleteError::IdentityChanged));
        assert!(
            file.exists(),
            "the file must survive a failed identity check"
        );
    }

    #[test]
    fn handles_paths_beyond_the_legacy_max_path_limit() {
        let dir = tempfile::tempdir().expect("temp dir");
        let mut path = dir.path().to_path_buf();
        for index in 0..12 {
            path.push(format!("segment-{index}-{}", "x".repeat(20)));
        }
        std::fs::create_dir_all(&path).expect("deep dir");
        let file = path.join("payload.bin");
        std::fs::write(&file, b"x").expect("write");

        let expected = identity(&file).expect("identity");
        delete_by_handle(&file, Some(expected)).expect("delete");

        assert!(!file.exists());
    }
}
