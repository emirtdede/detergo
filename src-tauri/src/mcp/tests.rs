use std::collections::HashMap;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::cleanup::{CleanupPlan, DeleteMode};
use crate::scanner::models::ScanScope;

use super::{
    cleanup_status, make_room_for_grant, make_room_for_scan, run_mcp_server_with, McpOptions,
    PreviewGrant, StoredScan, MAX_PENDING_GRANTS, MAX_STORED_SCANS, PREVIEW_TTL,
};

fn preview_grant(created: Instant, token: &str) -> PreviewGrant {
    PreviewGrant {
        plan: CleanupPlan {
            id: format!("p-{token}"),
            session_id: "s-test".to_string(),
            mode: DeleteMode::RecycleBin,
            created_ms: 0,
            expires_ms: 0,
            items: Vec::new(),
            total_logical_bytes: 0,
            total_estimated_bytes: 0,
            eligible_count: 0,
            blocked_count: 0,
            confirmation_token: token.to_string(),
        },
        session: Arc::new(crate::scanner::session::ScanSession {
            id: "s-test".to_string(),
            scope: ScanScope::Project,
            root: PathBuf::new(),
            allowed_roots: Vec::new(),
            created: Instant::now(),
            items: Vec::new(),
            targets: HashMap::new(),
            summary: None,
        }),
        created,
    }
}

#[test]
fn pending_previews_stay_bounded_and_drop_the_oldest() {
    let now = Instant::now();
    let mut grants = HashMap::new();
    let total = MAX_PENDING_GRANTS + 5;
    for index in 0..total {
        let age = u64::try_from(total - index).unwrap_or(0);
        let created = now.checked_sub(Duration::from_secs(age)).unwrap_or(now);
        make_room_for_grant(&mut grants);
        grants.insert(
            format!("t-{index}"),
            preview_grant(created, &format!("t-{index}")),
        );
    }
    assert_eq!(grants.len(), MAX_PENDING_GRANTS);
    assert!(
        !grants.contains_key("t-0"),
        "the oldest grant must be evicted"
    );
    assert!(grants.contains_key(&format!("t-{}", total - 1)));
}

#[test]
fn an_expired_preview_is_dropped_before_the_map_fills() {
    let now = Instant::now();
    let mut grants = HashMap::new();
    let expired = now
        .checked_sub(PREVIEW_TTL + Duration::from_secs(1))
        .unwrap_or(now);
    grants.insert("stale".to_string(), preview_grant(expired, "stale"));
    make_room_for_grant(&mut grants);
    assert!(grants.is_empty());
}

fn stored_scan(created: Instant, id: &str) -> StoredScan {
    StoredScan {
        session: Arc::new(crate::scanner::session::ScanSession {
            id: id.to_string(),
            scope: ScanScope::Project,
            root: PathBuf::new(),
            allowed_roots: Vec::new(),
            created: Instant::now(),
            items: Vec::new(),
            targets: HashMap::new(),
            summary: None,
        }),
        ordered_item_ids: Vec::new(),
        total_reclaimable_bytes: 0,
        cleanable_bytes: 0,
        path_str: ".".to_string(),
        scope_label: "projects".to_string(),
        older_than_days: None,
        created,
    }
}

#[test]
fn remembered_scans_stay_bounded_and_drop_the_oldest() {
    let now = Instant::now();
    let mut scans = HashMap::new();
    let total = MAX_STORED_SCANS + 4;
    for index in 0..total {
        let age = u64::try_from(total - index).unwrap_or(0);
        let created = now.checked_sub(Duration::from_secs(age)).unwrap_or(now);
        make_room_for_scan(&mut scans);
        scans.insert(
            format!("s-{index}"),
            stored_scan(created, &format!("s-{index}")),
        );
    }
    assert_eq!(scans.len(), MAX_STORED_SCANS);
    assert!(
        !scans.contains_key("s-0"),
        "the oldest scan must be evicted"
    );
    assert!(scans.contains_key(&format!("s-{}", total - 1)));
}

#[test]
fn an_expired_scan_is_dropped_before_the_cap_is_reached() {
    let now = Instant::now();
    let mut scans = HashMap::new();
    let expired = now
        .checked_sub(crate::scanner::session::SESSION_TTL + Duration::from_secs(1))
        .unwrap_or(now);
    scans.insert("stale".to_string(), stored_scan(expired, "stale"));
    make_room_for_scan(&mut scans);
    assert!(scans.is_empty());
}

fn call(options: McpOptions, request: &str) -> Value {
    let mut out = Vec::new();
    run_mcp_server_with(Cursor::new(format!("{request}\n")), &mut out, options);
    serde_json::from_slice(&out).expect("response json")
}

fn raw(options: McpOptions, request: &str) -> String {
    let mut out = Vec::new();
    run_mcp_server_with(Cursor::new(format!("{request}\n")), &mut out, options);
    String::from_utf8(out).expect("utf8")
}

#[test]
fn notification_without_id_gets_no_response() {
    let output = raw(
        McpOptions::default(),
        r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
    );
    assert!(output.trim().is_empty());
}

#[test]
fn null_id_is_an_invalid_request_not_a_notification() {
    let response = call(
        McpOptions::default(),
        r#"{"jsonrpc":"2.0","id":null,"method":"initialize"}"#,
    );
    assert_eq!(response["error"]["code"], -32600);
    assert!(response["id"].is_null());
}

#[test]
fn initialize_reports_package_version() {
    let response = call(
        McpOptions::default(),
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#,
    );
    assert_eq!(
        response["result"]["serverInfo"]["version"],
        env!("CARGO_PKG_VERSION")
    );
}

#[test]
fn destructive_tool_is_hidden_without_flag() {
    let response = call(
        McpOptions::default(),
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#,
    );
    let names: Vec<&str> = response["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert!(!names.contains(&"detergo_execute_cleanup"));
    assert!(!names.contains(&"detergo_clean_cache"));
    assert!(names.contains(&"detergo_preview_cleanup"));
}

#[test]
fn destructive_tool_is_listed_with_flag() {
    let response = call(
        McpOptions {
            allow_destructive: true,
        },
        r#"{"jsonrpc":"2.0","id":3,"method":"tools/list"}"#,
    );
    let names: Vec<&str> = response["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"detergo_execute_cleanup"));
    assert!(names.contains(&"detergo_clean_cache"));
}

#[test]
fn clean_cache_requires_confirm_and_flag() {
    let response = call(
        McpOptions::default(),
        r#"{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"detergo_clean_cache","arguments":{"provider_id":"npm","confirm":true}}}"#,
    );
    let text = response["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("allow-destructive"));

    let response = call(
        McpOptions {
            allow_destructive: true,
        },
        r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"detergo_clean_cache","arguments":{"provider_id":"npm"}}}"#,
    );
    let text = response["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("confirm"));
}

#[test]
fn execute_requires_confirm_and_flag() {
    let response = call(
        McpOptions::default(),
        r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"detergo_execute_cleanup","arguments":{"token":"x","confirm":true}}}"#,
    );
    let text = response["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("allow-destructive"));
}

#[test]
fn malformed_json_returns_parse_error() {
    let response = call(McpOptions::default(), "{not json");
    assert_eq!(response["error"]["code"], -32700);
}

#[test]
fn unknown_method_returns_method_not_found() {
    let response = call(
        McpOptions::default(),
        r#"{"jsonrpc":"2.0","id":5,"method":"nope"}"#,
    );
    assert_eq!(response["error"]["code"], -32601);
}

#[test]
fn cleanup_status_never_calls_a_failed_run_success() {
    assert_eq!(cleanup_status(false, 0, 3), "success");
    assert_eq!(cleanup_status(false, 1, 2), "partial");
    assert_eq!(cleanup_status(false, 2, 0), "failed");
    assert_eq!(cleanup_status(true, 0, 1), "cancelled");
    assert_eq!(cleanup_status(true, 1, 0), "cancelled");
}

#[test]
fn blocked_tools_call_reports_is_error() {
    let response = call(
        McpOptions::default(),
        r#"{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"detergo_execute_cleanup","arguments":{"token":"x","confirm":true}}}"#,
    );
    assert_eq!(
        response["result"]["isError"],
        serde_json::Value::Bool(true),
        "a blocked cleanup must be marked as an error: {response}"
    );
}

#[test]
fn unknown_tool_reports_is_error() {
    let response = call(
        McpOptions::default(),
        r#"{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"detergo_missing","arguments":{}}}"#,
    );
    assert_eq!(response["result"]["isError"], serde_json::Value::Bool(true));
}

#[test]
fn successful_listing_is_not_an_error() {
    let response = call(
        McpOptions::default(),
        r#"{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"detergo_list_caches","arguments":{}}}"#,
    );
    assert_eq!(
        response["result"]["isError"],
        serde_json::Value::Bool(false)
    );
    let parsed: Value =
        serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap())
            .expect("structured JSON cache list");
    assert!(parsed["providers"].is_array());
}

#[test]
fn initialize_negotiates_protocol_version_and_tools_include_annotations() {
    let r25 = call(
        McpOptions::default(),
        r#"{"jsonrpc":"2.0","id":11,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}"#,
    );
    assert_eq!(r25["result"]["protocolVersion"], "2025-03-26");

    let r24 = call(
        McpOptions::default(),
        r#"{"jsonrpc":"2.0","id":12,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}"#,
    );
    assert_eq!(r24["result"]["protocolVersion"], "2024-11-05");

    let r25_11 = call(
        McpOptions::default(),
        r#"{"jsonrpc":"2.0","id":120,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}"#,
    );
    assert_eq!(r25_11["result"]["protocolVersion"], "2025-11-25");

    let bad_ver = call(
        McpOptions::default(),
        r#"{"jsonrpc":"1.0","id":121,"method":"ping"}"#,
    );
    assert_eq!(bad_ver["error"]["code"], -32600);

    let bool_id = call(
        McpOptions::default(),
        r#"{"jsonrpc":"2.0","id":true,"method":"ping"}"#,
    );
    assert_eq!(bool_id["error"]["code"], -32600);

    let list = call(
        McpOptions {
            allow_destructive: true,
        },
        r#"{"jsonrpc":"2.0","id":13,"method":"tools/list"}"#,
    );
    let tools = list["result"]["tools"].as_array().unwrap();
    assert!(
        !tools.iter().any(|t| t["name"] == "detergo_clean_safe"),
        "deprecated detergo_clean_safe must not appear in tools/list"
    );
    let scan_tool = tools
        .iter()
        .find(|t| t["name"] == "detergo_scan_workspace")
        .expect("scan tool present");
    assert!(
        scan_tool["inputSchema"]["properties"]["older_than_days"].is_object(),
        "detergo_scan_workspace must expose older_than_days"
    );
    assert!(tools.iter().any(|t| t["name"] == "detergo_preview_cache"));
    assert!(tools.iter().any(|t| t["name"] == "detergo_system_scan"));
    assert!(tools.iter().any(|t| t["name"] == "detergo_system_preview"));
    assert!(tools.iter().any(|t| t["name"] == "detergo_system_execute"));
    for tool in tools {
        assert!(
            tool["annotations"]["readOnlyHint"].is_boolean(),
            "tool {} missing readOnlyHint annotation",
            tool["name"]
        );
    }
}

#[test]
fn scan_workspace_honors_older_than_days_staleness_filter() {
    let temp = tempfile::tempdir().unwrap();
    let proj = temp.path().join("fresh-app");
    let nm = proj.join("node_modules");
    std::fs::create_dir_all(&nm).unwrap();
    std::fs::write(proj.join("package.json"), "{}").unwrap();
    std::fs::write(nm.join("index.js"), "console.log(1);").unwrap();

    // Freshly created directory is < 30 days old, so older_than_days=30 excludes it.
    let resp = call(
        McpOptions::default(),
        &json!({
            "jsonrpc": "2.0",
            "id": 20,
            "method": "tools/call",
            "params": {
                "name": "detergo_scan_workspace",
                "arguments": {
                    "path": temp.path().to_string_lossy(),
                    "older_than_days": 30
                }
            }
        })
        .to_string(),
    );
    let parsed: Value =
        serde_json::from_str(resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(parsed["older_than_days"], json!(30));
    assert_eq!(parsed["items"].as_array().unwrap().len(), 0);
}

#[test]
fn inspect_target_enforces_real_path_guard_on_system_paths() {
    let response = call(
        McpOptions::default(),
        r#"{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"detergo_inspect_target","arguments":{"path":"C:\\Windows\\System32"}}}"#,
    );
    assert_eq!(response["result"]["isError"], Value::Bool(false));
    let parsed: Value =
        serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(parsed["protected"], Value::Bool(true));
    assert_eq!(parsed["eligible"], Value::Bool(false));
}

#[test]
fn inspect_target_uses_evaluate_path_for_verified_and_unverified_folders() {
    let temp = tempfile::tempdir().unwrap();
    let verified_proj = temp.path().join("web-app");
    let nm = verified_proj.join("node_modules");
    std::fs::create_dir_all(&nm).unwrap();
    std::fs::write(verified_proj.join("package.json"), "{}").unwrap();

    let resp = call(
        McpOptions::default(),
        &json!({
            "jsonrpc": "2.0",
            "id": 15,
            "method": "tools/call",
            "params": {
                "name": "detergo_inspect_target",
                "arguments": { "path": nm.to_string_lossy() }
            }
        })
        .to_string(),
    );
    let parsed: Value =
        serde_json::from_str(resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(parsed["eligible"], Value::Bool(true));
    assert_eq!(parsed["matched_rule"]["id"], "js.node_modules");

    let bare = temp.path().join("random-folder").join("target");
    std::fs::create_dir_all(&bare).unwrap();
    let resp_bare = call(
        McpOptions::default(),
        &json!({
            "jsonrpc": "2.0",
            "id": 16,
            "method": "tools/call",
            "params": {
                "name": "detergo_inspect_target",
                "arguments": { "path": bare.to_string_lossy() }
            }
        })
        .to_string(),
    );
    let parsed_bare: Value =
        serde_json::from_str(resp_bare["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(parsed_bare["eligible"], Value::Bool(false));
    assert!(parsed_bare["matched_rule"].is_null());
}
