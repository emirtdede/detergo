pub mod drives;
pub mod fs_meta;
pub mod instance_guard;
pub mod known_folders;

pub use drives::{fixed_drive_roots, list_fixed_drives, DriveInfo};
pub use instance_guard::{force_foreground, preflight_cleanup_zombies};

pub use fs_meta::{
    facts, identity, is_in_use, is_remote_path, is_reparse_point, process_running_under,
    running_process_names, volume_free_bytes, FileFacts, FileIdentity,
};
pub use known_folders::{get_known_dev_locations, KnownLocation};
