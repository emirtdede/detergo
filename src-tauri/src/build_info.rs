//! Build identity baked into the binary by `build.rs`.
//!
//! The values come from `cargo:rustc-env` instructions, so they always describe
//! the compiled source revision rather than whatever happens to be checked out
//! when the user launches the app.

use serde::Serialize;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const REPOSITORY_URL: &str = "https://github.com/emirtdede/detergo";
pub const REPOSITORY_API_URL: &str = "https://api.github.com/repos/emirtdede/detergo";
pub const COMMIT: &str = env!("NC_BUILD_COMMIT");
pub const COMMIT_SHORT: &str = env!("NC_BUILD_COMMIT_SHORT");
pub const DIRTY: &str = env!("NC_BUILD_DIRTY");
pub const BUILT_AT_EPOCH_SECS: &str = env!("NC_BUILD_TIME");

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    pub version: &'static str,
    pub commit: &'static str,
    pub commit_short: &'static str,
    /// `true` when the working tree had uncommitted changes during the build.
    /// A release artifact must always report `false`.
    pub dirty: bool,
    pub profile: &'static str,
    pub built_at: String,
}

pub fn build_info() -> BuildInfo {
    let dirty = match DIRTY {
        "true" => true,
        "false" => false,
        // Unknown git state is treated as dirty: never claim a clean build we
        // cannot prove.
        _ => true,
    };
    let built_at = BUILT_AT_EPOCH_SECS
        .parse::<i64>()
        .ok()
        .and_then(|secs| chrono::DateTime::from_timestamp(secs, 0))
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default();

    BuildInfo {
        version: VERSION,
        commit: COMMIT,
        commit_short: COMMIT_SHORT,
        dirty,
        profile: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
        built_at,
    }
}
