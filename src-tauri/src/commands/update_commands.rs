use crate::build_info;
use crate::error::AppError;
use crate::updates::{
    interpret_release, UpdateInfo, MAX_BODY_BYTES, RELEASES_API, REQUEST_TIMEOUT_SECS,
};

/// Asks the public GitHub Releases API for the newest release.
///
/// Only ever runs because the user pressed "Check for updates": there is no
/// startup call and no scheduled task, so the application still makes no
/// background network request.
#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateInfo, AppError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        // The endpoint is a constant; following a redirect would only let the
        // response come from somewhere the user did not ask for.
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!(
            "DevCleaner/",
            env!("CARGO_PKG_VERSION"),
            " (+https://github.com/emirtdede/dev-cleaner)"
        ))
        .build()
        .map_err(|err| AppError::Network(err.to_string()))?;

    let response = client
        .get(RELEASES_API)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|err| AppError::Network(format!("Could not reach the update server: {err}")))?;

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

    if let Some(length) = response.content_length() {
        if length as usize > MAX_BODY_BYTES {
            return Err(AppError::Network(
                "The update server reply was larger than expected.".to_string(),
            ));
        }
    }

    let body = response
        .text()
        .await
        .map_err(|err| AppError::Network(format!("Could not read the update reply: {err}")))?;
    if body.len() > MAX_BODY_BYTES {
        return Err(AppError::Network(
            "The update server reply was larger than expected.".to_string(),
        ));
    }

    interpret_release(&body, build_info::VERSION)
}
