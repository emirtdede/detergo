use serde_json::{json, Value};

use crate::cli::i18n::t;

fn tool_annotations(title: &str, read_only: bool, destructive: bool, idempotent: bool) -> Value {
    json!({
        "title": title,
        "readOnlyHint": read_only,
        "destructiveHint": destructive,
        "idempotentHint": idempotent,
        "openWorldHint": false
    })
}

pub(super) fn tool_definitions(allow_destructive: bool) -> Vec<Value> {
    let mut tools = vec![
        json!({
            "name": "detergo_scan_workspace",
            "description": t("Scans projects, AI storage, package caches, or C: system cleanup targets and returns measured reclaimable items."),
            "annotations": tool_annotations("Scan Workspace & Storage", true, false, true),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": t("Folder path to scan (default: current directory .)") },
                    "scope": { "type": "string", "enum": ["projects", "agents", "combined", "all"], "default": "projects" },
                    "targets": {
                        "type": "array",
                        "items": { "type": "string", "enum": ["projects", "agents", "caches", "system", "all", "drives"] },
                        "description": "Optional multi-target selection overriding scope (e.g. ['projects','agents','caches','system'])."
                    },
                    "min_size_mb": { "type": "number", "description": t("Minimum size threshold (MB)") },
                    "older_than_days": { "type": "number", "description": "Optional staleness filter: only return targets untouched for at least this many days (e.g. 30)." },
                    "limit": { "type": "number", "description": "Optional page size (default 25, max 200)." },
                    "cursor": { "type": "string", "description": "Optional opaque cursor from a previous scan response's nextCursor to fetch the next page without re-scanning." }
                }
            }
        }),
        json!({
            "name": "detergo_preview_cleanup",
            "description": t("Builds a cleanup plan and returns a single-use token. Never deletes anything."),
            "annotations": tool_annotations("Preview Workspace Cleanup", true, false, true),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "scan_id": { "type": "string", "description": "Scan session ID returned by detergo_scan_workspace." },
                    "target_ids": { "type": "array", "items": { "type": "string" }, "description": t("List of target IDs returned by detergo_scan_workspace") },
                    "path": { "type": "string", "description": t("Workspace directory for target verification") },
                    "incremental_older_than_days": { "type": "number", "description": "Optional cargo-sweep style intra-target age threshold in days (e.g. 7, 14, 30). Prunes only stale incremental build slices older than this many days while keeping recent builds warm." }
                },
                "required": ["target_ids"]
            }
        }),
        json!({
            "name": "detergo_list_caches",
            "description": t("Lists and measures cache status, disk sizes, provider IDs, and official cleanup action IDs for developer tools."),
            "annotations": tool_annotations("List & Measure Tool Caches", true, false, true),
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "detergo_preview_cache",
            "description": "Measures a developer tool cache before cleanup and returns a single-use preview_token for detergo_clean_cache. Never deletes anything.",
            "annotations": tool_annotations("Preview Tool Cache Cleanup", true, false, true),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "provider_id": { "type": "string", "description": t("Provider ID to clean (e.g. npm, cargo, pip, docker)") },
                    "action_id": { "type": "string", "description": t("Optional action ID from detergo_list_caches; defaults to the first action") }
                },
                "required": ["provider_id"]
            }
        }),
        json!({
            "name": "detergo_system_scan",
            "description": "Scans Windows C: drive system cleanup categories (temp folders, Prefetch, Windows Update leftovers, Recycle Bin, etc.) and reports measured sizes.",
            "annotations": tool_annotations("Scan C: System Cleaner", true, false, true),
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "detergo_system_preview",
            "description": "Validates selected C: system cleanup action IDs or profile (quick/standard/deep) and returns a single-use token for detergo_system_execute. Never deletes anything.",
            "annotations": tool_annotations("Preview C: System Cleanup", true, false, true),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action_ids": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Action IDs from detergo_system_scan (e.g. ['userTemp','windowsUpdate'])."
                    },
                    "profile": {
                        "type": "string",
                        "enum": ["quick", "standard", "deep"],
                        "description": "Optional preset profile instead of explicit action_ids."
                    }
                }
            }
        }),
        json!({
            "name": "detergo_get_history",
            "description": t("Lists past cleanup and audit records performed by Detergo."),
            "annotations": tool_annotations("Read Cleanup History", true, false, true),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": { "type": "number", "description": t("Number of records to list (default: 10)") }
                }
            }
        }),
        json!({
            "name": "detergo_inspect_target",
            "description": t("Inspects safety class, PathGuard protection, rule details, and cleanup eligibility for a specific target."),
            "annotations": tool_annotations("Inspect Target Safety", true, false, true),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": t("File path of target to inspect") }
                },
                "required": ["path"]
            }
        }),
    ];

    if allow_destructive {
        tools.push(json!({
            "name": "detergo_clean_cache",
            "description": "Executes a previewed developer tool cache cleanup via official CLI command. Call detergo_preview_cache first to obtain preview_token. Destructive: requires preview_token, confirm:true, --allow-destructive and the MCP destructive setting.",
            "annotations": tool_annotations("Clean Tool Cache", false, true, false),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "preview_token": { "type": "string", "description": "Single-use preview_token returned by detergo_preview_cache." },
                    "confirm": { "type": "boolean", "description": t("Must be true; proves the caller intentionally requests cache deletion") }
                },
                "required": ["preview_token", "confirm"]
            }
        }));
        tools.push(json!({
            "name": "detergo_execute_cleanup",
            "description": t("Executes a previously previewed cleanup plan. Requires confirm:true, a single-use token, the --allow-destructive flag and the MCP destructive setting."),
            "annotations": tool_annotations("Execute Workspace Cleanup", false, true, false),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "token": { "type": "string", "description": t("Single-use token returned by detergo_preview_cleanup") },
                    "confirm": { "type": "boolean", "description": t("Must be true; proves the caller saw the preview") }
                },
                "required": ["token", "confirm"]
            }
        }));
        tools.push(json!({
            "name": "detergo_system_execute",
            "description": "Executes a previewed C: system cleanup plan. Call detergo_system_preview first to obtain a single-use token. Destructive: requires token, confirm:true, --allow-destructive and the MCP destructive setting.",
            "annotations": tool_annotations("Execute C: System Cleanup", false, true, false),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "token": { "type": "string", "description": "Single-use token returned by detergo_system_preview." },
                    "confirm": { "type": "boolean", "description": "Must be true; proves the caller saw the preview." }
                },
                "required": ["token", "confirm"]
            }
        }));
    }

    tools
}

pub(super) fn negotiate_protocol_version(params: Option<&Value>) -> &'static str {
    match params
        .and_then(|p| p.get("protocolVersion"))
        .and_then(|v| v.as_str())
    {
        Some("2024-11-05") => "2024-11-05",
        Some("2025-03-26") => "2025-03-26",
        Some("2025-06-18") => "2025-06-18",
        Some("2025-11-25") => "2025-11-25",
        _ => "2025-11-25",
    }
}
