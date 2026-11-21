use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

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

/// Back-off schedule for a retryable webhook failure.
///
/// A webhook endpoint that answers 429 or 5xx is usually briefly unavailable
/// (receiver restart, rate limit, upstream blip). The send used to be a single
/// attempt, so a lifecycle event was lost with no trace. Three retries cover a
/// ~4 s window without blocking the scan/clean command for long; a 4xx is a
/// client mistake (`400`,`401`,`404`) and is never retried, because replaying it
/// cannot help and some receivers count every attempt against a rate limit.
const WEBHOOK_RETRY_DELAYS_MS: &[u64] = &[250, 1_000, 3_000];

/// Header that lets a receiver deduplicate replayed deliveries.
///
/// Every logical event gets one value that is reused across its retries, so an
/// endpoint that already processed the first attempt can drop the replay
/// instead of posting the same "cleanup finished" message twice.
const IDEMPOTENCY_HEADER: &str = "Idempotency-Key";

/// Generates the idempotency key for one logical delivery.
fn new_idempotency_key() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// Whether a response status should be retried.
///
/// `429` (rate limited) and `5xx` (server-side) are transient; every other
/// non-success (including `3xx`, since redirects are not followed) is final.
fn is_retryable_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

/// Only `http` and `https` are acceptable. Any other scheme would either be a
/// local file read (`file:`) or unparseable by the client.
fn parse_http_url(url: &str) -> Result<reqwest::Url, AppError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidPath("Webhook URL is empty.".to_string()));
    }
    let parsed = reqwest::Url::parse(trimmed)
        .map_err(|err| AppError::InvalidPath(format!("Invalid webhook URL: {err}")))?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppError::InvalidPath(
            "Webhook URL must not contain embedded user credentials.".to_string(),
        ));
    }
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(AppError::InvalidPath(format!(
            "Unsupported webhook scheme '{other}'; use http or https."
        ))),
    }
}

fn private_target_error(allow_private: bool) -> AppError {
    if allow_private {
        AppError::InvalidPath(
            "Webhook URL targets a restricted address (cloud metadata, link-local, unspecified, \
             or multicast targets are always blocked even when private webhooks are enabled)."
                .to_string(),
        )
    } else {
        AppError::InvalidPath(
            "Webhook URL must point to a public address; loopback, private, link-local and \
             multicast targets are not allowed. Enable 'Allow local/LAN webhooks' in Settings \
             for self-hosted endpoints such as local n8n."
                .to_string(),
        )
    }
}

fn forbidden_ipv4_with_policy(ip: Ipv4Addr, allow_private: bool) -> bool {
    let octets = ip.octets();
    // Always blocked regardless of user opt-in: cloud instance metadata
    // (AWS/GCP/Azure 169.254.0.0/16, Alibaba Cloud 100.100.100.200),
    // unspecified (0.0.0.0/8), reserved (240.0.0.0/4), multicast, broadcast,
    // documentation, IETF protocol-assignment, and benchmarking.
    let always_forbidden = ip.is_link_local()
        || ip.is_multicast()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_documentation()
        || octets[0] == 0
        || octets[0] >= 240
        || octets == [100, 100, 100, 200]
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
        || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19));
    if always_forbidden {
        return true;
    }
    if allow_private {
        return false;
    }
    ip.is_loopback()
        || ip.is_private()
        // Carrier-grade NAT (100.64.0.0/10, e.g. Tailscale / ISP CGNAT) is not
        // a public webhook destination unless private webhooks are opted in.
        || (octets[0] == 100 && (64..=127).contains(&octets[1]))
}

fn forbidden_ipv6_with_policy(ip: Ipv6Addr, allow_private: bool) -> bool {
    // Check loopback (`::1`) BEFORE `to_ipv4()`: Rust treats `::1` as an
    // IPv4-compatible `0.0.0.1` in `to_ipv4()`, which would otherwise hit the
    // `octets[0] == 0` guard even when `allow_private` is enabled.
    if ip.is_loopback() {
        return !allow_private;
    }
    let segments = ip.segments();
    let embedded_tail_v4 = Ipv4Addr::new(
        (segments[6] >> 8) as u8,
        (segments[6] & 0xff) as u8,
        (segments[7] >> 8) as u8,
        (segments[7] & 0xff) as u8,
    );
    let always_forbidden = ip.is_unspecified()
        || ip.is_multicast()
        // Link-local unicast (fe80::/10) and deprecated site-local (fec0::/10).
        || (segments[0] & 0xffc0) == 0xfe80
        || (segments[0] & 0xffc0) == 0xfec0
        // AWS EC2 IPv6 IMDS (`fd00:ec2::254`) is always blocked even when LAN webhooks are enabled.
        || segments == [0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254]
        // Discard-only (`100::/64`) and documentation (`2001:db8::/32`).
        || (segments[0] == 0x0100 && segments[1] == 0 && segments[2] == 0 && segments[3] == 0)
        || (segments[0] == 0x2001 && segments[1] == 0x0db8)
        // IPv4-mapped/compatible forms inherit the IPv4 policy.
        || ip
            .to_ipv4()
            .map(|v4| forbidden_ipv4_with_policy(v4, allow_private))
            .unwrap_or(false)
        // IPv4-translated (`::ffff:0:0/96`) and NAT64 well-known (`64:ff9b::/96`)
        // & local (`64:ff9b:1::/48`) prefixes embed an IPv4 address in segments 6..7.
        || (segments[0..6] == [0, 0, 0, 0, 0xffff, 0]
            && forbidden_ipv4_with_policy(embedded_tail_v4, allow_private))
        || (segments[0] == 0x0064
            && segments[1] == 0xff9b
            && (segments[2..6] == [0, 0, 0, 0] || segments[2] == 1)
            && forbidden_ipv4_with_policy(embedded_tail_v4, allow_private))
        // 6to4 embeds an IPv4 address in segments 1 and 2.
        || (segments[0] == 0x2002
            && forbidden_ipv4_with_policy(
                Ipv4Addr::new(
                    (segments[1] >> 8) as u8,
                    (segments[1] & 0xff) as u8,
                    (segments[2] >> 8) as u8,
                    (segments[2] & 0xff) as u8,
                ),
                allow_private,
            ))
        // Teredo embeds the client IPv4 address XORed with 0xffffffff.
        || (segments[0] == 0x2001
            && segments[1] == 0
            && forbidden_ipv4_with_policy(
                Ipv4Addr::new(
                    !(segments[6] >> 8) as u8,
                    !(segments[6] & 0xff) as u8,
                    !(segments[7] >> 8) as u8,
                    !(segments[7] & 0xff) as u8,
                ),
                allow_private,
            ));
    if always_forbidden {
        return true;
    }
    if allow_private {
        return false;
    }
    // Unique local addresses (fc00::/7).
    (segments[0] & 0xfe00) == 0xfc00
}

fn is_forbidden_ip_with_policy(ip: IpAddr, allow_private: bool) -> bool {
    match ip {
        IpAddr::V4(ipv4) => forbidden_ipv4_with_policy(ipv4, allow_private),
        IpAddr::V6(ipv6) => forbidden_ipv6_with_policy(ipv6, allow_private),
    }
}

#[cfg(test)]
fn is_forbidden_ip(ip: IpAddr) -> bool {
    is_forbidden_ip_with_policy(ip, false)
}

fn normalized_host(parsed: &reqwest::Url) -> Result<String, AppError> {
    parsed
        .host_str()
        .map(|host| {
            host.trim_matches(['[', ']'])
                .trim_end_matches('.')
                .to_ascii_lowercase()
        })
        .filter(|host| !host.is_empty())
        .ok_or_else(|| AppError::InvalidPath("Webhook URL has no host.".to_string()))
}

/// Rejects hostnames forbidden by the active policy before any DNS lookup.
///
/// Cloud metadata hostnames are always blocked even when `allow_private` is
/// enabled for self-hosted n8n / LAN automation servers.
fn validate_hostname_policy(host: &str, allow_private: bool) -> Result<(), AppError> {
    if host == "metadata.google.internal" || host == "metadata" {
        return Err(private_target_error(allow_private));
    }
    if !allow_private
        && (host == "localhost"
            || host.ends_with(".localhost")
            || host.ends_with(".local")
            || host.ends_with(".internal")
            || host.ends_with(".home.arpa"))
    {
        return Err(private_target_error(false));
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_forbidden_ip_with_policy(ip, allow_private) {
            return Err(private_target_error(allow_private));
        }
    }
    Ok(())
}

/// Validates the scheme and literal-host policy under the strict public-only
/// default. DNS-dependent checks happen in `prepare_webhook_client_*`, where
/// every resolved IP is also pinned for the actual request.
pub fn validate_webhook_url(url: &str) -> Result<reqwest::Url, AppError> {
    validate_webhook_url_with_policy(url, false)
}

/// Validates the scheme and literal-host policy with an explicit
/// `allow_private` toggle. When `allow_private` is `true`, loopback and
/// RFC1918/ULA LAN hosts (such as a local or home-lab n8n instance) are
/// permitted while cloud metadata (`169.254.0.0/16`, `fe80::/10`,
/// `metadata.google.internal`), unspecified (`0.0.0.0`/`::`), multicast, and
/// non-HTTP schemes remain blocked.
pub fn validate_webhook_url_with_policy(
    url: &str,
    allow_private: bool,
) -> Result<reqwest::Url, AppError> {
    let parsed = parse_http_url(url)?;
    let host = normalized_host(&parsed)?;
    validate_hostname_policy(&host, allow_private)?;
    Ok(parsed)
}

fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(WEBHOOK_TIMEOUT_SECS))
        // Ignore environment/system proxies so DNS pinning and SSRF policy can
        // never be bypassed by an HTTP(S)_PROXY forwarding to internal targets.
        .no_proxy()
        // The endpoint is supplied by the user. Following redirects would let a
        // public URL bounce the request to a loopback/private address the user
        // never approved. Webhook receivers answer directly, so no redirects.
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("Detergo/", env!("CARGO_PKG_VERSION")))
}

fn blocking_client_builder() -> reqwest::blocking::ClientBuilder {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(WEBHOOK_TIMEOUT_SECS))
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("Detergo/", env!("CARGO_PKG_VERSION")))
}

fn ensure_allowed_addrs(addrs: &[SocketAddr], allow_private: bool) -> Result<(), AppError> {
    if addrs.is_empty() {
        return Err(AppError::InvalidPath(
            "Webhook host did not resolve to any address.".to_string(),
        ));
    }
    if addrs
        .iter()
        .any(|addr| is_forbidden_ip_with_policy(addr.ip(), allow_private))
    {
        return Err(private_target_error(allow_private));
    }
    Ok(())
}

/// Canonicalizes a parsed URL's hostname (stripping trailing FQDN dots) so
/// `reqwest`'s DNS pin map always matches the exact request host.
fn canonicalize_request_host(parsed: &mut reqwest::Url, host: &str) -> Result<(), AppError> {
    if parsed
        .host_str()
        .is_some_and(|raw| raw.ends_with('.') || raw.chars().any(|c| c.is_ascii_uppercase()))
    {
        let host_for_url = if host.contains(':') {
            format!("[{host}]")
        } else {
            host.to_string()
        };
        parsed
            .set_host(Some(&host_for_url))
            .map_err(|err| AppError::InvalidPath(format!("Invalid webhook host: {err}")))?;
    }
    Ok(())
}

async fn prepare_webhook_client_async(
    url: &str,
    allow_private: bool,
) -> Result<(reqwest::Client, reqwest::Url), AppError> {
    let mut parsed = validate_webhook_url_with_policy(url, allow_private)?;
    let host = normalized_host(&parsed)?;
    canonicalize_request_host(&mut parsed, &host)?;
    let port = parsed.port_or_known_default().unwrap_or(443);
    let addrs: Vec<SocketAddr> = if let Ok(ip) = host.parse::<IpAddr>() {
        vec![SocketAddr::new(ip, port)]
    } else {
        tokio::net::lookup_host((host.as_str(), port))
            .await
            .map_err(|err| {
                AppError::Network(format!("Could not resolve webhook host '{host}': {err}"))
            })?
            .collect()
    };
    ensure_allowed_addrs(&addrs, allow_private)?;

    // Pin all validated addresses via `resolve_to_addrs` (a loop of `.resolve()`
    // overwrote previous entries with only the last IP).
    let client = client_builder()
        .resolve_to_addrs(&host, &addrs)
        .build()
        .map_err(|err| AppError::Network(err.without_url().to_string()))?;
    Ok((client, parsed))
}

fn prepare_webhook_client_blocking(
    url: &str,
    allow_private: bool,
) -> Result<(reqwest::blocking::Client, reqwest::Url), AppError> {
    let mut parsed = validate_webhook_url_with_policy(url, allow_private)?;
    let host = normalized_host(&parsed)?;
    canonicalize_request_host(&mut parsed, &host)?;
    let port = parsed.port_or_known_default().unwrap_or(443);
    let addrs: Vec<SocketAddr> = if let Ok(ip) = host.parse::<IpAddr>() {
        vec![SocketAddr::new(ip, port)]
    } else {
        (host.as_str(), port)
            .to_socket_addrs()
            .map_err(|err| {
                AppError::Network(format!("Could not resolve webhook host '{host}': {err}"))
            })?
            .collect()
    };
    ensure_allowed_addrs(&addrs, allow_private)?;

    let client = blocking_client_builder()
        .resolve_to_addrs(&host, &addrs)
        .build()
        .map_err(|err| AppError::Network(err.without_url().to_string()))?;
    Ok((client, parsed))
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
    // One key per logical delivery: every retry below reuses it so a receiver
    // that already processed the first attempt can drop the replay.
    let idempotency_key = new_idempotency_key();
    let mut attempt = 0usize;

    loop {
        let response = client
            .post(url.clone())
            .header(IDEMPOTENCY_HEADER, &idempotency_key)
            .json(payload)
            .send()
            .await;

        let status = match response {
            Ok(response) => response.status(),
            Err(err) => {
                // A transport error (DNS, TLS, connection reset) is retryable
                // only while attempts remain; otherwise it is the real failure.
                if let Some(delay) = WEBHOOK_RETRY_DELAYS_MS.get(attempt) {
                    attempt += 1;
                    tokio::time::sleep(std::time::Duration::from_millis(*delay)).await;
                    continue;
                }
                return Err(AppError::Network(err.without_url().to_string()));
            }
        };

        if !is_retryable_status(status) {
            let latency_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
            return Ok(WebhookTestResult {
                ok: status.is_success(),
                status: status.as_u16(),
                latency_ms,
                message: status_message(status),
            });
        }

        if let Some(delay) = WEBHOOK_RETRY_DELAYS_MS.get(attempt) {
            attempt += 1;
            tokio::time::sleep(std::time::Duration::from_millis(*delay)).await;
            continue;
        }

        // Retries exhausted: report the last status instead of a timeout so the
        // user can see *what* kept failing.
        let latency_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
        return Ok(WebhookTestResult {
            ok: false,
            status: status.as_u16(),
            latency_ms,
            message: format!(
                "{} (gave up after {} attempts)",
                status_message(status),
                attempt + 1
            ),
        });
    }
}

/// Sends a one-off payload from Settings → Automation. The URL comes from the
/// user, so it must be validated here rather than relying on a CSP scope.
#[tauri::command]
pub async fn test_webhook(
    url: String,
    payload: Option<serde_json::Value>,
    allow_private: Option<bool>,
    state: tauri::State<'_, crate::commands::AppState>,
) -> Result<WebhookTestResult, AppError> {
    let allow_private =
        allow_private.unwrap_or_else(|| state.settings.load().allow_private_webhooks);
    let (client, parsed) = prepare_webhook_client_async(&url, allow_private).await?;
    let body = payload.unwrap_or_else(|| {
        serde_json::json!({
            "event": "webhook_test",
            "product": "Detergo by Vellium",
            "version": env!("CARGO_PKG_VERSION"),
            "timestamp": chrono::Utc::now().to_rfc3339(),
        })
    });
    post_json(client, parsed, &body).await
}

/// Renames the camelCase keys the GUI used to send on the wire to the
/// snake_case names the CLI payload and the documentation use. One consumer
/// must be able to parse every Detergo event with one schema.
const LEGACY_KEY_MAP: &[(&str, &str)] = &[
    ("scanId", "scan_id"),
    ("rootPath", "root_path"),
    ("itemCount", "target_count"),
    ("cleanableBytes", "total_bytes"),
    ("planId", "plan_id"),
    ("durationMs", "duration_ms"),
    ("stopReason", "stop_reason"),
    ("successCount", "success_count"),
    ("errorCount", "error_count"),
    ("reclaimBytes", "reclaim_bytes"),
    ("movedBytes", "cleaned_bytes"),
];

/// Produces the documented webhook body from whatever the caller sent.
///
/// The GUI and the CLI both raise lifecycle events, and they used to describe
/// them with different field names. The canonical body is the one documented in
/// the app: an envelope (`event`, `timestamp`, `product`, `version`, `status`)
/// plus snake_case detail fields. Unknown fields are preserved so a caller can
/// add its own metadata without losing it here.
pub fn canonicalize_webhook_payload(event: &str, payload: Value) -> Value {
    let Value::Object(source) = payload else {
        return payload;
    };

    let mut out = Map::new();
    out.insert("event".to_string(), Value::String(event.to_string()));
    out.insert(
        "timestamp".to_string(),
        source
            .get("timestamp")
            .cloned()
            .unwrap_or_else(|| Value::String(chrono::Utc::now().to_rfc3339())),
    );
    out.insert(
        "product".to_string(),
        Value::String("Detergo by Vellium".to_string()),
    );
    out.insert(
        "version".to_string(),
        Value::String(env!("CARGO_PKG_VERSION").to_string()),
    );

    for (key, value) in source {
        if matches!(
            key.as_str(),
            "event" | "timestamp" | "product" | "version" | "status"
        ) {
            continue;
        }
        let canonical = LEGACY_KEY_MAP
            .iter()
            .find(|(legacy, _)| *legacy == key)
            .map(|(_, name)| *name)
            .unwrap_or(key.as_str());
        // A snake_case key always wins over its legacy spelling.
        out.entry(canonical.to_string()).or_insert(value);
    }

    if let Some(bytes) = out.get("total_bytes").and_then(Value::as_u64) {
        out.entry("total_human".to_string())
            .or_insert_with(|| Value::String(crate::format::human_bytes(bytes)));
    }

    let status = match (
        out.get("cancelled").and_then(Value::as_bool),
        out.get("partial").and_then(Value::as_bool),
    ) {
        (Some(true), _) => "cancelled",
        (_, Some(true)) => "partial",
        _ => "success",
    };
    out.insert("status".to_string(), Value::String(status.to_string()));

    Value::Object(out)
}

/// Sends a lifecycle webhook (scan/clean finished) using the saved settings.
///
/// The URL and the per-event toggles are read on the backend so the UI cannot
/// accidentally call a disabled webhook and so a stale frontend copy of the
/// settings can never bypass the user's choice.
#[tauri::command]
pub async fn dispatch_webhook(
    event: String,
    payload: serde_json::Value,
    state: tauri::State<'_, crate::commands::AppState>,
) -> Result<WebhookTestResult, AppError> {
    let settings = state.settings.load();
    // Fail closed: an unknown event name must not skip the user's per-event
    // toggles. Accept the legacy CLI names as aliases of the canonical ones.
    let canonical_event = match event.as_str() {
        "scan" | "scan_completed" => "scan",
        "clean" | "cleanup_completed" => "clean",
        _ => {
            return Err(AppError::Blocked(format!(
                "Unknown webhook event '{event}'."
            )))
        }
    };
    let enabled = match canonical_event {
        "scan" => settings.webhook_on_scan,
        _ => settings.webhook_on_clean,
    };
    if !enabled {
        return Err(AppError::Blocked(format!(
            "Webhook for '{event}' is disabled in settings."
        )));
    }
    let url = settings
        .webhook_url
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::InvalidPath("Webhook URL is not configured.".to_string()))?;
    let (client, parsed) =
        prepare_webhook_client_async(&url, settings.allow_private_webhooks).await?;
    let body = canonicalize_webhook_payload(canonical_event, payload);
    post_json(client, parsed, &body).await
}

/// Blocking variant used by the CLI, which does not run inside the Tauri
/// runtime. Keeping it in this module means there is exactly one HTTP path.
pub fn post_webhook_blocking(
    url: &str,
    payload: &serde_json::Value,
) -> Result<WebhookTestResult, AppError> {
    post_webhook_blocking_with_policy(url, payload, false)
}

/// Blocking variant with an explicit `allow_private` flag mirroring the saved
/// `allow_private_webhooks` setting for self-hosted n8n / LAN endpoints.
pub fn post_webhook_blocking_with_policy(
    url: &str,
    payload: &serde_json::Value,
    allow_private: bool,
) -> Result<WebhookTestResult, AppError> {
    let (client, parsed) = prepare_webhook_client_blocking(url, allow_private)?;
    post_blocking_json(client, parsed, payload)
}

/// Sends a payload without the public-address policy.
///
/// The integration suite uses loopback mock servers, which the production
/// policy correctly rejects. Production callers must use
/// `post_webhook_blocking`; this entry point exists only so the HTTP transport
/// itself can be tested.
#[doc(hidden)]
pub fn post_webhook_blocking_unchecked(
    url: &str,
    payload: &serde_json::Value,
) -> Result<WebhookTestResult, AppError> {
    let parsed = parse_http_url(url)?;
    let client = blocking_client_builder()
        .build()
        .map_err(|err| AppError::Network(err.to_string()))?;
    post_blocking_json(client, parsed, payload)
}

fn post_blocking_json(
    client: reqwest::blocking::Client,
    parsed: reqwest::Url,
    payload: &serde_json::Value,
) -> Result<WebhookTestResult, AppError> {
    let started = std::time::Instant::now();
    // Same delivery contract as the async path: one idempotency key per logical
    // event, reused by every retry, and no retry for a definitive 4xx.
    let idempotency_key = new_idempotency_key();
    let mut attempt = 0usize;

    loop {
        let response = client
            .post(parsed.clone())
            .header(IDEMPOTENCY_HEADER, &idempotency_key)
            .json(payload)
            .send();

        let status = match response {
            Ok(response) => response.status(),
            Err(err) => {
                if let Some(delay) = WEBHOOK_RETRY_DELAYS_MS.get(attempt) {
                    attempt += 1;
                    std::thread::sleep(std::time::Duration::from_millis(*delay));
                    continue;
                }
                return Err(AppError::Network(err.without_url().to_string()));
            }
        };

        if !is_retryable_status(status) {
            let latency_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
            return Ok(WebhookTestResult {
                ok: status.is_success(),
                status: status.as_u16(),
                latency_ms,
                message: status_message(status),
            });
        }

        if let Some(delay) = WEBHOOK_RETRY_DELAYS_MS.get(attempt) {
            attempt += 1;
            std::thread::sleep(std::time::Duration::from_millis(*delay));
            continue;
        }

        let latency_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
        return Ok(WebhookTestResult {
            ok: false,
            status: status.as_u16(),
            latency_ms,
            message: format!(
                "{} (gave up after {} attempts)",
                status_message(status),
                attempt + 1
            ),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_forbidden_ipv4_ranges() {
        for ip in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "224.0.0.1",
            "192.0.2.10",
        ] {
            assert!(
                is_forbidden_ip(ip.parse().unwrap()),
                "{ip} must be rejected"
            );
        }
        assert!(!is_forbidden_ip("1.1.1.1".parse().unwrap()));
        assert!(!is_forbidden_ip("8.8.8.8".parse().unwrap()));
    }

    #[test]
    fn classifies_forbidden_ipv6_ranges() {
        for ip in [
            "::1",
            "::",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
            "ff02::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(
                is_forbidden_ip(ip.parse().unwrap()),
                "{ip} must be rejected"
            );
        }
        assert!(!is_forbidden_ip("2606:4700:4700::1111".parse().unwrap()));
    }

    #[test]
    fn rejects_localhost_and_private_literals_in_urls() {
        for url in [
            "http://localhost/hook",
            "http://api.localhost/hook",
            "http://127.0.0.1/hook",
            "http://[::1]/hook",
            "http://192.168.0.10/hook",
            "http://169.254.169.254/latest/meta-data",
        ] {
            assert!(validate_webhook_url(url).is_err(), "{url} must be rejected");
        }
        assert!(validate_webhook_url("https://example.com/hook").is_ok());
    }

    #[test]
    fn allow_private_policy_permits_self_hosted_lan_and_blocks_cloud_metadata() {
        for allowed in [
            "http://localhost:5678/webhook/detergo",
            "http://127.0.0.1:5678/webhook/detergo",
            "http://[::1]:5678/webhook/detergo",
            "http://192.168.1.42:5678/webhook/detergo",
            "http://10.0.0.15:5678/webhook/detergo",
            "http://100.64.0.12:5678/webhook/detergo",
            "http://n8n.local:5678/webhook/detergo",
        ] {
            assert!(
                validate_webhook_url_with_policy(allowed, true).is_ok(),
                "{allowed} should be accepted when allow_private=true"
            );
        }
        for still_blocked in [
            "http://169.254.169.254/latest/meta-data/",
            "http://[fe80::1]/hook",
            "http://0.0.0.0/hook",
            "http://[::]/hook",
            "http://metadata.google.internal/computeMetadata/v1/",
            "file:///C:/Windows/win.ini",
        ] {
            assert!(
                validate_webhook_url_with_policy(still_blocked, true).is_err(),
                "{still_blocked} must remain blocked even when allow_private=true"
            );
        }
    }

    #[test]
    fn canonical_payload_renames_gui_fields_and_fills_the_envelope() {
        let body = canonicalize_webhook_payload(
            "scan",
            serde_json::json!({
                "event": "scan",
                "scanId": "s-1",
                "itemCount": 12,
                "cleanableBytes": 3 * 1024 * 1024,
                "durationMs": 900,
                "partial": false,
                "rootPath": "D:\\work",
            }),
        );

        assert_eq!(body["event"], "scan");
        assert_eq!(body["scan_id"], "s-1");
        assert_eq!(body["target_count"].as_u64(), Some(12));
        assert_eq!(body["total_bytes"].as_u64(), Some(3 * 1024 * 1024));
        assert_eq!(body["total_human"], "3.0 MB");
        assert_eq!(body["duration_ms"].as_u64(), Some(900));
        assert_eq!(body["root_path"], "D:\\work");
        assert_eq!(body["status"], "success");
        assert_eq!(body["product"], "Detergo by Vellium");
        assert_eq!(body["version"], env!("CARGO_PKG_VERSION"));
        assert!(body["timestamp"].as_str().is_some_and(|ts| !ts.is_empty()));
        // The legacy name must not survive next to its canonical twin.
        assert!(body.get("scanId").is_none());
        assert!(body.get("itemCount").is_none());
    }

    #[test]
    fn canonical_payload_reports_partial_and_cancelled_runs() {
        let partial = canonicalize_webhook_payload(
            "scan",
            serde_json::json!({ "partial": true, "stopReason": "ACCESS_DENIED" }),
        );
        assert_eq!(partial["status"], "partial");
        assert_eq!(partial["stop_reason"], "ACCESS_DENIED");

        let cancelled = canonicalize_webhook_payload(
            "clean",
            serde_json::json!({ "cancelled": true, "movedBytes": 2048 }),
        );
        assert_eq!(cancelled["status"], "cancelled");
        assert_eq!(cancelled["cleaned_bytes"].as_u64(), Some(2048));
    }

    #[test]
    fn canonical_payload_is_idempotent_for_the_cli_shape() {
        let cli = serde_json::json!({
            "event": "clean",
            "timestamp": "2026-11-17T10:00:00Z",
            "product": "Detergo by Vellium",
            "version": "1.0.0",
            "scope": "projects",
            "target_count": 24,
            "total_bytes": 1024,
            "total_human": "1 KB",
            "status": "success",
            "cleaned_count": 24,
            "cleaned_bytes": 1024,
            "dry_run": false,
        });
        let normalized = canonicalize_webhook_payload("clean", cli);
        assert_eq!(normalized["timestamp"], "2026-11-17T10:00:00Z");
        assert_eq!(normalized["total_human"], "1 KB");
        assert_eq!(normalized["cleaned_count"].as_u64(), Some(24));
        assert_eq!(normalized["dry_run"], false);
        assert_eq!(normalized["status"], "success");
    }
}
