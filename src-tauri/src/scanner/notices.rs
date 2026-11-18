//! Severity classification for scan warnings.
//!
//! The scanner reports every path it could not read. Presenting all of them as
//! "warnings" told the user that their own folders were skipped even when the
//! only unreadable locations were Windows-protected ones that can never hold a
//! cleanup target. The classification has to live here, in the backend: the
//! walk knows the real root of each pass, while the UI only ever sees the
//! joined `"C:\\, D:\\"` label of a full-disk scan and therefore cannot tell
//! whether a path is inside the selected scope.
//!
//! Order matters. A protected system location is reported as `Info` even when
//! it lies inside the scan root (for a full-disk scan the root *is* the drive,
//! so every system folder is "inside" it). Only after that check does an
//! in-scope path count as a real `Warning`.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::safety::path_guard;

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ScanNoticeSeverity {
    /// Expected skip; no user action needed.
    #[default]
    Info,
    /// A location inside the selected scope could not be read: results may be
    /// missing entries.
    Warning,
    /// The scan itself was blocked (root unreadable, drive failure).
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanNotice {
    pub code: String,
    pub path: Option<String>,
    pub severity: ScanNoticeSeverity,
    /// The walk root this notice belongs to. Lets the UI explain the scope and
    /// lets support copy a complete record.
    pub root: Option<String>,
}

/// Windows-owned locations that never hold a cleanup target. Taking ownership
/// of these is explicitly not recommended, so the UI must not ask the user to
/// "check permissions" for them.
const SYSTEM_COMPONENTS: &[&str] = &[
    "system volume information",
    "config.msi",
    "$recycle.bin",
    "recovery",
    "perflogs",
    "msocache",
    "$windows.~bt",
    "$windows.~ws",
    "boot",
];

/// Names of the first path component after the drive letter that are always
/// Windows-owned. Checked only at the first level so a legitimate project
/// folder named `windows` or `programdata` deeper in the tree stays scoped.
const SYSTEM_FIRST_COMPONENTS: &[&str] = &[
    "windows",
    "program files",
    "program files (x86)",
    "programdata",
];

/// True for a temp directory and anything below it.
///
/// The scan key is normalized (lowercased, trailing separator removed), so a
/// `contains("\\temp\\")` test missed the temp directory *itself*: an
/// `ACCESS_DENIED` on `%LOCALAPPDATA%\Temp` was reported as a warning telling
/// the user to check permissions on a folder that cannot hold a cleanup target.
fn is_temp_dir(lower: &str) -> bool {
    const WINDOWS_TEMP: &str = "\\windows\\temp";
    const LOCAL_TEMP: &str = "\\appdata\\local\\temp";
    [WINDOWS_TEMP, LOCAL_TEMP]
        .iter()
        .any(|dir| lower.ends_with(dir) || lower.contains(&format!("{dir}\\")))
}

pub fn is_system_protected(key: &str) -> bool {
    let lower = key.replace('/', "\\").to_lowercase();
    // Temporary directories are routinely locked by running tools. They are
    // not a signal that the user's project was skipped.
    if is_temp_dir(&lower) {
        return true;
    }
    let parts = path_guard::path_components(&lower);
    if parts
        .iter()
        .any(|part| SYSTEM_COMPONENTS.iter().any(|known| known == part))
    {
        return true;
    }
    parts
        .get(1)
        .is_some_and(|first| SYSTEM_FIRST_COMPONENTS.iter().any(|known| known == first))
}

/// Classifies one warning. `root` is the root of the walk that produced it.
pub fn classify(code: &str, path: Option<&str>, root: Option<&str>) -> ScanNoticeSeverity {
    if code == "DRIVE_SCAN_FAILED" {
        return ScanNoticeSeverity::Error;
    }
    // A warning without a path (history write, provider failure) is never a
    // hole in the walk, but it does affect what the user can trust.
    let Some(path) = path else {
        return if code == "HISTORY_WRITE_FAILED" || code == "ACCESS_DENIED" {
            ScanNoticeSeverity::Warning
        } else {
            ScanNoticeSeverity::Info
        };
    };

    let key = path_guard::normalize_key(Path::new(path));
    let Some(root) = root else {
        return if is_system_protected(&key) {
            ScanNoticeSeverity::Info
        } else {
            ScanNoticeSeverity::Warning
        };
    };
    let root_key = path_guard::normalize_key(Path::new(root));

    // The root itself is unreadable: the scan never started for that scope.
    if key == root_key {
        return ScanNoticeSeverity::Error;
    }
    if is_system_protected(&key) {
        return ScanNoticeSeverity::Info;
    }
    if path_guard::is_within(&key, &root_key) {
        return ScanNoticeSeverity::Warning;
    }
    ScanNoticeSeverity::Info
}

/// Agent warnings are mostly policy statements (`RECORDING_ACTIVE`,
/// `AGENT_CACHE_DISABLED`); only a read failure is a real gap.
pub fn classify_agent(code: &str, path: Option<&str>) -> ScanNoticeSeverity {
    if matches!(code, "ACCESS_DENIED" | "WALK_ERROR") {
        classify(code, path, None)
    } else {
        ScanNoticeSeverity::Info
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_volume_information_is_info_even_inside_the_drive_root() {
        assert_eq!(
            classify(
                "ACCESS_DENIED",
                Some(r"C:\System Volume Information"),
                Some(r"C:\")
            ),
            ScanNoticeSeverity::Info
        );
    }

    #[test]
    fn config_msi_is_info() {
        assert_eq!(
            classify("ACCESS_DENIED", Some(r"C:\Config.Msi"), Some(r"C:\")),
            ScanNoticeSeverity::Info
        );
    }

    #[test]
    fn locked_temp_is_info() {
        assert_eq!(
            classify(
                "ACCESS_DENIED",
                Some(r"C:\Users\me\AppData\Local\Temp\build-42"),
                Some(r"C:\")
            ),
            ScanNoticeSeverity::Info
        );
    }

    #[test]
    fn the_locked_temp_directory_itself_is_info() {
        // The key has no trailing separator, which the old `contains` test
        // required; the user was told to "check permissions" on %TEMP% itself.
        assert_eq!(
            classify(
                "ACCESS_DENIED",
                Some(r"C:\Users\me\AppData\Local\Temp"),
                Some(r"C:\")
            ),
            ScanNoticeSeverity::Info
        );
        assert_eq!(
            classify("ACCESS_DENIED", Some(r"C:\Windows\Temp"), Some(r"C:\")),
            ScanNoticeSeverity::Info
        );
    }

    #[test]
    fn project_folder_inside_the_selected_root_is_a_warning() {
        assert_eq!(
            classify(
                "ACCESS_DENIED",
                Some(r"D:\Projects\app\node_modules"),
                Some(r"D:\Projects\app")
            ),
            ScanNoticeSeverity::Warning
        );
    }

    #[test]
    fn a_project_named_windows_is_not_treated_as_a_system_folder() {
        assert_eq!(
            classify(
                "ACCESS_DENIED",
                Some(r"D:\Projects\windows\dist"),
                Some(r"D:\Projects")
            ),
            ScanNoticeSeverity::Warning
        );
    }

    #[test]
    fn unreadable_root_is_an_error() {
        assert_eq!(
            classify(
                "ACCESS_DENIED",
                Some(r"D:\Projects\app"),
                Some(r"D:\Projects\app")
            ),
            ScanNoticeSeverity::Error
        );
    }

    #[test]
    fn drive_failure_is_an_error() {
        assert_eq!(
            classify("DRIVE_SCAN_FAILED", Some("E: boom"), None),
            ScanNoticeSeverity::Error
        );
    }

    #[test]
    fn path_outside_the_root_is_only_informational() {
        assert_eq!(
            classify(
                "WALK_ERROR",
                Some(r"C:\Somewhere\else"),
                Some(r"D:\Projects")
            ),
            ScanNoticeSeverity::Info
        );
    }

    #[test]
    fn prefix_collision_is_not_within() {
        // `C:\WindowsX` must not be treated as a child of `C:\Windows`.
        assert_eq!(
            classify("ACCESS_DENIED", Some(r"C:\WindowsX\a"), Some(r"C:\Windows")),
            ScanNoticeSeverity::Info
        );
    }
}
