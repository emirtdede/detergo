//! Update check against the public GitHub Releases API.
//!
//! The project has no update server: GitHub Releases is the distribution
//! channel, so the newest tag is the authoritative version. This module only
//! *reports* — it never downloads or executes an installer. The user opens the
//! release page in their browser, which keeps the "nothing installs itself"
//! promise and needs no code-signing certificate for the update channel.
//!
//! Network policy:
//!  - the request runs only when the user presses the button in Settings > About;
//!  - the URL is a compile-time constant, so no user input can redirect it;
//!  - redirects are refused and the response body is capped;
//!  - only the public release tag, name, notes and asset list are read.

use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[cfg(test)]
mod tests;

/// Public repository the releases live in.
pub(crate) const RELEASES_API: &str =
    "https://api.github.com/repos/emirtdede/dev-cleaner/releases/latest";
pub(crate) const REQUEST_TIMEOUT_SECS: u64 = 10;
/// Release notes are prose; anything larger is a broken response, not a release.
pub(crate) const MAX_BODY_BYTES: usize = 512 * 1024;

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAsset {
    pub name: String,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub size: u64,
    pub download_url: String,
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
}

/// A parseable semantic version, without build metadata.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version {
    major: u64,
    minor: u64,
    patch: u64,
    /// A pre-release sorts before the same numeric version (`1.0.0-rc1` <
    /// `1.0.0`), which matches semver and stops a beta tag from hiding the
    /// stable release.
    pre_release: Option<String>,
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
        // `+build` metadata is explicitly ignored by semver comparison.
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

/// Ordering that follows semver: numeric fields first, then a release outranks
/// its own pre-releases.
fn compare_versions(a: &Version, b: &Version) -> std::cmp::Ordering {
    let numeric = (a.major, a.minor, a.patch).cmp(&(b.major, b.minor, b.patch));
    if numeric != std::cmp::Ordering::Equal {
        return numeric;
    }
    match (&a.pre_release, &b.pre_release) {
        (None, None) => std::cmp::Ordering::Equal,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (Some(_), None) => std::cmp::Ordering::Less,
        (Some(left), Some(right)) => left.cmp(right),
    }
}

/// True when `latest` should be offered over `current`.
///
/// An unparseable version on either side reports "no update": telling a user to
/// upgrade because a tag looked odd is worse than staying quiet.
pub fn is_newer(current: &str, latest: &str) -> bool {
    match (Version::parse(current), Version::parse(latest)) {
        (Some(current), Some(latest)) => compare_versions(&latest, &current).is_gt(),
        _ => false,
    }
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

/// Turns one API payload into the value the UI renders.
pub fn interpret_release(payload: &str, current_version: &str) -> Result<UpdateInfo, AppError> {
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

    Ok(UpdateInfo {
        current_version: current_version.to_string(),
        latest_version: latest.to_string(),
        available,
        release_name: release
            .name
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| latest.to_string()),
        release_url: release.html_url.unwrap_or_else(|| {
            "https://github.com/emirtdede/dev-cleaner/releases/latest".to_string()
        }),
        notes: release.body.unwrap_or_default(),
        published_at: release.published_at.unwrap_or_default(),
        assets: release
            .assets
            .into_iter()
            .map(|asset| UpdateAsset {
                name: asset.name,
                size: asset.size,
                download_url: asset.browser_download_url,
            })
            .collect(),
    })
}
