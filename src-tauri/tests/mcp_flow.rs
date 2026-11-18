//! End-to-end MCP gate coverage.
//!
//! These tests drive `McpContext` directly so several tool calls share one
//! preview-grant store. That is the only way to exercise preview -> execute ->
//! replay in a single process. Every scenario runs against a throwaway APPDATA
//! directory so the developer's real settings and audit log are untouched.

use std::fs;
use std::time::Duration;

use serde_json::{json, Value};
use tempfile::tempdir;

use dev_cleaner_lib::mcp::{McpContext, McpOptions};
use dev_cleaner_lib::settings::model::AppSettings;
use dev_cleaner_lib::settings::SettingsRepository;

fn parse(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or_else(|_| json!({ "raw": text }))
}

/// Lays out a tiny Node project that discovery recognises as cleanable.
fn make_workspace(root: &std::path::Path) {
    let project = root.join("demo-app");
    fs::create_dir_all(project.join("node_modules").join("left-pad")).unwrap();
    fs::write(project.join("package.json"), r#"{"name":"demo-app"}"#).unwrap();
    fs::write(
        project
            .join("node_modules")
            .join("left-pad")
            .join("index.js"),
        "module.exports = 1;\n".repeat(128),
    )
    .unwrap();
}

fn first_target_id(scan: &Value) -> String {
    scan["items"][0]["target_id"]
        .as_str()
        .or_else(|| scan["top_targets"][0]["target_id"].as_str())
        .expect("scan returns at least one target")
        .to_string()
}

#[test]
fn preview_execute_replay_and_disabled_setting() {
    let temp = tempdir().unwrap();
    // Isolate settings, audit and last-scan storage for this process.
    std::env::set_var("APPDATA", temp.path());
    std::env::set_var("USERPROFILE", temp.path());
    make_workspace(temp.path());

    let root = temp.path().to_string_lossy().to_string();
    let ctx = McpContext::new(McpOptions {
        allow_destructive: true,
    });

    let scan = parse(&ctx.call_tool(
        "devcleaner_scan_workspace",
        &json!({ "path": root, "scope": "projects" }),
    ));
    let target_id = first_target_id(&scan);

    let preview = parse(&ctx.call_tool(
        "devcleaner_preview_cleanup",
        &json!({ "target_ids": [target_id], "path": root }),
    ));
    let token = preview["token"]
        .as_str()
        .unwrap_or_else(|| panic!("preview failed: {preview}"))
        .to_string();
    assert_eq!(preview["status"], "preview");

    // Settings default to disabled: execute must refuse even with a valid token.
    let blocked = ctx.call_tool(
        "devcleaner_execute_cleanup",
        &json!({ "token": token, "confirm": true }),
    );
    assert!(!blocked.contains("success"), "unexpected: {blocked}");

    // Enable the setting and execute the same grant; a refusal must not consume it.
    let settings = AppSettings {
        mcp_allow_destructive: true,
        ..Default::default()
    };
    SettingsRepository::with_path(temp.path().join("dev-cleaner").join("config.json"))
        .save(&settings)
        .unwrap();

    let executed = parse(&ctx.call_tool(
        "devcleaner_execute_cleanup",
        &json!({ "token": token, "confirm": true }),
    ));
    assert_eq!(executed["status"], "success", "unexpected: {executed}");

    // The token is single-use: the same grant cannot run twice.
    let replay = ctx.call_tool(
        "devcleaner_execute_cleanup",
        &json!({ "token": token, "confirm": true }),
    );
    assert!(!replay.contains("success"), "unexpected: {replay}");

    // A fresh grant that ages past the TTL is rejected as expired.
    let scan_again = parse(&ctx.call_tool(
        "devcleaner_scan_workspace",
        &json!({ "path": root, "scope": "projects" }),
    ));
    // The first target was recycled; there may be nothing left to preview.
    if let Some(next_id) = scan_again["items"]
        .as_array()
        .and_then(|items| items.first())
        .and_then(|item| item["target_id"].as_str())
    {
        let preview2 = parse(&ctx.call_tool(
            "devcleaner_preview_cleanup",
            &json!({ "target_ids": [next_id], "path": root }),
        ));
        let token2 = preview2["token"]
            .as_str()
            .expect("second preview")
            .to_string();
        ctx.age_grants_for_test(Duration::from_secs(10 * 60));
        let expired = ctx.call_tool(
            "devcleaner_execute_cleanup",
            &json!({ "token": token2, "confirm": true }),
        );
        assert!(!expired.contains("success"), "unexpected: {expired}");
    }
}

fn context() -> McpContext {
    McpContext::new(McpOptions {
        allow_destructive: true,
    })
}

#[test]
fn unknown_tool_is_reported_not_panicked() {
    let text = context().call_tool("devcleaner_does_not_exist", &json!({}));
    assert!(
        text.contains("devcleaner_does_not_exist"),
        "unexpected: {text}"
    );
}

#[test]
fn preview_requires_at_least_one_target() {
    let text = context().call_tool("devcleaner_preview_cleanup", &json!({ "target_ids": [] }));
    assert!(text.contains("target_id"), "unexpected: {text}");
}

#[test]
fn clean_safe_is_preview_only_and_needs_targets() {
    // The deprecated alias must behave like preview, never delete.
    let text = context().call_tool("devcleaner_clean_safe", &json!({ "target_ids": [] }));
    assert!(text.contains("target_id"), "unexpected: {text}");
}

#[test]
fn clean_cache_requires_destructive_flag_before_provider_lookup() {
    // H2: the destructive tool is gated before it looks at the provider list,
    // so an agent cannot probe or clean caches without the flag.
    let text = context().call_tool(
        "devcleaner_clean_cache",
        &json!({ "provider_id": "definitely-not-a-provider" }),
    );
    assert!(text.contains("confirm"), "unexpected: {text}");

    // Without the flag the destructive path is refused even earlier.
    let gated = McpContext::new(McpOptions::default());
    let text = gated.call_tool(
        "devcleaner_clean_cache",
        &json!({ "provider_id": "definitely-not-a-provider", "confirm": true }),
    );
    assert!(text.contains("allow-destructive"), "unexpected: {text}");
}

#[test]
fn scan_rejects_unknown_scope_before_touching_disk() {
    let text = context().call_tool(
        "devcleaner_scan_workspace",
        &json!({ "path": ".", "scope": "everything" }),
    );
    assert!(text.contains("everything"), "unexpected: {text}");
}

#[test]
fn execute_requires_confirm_even_with_flag() {
    let text = context().call_tool(
        "devcleaner_execute_cleanup",
        &json!({ "token": "anything", "confirm": false }),
    );
    assert!(text.contains("confirm"), "unexpected: {text}");
}

#[test]
fn tool_errors_are_structured() {
    // MCP 2025-06-18: blocked or unknown tools must set `isError`, not return
    // a plain text result that a client can mistake for success.
    let ctx = context();
    let unknown = ctx.call_tool_output("devcleaner_does_not_exist", &json!({}));
    assert!(unknown.is_error);
    assert!(unknown.text.contains("devcleaner_does_not_exist"));

    let blocked = ctx.call_tool_output(
        "devcleaner_execute_cleanup",
        &json!({ "token": "anything", "confirm": false }),
    );
    assert!(blocked.is_error);

    let listing = ctx.call_tool_output("devcleaner_list_caches", &json!({}));
    assert!(!listing.is_error);
}

#[test]
fn execute_without_flag_is_blocked_before_token_lookup() {
    let locked = McpContext::new(McpOptions::default());
    let text = locked.call_tool(
        "devcleaner_execute_cleanup",
        &json!({ "token": "anything", "confirm": true }),
    );
    assert!(text.contains("allow-destructive"), "unexpected: {text}");
}
