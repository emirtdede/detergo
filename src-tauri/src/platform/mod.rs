pub mod windows;

pub use windows::{
    facts, identity, is_in_use, is_remote_path, is_reparse_point, process_running_under,
    running_process_names, volume_free_bytes, FileFacts, FileIdentity,
};
pub use windows::{get_known_dev_locations, KnownLocation};
