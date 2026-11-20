use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::cleanup::{CleanupPlan, DeleteMode};
use crate::cli::i18n::{t, tf};
use crate::commands::AppState;
use crate::scanner::cancellation::CancellationToken;
use crate::scanner::models::ScanScope;

/// Shared process-wide backend state.
///
/// The MCP server is long-lived, yet every tool call constructed a fresh
/// `AppState`, re-reading the catalog and settings repositories. A single
/// `OnceLock` keeps the same settings/audit handles the GUI uses and avoids
/// repeating that work on each request.
fn mcp_state() -> &'static AppState {
    static STATE: OnceLock<AppState> = OnceLock::new();
    STATE.get_or_init(AppState::new)
}

/// Preview grants are intentionally shorter-lived than cleanup plans: an agent
/// must execute within five minutes of the preview it showed the user.
const PREVIEW_TTL: Duration = Duration::from_secs(5 * 60);

/// Pending previews kept per server.
///
/// Each grant owns a whole `CleanupPlan` and an `Arc<ScanSession>` (which holds
/// every scanned item), so an agent that previews in a loop without executing
/// grew the map for the lifetime of the process. Expired grants are dropped and
/// the oldest survivor is evicted before a new one is stored.
const MAX_PENDING_GRANTS: usize = 16;

/// Scan sessions remembered for a later `devcleaner_preview_cleanup`.
///
/// A `StoredScan` owns a whole `ScanSession` (every discovered item and target),
/// so the TTL alone was not enough: an agent that rescans a large workspace in a
/// loop kept every intermediate result for the full 30 minute window. The newest
/// scan is the one a preview resolves, so dropping the oldest is safe.
const MAX_STORED_SCANS: usize = 8;

#[derive(Debug, Clone, Copy, Default)]
pub struct McpOptions {
    /// Mirrors the `mcp --allow-destructive` CLI flag.
    pub allow_destructive: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    params: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolCallOutput {
    pub text: String,
    /// Mirrors MCP `CallToolResult.isError`. A blocked or failed call must set
    /// this so a client never mistakes a refusal for a successful operation.
    pub is_error: bool,
}

impl ToolCallOutput {
    fn ok(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            is_error: false,
        }
    }

    fn error(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            is_error: true,
        }
    }
}

struct PreviewGrant {
    plan: CleanupPlan,
    session: Arc<crate::scanner::session::ScanSession>,
    created: Instant,
}

/// Result of a previous `devcleaner_scan_workspace` call. Kept so
/// `devcleaner_preview_cleanup` can resolve the target IDs the agent just saw
/// (discovery generates fresh IDs on every run, so a re-scan cannot match).
struct StoredScan {
    session: Arc<crate::scanner::session::ScanSession>,
    created: Instant,
}

struct SystemPreviewGrant {
    ids: Vec<crate::system_cleaner::SystemActionId>,
    created: Instant,
}

/// Per-process MCP state. The preview grants live in memory so a token cannot
/// be replayed across a restart and can only be redeemed once.
pub struct McpContext {
    options: McpOptions,
    grants: Mutex<HashMap<String, PreviewGrant>>,
    scans: Mutex<HashMap<String, StoredScan>>,
    cache_registry: crate::cleanup::official_actions::OfficialActionRegistry,
    system_grants: Mutex<HashMap<String, SystemPreviewGrant>>,
}

fn make_room_for_system_grant(grants: &mut HashMap<String, SystemPreviewGrant>) {
    grants.retain(|_, grant| grant.created.elapsed() <= PREVIEW_TTL);
    if grants.len() < MAX_PENDING_GRANTS {
        return;
    }
    let oldest = grants
        .iter()
        .min_by_key(|(_, grant)| grant.created)
        .map(|(token, _)| token.clone());
    if let Some(token) = oldest {
        grants.remove(&token);
    }
}

/// Keeps the pending-preview map bounded.
///
/// Runs with the map already locked, immediately before a new grant is stored:
/// expired grants can never be redeemed, and a burst of previews without an
/// execute would otherwise retain every plan and its scan session for the whole
/// lifetime of the server process.
fn make_room_for_grant(grants: &mut HashMap<String, PreviewGrant>) {
    grants.retain(|_, grant| grant.created.elapsed() <= PREVIEW_TTL);
    if grants.len() < MAX_PENDING_GRANTS {
        return;
    }
    let oldest = grants
        .iter()
        .min_by_key(|(_, grant)| grant.created)
        .map(|(token, _)| token.clone());
    if let Some(token) = oldest {
        grants.remove(&token);
    }
}

/// Keeps the remembered scan list bounded.
///
/// Same contract as [`make_room_for_grant`]: expired sessions are unusable and
/// are dropped first; when the list is still full the oldest survivor is
/// evicted. A preview can only resolve the scan id it was just given, so the
/// oldest entry is the least likely to be redeemed.
fn make_room_for_scan(scans: &mut HashMap<String, StoredScan>) {
    scans.retain(|_, scan| scan.created.elapsed() <= crate::scanner::session::SESSION_TTL);
    if scans.len() < MAX_STORED_SCANS {
        return;
    }
    let oldest = scans
        .iter()
        .min_by_key(|(_, scan)| scan.created)
        .map(|(id, _)| id.clone());
    if let Some(id) = oldest {
        scans.remove(&id);
    }
}

impl McpContext {
    pub fn new(options: McpOptions) -> Self {
        Self {
            options,
            grants: Mutex::new(HashMap::new()),
            scans: Mutex::new(HashMap::new()),
            cache_registry: crate::cleanup::official_actions::OfficialActionRegistry::new(),
            system_grants: Mutex::new(HashMap::new()),
        }
    }

    fn grants(&self) -> std::sync::MutexGuard<'_, HashMap<String, PreviewGrant>> {
        self.grants
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn scans(&self) -> std::sync::MutexGuard<'_, HashMap<String, StoredScan>> {
        self.scans
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn system_grants(&self) -> std::sync::MutexGuard<'_, HashMap<String, SystemPreviewGrant>> {
        self.system_grants
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Starts the stdio MCP server with destructive tools disabled.
pub fn run_mcp_server() {
    run_mcp_server_with_options(McpOptions::default());
}

pub fn run_mcp_server_with_options(options: McpOptions) {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    run_mcp_server_with(stdin.lock(), stdout, options);
}

/// Testable MCP loop. Production passes stdin/stdout; tests pass buffers.
pub fn run_mcp_server_with<R: BufRead, W: Write>(reader: R, mut writer: W, options: McpOptions) {
    let context = McpContext::new(options);
    for line in reader.lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }

        let raw: serde_json::Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => {
                let err_res = json!({
                    "jsonrpc": "2.0",
                    "id": Value::Null,
                    "error": {
                        "code": -32700,
                        "message": t("Parse error: Invalid JSON received")
                    }
                });
                let _ = writeln!(
                    writer,
                    "{}",
                    serde_json::to_string(&err_res).unwrap_or_default()
                );
                let _ = writer.flush();
                continue;
            }
        };
        // JSON-RPC only treats a request as a notification when the `id`
        // member is absent. `"id": null` is an invalid request and must still
        // receive a response, otherwise a client waits until it times out.
        let id_present = raw.get("id").is_some();
        let request: JsonRpcRequest = match serde_json::from_value(raw) {
            Ok(req) => req,
            Err(_) => {
                let err_res = json!({
                    "jsonrpc": "2.0",
                    "id": Value::Null,
                    "error": {
                        "code": -32600,
                        "message": t("Invalid Request: malformed JSON-RPC message")
                    }
                });
                let _ = writeln!(
                    writer,
                    "{}",
                    serde_json::to_string(&err_res).unwrap_or_default()
                );
                let _ = writer.flush();
                continue;
            }
        };

        if let Some(res) = handle_mcp_message(&request, id_present, &context) {
            let res_str = serde_json::to_string(&res).unwrap_or_default();
            let _ = writeln!(writer, "{}", res_str);
            let _ = writer.flush();
        }
    }
}

fn tool_annotations(title: &str, read_only: bool, destructive: bool, idempotent: bool) -> Value {
    json!({
        "title": title,
        "readOnlyHint": read_only,
        "destructiveHint": destructive,
        "idempotentHint": idempotent,
        "openWorldHint": false
    })
}

fn tool_definitions(allow_destructive: bool) -> Vec<Value> {
    let mut tools = vec![
        json!({
            "name": "devcleaner_scan_workspace",
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
                    "min_size_mb": { "type": "number", "description": t("Minimum size threshold (MB)") }
                }
            }
        }),
        json!({
            "name": "devcleaner_preview_cleanup",
            "description": t("Builds a cleanup plan and returns a single-use token. Never deletes anything."),
            "annotations": tool_annotations("Preview Workspace Cleanup", true, false, true),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "scan_id": { "type": "string", "description": "Scan session ID returned by devcleaner_scan_workspace." },
                    "target_ids": { "type": "array", "items": { "type": "string" }, "description": t("List of target IDs returned by devcleaner_scan_workspace") },
                    "path": { "type": "string", "description": t("Workspace directory for target verification") }
                },
                "required": ["target_ids"]
            }
        }),
        json!({
            "name": "devcleaner_list_caches",
            "description": t("Lists and measures cache status, disk sizes, provider IDs, and official cleanup action IDs for developer tools."),
            "annotations": tool_annotations("List & Measure Tool Caches", true, false, true),
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "devcleaner_preview_cache",
            "description": "Measures a developer tool cache before cleanup and returns a single-use preview_token for devcleaner_clean_cache. Never deletes anything.",
            "annotations": tool_annotations("Preview Tool Cache Cleanup", true, false, true),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "provider_id": { "type": "string", "description": t("Provider ID to clean (e.g. npm, cargo, pip, docker)") },
                    "action_id": { "type": "string", "description": t("Optional action ID from devcleaner_list_caches; defaults to the first action") }
                },
                "required": ["provider_id"]
            }
        }),
        json!({
            "name": "devcleaner_system_scan",
            "description": "Scans Windows C: drive system cleanup categories (temp folders, Prefetch, Windows Update leftovers, Recycle Bin, etc.) and reports measured sizes.",
            "annotations": tool_annotations("Scan C: System Cleaner", true, false, true),
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "devcleaner_system_preview",
            "description": "Validates selected C: system cleanup action IDs or profile (quick/standard/deep) and returns a single-use token for devcleaner_system_execute. Never deletes anything.",
            "annotations": tool_annotations("Preview C: System Cleanup", true, false, true),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action_ids": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Action IDs from devcleaner_system_scan (e.g. ['userTemp','windowsUpdate'])."
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
            "name": "devcleaner_get_history",
            "description": t("Lists past cleanup and audit records performed by Dev Cleaner."),
            "annotations": tool_annotations("Read Cleanup History", true, false, true),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": { "type": "number", "description": t("Number of records to list (default: 10)") }
                }
            }
        }),
        json!({
            "name": "devcleaner_inspect_target",
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
            "name": "devcleaner_clean_cache",
            "description": "Executes a previewed developer tool cache cleanup via official CLI command. Call devcleaner_preview_cache first to obtain preview_token. Destructive: requires preview_token, confirm:true, --allow-destructive and the MCP destructive setting.",
            "annotations": tool_annotations("Clean Tool Cache", false, true, false),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "preview_token": { "type": "string", "description": "Single-use preview_token returned by devcleaner_preview_cache." },
                    "confirm": { "type": "boolean", "description": t("Must be true; proves the caller intentionally requests cache deletion") }
                },
                "required": ["preview_token", "confirm"]
            }
        }));
        tools.push(json!({
            "name": "devcleaner_execute_cleanup",
            "description": t("Executes a previously previewed cleanup plan. Requires confirm:true, a single-use token, the --allow-destructive flag and the MCP destructive setting."),
            "annotations": tool_annotations("Execute Workspace Cleanup", false, true, false),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "token": { "type": "string", "description": t("Single-use token returned by devcleaner_preview_cleanup") },
                    "confirm": { "type": "boolean", "description": t("Must be true; proves the caller saw the preview") }
                },
                "required": ["token", "confirm"]
            }
        }));
        tools.push(json!({
            "name": "devcleaner_system_execute",
            "description": "Executes a previewed C: system cleanup plan. Call devcleaner_system_preview first to obtain a single-use token. Destructive: requires token, confirm:true, --allow-destructive and the MCP destructive setting.",
            "annotations": tool_annotations("Execute C: System Cleanup", false, true, false),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "token": { "type": "string", "description": "Single-use token returned by devcleaner_system_preview." },
                    "confirm": { "type": "boolean", "description": "Must be true; proves the caller saw the preview." }
                },
                "required": ["token", "confirm"]
            }
        }));
    }

    tools
}

fn negotiate_protocol_version(params: Option<&Value>) -> &'static str {
    match params
        .and_then(|p| p.get("protocolVersion"))
        .and_then(|v| v.as_str())
    {
        Some("2024-11-05") => "2024-11-05",
        Some("2025-03-26") => "2025-03-26",
        _ => "2025-03-26",
    }
}

fn handle_mcp_message(req: &JsonRpcRequest, id_present: bool, ctx: &McpContext) -> Option<Value> {
    // Notifications have no `id` member at all. A present-but-null id is an
    // invalid request, not a notification.
    if !id_present {
        return None;
    }
    let Some(id) = req.id.clone() else {
        return Some(json!({
            "jsonrpc": "2.0",
            "id": Value::Null,
            "error": {
                "code": -32600,
                "message": t("Invalid Request: id must be a string or number")
            }
        }));
    };

    match req.method.as_str() {
        "initialize" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": negotiate_protocol_version(req.params.as_ref()),
                "serverInfo": {
                    "name": "dev-cleaner-mcp",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": { "tools": {} }
            }
        })),
        "notifications/initialized" | "notifications/cancelled" => None,
        "ping" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {}
        })),
        "tools/list" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "tools": tool_definitions(ctx.options.allow_destructive) }
        })),
        "tools/call" => {
            let params = req.params.as_ref();
            let tool_name = params
                .and_then(|p| p.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("");
            let args = params
                .and_then(|p| p.get("arguments"))
                .cloned()
                .unwrap_or(json!({}));
            let output = ctx.execute_tool(tool_name, &args);
            Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "content": [ { "type": "text", "text": output.text } ],
                    // MCP 2025-06-18: tool execution failures are reported
                    // inside the result with `isError: true`, not as a
                    // JSON-RPC error.
                    "isError": output.is_error
                }
            }))
        }
        _ => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32601,
                "message": t("Method not found")
            }
        })),
    }
}

/// Terminal state of a cleanup report.
///
/// `success` used to be hard-coded even when every target failed, which made
/// agents report a partially failed deletion as a win.
fn cleanup_status(cancelled: bool, error_count: u64, success_count: u64) -> &'static str {
    if cancelled {
        "cancelled"
    } else if error_count == 0 {
        "success"
    } else if success_count > 0 {
        "partial"
    } else {
        "failed"
    }
}

fn format_size(bytes: u64) -> String {
    crate::format::human_bytes(bytes)
}

fn parse_scope(scope: &str) -> Option<ScanScope> {
    match scope {
        "projects" | "project" => Some(ScanScope::Project),
        "agents" => Some(ScanScope::Agents),
        "all" => Some(ScanScope::AllDrives),
        // Projects and agent storage in one session, matching the GUI action.
        "combined" => Some(ScanScope::Combined),
        // Package caches are not a scan scope: `devcleaner_list_caches` and
        // `devcleaner_clean_cache` own that flow.
        _ => None,
    }
}

fn parse_target_ids(args: &Value) -> Vec<String> {
    if let Some(arr) = args.get("target_ids").and_then(|a| a.as_array()) {
        arr.iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect()
    } else if let Some(id) = args.get("target_id").and_then(|i| i.as_str()) {
        vec![id.to_string()]
    } else {
        Vec::new()
    }
}

fn audit_record(
    plan: &CleanupPlan,
    report: &crate::cleanup::CleanupReport,
) -> crate::audit::AuditRecord {
    crate::audit::AuditRecord {
        id: format!("h-{}", uuid::Uuid::new_v4().simple()),
        timestamp: report.finished_at.clone(),
        session_id: plan.session_id.clone(),
        plan_id: plan.id.clone(),
        mode: report.mode,
        success_count: report.success_count,
        error_count: report.error_count,
        reclaim_bytes: report.reclaim_bytes,
        moved_bytes: report.moved_bytes,
        duration_ms: report.duration_ms,
        entries: report
            .results
            .iter()
            .map(|r| crate::audit::AuditEntry {
                target_id: r.target_id.clone(),
                rule_id: r.rule_id.clone(),
                path: r.display_path.clone(),
                success: r.success,
                verified: r.verified,
                error_code: r.error_code.clone(),
                bytes: r.measured_bytes,
            })
            .collect(),
        cancelled: report.cancelled,
        processed_count: report.processed_count,
        skipped_count: report.skipped_count,
    }
}

impl McpContext {
    /// Test/embedding entry point. Production traffic goes through
    /// `run_mcp_server_with`, but integration tests need several calls to share
    /// one grant store (preview, execute, replay).
    #[doc(hidden)]
    pub fn call_tool(&self, name: &str, args: &Value) -> String {
        self.execute_tool(name, args).text
    }

    /// Structured variant used by tests that assert the `isError` signal.
    #[doc(hidden)]
    pub fn call_tool_output(&self, name: &str, args: &Value) -> ToolCallOutput {
        self.execute_tool(name, args)
    }

    /// Ages every outstanding preview grant so expiry can be tested without
    /// sleeping for the real five-minute TTL.
    #[doc(hidden)]
    pub fn age_grants_for_test(&self, age: Duration) {
        let now = Instant::now();
        let older = now.checked_sub(age).unwrap_or(now);
        for grant in self.grants().values_mut() {
            grant.created = older;
        }
    }

    fn execute_tool(&self, name: &str, args: &Value) -> ToolCallOutput {
        match name {
            "devcleaner_list_caches" => self.list_caches(),
            "devcleaner_preview_cache" => self.preview_cache(args),
            "devcleaner_clean_cache" => self.clean_cache(args),
            "devcleaner_system_scan" => self.system_scan(),
            "devcleaner_system_preview" => self.system_preview(args),
            "devcleaner_system_execute" => self.system_execute(args),
            "devcleaner_scan_workspace" => self.scan_workspace(args),
            "devcleaner_preview_cleanup" | "devcleaner_clean_safe" => self.preview_cleanup(args),
            "devcleaner_execute_cleanup" => self.execute_cleanup(args),
            "devcleaner_get_history" => {
                let limit = args.get("limit").and_then(|l| l.as_u64()).unwrap_or(10) as usize;
                let state = mcp_state();
                let records = state.audit.list_records(limit);
                ToolCallOutput::ok(serde_json::to_string_pretty(&records).unwrap_or_default())
            }
            "devcleaner_inspect_target" => self.inspect_target(args),
            _ => ToolCallOutput::error(tf("Unknown tool: {}", &[&name])),
        }
    }

    fn list_caches(&self) -> ToolCallOutput {
        let mut providers = crate::cleanup::official_actions::list_cache_providers();
        let detected_ids: Vec<String> = providers
            .iter()
            .filter(|p| p.detected)
            .map(|p| p.id.clone())
            .collect();
        let token = CancellationToken::new();
        let mut totals: HashMap<String, u64> = HashMap::new();
        if !detected_ids.is_empty() {
            crate::cleanup::official_actions::measure_cache_providers(
                &token,
                Some(&detected_ids),
                |event| {
                    if let crate::cleanup::official_actions::CacheMeasureEvent::ProviderFinished {
                        provider_id,
                        total_bytes,
                    } = event
                    {
                        totals.insert(provider_id, total_bytes);
                    }
                },
            );
        }

        let mut total_measured_bytes = 0u64;
        let items: Vec<Value> = providers
            .drain(..)
            .map(|p| {
                let measured = totals
                    .get(&p.id)
                    .copied()
                    .or_else(|| p.measured.then_some(p.total_bytes));
                if let Some(b) = measured {
                    total_measured_bytes = total_measured_bytes.saturating_add(b);
                }
                let actions: Vec<Value> = p
                    .actions
                    .iter()
                    .map(|a| {
                        let cmd = a.executable.as_deref().map(|exe| {
                            if a.args.is_empty() {
                                exe.to_string()
                            } else {
                                format!("{} {}", exe, a.args.join(" "))
                            }
                        });
                        json!({
                            "action_id": a.id,
                            "label": a.label,
                            "command": cmd,
                            "available": a.available,
                        })
                    })
                    .collect();
                json!({
                    "provider_id": p.id,
                    "name": p.name,
                    "detected": p.detected,
                    "version": p.version,
                    "measured_bytes": measured,
                    "measured_human": measured.map(format_size),
                    "actions": actions,
                })
            })
            .collect();

        let payload = json!({
            "provider_count": items.len(),
            "detected_count": detected_ids.len(),
            "total_measured_bytes": total_measured_bytes,
            "total_measured_human": format_size(total_measured_bytes),
            "providers": items,
        });
        ToolCallOutput::ok(serde_json::to_string_pretty(&payload).unwrap_or_default())
    }

    fn preview_cache(&self, args: &Value) -> ToolCallOutput {
        let provider_id = args
            .get("provider_id")
            .and_then(|p| p.as_str())
            .unwrap_or("");
        if provider_id.is_empty() {
            return ToolCallOutput::error(t(
                "Error: 'provider_id' parameter is required (e.g. 'npm', 'pip', 'cargo').",
            ));
        }

        let providers = crate::cleanup::official_actions::list_cache_providers();
        let Some(p) = providers
            .iter()
            .find(|p| p.id.eq_ignore_ascii_case(provider_id))
        else {
            return ToolCallOutput::error(tf(
                "Unknown provider ID: '{}'. Use 'devcleaner_list_caches' to list available providers.",
                &[&provider_id],
            ));
        };
        if !p.detected {
            return ToolCallOutput::error(tf(
                "Tool cache could not be cleaned: '{}' is not installed.",
                &[&p.name],
            ));
        }
        if p.actions.is_empty() {
            return ToolCallOutput::error(tf(
                "No official CLI cleanup command is defined for '{}'.",
                &[&p.name],
            ));
        }

        let action_id = args.get("action_id").and_then(|a| a.as_str()).unwrap_or("");
        let action = if action_id.is_empty() {
            &p.actions[0]
        } else {
            match p
                .actions
                .iter()
                .find(|a| a.id.eq_ignore_ascii_case(action_id))
            {
                Some(action) => action,
                None => {
                    let available = p
                        .actions
                        .iter()
                        .map(|a| a.id.as_str())
                        .collect::<Vec<_>>()
                        .join(", ");
                    return ToolCallOutput::error(tf(
                        "Unknown action '{}' for '{}'. Available actions: {}",
                        &[&action_id, &p.name, &available],
                    ));
                }
            }
        };

        let token = CancellationToken::new();
        match crate::cleanup::official_actions::preview_action(
            &self.cache_registry,
            &p.id,
            &action.id,
            &token,
        ) {
            Ok(preview) => {
                let command_display = if preview.args.is_empty() {
                    preview.executable.clone()
                } else {
                    format!("{} {}", preview.executable, preview.args.join(" "))
                };
                let payload = json!({
                    "status": "preview",
                    "preview_token": preview.token,
                    "provider_id": preview.provider_id,
                    "action_id": preview.action_id,
                    "label": action.label,
                    "command": command_display,
                    "before_bytes": preview.before_bytes,
                    "before_human": format_size(preview.before_bytes),
                    "before_truncated": preview.measurement_truncated,
                    "expires_in_seconds": PREVIEW_TTL.as_secs(),
                    "next_step": "Call devcleaner_clean_cache with preview_token and confirm:true."
                });
                ToolCallOutput::ok(serde_json::to_string_pretty(&payload).unwrap_or_default())
            }
            Err(e) => {
                ToolCallOutput::error(tf("Failed to create action preview: {}", &[&e.to_string()]))
            }
        }
    }

    fn clean_cache(&self, args: &Value) -> ToolCallOutput {
        if !self.options.allow_destructive {
            return ToolCallOutput::error(t(
                "Blocked: the MCP server was not started with --allow-destructive.",
            ));
        }
        let confirm = args
            .get("confirm")
            .and_then(|c| c.as_bool())
            .unwrap_or(false);
        if !confirm {
            return ToolCallOutput::error(t(
                "Blocked: 'confirm' must be true. Run devcleaner_preview_cache and ask the user first.",
            ));
        }
        let state = mcp_state();
        if !state.settings.load().mcp_allow_destructive {
            return ToolCallOutput::error(t(
                "Blocked: MCP destructive actions are disabled in Settings → Safety & Policy → AI agent policy.",
            ));
        }

        let preview_token = args
            .get("preview_token")
            .or_else(|| args.get("token"))
            .and_then(|t| t.as_str())
            .unwrap_or("");
        if preview_token.is_empty() {
            return ToolCallOutput::error(
                "Error: 'preview_token' is required. Call devcleaner_preview_cache first with provider_id (and optional action_id) to obtain a preview_token.",
            );
        }

        match crate::cleanup::official_actions::execute_action(&self.cache_registry, preview_token)
        {
            Ok(res) => {
                if state.settings.load().history_enabled {
                    let record = crate::audit::ActionAuditRecord {
                        id: format!("a-{}", uuid::Uuid::new_v4().simple()),
                        timestamp: chrono::Local::now().to_rfc3339(),
                        provider_id: res.provider_id.clone(),
                        action_id: res.action_id.clone(),
                        label: res.label.clone(),
                        success: res.success,
                        exit_code: res.exit_code,
                        before_bytes: res.before_bytes,
                        after_bytes: res.after_bytes,
                        delta_bytes: res.delta_bytes,
                        duration_ms: res.duration_ms,
                    };
                    if let Err(err) = state.audit.append_action(&record) {
                        crate::logging::warn("could not record the MCP cache action audit", err);
                    }
                }
                let reclaimed = res.before_bytes.saturating_sub(res.after_bytes);
                let payload = json!({
                    "status": if res.success { "success" } else { "failed" },
                    "provider_id": res.provider_id,
                    "action_id": res.action_id,
                    "reclaimed_bytes": reclaimed,
                    "reclaimed_human": format_size(reclaimed),
                    "before_bytes": res.before_bytes,
                    "after_bytes": res.after_bytes,
                    "exit_code": res.exit_code,
                });
                let text = serde_json::to_string_pretty(&payload).unwrap_or_default();
                if res.success {
                    ToolCallOutput::ok(text)
                } else {
                    ToolCallOutput::error(text)
                }
            }
            Err(e) => {
                ToolCallOutput::error(tf("Error executing cleanup command: {}", &[&e.to_string()]))
            }
        }
    }

    fn system_scan(&self) -> ToolCallOutput {
        let elevated = crate::platform::is_elevated();
        let token = CancellationToken::new();
        let outcome = crate::system_cleaner::measure::scan(elevated, &token);
        let total: u64 = outcome
            .actions
            .iter()
            .filter(|a| a.measured)
            .fold(0u64, |sum, a| sum.saturating_add(a.bytes));
        let payload = json!({
            "elevated": elevated,
            "total_bytes": total,
            "total_human": format_size(total),
            "actions": outcome.actions,
            "warnings": outcome.warnings,
        });
        ToolCallOutput::ok(serde_json::to_string_pretty(&payload).unwrap_or_default())
    }

    fn system_preview(&self, args: &Value) -> ToolCallOutput {
        let mut ids: Vec<crate::system_cleaner::SystemActionId> = Vec::new();
        if let Some(arr) = args.get("action_ids").and_then(|v| v.as_array()) {
            for entry in arr {
                let Some(raw) = entry.as_str() else { continue };
                let Some(parsed) = crate::system_cleaner::SystemActionId::parse(raw) else {
                    return ToolCallOutput::error(format!("Unknown system action_id '{raw}'."));
                };
                if !ids.contains(&parsed) {
                    ids.push(parsed);
                }
            }
        } else if let Some(profile) = args.get("profile").and_then(|v| v.as_str()) {
            let lower = profile.to_lowercase();
            if !matches!(lower.as_str(), "quick" | "standard" | "deep") {
                return ToolCallOutput::error(format!(
                    "Unknown system profile '{profile}'; use quick, standard, or deep."
                ));
            }
            ids = crate::system_cleaner::profile_actions(&lower);
        }

        if ids.is_empty() {
            return ToolCallOutput::error(
                "Error: provide 'action_ids' (e.g. ['userTemp']) or 'profile' ('quick'|'standard'|'deep').",
            );
        }

        let elevated = crate::platform::is_elevated();
        let requires_admin = ids
            .iter()
            .any(|id| crate::system_cleaner::actions::spec(*id).requires_admin);
        if requires_admin && !elevated {
            return ToolCallOutput::error(
                "Blocked: selected system actions require administrator privileges.",
            );
        }

        let token = CancellationToken::new();
        let actions = crate::system_cleaner::measure::measure_actions(&ids, elevated, &token);
        let total: u64 = actions
            .iter()
            .fold(0u64, |sum, a| sum.saturating_add(a.bytes));
        let preview_token = format!("sys-{}", uuid::Uuid::new_v4().simple());

        {
            let mut grants = self.system_grants();
            make_room_for_system_grant(&mut grants);
            grants.insert(
                preview_token.clone(),
                SystemPreviewGrant {
                    ids,
                    created: Instant::now(),
                },
            );
        }

        let payload = json!({
            "status": "preview",
            "token": preview_token,
            "elevated": elevated,
            "requires_admin": requires_admin,
            "total_bytes": total,
            "total_human": format_size(total),
            "expires_in_seconds": PREVIEW_TTL.as_secs(),
            "actions": actions,
            "next_step": "Call devcleaner_system_execute with this token and confirm:true."
        });
        ToolCallOutput::ok(serde_json::to_string_pretty(&payload).unwrap_or_default())
    }

    fn system_execute(&self, args: &Value) -> ToolCallOutput {
        let confirm = args
            .get("confirm")
            .and_then(|c| c.as_bool())
            .unwrap_or(false);
        if !confirm {
            return ToolCallOutput::error(t(
                "Blocked: 'confirm' must be true. Run devcleaner_system_preview first.",
            ));
        }
        if !self.options.allow_destructive {
            return ToolCallOutput::error(t(
                "Blocked: the MCP server was not started with --allow-destructive.",
            ));
        }
        let token = match args.get("token").and_then(|t| t.as_str()) {
            Some(t) if !t.is_empty() => t.to_string(),
            _ => return ToolCallOutput::error(t("Error: 'token' is required.")),
        };
        let state = mcp_state();
        let settings = state.settings.load();
        if !settings.mcp_allow_destructive {
            return ToolCallOutput::error(t(
                "Blocked: MCP destructive actions are disabled in Settings → Safety & Policy → AI agent policy.",
            ));
        }

        let Some(grant) = self.system_grants().remove(&token) else {
            return ToolCallOutput::error(t("PlanInvalid: unknown or already used system token."));
        };
        if grant.created.elapsed() > PREVIEW_TTL {
            return ToolCallOutput::error(t(
                "PlanExpired: the system preview token has expired. Run devcleaner_system_preview again.",
            ));
        }

        let elevated = crate::platform::is_elevated();
        let cancel = CancellationToken::new();
        let report = crate::system_cleaner::execute::execute(&grant.ids, elevated, &cancel, |_| {});
        crate::system_cleaner::execute::record_audit(
            &state.audit,
            &report,
            settings.history_enabled,
        );

        let any_failed = report.results.iter().any(|r| !r.success);
        let text = serde_json::to_string_pretty(&report).unwrap_or_default();
        if any_failed {
            ToolCallOutput::error(text)
        } else {
            ToolCallOutput::ok(text)
        }
    }

    fn scan_workspace(&self, args: &Value) -> ToolCallOutput {
        let path_str = args.get("path").and_then(|p| p.as_str()).unwrap_or(".");
        let min_size_mb = args
            .get("min_size_mb")
            .and_then(|m| m.as_u64())
            .unwrap_or(0);

        let mut want_projects = false;
        let mut want_agents = false;
        let mut want_caches = false;
        let mut want_system = false;
        let mut want_all_drives = false;
        let mut scope_label = args
            .get("scope")
            .and_then(|s| s.as_str())
            .unwrap_or("projects")
            .to_string();

        if let Some(arr) = args.get("targets").and_then(|v| v.as_array()) {
            let mut labels = Vec::new();
            for item in arr {
                let Some(tok) = item.as_str() else { continue };
                match tok.to_lowercase().as_str() {
                    "p" | "project" | "projects" => {
                        want_projects = true;
                        labels.push("projects");
                    }
                    "a" | "agent" | "agents" => {
                        want_agents = true;
                        labels.push("agents");
                    }
                    "c" | "cache" | "caches" => {
                        want_caches = true;
                        labels.push("caches");
                    }
                    "s" | "sys" | "system" => {
                        want_system = true;
                        labels.push("system");
                    }
                    "drives" | "all-drives" => {
                        want_projects = true;
                        want_all_drives = true;
                        labels.push("drives");
                    }
                    "all" => {
                        want_projects = true;
                        want_agents = true;
                        want_caches = true;
                        want_system = true;
                        labels.push("all");
                    }
                    other => {
                        return ToolCallOutput::error(format!(
                            "Error: unknown target '{other}'. Use 'projects', 'agents', 'caches', 'system', 'drives' or 'all'."
                        ));
                    }
                }
            }
            if !labels.is_empty() {
                scope_label = labels.join(",");
            }
        } else {
            match parse_scope(&scope_label) {
                Some(ScanScope::Project) => want_projects = true,
                Some(ScanScope::Agents) => want_agents = true,
                Some(ScanScope::Combined) => {
                    want_projects = true;
                    want_agents = true;
                }
                Some(ScanScope::AllDrives) => {
                    want_projects = true;
                    want_all_drives = true;
                }
                _ => {
                    return ToolCallOutput::error(tf(
                        "Error: unknown scope '{}'. Use 'projects', 'agents', 'combined' or 'all'.",
                        &[&scope_label],
                    ))
                }
            }
        }

        let scanner_scope = if want_all_drives {
            Some(ScanScope::AllDrives)
        } else if want_projects && want_agents {
            Some(ScanScope::Combined)
        } else if want_projects {
            Some(ScanScope::Project)
        } else if want_agents {
            Some(ScanScope::Agents)
        } else {
            None
        };

        let caches_payload = if want_caches {
            serde_json::from_str::<Value>(&self.list_caches().text).ok()
        } else {
            None
        };
        let system_payload = if want_system {
            serde_json::from_str::<Value>(&self.system_scan().text).ok()
        } else {
            None
        };

        let Some(scope) = scanner_scope else {
            let payload = json!({
                "path": path_str,
                "scope": scope_label,
                "caches": caches_payload,
                "system": system_payload,
            });
            return ToolCallOutput::ok(serde_json::to_string_pretty(&payload).unwrap_or_default());
        };

        // Saturating: `min_size_mb` is untrusted JSON-RPC input, and a value
        // near `u64::MAX` wrapped around to a tiny threshold (in release) or
        // panicked (in debug) instead of meaning "no small rows".
        let min_bytes = min_size_mb.saturating_mul(1024 * 1024);

        let state = mcp_state();
        let catalog = match state.catalog() {
            Ok(idx) => idx,
            Err(err) => return ToolCallOutput::error(format!("Failed to load catalog: {err}")),
        };
        let settings = state.settings.load();
        let policy = crate::cleanup::CleanupPolicy::from(&settings);
        let request = crate::scanner::models::ScanRequest {
            root_path: path_str.to_string(),
            exclusions: Vec::new(),
            scope,
            include_agents: Some(want_agents),
            profile: None,
            max_depth: None,
            max_candidates: None,
            timeout_minutes: None,
            // `None` lets the backend apply the user's saved threshold; an
            // explicit agent value wins only when it is non-zero.
            min_size_bytes: if min_bytes > 0 { Some(min_bytes) } else { None },
            protected_paths: Vec::new(),
        };

        // H3: discovery alone never measured anything, so every row in the MCP
        // response was "0 B" and `min_size_mb` could never match. Use the same
        // full scan (discovery + measurement) as the desktop app.
        let (summary, scanned) =
            match crate::scanner::run_scan_blocking(request, catalog, &settings, &policy) {
                Ok(found) => found,
                Err(err) => return ToolCallOutput::error(format!("Scan error: {err}")),
            };

        let items = scanned.items.clone();
        let cleanable = |it: &crate::scanner::models::CleanupItem| {
            it.selectable && !it.protected && it.safety_class != crate::catalog::SafetyClass::Keep
        };
        let filtered_items: Vec<_> = items
            .iter()
            .filter(|it| {
                cleanable(it)
                    && (min_bytes == 0
                        || it.estimated_reclaim_bytes.is_some_and(|b| b >= min_bytes))
            })
            .collect();

        let filtered_owned: Vec<crate::scanner::models::CleanupItem> =
            filtered_items.iter().map(|it| (*it).clone()).collect();
        let own = crate::scanner::own_bytes(&filtered_owned);
        let total_bytes = filtered_items.iter().fold(0u64, |sum, item| {
            let bytes = own
                .get(&item.id)
                .map(|(_, allocated)| *allocated)
                .unwrap_or_else(|| item.estimated_reclaim_bytes.unwrap_or(0));
            sum.saturating_add(bytes)
        });

        // Token bloat protection: detail the top 25, summarize the rest.
        let mut sorted = filtered_items.clone();
        sorted.sort_by_key(|it| std::cmp::Reverse(it.estimated_reclaim_bytes.unwrap_or(0)));
        let top_items: Vec<_> = sorted.into_iter().take(25).collect();

        let formatted_targets: Vec<_> = top_items
            .iter()
            .map(|it| {
                json!({
                    "target_id": it.id,
                    "name": it.display_name,
                    "path": it.display_path,
                    "category": it.category,
                    "safety": it.safety_class,
                    "measured": it.logical_bytes.is_some(),
                    // Never claim an unreadable target is 0 B: null lets the
                    // agent distinguish "empty" from "could not read".
                    "bytes": it.estimated_reclaim_bytes,
                    "human": it.estimated_reclaim_bytes.map(format_size),
                    "status": it.status,
                    "warnings": it.warning_codes,
                })
            })
            .collect();

        let scan_id = scanned.id.clone();
        let session = Arc::new(scanned);
        {
            // L10: the MCP server is long-lived; expire and cap the remembered
            // scans instead of growing the map for the life of the process.
            let mut scans = self.scans();
            make_room_for_scan(&mut scans);
            scans.insert(
                scan_id.clone(),
                StoredScan {
                    session,
                    created: Instant::now(),
                },
            );
        }

        let mut payload = json!({
            "scan_id": scan_id,
            "path": path_str,
            "scope": scope_label,
            "total_targets_found": items.len(),
            "measured_targets": filtered_items.iter().filter(|it| it.logical_bytes.is_some()).count(),
            "total_reclaimable_bytes": total_bytes,
            "total_reclaimable_human": format_size(total_bytes),
            "cleanable_bytes": summary.cleanable_bytes,
            "items_truncated": filtered_items.len() > 25,
            "items": formatted_targets
        });
        if let Some(obj) = payload.as_object_mut() {
            if let Some(caches) = caches_payload {
                obj.insert("caches".to_string(), caches);
            }
            if let Some(system) = system_payload {
                obj.insert("system".to_string(), system);
            }
        }
        ToolCallOutput::ok(serde_json::to_string_pretty(&payload).unwrap_or_default())
    }

    fn preview_cleanup(&self, args: &Value) -> ToolCallOutput {
        let target_ids = parse_target_ids(args);
        if target_ids.is_empty() {
            return ToolCallOutput::error(t("Error: At least one 'target_id' must be provided."));
        }

        let state = mcp_state();
        let catalog = match state.catalog() {
            Ok(idx) => idx,
            Err(e) => return ToolCallOutput::error(format!("Failed to load catalog: {e}")),
        };
        let settings = state.settings.load();
        let policy = crate::cleanup::CleanupPolicy::from(&settings);

        // Prefer the session created by `devcleaner_scan_workspace`: discovery
        // generates fresh IDs on every run, so re-scanning here could never
        // resolve the IDs the agent received from the scan.
        let requested_scan = args.get("scan_id").and_then(|s| s.as_str());
        let stored = {
            let scans = self.scans();
            match requested_scan {
                // L10: an unknown/expired explicit scan id must not silently
                // fall back to scanning some other path with the wrong scope.
                Some(id) => match scans.get(id) {
                    Some(scan) if scan.created.elapsed() <= crate::scanner::session::SESSION_TTL => {
                        Some((scan.session.clone(), scan.created))
                    }
                    _ => {
                        return ToolCallOutput::error(format!(
                            "PlanInvalid: unknown or expired scan_id '{}'. Run devcleaner_scan_workspace again.",
                            id
                        ))
                    }
                },
                None => scans
                    .values()
                    .filter(|s| s.created.elapsed() <= crate::scanner::session::SESSION_TTL)
                    .find(|s| {
                        target_ids
                            .iter()
                            .all(|id| s.session.targets.contains_key(id))
                    })
                    .map(|s| (s.session.clone(), s.created)),
            }
        };

        let session = match stored {
            Some((session, _)) => session,
            None => {
                let path_str = args.get("path").and_then(|p| p.as_str()).unwrap_or(".");
                let request = crate::scanner::models::ScanRequest {
                    root_path: path_str.to_string(),
                    exclusions: Vec::new(),
                    scope: ScanScope::Project,
                    include_agents: None,
                    profile: None,
                    max_depth: None,
                    max_candidates: None,
                    timeout_minutes: None,
                    min_size_bytes: None,
                    protected_paths: Vec::new(),
                };
                match crate::scanner::run_scan_blocking(
                    request,
                    catalog.clone(),
                    &settings,
                    &policy,
                ) {
                    Ok((_, scanned)) => Arc::new(scanned),
                    Err(e) => {
                        return ToolCallOutput::error(format!("Verification scan error: {e}"))
                    }
                }
            }
        };

        // `run_scan_blocking` already measured every target. Keep this cheap
        // fallback for targets that were unreadable during the scan (for
        // example when the scan deadline expired) so a preview is still
        // possible without ever inventing a 0 B size.
        let mut session = (*session).clone();
        let measure_token = CancellationToken::new();
        for id in &target_ids {
            if let Some(target) = session.targets.get_mut(id) {
                if target.logical_bytes.is_none() {
                    if let Some(size) = crate::scanner::measurement::measure_path(
                        &target.path,
                        target.kind,
                        &measure_token,
                    ) {
                        target.logical_bytes = Some(size.logical_bytes);
                        target.allocated_bytes = size.allocated_bytes;
                    }
                }
            }
        }
        let session = Arc::new(session);

        match crate::cleanup::build_plan(
            &session,
            &target_ids,
            DeleteMode::RecycleBin,
            &catalog,
            &policy,
        ) {
            Ok(plan) => {
                let token = plan.confirmation_token.clone();
                let items_json: Vec<_> = plan
                    .items
                    .iter()
                    .map(|item| {
                        json!({
                            "target_id": item.target_id,
                            "name": item.display_name,
                            "path": item.display_path,
                            "safety": item.safety_class,
                            "eligible": item.eligible,
                            "blocked_code": item.blocked_code,
                            "bytes": item.estimated_reclaim_bytes,
                            "human": format_size(item.estimated_reclaim_bytes),
                        })
                    })
                    .collect();
                let payload = json!({
                    "status": "preview",
                    "token": token,
                    "plan_id": plan.id,
                    "expires_in_seconds": PREVIEW_TTL.as_secs(),
                    "eligible_count": plan.eligible_count,
                    "blocked_count": plan.blocked_count,
                    "total_estimated_bytes": plan.total_estimated_bytes,
                    "total_estimated_human": format_size(plan.total_estimated_bytes),
                    "destination": "Windows Recycle Bin (zero data loss)",
                    "items": items_json,
                    "next_step": "Call devcleaner_execute_cleanup with this token and confirm:true (requires --allow-destructive and the MCP setting)."
                });

                {
                    let mut grants = self.grants();
                    make_room_for_grant(&mut grants);
                    grants.insert(
                        token,
                        PreviewGrant {
                            plan,
                            session,
                            created: Instant::now(),
                        },
                    );
                }
                ToolCallOutput::ok(serde_json::to_string_pretty(&payload).unwrap_or_default())
            }
            Err(e) => ToolCallOutput::error(format!(
                "Failed to build cleanup plan (targets not found or unsafe): {e}"
            )),
        }
    }

    fn execute_cleanup(&self, args: &Value) -> ToolCallOutput {
        let confirm = args
            .get("confirm")
            .and_then(|c| c.as_bool())
            .unwrap_or(false);
        if !confirm {
            return ToolCallOutput::error(t(
                "Blocked: 'confirm' must be true. Preview the plan first.",
            ));
        }
        if !self.options.allow_destructive {
            return ToolCallOutput::error(t(
                "Blocked: the MCP server was not started with --allow-destructive.",
            ));
        }

        let token = match args.get("token").and_then(|t| t.as_str()) {
            Some(token) if !token.is_empty() => token.to_string(),
            _ => return ToolCallOutput::error(t("Error: 'token' is required.")),
        };

        let state = mcp_state();
        let settings = state.settings.load();
        if !settings.mcp_allow_destructive {
            return ToolCallOutput::error(t(
                "Blocked: MCP destructive actions are disabled in Settings → Safety & Policy → AI agent policy.",
            ));
        }

        // Remove first: a token is single-use even if execution later fails.
        let Some(grant) = self.grants().remove(&token) else {
            return ToolCallOutput::error(t("PlanInvalid: unknown or already used preview token."));
        };
        if grant.created.elapsed() > PREVIEW_TTL || grant.plan.is_expired() {
            return ToolCallOutput::error(t(
                "PlanExpired: the preview token has expired. Run preview again.",
            ));
        }

        let catalog = match state.catalog() {
            Ok(idx) => idx,
            Err(e) => return ToolCallOutput::error(format!("Failed to load catalog: {e}")),
        };
        let policy = crate::cleanup::CleanupPolicy::from(&settings);
        let confirmation = grant.plan.confirmation_token.clone();
        let token_handle = CancellationToken::new();

        match crate::cleanup::execute_plan(
            &grant.plan,
            &grant.session,
            &catalog,
            &policy,
            &confirmation,
            false,
            &token_handle,
        ) {
            Ok(report) => {
                let audit_entry = audit_record(&grant.plan, &report);
                // Losing the audit trail must be visible to the caller; the
                // GUI reports the same condition as `auditError`.
                let audit_error = state
                    .audit
                    .append_record(&audit_entry)
                    .err()
                    .map(|err| err.to_string());

                // A run with per-target failures is not a success. Cancellation
                // is its own terminal state: the user asked for it, and calling
                // it "failed" would hide the fact that a stop was requested.
                let status =
                    cleanup_status(report.cancelled, report.error_count, report.success_count);

                let payload = json!({
                    "status": status,
                    "cancelled": report.cancelled,
                    "success_count": report.success_count,
                    "error_count": report.error_count,
                    "processed_count": report.processed_count,
                    "skipped_count": report.skipped_count,
                    "cleaned_targets_count": report.success_count,
                    // Recycle Bin moves do not free disk space; the honest
                    // number is `moved_bytes`. `reclaim_bytes` stays the
                    // permanent-delete figure (M6).
                    "moved_bytes": report.moved_bytes,
                    "moved_human": format_size(report.moved_bytes),
                    "reclaimed_bytes": report.reclaim_bytes,
                    "reclaimed_human": format_size(report.reclaim_bytes),
                    "mode": report.mode,
                    "destination": "Windows Recycle Bin (Zero data loss)",
                    "errors": report.results.iter().filter(|r| !r.success).map(|r| json!({
                        "path": r.display_path,
                        "error": r.error
                    })).collect::<Vec<_>>(),
                    "audit_error": audit_error
                });
                let text = serde_json::to_string_pretty(&payload).unwrap_or_default();
                if status == "success" {
                    ToolCallOutput::ok(text)
                } else {
                    ToolCallOutput::error(text)
                }
            }
            Err(e) => ToolCallOutput::error(format!("Cleanup execution failed: {e}")),
        }
    }

    fn inspect_target(&self, args: &Value) -> ToolCallOutput {
        let path_str = args.get("path").and_then(|p| p.as_str()).unwrap_or("");
        if path_str.is_empty() {
            return ToolCallOutput::error(t("Error: 'path' parameter is required."));
        }
        let target_path = PathBuf::from(path_str);
        let state = mcp_state();
        let catalog = match state.catalog() {
            Ok(idx) => idx,
            Err(e) => return ToolCallOutput::error(format!("Failed to load catalog: {e}")),
        };
        let settings = state.settings.load();

        let exists = target_path.exists();
        let is_symlink = target_path
            .symlink_metadata()
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false);
        let is_reparse = exists && crate::platform::is_reparse_point(&target_path);

        let hard_protected = target_path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(crate::safety::is_hard_protected_name);

        let path_guard_verdict: Result<String, String> = if !exists {
            Err("PathNotFound: target does not exist on disk.".to_string())
        } else if let Some(parent) = target_path.parent() {
            let scan_roots = vec![parent.to_path_buf()];
            let ctx = crate::safety::GuardContext {
                scan_roots: &scan_roots,
                protected_paths: &settings.protected_paths,
            };
            crate::safety::PathGuard::validate(&target_path, &ctx)
                .map(|canonical| canonical.to_string_lossy().to_string())
                .map_err(|err| err.to_string())
        } else {
            Err("UnsafeDeleteTarget: drive root cannot be deleted.".to_string())
        };

        let (protected, block_reason, canonical_path) = match path_guard_verdict {
            Ok(canonical) if hard_protected => (
                true,
                Some("HardProtected: target name is permanently protected.".to_string()),
                Some(canonical),
            ),
            Ok(canonical) if is_symlink || is_reparse => (
                true,
                Some("ReparsePoint: symlinks and junctions are never deleted.".to_string()),
                Some(canonical),
            ),
            Ok(canonical) => (false, None, Some(canonical)),
            Err(reason) => (true, Some(reason), None),
        };

        let evaluated = if exists && !protected {
            crate::scanner::discovery::evaluate_path(&catalog, &target_path)
        } else {
            None
        };
        let (matched_rule, classified_safety, warnings) = match evaluated {
            Some((rule_id, safety_class, eval_warnings)) => {
                (catalog.rule(&rule_id), Some(safety_class), eval_warnings)
            }
            None => (None, None, Vec::new()),
        };

        let keep_only = classified_safety == Some(crate::catalog::SafetyClass::Keep);
        let eligible = !protected && exists && matched_rule.is_some() && !keep_only;

        let payload = json!({
            "path": target_path.to_string_lossy(),
            "canonical_path": canonical_path,
            "exists": exists,
            "is_symlink": is_symlink,
            "is_reparse_point": is_reparse,
            "hard_protected": hard_protected,
            "protected": protected,
            "eligible": eligible,
            "classified_safety": classified_safety,
            "warnings": warnings,
            "block_reason": block_reason,
            "matched_rule": matched_rule.map(|r| json!({
                "id": r.id,
                "ecosystem": r.ecosystem,
                "category": r.category,
                "names": r.names,
                "safety": classified_safety.unwrap_or(r.safety),
                "regenerate": r.regenerate
            }))
        });
        ToolCallOutput::ok(serde_json::to_string_pretty(&payload).unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn preview_grant(created: Instant, token: &str) -> PreviewGrant {
        // A grant only needs an identity and an age: the retention rule never
        // inspects the plan or the session, and building a real scan for it
        // would test the scanner instead of the bookkeeping.
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
            // Later indices are newer, so the first five are the oldest.
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
            created,
        }
    }

    #[test]
    fn remembered_scans_stay_bounded_and_drop_the_oldest() {
        let now = Instant::now();
        let mut scans = HashMap::new();
        let total = MAX_STORED_SCANS + 4;
        for index in 0..total {
            // Later indices are newer, so the first four are the oldest.
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
        // The old `Option<Value>` parse treated `"id": null` as a notification
        // and silently sent nothing; JSON-RPC requires a response for a
        // present-but-null id.
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
        assert!(!names.contains(&"devcleaner_execute_cleanup"));
        assert!(!names.contains(&"devcleaner_clean_cache"));
        assert!(names.contains(&"devcleaner_preview_cleanup"));
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
        assert!(names.contains(&"devcleaner_execute_cleanup"));
        assert!(names.contains(&"devcleaner_clean_cache"));
    }

    #[test]
    fn clean_cache_requires_confirm_and_flag() {
        // Without the flag the destructive path is refused before it can even
        // look at the provider list.
        let response = call(
            McpOptions::default(),
            r#"{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"devcleaner_clean_cache","arguments":{"provider_id":"npm","confirm":true}}}"#,
        );
        let text = response["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("allow-destructive"));

        // With the flag but without explicit confirmation, it must refuse too.
        let response = call(
            McpOptions {
                allow_destructive: true,
            },
            r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"devcleaner_clean_cache","arguments":{"provider_id":"npm"}}}"#,
        );
        let text = response["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("confirm"));
    }

    #[test]
    fn execute_requires_confirm_and_flag() {
        let response = call(
            McpOptions::default(),
            r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"devcleaner_execute_cleanup","arguments":{"token":"x","confirm":true}}}"#,
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
        // Cancellation wins over per-target failures; the user asked to stop.
        assert_eq!(cleanup_status(true, 0, 1), "cancelled");
        assert_eq!(cleanup_status(true, 1, 0), "cancelled");
    }

    #[test]
    fn blocked_tools_call_reports_is_error() {
        let response = call(
            McpOptions::default(),
            r#"{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"devcleaner_execute_cleanup","arguments":{"token":"x","confirm":true}}}"#,
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
            r#"{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"devcleaner_missing","arguments":{}}}"#,
        );
        assert_eq!(response["result"]["isError"], serde_json::Value::Bool(true));
    }

    #[test]
    fn successful_listing_is_not_an_error() {
        let response = call(
            McpOptions::default(),
            r#"{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"devcleaner_list_caches","arguments":{}}}"#,
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

        let list = call(
            McpOptions {
                allow_destructive: true,
            },
            r#"{"jsonrpc":"2.0","id":13,"method":"tools/list"}"#,
        );
        let tools = list["result"]["tools"].as_array().unwrap();
        assert!(
            !tools.iter().any(|t| t["name"] == "devcleaner_clean_safe"),
            "deprecated devcleaner_clean_safe must not appear in tools/list"
        );
        assert!(tools
            .iter()
            .any(|t| t["name"] == "devcleaner_preview_cache"));
        assert!(tools.iter().any(|t| t["name"] == "devcleaner_system_scan"));
        assert!(tools
            .iter()
            .any(|t| t["name"] == "devcleaner_system_preview"));
        assert!(tools
            .iter()
            .any(|t| t["name"] == "devcleaner_system_execute"));
        for tool in tools {
            assert!(
                tool["annotations"]["readOnlyHint"].is_boolean(),
                "tool {} missing readOnlyHint annotation",
                tool["name"]
            );
        }
    }

    #[test]
    fn inspect_target_enforces_real_path_guard_on_system_paths() {
        let response = call(
            McpOptions::default(),
            r#"{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"devcleaner_inspect_target","arguments":{"path":"C:\\Windows\\System32"}}}"#,
        );
        assert_eq!(response["result"]["isError"], Value::Bool(false));
        let parsed: Value =
            serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap())
                .unwrap();
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
                    "name": "devcleaner_inspect_target",
                    "arguments": { "path": nm.to_string_lossy() }
                }
            })
            .to_string(),
        );
        let parsed: Value =
            serde_json::from_str(resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(parsed["eligible"], Value::Bool(true));
        assert_eq!(parsed["matched_rule"]["id"], "js.node_modules");

        // An unverified `target` directory with no Cargo.toml or pom.xml must
        // not falsely match Rust/Maven rules via bare name lookup.
        let bare = temp.path().join("random-folder").join("target");
        std::fs::create_dir_all(&bare).unwrap();
        let resp_bare = call(
            McpOptions::default(),
            &json!({
                "jsonrpc": "2.0",
                "id": 16,
                "method": "tools/call",
                "params": {
                    "name": "devcleaner_inspect_target",
                    "arguments": { "path": bare.to_string_lossy() }
                }
            })
            .to_string(),
        );
        let parsed_bare: Value =
            serde_json::from_str(resp_bare["result"]["content"][0]["text"].as_str().unwrap())
                .unwrap();
        assert_eq!(parsed_bare["eligible"], Value::Bool(false));
        assert!(parsed_bare["matched_rule"].is_null());
    }
}
