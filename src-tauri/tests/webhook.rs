use detergo_lib::commands::webhook_commands::{
    post_webhook_blocking, post_webhook_blocking_unchecked, validate_webhook_url,
};
use httpmock::prelude::*;

#[test]
fn rejects_unsupported_scheme() {
    let err = validate_webhook_url("file:///C:/secret").expect_err("file: must be rejected");
    assert!(format!("{err}").contains("Unsupported webhook scheme"));
}

#[test]
fn rejects_empty_url() {
    assert!(validate_webhook_url("   ").is_err());
}

#[test]
fn accepts_public_http_and_https() {
    assert!(validate_webhook_url("https://example.com/hook").is_ok());
    assert!(validate_webhook_url("http://1.1.1.1/hook").is_ok());
}

#[test]
fn rejects_loopback_and_private_targets() {
    // The webhook is delivered by the backend, so a loopback or private
    // destination would let a remote config turn the app into an SSRF proxy
    // against the local machine or the user's LAN.
    for url in [
        "http://localhost:8080/hook",
        "http://127.0.0.1:8080/hook",
        "http://[::1]:8080/hook",
        "http://192.168.1.10/hook",
        "http://10.0.0.5/hook",
        "http://169.254.169.254/latest/meta-data",
        "http://printer.local/hook",
    ] {
        assert!(
            validate_webhook_url(url).is_err(),
            "{url} must be rejected by the public-address policy"
        );
    }
}

#[test]
fn posts_json_payload_and_reports_success() {
    let server = MockServer::start();
    let mock = server.mock(|when, then| {
        when.method(POST)
            .path("/hook")
            .header("content-type", "application/json");
        then.status(200).body("ok");
    });

    let payload = serde_json::json!({ "event": "webhook_test" });
    // Mock servers listen on loopback, which the production policy rejects on
    // purpose. The unchecked entry point exercises the HTTP transport only.
    let result = post_webhook_blocking_unchecked(&server.url("/hook"), &payload).expect("request");

    assert!(result.ok);
    assert_eq!(result.status, 200);
    mock.assert();
}

#[test]
fn non_2xx_response_is_reported_as_not_ok() {
    let server = MockServer::start();
    // 400 is a client error: it is not retryable, so exactly one request must be
    // made. 5xx retry behaviour is covered by the next test.
    let mock = server.mock(|when, then| {
        when.method(POST).path("/hook");
        then.status(400);
    });

    let payload = serde_json::json!({ "event": "webhook_test" });
    let result = post_webhook_blocking_unchecked(&server.url("/hook"), &payload).expect("request");

    assert!(!result.ok);
    assert_eq!(result.status, 400);
    assert!(result.message.contains("400"));
    mock.assert();
}

#[test]
fn server_errors_are_retried_and_the_last_status_is_reported() {
    let server = MockServer::start();
    let mock = server.mock(|when, then| {
        when.method(POST).path("/hook");
        then.status(500);
    });

    let payload = serde_json::json!({ "event": "webhook_test" });
    let result = post_webhook_blocking_unchecked(&server.url("/hook"), &payload).expect("request");

    // R-2: the first attempt plus every delay in WEBHOOK_RETRY_DELAYS_MS.
    assert!(!result.ok);
    assert_eq!(result.status, 500);
    assert_eq!(mock.hits(), 4);
}

#[test]
fn unreachable_public_host_returns_a_clear_error() {
    // TEST-NET-1 (192.0.2.0/24) is documented and unroutable; the caller must
    // get an Err with a message rather than a silent success.
    let payload = serde_json::json!({ "event": "webhook_test" });
    let err = post_webhook_blocking("http://192.0.2.1:1/hook", &payload)
        .expect_err("connection must fail");
    assert!(!format!("{err}").is_empty());
}
