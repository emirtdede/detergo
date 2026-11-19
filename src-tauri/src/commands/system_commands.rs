use serde::{Deserialize, Serialize};
use std::path::Path;

/// Free/total space for one local volume. The frontend turns this into a
/// localized "disk is almost full" notification; the backend only reports
/// facts so the threshold stays a presentation concern.
#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiskSpaceInfo {
    pub drive: String,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub free_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub total_bytes: u64,
    pub percent_used: f64,
}

/// Reads space for every fixed/removable local volume. Network drives are
/// excluded by `fixed_drive_roots`, matching the scan scope.
#[tauri::command]
pub fn get_disk_pressure() -> Vec<DiskSpaceInfo> {
    let mut out = Vec::new();
    for root in crate::platform::fixed_drive_roots() {
        if let Some((free, total)) =
            crate::platform::windows::fs_meta::volume_space(Path::new(&root))
        {
            if total == 0 {
                continue;
            }
            let used = total.saturating_sub(free);
            out.push(DiskSpaceInfo {
                drive: root,
                free_bytes: free,
                total_bytes: total,
                percent_used: (used as f64 / total as f64) * 100.0,
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::DiskSpaceInfo;

    #[test]
    fn percent_used_is_derived_from_free_and_total() {
        let total = 1_000u64;
        let free = 250u64;
        let used = total - free;
        let info = DiskSpaceInfo {
            drive: "C:\\".into(),
            free_bytes: free,
            total_bytes: total,
            percent_used: (used as f64 / total as f64) * 100.0,
        };
        assert!((info.percent_used - 75.0).abs() < f64::EPSILON);
    }
}
