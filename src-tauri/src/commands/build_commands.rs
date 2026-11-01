use crate::build_info::{self, BuildInfo};

/// Exposes the compiled revision so the About card (and a support request) can
/// prove which commit an installed binary was built from.
#[tauri::command]
pub fn get_build_info() -> BuildInfo {
    build_info::build_info()
}
