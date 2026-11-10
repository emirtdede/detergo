use httpmock::prelude::*;
use node_cleaner_lib::commands::webhook_commands::{post_webhook_blocking, validate_webhook_url};

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
fn accepts_http_and_https() {
    assert!(validate_webhook_url("http://localhost:8080/hook").is_ok());
    assert!(validate_webhook_url("https://example.com/hook").is_ok());
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
    let result = post_webhook_blocking(&server.url("/hook"), &payload).expect("request");

    assert!(result.ok);
    assert_eq!(result.status, 200);
    mock.assert();
}

#[test]
fn non_2xx_response_is_reported_as_not_ok() {
    let server = MockServer::start();
    let mock = server.mock(|when, then| {
        when.method(POST).path("/hook");
        then.status(500);
    });

    let payload = serde_json::json!({ "event": "webhook_test" });
    let result = post_webhook_blocking(&server.url("/hook"), &payload).expect("request");

    assert!(!result.ok);
    assert_eq!(result.status, 500);
    assert!(result.message.contains("500"));
    mock.assert();
}

#[test]
fn unreachable_host_returns_a_clear_error() {
    // Nothing listens on port 1; the caller must get an Err with a message
    // rather than a silent success (the old `fetch` path did exactly that).
    let payload = serde_json::json!({ "event": "webhook_test" });
    let err = post_webhook_blocking("http://127.0.0.1:1/hook", &payload)
        .expect_err("connection must fail");
    assert!(!format!("{err}").is_empty());
}
