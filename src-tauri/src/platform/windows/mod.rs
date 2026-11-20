pub mod delete;
pub mod drives;
pub mod elevation;
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

    let text = path.to_string_lossy();
    let prefix = if text.starts_with(r"\\?\") {
        ""
    } else if text.starts_with(r"\\") {
        r"\\?\UNC\"
    } else {
        r"\\?\"
    };
    let mut os = OsString::new();
    os.push(prefix);
    os.push(path.as_os_str());
    // Verbatim paths are parsed literally: unlike the legacy `CreateFileW`
    // parser they reject `/` as a separator. `Path::join` happily produces
    // mixed separators, so normalize them here instead of failing the open.
    os.encode_wide()
        .map(|unit| {
            if unit == '/' as u16 {
                '\\' as u16
            } else {
                unit
            }
        })
        .chain(std::iter::once(0))
        .collect()
}

pub use drives::{fixed_drive_roots, list_fixed_drives, DriveInfo};
pub use elevation::{is_elevated, relaunch_elevated, wait_for_pid_exit};
pub use instance_guard::force_foreground;

pub use fs_meta::{
    facts, identity, is_in_use, is_remote_path, is_reparse_point, running_process_names,
    volume_free_bytes, FileFacts, FileIdentity,
};
pub use known_folders::{get_known_dev_locations, KnownLocation};
