pub mod delete;
pub mod drives;
pub mod elevation;
pub mod fast_walk;
pub mod fs_meta;
pub mod instance_guard;
pub mod known_folders;

/// Encodes a path for the wide Win32 APIs with a `\\?\` verbatim prefix.
///
/// Without the prefix `CreateFileW` refuses paths longer than `MAX_PATH`
/// (260 characters); the deletion and metadata paths must accept the same
/// long targets the scanner reports.
#[cfg(windows)]
pub(crate) fn wide_verbatim(path: &std::path::Path) -> Vec<u16> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStrExt;

    let raw = path.to_string_lossy();
    let normalized = raw.replace('/', "\\");
    let mut os = OsString::new();
    if normalized.starts_with(r"\\?\") || normalized.starts_with(r"\\.\") {
        os.push(&normalized);
    } else if let Some(unc_tail) = normalized.strip_prefix(r"\\") {
        os.push(r"\\?\UNC\");
        os.push(unc_tail);
    } else if path.is_absolute() {
        os.push(r"\\?\");
        os.push(&normalized);
    } else {
        // Relative paths cannot take a `\\?\` verbatim prefix because Win32
        // does not resolve `.` / `..` or CWD on verbatim strings.
        os.push(&normalized);
    }
    os.encode_wide().chain(std::iter::once(0)).collect()
}

pub use drives::{fixed_drive_roots, list_fixed_drives, DriveInfo};
pub use elevation::{is_elevated, relaunch_elevated, wait_for_pid_exit};
#[cfg(windows)]
pub use instance_guard::force_foreground;

pub use fs_meta::{
    facts, identity, is_in_use, is_remote_path, is_reparse_point, running_process_names,
    volume_free_bytes, FileFacts, FileIdentity,
};
pub use known_folders::{get_known_dev_locations, KnownLocation};

#[cfg(all(test, windows))]
mod tests {
    use super::wide_verbatim;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::path::Path;

    fn decode(wide: Vec<u16>) -> String {
        let len = wide.iter().position(|&u| u == 0).unwrap_or(wide.len());
        OsString::from_wide(&wide[..len])
            .to_string_lossy()
            .to_string()
    }

    #[test]
    fn wide_verbatim_formats_drive_unc_device_and_relative_paths() {
        assert_eq!(
            decode(wide_verbatim(Path::new(r"C:\Projects/app\node_modules"))),
            r"\\?\C:\Projects\app\node_modules"
        );
        assert_eq!(
            decode(wide_verbatim(Path::new(r"\\server\share\proj"))),
            r"\\?\UNC\server\share\proj"
        );
        assert_eq!(
            decode(wide_verbatim(Path::new(r"\\?\C:\Already\Verbatim"))),
            r"\\?\C:\Already\Verbatim"
        );
        assert_eq!(
            decode(wide_verbatim(Path::new(r"\\.\PhysicalDrive0"))),
            r"\\.\PhysicalDrive0"
        );
        assert_eq!(
            decode(wide_verbatim(Path::new(r"relative/dir"))),
            r"relative\dir"
        );
    }
}
