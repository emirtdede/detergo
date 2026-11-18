use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownLocation {
    pub id: String,
    pub path: String,
    pub label: String,
    pub source: String,
}

pub fn get_known_dev_locations() -> Vec<KnownLocation> {
    let mut locations = Vec::new();

    let user_profile = match std::env::var("USERPROFILE") {
        Ok(p) => PathBuf::from(p),
        Err(_) => return locations,
    };

    // 0. Full-disk scan entry. The empty path is intentional: it is a virtual
    // location, not a directory, and the scan backend enumerates local drives.
    locations.push(KnownLocation {
        id: "loc-all-drives".to_string(),
        path: String::new(),
        label: "All drives (full scan)".to_string(),
        source: "all-drives".to_string(),
    });

    // 0b. One entry per local volume, plus common dev folders on that volume.
    for drive in crate::platform::list_fixed_drives() {
        locations.push(KnownLocation {
            id: format!("loc-drive-root-{}", drive.label.replace(':', "")),
            path: drive.root.clone(),
            label: format!("Drive {} (full)", drive.label),
            source: "drive".to_string(),
        });
    }

    // 1. Desktop
    let desktop = user_profile.join("Desktop");
    if desktop.is_dir() {
        locations.push(KnownLocation {
            id: "loc-desktop".to_string(),
            path: desktop.to_string_lossy().to_string(),
            label: "Desktop".to_string(),
            source: "default".to_string(),
        });
    }

    // 2. Documents
    let docs = user_profile.join("Documents");
    if docs.is_dir() {
        locations.push(KnownLocation {
            id: "loc-documents".to_string(),
            path: docs.to_string_lossy().to_string(),
            label: "Documents".to_string(),
            source: "default".to_string(),
        });
    }

    // 3. Common Dev folders under UserProfile
    let candidates = [
        ("Projects", "Projects"),
        ("Code", "Code"),
        ("Dev", "Dev"),
        ("Development", "Development"),
        ("source\\repos", "Visual Studio Repos"),
        ("workspace", "Workspace"),
        ("workspaces", "Workspaces"),
    ];

    for (subpath, label) in &candidates {
        let full = user_profile.join(subpath);
        if full.is_dir() {
            locations.push(KnownLocation {
                id: format!("loc-{}", subpath.replace('\\', "-")),
                path: full.to_string_lossy().to_string(),
                label: label.to_string(),
                source: "default".to_string(),
            });
        }
    }

    // 4. Drive root common dev folders, derived from the drives the machine
    // actually has instead of a hard-coded C:/D: list.
    for drive in crate::platform::list_fixed_drives() {
        for (name, label) in [
            ("Projects", "Projects"),
            ("Code", "Code"),
            ("Dev", "Dev"),
            ("Development", "Development"),
        ] {
            let path = PathBuf::from(&drive.root).join(name);
            if path.is_dir() {
                locations.push(KnownLocation {
                    id: format!(
                        "loc-drive-{}-{}",
                        drive.label.replace(':', ""),
                        name.to_lowercase()
                    ),
                    path: path.to_string_lossy().to_string(),
                    label: format!("{} ({})", label, drive.label),
                    source: "default".to_string(),
                });
            }
        }
    }

    locations
}
