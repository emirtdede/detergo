use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::cleanup::CleanupPlan;
use crate::cli::i18n::{t, tf};
use crate::commands::AppState;
use crate::scanner::cancellation::CancellationToken;

mod handlers_cache;
mod handlers_scan;
mod handlers_system;
#[cfg(test)]
mod tests;
mod tools;

use tools::{negotiate_protocol_version, tool_definitions};

/// Shared process-wide backend state.
pub(super) fn mcp_state() -> &'static AppState {
    static STATE: OnceLock<AppState> = OnceLock::new();
    STATE.get_or_init(AppState::new)
}

/// Preview grants are intentionally shorter-lived than cleanup plans: an agent
/// must execute within five minutes of the preview it showed the user.
pub(super) const PREVIEW_TTL: Duration = Duration::from_secs(5 * 60);

/// Pending previews kept per server.
pub(super) const MAX_PENDING_GRANTS: usize = 16;

/// Scan sessions remembered for a later `detergo_preview_cleanup` or cursor page.
pub(super) const MAX_STORED_SCANS: usize = 8;

/// Maximum incoming JSON-RPC line length (2 MiB) so a malformed stream without
/// newlines cannot exhaust server memory.
const MAX_MCP_LINE_BYTES: usize = 2 * 1024 * 1024;

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
    pub(super) fn ok(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            is_error: false,
        }
    }

    pub(super) fn error(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            is_error: true,
        }
    }
}

pub(super) struct PreviewGrant {
    pub(super) plan: CleanupPlan,
    pub(super) session: Arc<crate::scanner::session::ScanSession>,
    pub(super) created: Instant,
}

pub(super) struct StoredScan {
    pub(super) session: Arc<crate::scanner::session::ScanSession>,
    /// Filtered, size-sorted item IDs for cursor pagination without re-scanning.
    pub(super) ordered_item_ids: Vec<String>,
    pub(super) total_reclaimable_bytes: u64,
    pub(super) cleanable_bytes: u64,
    pub(super) path_str: String,
    pub(super) scope_label: String,
    pub(super) older_than_days: Option<u64>,
    pub(super) created: Instant,
}

pub(super) struct SystemPreviewGrant {
    pub(super) ids: Vec<crate::system_cleaner::SystemActionId>,
    pub(super) created: Instant,
}

/// Per-process MCP state. The preview grants live in memory so a token cannot
/// be replayed across a restart and can only be redeemed once.
pub struct McpContext {
    pub(super) options: McpOptions,
    grants: Mutex<HashMap<String, PreviewGrant>>,
    scans: Mutex<HashMap<String, StoredScan>>,
    pub(super) cache_registry: crate::cleanup::official_actions::OfficialActionRegistry,
    system_grants: Mutex<HashMap<String, SystemPreviewGrant>>,
    in_flight: Mutex<HashMap<String, CancellationToken>>,
}

pub(super) fn make_room_for_system_grant(grants: &mut HashMap<String, SystemPreviewGrant>) {
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

pub(super) fn make_room_for_grant(grants: &mut HashMap<String, PreviewGrant>) {
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

pub(super) fn make_room_for_scan(scans: &mut HashMap<String, StoredScan>) {
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
            in_flight: Mutex::new(HashMap::new()),
        }
    }

    pub(super) fn grants(&self) -> std::sync::MutexGuard<'_, HashMap<String, PreviewGrant>> {
        self.grants
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(super) fn scans(&self) -> std::sync::MutexGuard<'_, HashMap<String, StoredScan>> {
        self.scans
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(super) fn system_grants(
        &self,
    ) -> std::sync::MutexGuard<'_, HashMap<String, SystemPreviewGrant>> {
        self.system_grants
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn in_flight(&self) -> std::sync::MutexGuard<'_, HashMap<String, CancellationToken>> {
        self.in_flight
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn register_request(&self, id: &Value) -> (String, CancellationToken) {
        let key = request_id_key(id);
        let token = CancellationToken::new();
        self.in_flight().insert(key.clone(), token.clone());
        (key, token)
    }

    fn unregister_request(&self, key: &str) {
        self.in_flight().remove(key);
    }

    fn cancel_request(&self, request_id: &Value) {
        let key = request_id_key(request_id);
        if let Some(token) = self.in_flight().get(&key) {
            token.cancel();
        }
    }

    /// Test/embedding entry point.
    #[doc(hidden)]
    pub fn call_tool(&self, name: &str, args: &Value) -> String {
        self.execute_tool(name, args, &CancellationToken::new())
            .text
    }

    /// Structured variant used by tests that assert the `isError` signal.
    #[doc(hidden)]
    pub fn call_tool_output(&self, name: &str, args: &Value) -> ToolCallOutput {
        self.execute_tool(name, args, &CancellationToken::new())
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

    fn execute_tool(&self, name: &str, args: &Value, cancel: &CancellationToken) -> ToolCallOutput {
        match name {
            "detergo_list_caches" | "devcleaner_list_caches" => self.list_caches(cancel),
            "detergo_preview_cache" | "devcleaner_preview_cache" => {
                self.preview_cache(args, cancel)
            }
            "detergo_clean_cache" | "devcleaner_clean_cache" => self.clean_cache(args),
            "detergo_system_scan" | "devcleaner_system_scan" => self.system_scan(cancel),
            "detergo_system_preview" | "devcleaner_system_preview" => {
                self.system_preview(args, cancel)
            }
            "detergo_system_execute" | "devcleaner_system_execute" => {
                self.system_execute(args, cancel)
            }
            "detergo_scan_workspace" | "devcleaner_scan_workspace" => {
                self.scan_workspace(args, cancel)
            }
            "detergo_preview_cleanup"
            | "detergo_clean_safe"
            | "devcleaner_preview_cleanup"
            | "devcleaner_clean_safe" => self.preview_cleanup(args, cancel),
            "detergo_execute_cleanup" | "devcleaner_execute_cleanup" => {
                self.execute_cleanup(args, cancel)
            }
            "detergo_get_history" | "devcleaner_get_history" => {
                let limit = args.get("limit").and_then(|l| l.as_u64()).unwrap_or(10) as usize;
                let state = mcp_state();
                let records = state.audit.list_records(limit);
                ToolCallOutput::ok(serde_json::to_string_pretty(&records).unwrap_or_default())
            }
            "detergo_inspect_target" | "devcleaner_inspect_target" => self.inspect_target(args),
            _ => ToolCallOutput::error(tf("Unknown tool: {}", &[&name])),
        }
    }
}

fn request_id_key(id: &Value) -> String {
    match id {
        Value::String(s) => format!("s:{s}"),
        Value::Number(n) => format!("n:{n}"),
        other => other.to_string(),
    }
}

fn is_valid_request_id(id: &Value) -> bool {
    matches!(id, Value::String(_) | Value::Number(_))
}

enum LineRead {
    Line(String),
    TooLong,
    Eof,
}

fn read_limited_line<R: BufRead>(reader: &mut R, limit: usize) -> LineRead {
    let mut buf = Vec::new();
    let mut exceeded = false;
    loop {
        let Ok(available) = reader.fill_buf() else {
            return LineRead::Eof;
        };
        if available.is_empty() {
            if buf.is_empty() {
                return LineRead::Eof;
            }
            break;
        }
        if let Some(pos) = available.iter().position(|&b| b == b'\n') {
            if !exceeded {
                let slice = &available[..pos];
                if buf.len().saturating_add(slice.len()) > limit {
                    exceeded = true;
                } else {
                    buf.extend_from_slice(slice);
                }
            }
            reader.consume(pos + 1);
            break;
        } else {
            let len = available.len();
            if !exceeded {
                if buf.len().saturating_add(len) > limit {
                    exceeded = true;
                } else {
                    buf.extend_from_slice(available);
                }
            }
            reader.consume(len);
        }
    }
    if exceeded {
        return LineRead::TooLong;
    }
    if buf.last() == Some(&b'\r') {
        buf.pop();
    }
    match String::from_utf8(buf) {
        Ok(s) => LineRead::Line(s),
        Err(_) => LineRead::Line(String::from("{invalid-utf8")),
    }
}

fn write_json_line<W: Write>(writer: &Mutex<W>, value: &Value) {
    let serialized = serde_json::to_string(value).unwrap_or_default();
    let mut guard = writer
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _ = writeln!(guard, "{serialized}");
    let _ = guard.flush();
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
///
/// Fast control frames (`initialize`, `ping`, `tools/list`,
/// `notifications/cancelled`) are processed immediately on the reader loop
/// while `tools/call` runs on scoped worker threads so `ping` stays responsive
/// and `notifications/cancelled` genuinely aborts in-flight work.
pub fn run_mcp_server_with<R: BufRead, W: Write + Send>(
    mut reader: R,
    writer: W,
    options: McpOptions,
) {
    let context = McpContext::new(options);
    let writer = Mutex::new(writer);

    std::thread::scope(|scope| loop {
        let line = match read_limited_line(&mut reader, MAX_MCP_LINE_BYTES) {
            LineRead::Line(l) => l,
            LineRead::TooLong => {
                write_json_line(
                    &writer,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": Value::Null,
                        "error": {
                            "code": -32600,
                            "message": "Invalid Request: message exceeds maximum size limit"
                        }
                    }),
                );
                continue;
            }
            LineRead::Eof => break,
        };
        if line.trim().is_empty() {
            continue;
        }

        let raw: serde_json::Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => {
                write_json_line(
                    &writer,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": Value::Null,
                        "error": {
                            "code": -32700,
                            "message": t("Parse error: Invalid JSON received")
                        }
                    }),
                );
                continue;
            }
        };
        let id_present = raw.get("id").is_some();
        let request: JsonRpcRequest = match serde_json::from_value(raw) {
            Ok(req) => req,
            Err(_) => {
                write_json_line(
                    &writer,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": Value::Null,
                        "error": {
                            "code": -32600,
                            "message": t("Invalid Request: malformed JSON-RPC message")
                        }
                    }),
                );
                continue;
            }
        };

        if request.jsonrpc != "2.0" {
            let err_id = request
                .id
                .filter(is_valid_request_id)
                .unwrap_or(Value::Null);
            write_json_line(
                &writer,
                &json!({
                    "jsonrpc": "2.0",
                    "id": err_id,
                    "error": {
                        "code": -32600,
                        "message": "Invalid Request: jsonrpc must be '2.0'"
                    }
                }),
            );
            continue;
        }

        // Notifications carry no `id` field and never emit a response.
        if !id_present {
            if request.method == "notifications/cancelled" {
                if let Some(req_id) = request.params.as_ref().and_then(|p| p.get("requestId")) {
                    context.cancel_request(req_id);
                }
            }
            continue;
        }

        let Some(id) = request.id.clone().filter(is_valid_request_id) else {
            write_json_line(
                &writer,
                &json!({
                    "jsonrpc": "2.0",
                    "id": Value::Null,
                    "error": {
                        "code": -32600,
                        "message": t("Invalid Request: id must be a string or number")
                    }
                }),
            );
            continue;
        };

        if request.method == "tools/call" {
            let params = request.params.clone();
            let (req_key, cancel) = context.register_request(&id);
            let ctx_ref = &context;
            let writer_ref = &writer;
            scope.spawn(move || {
                let tool_name = params
                    .as_ref()
                    .and_then(|p| p.get("name"))
                    .and_then(|n| n.as_str())
                    .unwrap_or("");
                let args = params
                    .as_ref()
                    .and_then(|p| p.get("arguments"))
                    .cloned()
                    .unwrap_or(json!({}));
                let output = ctx_ref.execute_tool(tool_name, &args, &cancel);
                ctx_ref.unregister_request(&req_key);
                if cancel.is_cancelled() {
                    return;
                }
                write_json_line(
                    writer_ref,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "content": [ { "type": "text", "text": output.text } ],
                            "isError": output.is_error
                        }
                    }),
                );
            });
            continue;
        }

        if let Some(res) = handle_control_message(&request, id, &context) {
            write_json_line(&writer, &res);
        }
    });
}

fn handle_control_message(req: &JsonRpcRequest, id: Value, ctx: &McpContext) -> Option<Value> {
    match req.method.as_str() {
        "initialize" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": negotiate_protocol_version(req.params.as_ref()),
                "serverInfo": {
                    "name": "detergo-mcp",
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

pub(super) fn cleanup_status(
    cancelled: bool,
    error_count: u64,
    success_count: u64,
) -> &'static str {
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

pub(super) fn format_size(bytes: u64) -> String {
    crate::format::human_bytes(bytes)
}

pub(super) fn audit_record(
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
