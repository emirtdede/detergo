//! Zero-cost verified update engine for Detergo.
//!
//! Architecture:
//!  1. Primary metadata feed is the static `latest-release.json` published to
//!     GitHub Releases CDN (`releases/latest/download/latest-release.json`),
//!     which has ZERO 60/hr IP API rate limit and costs $0/month.
//!  2. Falls back seamlessly to the GitHub Releases REST API when an older tag
//!     has no `latest-release.json`.
//!  3. Detects the running `InstallChannel` (`MsixStore`, `Installer`,
//!     `Portable`) so Microsoft Store installs delegate updates to the Store
//!     (zero Store Policy conflict) and Installer/Portable installs receive
//!     only their matching package.
//!  4. Downloads into an atomic `.part` file in `%TEMP%\detergo-updates\`,
//!     verifies streaming SHA-256 against the published digest, inspects the
//!     Windows Authenticode signature, and only launches when the user clicks.

pub mod channel;
pub mod sha256;

#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

static PENDING_UPDATE_ON_QUIT: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Stages (or clears) a SHA-256-verified NSIS installer to be launched
/// automatically when the user quits Detergo ("Install on Quit").
pub fn set_pending_update_on_quit(path: Option<PathBuf>) {
    if let Ok(mut guard) = PENDING_UPDATE_ON_QUIT.lock() {
        *guard = path;
    }
}

/// Takes any staged SHA-256-verified installer path queued for launch on exit.
pub fn take_pending_update_on_quit() -> Option<PathBuf> {
    PENDING_UPDATE_ON_QUIT
        .lock()
        .ok()
        .and_then(|mut guard| guard.take())
}

use crate::error::AppError;
pub use channel::{
    detect_install_channel, verify_authenticode_signature, InstallChannel, SignatureStatus,
};
pub use sha256::{normalize_sha256, Sha256};

/// Rate-limit-free GitHub Releases CDN manifest URL (primary).
pub(crate) const RELEASES_MANIFEST_URL: &str =
    "https://github.com/emirtdede/detergo/releases/latest/download/latest-release.json";
/// Fallback REST API endpoint for releases published before `latest-release.json`.
pub(crate) const RELEASES_API: &str =
    "https://api.github.com/repos/emirtdede/detergo/releases/latest";
pub(crate) const FALLBACK_RELEASE_URL: &str =
    "https://github.com/emirtdede/detergo/releases/latest";

pub(crate) const REQUEST_TIMEOUT_SECS: u64 = 12;
pub(crate) const DOWNLOAD_TIMEOUT_SECS: u64 = 180;
/// Release notes are prose; anything larger is a broken response, not a release.
pub(crate) const MAX_BODY_BYTES: usize = 512 * 1024;
/// Upper bound for a desktop installer download (256 MiB).
pub(crate) const MAX_DOWNLOAD_BYTES: u64 = 256 * 1024 * 1024;

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAsset {
    pub name: String,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub size: u64,
    pub download_url: String,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub channel: Option<String>,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// Version of the running binary.
    pub current_version: String,
    /// Newest published version, normalised without a leading `v`.
    pub latest_version: String,
    /// `true` when the published release is strictly newer than the binary.
    pub available: bool,
    pub release_name: String,
    pub release_url: String,
    /// Markdown release notes as published, empty when the body has none.
    pub notes: String,
    pub published_at: String,
    pub assets: Vec<UpdateAsset>,
    /// Detected distribution channel of the running instance.
    pub install_channel: InstallChannel,
    /// True when Microsoft Store manages updates (no external installer offered).
    pub managed_by_store: bool,
    /// Package matching `install_channel`, if present in the release.
    pub recommended_asset: Option<UpdateAsset>,
    /// Metadata source (`cdn-manifest` or `github-api`).
    pub source: String,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedUpdate {
    pub path: String,
    pub file_name: String,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub bytes: u64,
    pub sha256: String,
    pub signature_status: SignatureStatus,
}

/// A parseable semantic version, without build metadata.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    major: u64,
    minor: u64,
    patch: u64,
    pre_release: Option<String>,
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        compare_versions(self, other)
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Version {
    /// Parses `v1.2.3`, `1.2.3`, `1.2` or `1.2.3-rc.1`. Returns `None` for
    /// anything else so a malformed tag cannot be reported as an update.
    pub fn parse(raw: &str) -> Option<Version> {
        let trimmed = raw.trim();
        let without_prefix = trimmed
            .strip_prefix('v')
            .or_else(|| trimmed.strip_prefix('V'))
            .unwrap_or(trimmed);
        let without_build = without_prefix.split('+').next().unwrap_or(without_prefix);
        let (core, pre_release) = match without_build.split_once('-') {
            Some((core, pre)) => (core, Some(pre.to_string())),
            None => (without_build, None),
        };

        let mut parts = core.split('.');
        let major = parts.next()?.parse::<u64>().ok()?;
        let minor = parts
            .next()
            .map(|value| value.parse::<u64>())
            .transpose()
            .ok()?
            .unwrap_or(0);
        let patch = parts
            .next()
            .map(|value| value.parse::<u64>())
            .transpose()
            .ok()?
            .unwrap_or(0);
        if parts.next().is_some() {
            return None;
        }

        Some(Version {
            major,
            minor,
            patch,
            pre_release: pre_release.filter(|value| !value.is_empty()),
        })
    }
}

impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)?;
        if let Some(pre) = &self.pre_release {
            write!(f, "-{pre}")?;
        }
        Ok(())
    }
}

fn compare_prerelease(left: &str, right: &str) -> std::cmp::Ordering {
    let mut left_parts = left.split('.');
    let mut right_parts = right.split('.');
    loop {
        match (left_parts.next(), right_parts.next()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(l), Some(r)) => {
                let l_num = l.parse::<u64>().ok();
                let r_num = r.parse::<u64>().ok();
                let ord = match (l_num, r_num) {
                    (Some(a), Some(b)) => a.cmp(&b),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => l.cmp(r),
                };
                if ord != std::cmp::Ordering::Equal {
                    return ord;
                }
            }
        }
    }
}

fn compare_versions(a: &Version, b: &Version) -> std::cmp::Ordering {
    let numeric = (a.major, a.minor, a.patch).cmp(&(b.major, b.minor, b.patch));
    if numeric != std::cmp::Ordering::Equal {
        return numeric;
    }
    match (&a.pre_release, &b.pre_release) {
        (None, None) => std::cmp::Ordering::Equal,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (Some(_), None) => std::cmp::Ordering::Less,
        (Some(left), Some(right)) => compare_prerelease(left, right),
    }
}

/// Ensures release links, manifest redirects, and asset download URLs stay on
/// the official Detergo repository (plus legacy GitHub redirect continuity) or
/// GitHub's release asset CDN.
pub fn is_trusted_release_url(raw: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(raw.trim()) else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return false;
    }
    let Some(host) = parsed.host_str().map(|h| h.to_ascii_lowercase()) else {
        return false;
    };
    match host.as_str() {
        "github.com" => {
            let path = parsed.path().to_ascii_lowercase();
            path == "/emirtdede/detergo"
                || path.starts_with("/emirtdede/detergo/")
                || path == "/emirtdede/dev-cleaner"
                || path.starts_with("/emirtdede/dev-cleaner/")
        }
        "objects.githubusercontent.com" | "release-assets.githubusercontent.com" => true,
        _ => false,
    }
}

/// True when `latest` should be offered over `current`.
pub fn is_newer(current: &str, latest: &str) -> bool {
    match (Version::parse(current), Version::parse(latest)) {
        (Some(current), Some(latest)) => compare_versions(&latest, &current).is_gt(),
        _ => false,
    }
}

/// Infers the distribution channel tag of an asset from its filename.
pub fn infer_asset_channel(name: &str) -> Option<String> {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".msix") || lower.ends_with(".msixbundle") || lower.ends_with(".appx") {
        return Some("msix".to_string());
    }
    if lower.contains("portable") && lower.ends_with(".exe") {
        return Some("portable".to_string());
    }
    if lower.ends_with("-setup.exe") || lower.ends_with("_setup.exe") || lower.contains("setup.exe")
    {
        return Some("installer".to_string());
    }
    if lower.ends_with(".msi") {
        return Some("msi".to_string());
    }
    if lower.ends_with(".com") {
        return Some("cli".to_string());
    }
    None
}

/// Picks the single best package for the user's current `InstallChannel`.
pub fn select_recommended_asset(
    assets: &[UpdateAsset],
    channel: InstallChannel,
) -> Option<UpdateAsset> {
    match channel {
        // Microsoft Store owns updates for MSIX packages; never offer an external EXE.
        InstallChannel::MsixStore => None,
        InstallChannel::Installer => assets
            .iter()
            .find(|a| a.channel.as_deref() == Some("installer"))
            .or_else(|| assets.iter().find(|a| a.channel.as_deref() == Some("msi")))
            .cloned(),
        InstallChannel::Portable => assets
            .iter()
            .find(|a| a.channel.as_deref() == Some("portable"))
            .cloned(),
    }
}

/// Staging directory inside `%TEMP%` used for atomic `.part` update downloads.
pub fn update_staging_dir() -> PathBuf {
    std::env::temp_dir().join("detergo-updates")
}

/// Validates and sanitizes an update artifact filename (no separators, allowed
/// installer extensions only).
pub fn sanitize_update_filename(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.len() > 140
        || trimmed.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|', '\0'])
        || trimmed.contains("..")
    {
        return Err(AppError::InvalidPath(
            "The update package filename contains disallowed characters.".to_string(),
        ));
    }
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.ends_with(".exe") || lower.ends_with(".msi") || lower.ends_with(".msix")) {
        return Err(AppError::InvalidPath(
            "Only Windows installer packages (.exe, .msi, .msix) may be downloaded.".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

/// Deletes leftover `.part` files in the staging folder so interrupted runs
/// never accumulate disk junk.
pub fn cleanup_stale_part_files(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("part") {
            let _ = std::fs::remove_file(&path);
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaticReleaseManifest {
    version: String,
    #[serde(default)]
    release_name: Option<String>,
    #[serde(default)]
    release_url: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    assets: Vec<StaticManifestAsset>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaticManifestAsset {
    name: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    download_url: String,
    #[serde(default)]
    sha256: Option<String>,
    #[serde(default)]
    channel: Option<String>,
}

/// Parses our static CDN `latest-release.json` manifest into `UpdateInfo`.
pub fn interpret_manifest(
    payload: &str,
    current_version: &str,
    install_channel: InstallChannel,
) -> Result<UpdateInfo, AppError> {
    let manifest: StaticReleaseManifest = serde_json::from_str(payload).map_err(|err| {
        AppError::Network(format!("The release manifest could not be parsed: {err}"))
    })?;

    let latest = Version::parse(&manifest.version).ok_or_else(|| {
        AppError::Network(format!(
            "The release manifest version '{}' is not valid semver.",
            manifest.version
        ))
    })?;

    let assets: Vec<UpdateAsset> = manifest
        .assets
        .into_iter()
        .filter(|asset| is_trusted_release_url(&asset.download_url))
        .map(|asset| {
            let channel = asset
                .channel
                .filter(|c| !c.trim().is_empty())
                .or_else(|| infer_asset_channel(&asset.name));
            UpdateAsset {
                name: asset.name,
                size: asset.size,
                download_url: asset.download_url,
                sha256: asset.sha256.as_deref().and_then(normalize_sha256),
                channel,
            }
        })
        .collect();

    let recommended_asset = select_recommended_asset(&assets, install_channel);
    let available = is_newer(current_version, &manifest.version);

    Ok(UpdateInfo {
        current_version: current_version.to_string(),
        latest_version: latest.to_string(),
        available,
        release_name: manifest
            .release_name
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| format!("Detergo {latest}")),
        release_url: manifest
            .release_url
            .filter(|url| is_trusted_release_url(url))
            .unwrap_or_else(|| FALLBACK_RELEASE_URL.to_string()),
        notes: manifest.notes.unwrap_or_default(),
        published_at: manifest.published_at.unwrap_or_default(),
        assets,
        install_channel,
        managed_by_store: install_channel == InstallChannel::MsixStore,
        recommended_asset,
        source: "cdn-manifest".to_string(),
    })
}

#[derive(Debug, Deserialize)]
struct ApiRelease {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<ApiAsset>,
}

#[derive(Debug, Deserialize)]
struct ApiAsset {
    name: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    browser_download_url: String,
}

/// Turns one GitHub Releases API payload into `UpdateInfo` for a specific channel.
pub fn interpret_release_for_channel(
    payload: &str,
    current_version: &str,
    install_channel: InstallChannel,
) -> Result<UpdateInfo, AppError> {
    let release: ApiRelease = serde_json::from_str(payload).map_err(|err| {
        AppError::Network(format!("The update server sent an unexpected reply: {err}"))
    })?;

    let latest = Version::parse(&release.tag_name).ok_or_else(|| {
        AppError::Network(format!(
            "The newest release is tagged '{}', which is not a version number.",
            release.tag_name
        ))
    })?;

    let available =
        !release.draft && !release.prerelease && is_newer(current_version, &release.tag_name);

    let assets: Vec<UpdateAsset> = release
        .assets
        .into_iter()
        .filter(|asset| is_trusted_release_url(&asset.browser_download_url))
        .map(|asset| {
            let channel = infer_asset_channel(&asset.name);
            UpdateAsset {
                name: asset.name,
                size: asset.size,
                download_url: asset.browser_download_url,
                sha256: None,
                channel,
            }
        })
        .collect();

    let recommended_asset = select_recommended_asset(&assets, install_channel);

    Ok(UpdateInfo {
        current_version: current_version.to_string(),
        latest_version: latest.to_string(),
        available,
        release_name: release
            .name
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| latest.to_string()),
        release_url: release
            .html_url
            .filter(|url| is_trusted_release_url(url))
            .unwrap_or_else(|| FALLBACK_RELEASE_URL.to_string()),
        notes: release.body.unwrap_or_default(),
        published_at: release.published_at.unwrap_or_default(),
        assets,
        install_channel,
        managed_by_store: install_channel == InstallChannel::MsixStore,
        recommended_asset,
        source: "github-api".to_string(),
    })
}

/// Turns one API payload into `UpdateInfo` using the detected install channel.
pub fn interpret_release(payload: &str, current_version: &str) -> Result<UpdateInfo, AppError> {
    interpret_release_for_channel(payload, current_version, detect_install_channel())
}
