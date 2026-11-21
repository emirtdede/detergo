use std::fs;
use std::io::Write;
use std::path::PathBuf;

use crate::build_info;
use crate::error::AppError;
use crate::updates::{
    cleanup_stale_part_files, detect_install_channel, interpret_manifest,
    interpret_release_for_channel, is_trusted_release_url, normalize_sha256,
    sanitize_update_filename, update_staging_dir, verify_authenticode_signature, DownloadedUpdate,
    InstallChannel, Sha256, UpdateInfo, DOWNLOAD_TIMEOUT_SECS, MAX_BODY_BYTES, MAX_DOWNLOAD_BYTES,
    RELEASES_API, RELEASES_MANIFEST_URL, REQUEST_TIMEOUT_SECS,
};

const USER_AGENT: &str = concat!(
    "Detergo/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/emirtdede/detergo)"
);

fn trusted_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.error("Too many redirects while contacting GitHub Releases.");
        }
        if is_trusted_release_url(attempt.url().as_str()) {
            attempt.follow()
        } else {
            attempt.error("Refused redirect to an untrusted host.")
        }
    })
}

async fn read_capped_utf8(mut response: reqwest::Response) -> Result<String, AppError> {
    if let Some(length) = response.content_length() {
        if length as usize > MAX_BODY_BYTES {
            return Err(AppError::Network(
                "The update server reply was larger than expected.".to_string(),
            ));
        }
    }

    let mut raw = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|err| {
        AppError::Network(format!(
            "Could not read the update reply: {}",
            err.without_url()
        ))
    })? {
        if raw.len().saturating_add(chunk.len()) > MAX_BODY_BYTES {
            return Err(AppError::Network(
                "The update server reply was larger than expected.".to_string(),
            ));
        }
        raw.extend_from_slice(&chunk);
    }

    String::from_utf8(raw)
        .map_err(|_| AppError::Network("The update server reply was not valid UTF-8.".to_string()))
}

/// Returns the installation channel of this running Detergo binary (`msixStore`,
/// `installer`, or `portable`) without performing any network call.
#[tauri::command]
pub fn get_install_channel() -> InstallChannel {
    detect_install_channel()
}

/// Checks for the latest release using the zero-rate-limit GitHub Releases CDN
/// `latest-release.json` manifest, falling back cleanly to the GitHub API when
/// an older release has not yet published a static manifest.
///
/// Only runs when the user explicitly clicks "Check for updates": zero
/// background network traffic on startup.
#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateInfo, AppError> {
    let channel = detect_install_channel();

    // 1. Primary: Static CDN manifest (0 API rate limit, includes SHA-256 digests).
    let cdn_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .redirect(trusted_redirect_policy())
        .user_agent(USER_AGENT)
        .build()
        .map_err(|err| AppError::Network(err.to_string()))?;

    if let Ok(response) = cdn_client
        .get(RELEASES_MANIFEST_URL)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
    {
        if response.status().is_success() {
            if let Ok(body) = read_capped_utf8(response).await {
                if let Ok(info) = interpret_manifest(&body, build_info::VERSION, channel) {
                    return Ok(info);
                }
            }
        }
    }

    // 2. Fallback: GitHub Releases REST API (no redirects).
    let api_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(USER_AGENT)
        .build()
        .map_err(|err| AppError::Network(err.to_string()))?;

    let response = api_client
        .get(RELEASES_API)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|err| {
            AppError::Network(format!(
                "Could not reach the update server: {}",
                err.without_url()
            ))
        })?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::Network(
            "The repository has no published release yet.".to_string(),
        ));
    }
    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "The update server answered HTTP {}.",
            response.status()
        )));
    }

    let body = read_capped_utf8(response).await?;
    interpret_release_for_channel(&body, build_info::VERSION, channel)
}

/// Downloads a release artifact into `%TEMP%\detergo-updates\<name>.part`,
/// verifies its streaming SHA-256 digest against `expected_sha256`, atomically
/// promotes the verified file, and reports its Windows Authenticode status.
///
/// Refuses to run inside a Microsoft Store (MSIX) installation and refuses any
/// download without a valid 64-char SHA-256 digest or trusted GitHub URL.
#[tauri::command]
pub async fn download_and_verify_update(
    url: String,
    expected_sha256: String,
    file_name: String,
) -> Result<DownloadedUpdate, AppError> {
    if detect_install_channel() == InstallChannel::MsixStore {
        return Err(AppError::Blocked(
            "Microsoft Store manages updates for this installation.".to_string(),
        ));
    }

    if !is_trusted_release_url(&url) {
        return Err(AppError::Blocked(
            "Refused to download an update from an untrusted URL.".to_string(),
        ));
    }

    let expected_hash = normalize_sha256(&expected_sha256).ok_or_else(|| {
        AppError::Blocked(
            "Refused to download an update without a valid SHA-256 checksum.".to_string(),
        )
    })?;

    let safe_name = sanitize_update_filename(&file_name)?;
    let staging_dir = update_staging_dir();
    fs::create_dir_all(&staging_dir)
        .map_err(|err| AppError::Unknown(format!("Could not prepare update folder: {err}")))?;
    cleanup_stale_part_files(&staging_dir);

    let final_path = staging_dir.join(&safe_name);
    let part_path = staging_dir.join(format!(
        "{safe_name}.{}.part",
        uuid::Uuid::new_v4().simple()
    ));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(DOWNLOAD_TIMEOUT_SECS))
        .redirect(trusted_redirect_policy())
        .user_agent(USER_AGENT)
        .build()
        .map_err(|err| AppError::Network(err.to_string()))?;

    let mut response = client.get(&url).send().await.map_err(|err| {
        AppError::Network(format!(
            "Could not download the update package: {}",
            err.without_url()
        ))
    })?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Update download returned HTTP {}.",
            response.status()
        )));
    }
    if let Some(len) = response.content_length() {
        if len > MAX_DOWNLOAD_BYTES {
            return Err(AppError::Network(
                "Update package exceeds the maximum allowed size.".to_string(),
            ));
        }
    }

    let mut file = fs::File::create(&part_path)
        .map_err(|err| AppError::Unknown(format!("Could not create temp update file: {err}")))?;
    let mut hasher = Sha256::new();
    let mut total_bytes: u64 = 0;

    let stream_result: Result<(), AppError> = async {
        while let Some(chunk) = response.chunk().await.map_err(|err| {
            AppError::Network(format!(
                "Interrupted while downloading update: {}",
                err.without_url()
            ))
        })? {
            total_bytes = total_bytes.saturating_add(chunk.len() as u64);
            if total_bytes > MAX_DOWNLOAD_BYTES {
                return Err(AppError::Network(
                    "Update package exceeds the maximum allowed size.".to_string(),
                ));
            }
            file.write_all(&chunk).map_err(|err| {
                AppError::Unknown(format!("Could not write update package to disk: {err}"))
            })?;
            hasher.update(&chunk);
        }
        file.flush()
            .and_then(|()| file.sync_all())
            .map_err(|err| AppError::Unknown(format!("Could not finalize update file: {err}")))?;
        Ok(())
    }
    .await;

    drop(file);

    if let Err(err) = stream_result {
        let _ = fs::remove_file(&part_path);
        return Err(err);
    }

    let actual_hash = hasher.finalize_hex();
    if actual_hash != expected_hash {
        let _ = fs::remove_file(&part_path);
        return Err(AppError::Blocked(format!(
            "SHA-256 verification failed (expected {}, got {}). The downloaded file was discarded.",
            &expected_hash[..12],
            &actual_hash[..12]
        )));
    }

    if let Err(err) = crate::platform::atomic_replace_file(&part_path, &final_path) {
        let _ = fs::remove_file(&part_path);
        return Err(AppError::Unknown(format!(
            "Could not finalize verified update package: {err}"
        )));
    }

    let signature_status = verify_authenticode_signature(&final_path);

    Ok(DownloadedUpdate {
        path: final_path.to_string_lossy().to_string(),
        file_name: safe_name,
        bytes: total_bytes,
        sha256: actual_hash,
        signature_status,
    })
}

/// Launches a previously SHA-256-verified update package located inside
/// `%TEMP%\detergo-updates\` when the user explicitly clicks "Launch installer".
#[tauri::command]
pub fn launch_downloaded_update(path: String) -> Result<(), AppError> {
    if detect_install_channel() == InstallChannel::MsixStore {
        return Err(AppError::Blocked(
            "Microsoft Store manages updates for this installation.".to_string(),
        ));
    }

    let staging = fs::canonicalize(update_staging_dir()).map_err(|_| {
        AppError::PathNotFound("No verified update package is available to launch.".to_string())
    })?;
    let target = fs::canonicalize(PathBuf::from(path.trim())).map_err(|_| {
        AppError::PathNotFound("The verified update package could not be found.".to_string())
    })?;

    if !target.starts_with(&staging) || !target.is_file() {
        return Err(AppError::Blocked(
            "Refused to launch a file outside the verified update folder.".to_string(),
        ));
    }

    let ext = target
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !matches!(ext.as_str(), "exe" | "msi" | "msix") {
        return Err(AppError::Blocked(
            "Refused to launch an unsupported update file type.".to_string(),
        ));
    }

    launch_file_platform(&target)
}

#[cfg(windows)]
fn launch_file_platform(path: &std::path::Path) -> Result<(), AppError> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let wide_path: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let result = unsafe {
        ShellExecuteW(
            HWND(std::ptr::null_mut()),
            w!("open"),
            PCWSTR(wide_path.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if (result.0 as isize) <= 32 {
        return Err(AppError::Unknown(
            "Windows could not launch the verified update installer.".to_string(),
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn launch_file_platform(_path: &std::path::Path) -> Result<(), AppError> {
    Err(AppError::PlatformUnsupported(
        "Update launching is only supported on Windows.".to_string(),
    ))
}
