use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Result of a webhook probe. The frontend shows `status` and `latencyMs` so a
/// user can tell a timeout apart from an HTTP rejection.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WebhookTestResult {
    pub ok: bool,
    pub status: u16,
    pub latency_ms: u64,
    pub message: String,
}

const WEBHOOK_TIMEOUT_SECS: u64 = 10;
const MAX_REDIRECTS: usize = 3;

/// Only `http` and `https` are acceptable. Any other scheme would either be a
/// local file read (`file:`) or unparseable by the client.
pub fn validate_webhook_url(url: &str) -> Result<reqwest::Url, AppError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidPath("Webhook URL is empty.".to_string()));
    }
    let parsed = reqwest::Url::parse(trimmed)
        .map_err(|err| AppError::InvalidPath(format!("Invalid webhook URL: {err}")))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(AppError::InvalidPath(format!(
            "Unsupported webhook scheme '{other}'; use http or https."
        ))),
    }
}

fn build_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(WEBHOOK_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
        .user_agent(concat!("DevCleaner/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|err| AppError::Network(err.to_string()))
}

fn status_message(status: reqwest::StatusCode) -> String {
    if status.is_success() {
        format!("HTTP {status}")
    } else {
        format!("Webhook rejected the request with HTTP {status}")
    }
}

async fn post_json(
    client: reqwest::Client,
    url: reqwest::Url,
    payload: &serde_json::Value,
) -> Result<WebhookTestResult, AppError> {
    let started = std::time::Instant::now();
    let response = client
        .post(url)
        .json(payload)
        .send()
        .await
        .map_err(|err| AppError::Network(err.to_string()))?;
    let status = response.status();
    let latency_ms = started.elapsed().as_millis() as u64;
    Ok(WebhookTestResult {
        ok: status.is_success(),
        status: status.as_u16(),
        latency_ms,
        message: status_message(status),
    })
}

/// Sends a one-off payload from Settings → Automation. The URL comes from the
/// user, so it must be validated here rather than relying on a CSP scope.
#[tauri::command]
pub async fn test_webhook(
    url: String,
    payload: Option<serde_json::Value>,
) -> Result<WebhookTestResult, AppError> {
    let parsed = validate_webhook_url(&url)?;
    let body = payload.unwrap_or_else(|| {
        serde_json::json!({
            "event": "webhook_test",
            "product": "Dev Cleaner by Vellium",
            "version": env!("CARGO_PKG_VERSION"),
            "timestamp": chrono::Utc::now().to_rfc3339(),
        })
    });
    post_json(build_client()?, parsed, &body).await
}

/// Blocking variant used by the CLI, which does not run inside the Tauri
/// runtime. Keeping it in this module means there is exactly one HTTP path.
pub fn post_webhook_blocking(
    url: &str,
    payload: &serde_json::Value,
) -> Result<WebhookTestResult, AppError> {
    let parsed = validate_webhook_url(url)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(WEBHOOK_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
        .user_agent(concat!("DevCleaner/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|err| AppError::Network(err.to_string()))?;
    let started = std::time::Instant::now();
    let response = client
        .post(parsed)
        .json(payload)
        .send()
        .map_err(|err| AppError::Network(err.to_string()))?;
    let status = response.status();
    let latency_ms = started.elapsed().as_millis() as u64;
    Ok(WebhookTestResult {
        ok: status.is_success(),
        status: status.as_u16(),
        latency_ms,
        message: status_message(status),
    })
}
