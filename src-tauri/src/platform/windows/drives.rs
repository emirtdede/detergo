use serde::Serialize;
use std::path::Path;

/// A local volume that can be scanned. Network shares are deliberately excluded
/// because a full scan over SMB is slow and deletions there cannot use the
/// Recycle Bin safely.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    /// Root path such as `C:\`.
    pub root: String,
    /// Drive letter without the trailing separator, e.g. `C:`.
    pub label: String,
    /// `fixed`, `removable` or `unknown`.
    pub kind: String,
}

/// Converts the `GetLogicalDrives` bitmask into drive roots. Bit 0 is `A:`.
pub fn roots_from_mask(mask: u32) -> Vec<String> {
    let mut roots = Vec::new();
    for bit in 0..26u32 {
        if mask & (1 << bit) != 0 {
            let letter = (b'A' + bit as u8) as char;
            roots.push(format!("{}:\\", letter));
        }
    }
    roots
}

pub fn drive_letter(root: &str) -> String {
    root.trim_end_matches(['\\', '/'])
        .chars()
        .take(2)
        .collect::<String>()
        .to_uppercase()
}

#[cfg(windows)]
fn drive_kind(root: &str) -> String {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDriveTypeW;

    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_FIXED: u32 = 3;
    const DRIVE_REMOTE: u32 = 4;

    let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
    let kind = unsafe { GetDriveTypeW(PCWSTR(wide.as_ptr())) };
    if kind == DRIVE_FIXED {
        "fixed".to_string()
    } else if kind == DRIVE_REMOVABLE {
        "removable".to_string()
    } else if kind == DRIVE_REMOTE {
        "remote".to_string()
    } else {
        "unknown".to_string()
    }
}

#[cfg(not(windows))]
fn drive_kind(_root: &str) -> String {
    "fixed".to_string()
}

#[cfg(windows)]
fn logical_drive_roots() -> Vec<String> {
    use windows::Win32::Storage::FileSystem::GetLogicalDrives;

    let mask = unsafe { GetLogicalDrives() };
    if mask != 0 {
        roots_from_mask(mask)
    } else {
        Vec::new()
    }
}

#[cfg(not(windows))]
fn logical_drive_roots() -> Vec<String> {
    vec!["/".to_string()]
}

/// Every local volume that should participate in a full-disk scan.
///
/// A volume is included when it is a fixed or removable drive and its root is
/// readable. If the Windows API fails, the function falls back to probing drive
/// letters so a scan never silently degrades to "no drives".
pub fn list_fixed_drives() -> Vec<DriveInfo> {
    let mut roots = logical_drive_roots();
    if roots.is_empty() {
        roots = (b'A'..=b'Z')
            .map(|letter| format!("{}:\\", letter as char))
            .filter(|root| Path::new(root).is_dir())
            .collect();
    }

    let mut drives: Vec<DriveInfo> = roots
        .into_iter()
        .filter(|root| Path::new(root).is_dir())
        .map(|root| {
            let kind = drive_kind(&root);
            DriveInfo {
                label: drive_letter(&root),
                root,
                kind,
            }
        })
        .filter(|drive| drive.kind != "remote")
        .collect();

    drives.sort_by(|a, b| a.label.cmp(&b.label));
    drives.dedup_by(|a, b| a.root.eq_ignore_ascii_case(&b.root));
    drives
}

pub fn fixed_drive_roots() -> Vec<String> {
    list_fixed_drives().into_iter().map(|d| d.root).collect()
}

#[cfg(test)]
mod tests {
    use super::{drive_letter, roots_from_mask};

    #[test]
    fn mask_maps_bits_to_drive_roots() {
        assert_eq!(roots_from_mask(0b101), vec!["A:\\", "C:\\"]);
        assert!(roots_from_mask(0).is_empty());
    }

    #[test]
    fn drive_letter_is_uppercase_without_separator() {
        assert_eq!(drive_letter("c:\\"), "C:");
        assert_eq!(drive_letter("D:/"), "D:");
    }

    #[test]
    #[cfg(windows)]
    fn local_drive_discovery_returns_only_absolute_roots() {
        // The test environment always has at least one local volume.
        for root in super::fixed_drive_roots() {
            assert!(root.ends_with('\\'), "unexpected root: {root}");
            assert_eq!(root.len(), 3, "unexpected root: {root}");
        }
    }
}
