pub mod windows;

pub use windows::{
    facts, identity, is_in_use, is_remote_path, is_reparse_point, process_running_under,
    running_process_names, volume_free_bytes, FileFacts, FileIdentity,
};
pub use windows::{
    fixed_drive_roots, force_foreground, get_known_dev_locations, list_fixed_drives,
    preflight_cleanup_zombies, DriveInfo, KnownLocation,
};

use std::fs;
use std::path::{Path, PathBuf};

pub fn resolve_app_dir(base_dir: &Path) -> PathBuf {
    let dev_dir = base_dir.join("dev-cleaner");
    let legacy_dir = base_dir.join("node-cleaner");
    if !dev_dir.exists() && legacy_dir.exists() {
        let _ = fs::create_dir_all(&dev_dir);
        if let Ok(entries) = fs::read_dir(&legacy_dir) {
            for entry in entries.flatten() {
                let dest = dev_dir.join(entry.file_name());
                if !dest.exists() {
                    let _ = fs::copy(entry.path(), dest);
                }
            }
        }
    } else {
        let _ = fs::create_dir_all(&dev_dir);
    }
    dev_dir
}
