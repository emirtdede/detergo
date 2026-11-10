use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::cleanup::{CleanupPlan, DeleteMode};
use crate::cli::i18n::{t, tf};
use crate::commands::AppState;
use crate::error::AppError;
use crate::scanner::cancellation::CancellationToken;
use crate::scanner::models::{CleanupItem, ScanScope, StoredTarget};

/// Preview grants are intentionally shorter-lived than cleanup plans: an agent
/// must execute within five minutes of the preview it showed the user.
const PREVIEW_TTL: Duration = Duration::from_secs(5 * 60);

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

/// Per-process MCP state. The preview grants live in memory so a token cannot
/// be replayed across a restart and can only be redeemed once.
pub struct McpContext {
    options: McpOptions,
    grants: Mutex<HashMap<String, PreviewGrant>>,
    scans: Mutex<HashMap<String, StoredScan>>,
}

impl McpContext {
    pub fn new(options: McpOptions) -> Self {
        Self {
            options,
            grants: Mutex::new(HashMap::new()),
            scans: Mutex::new(HashMap::new()),
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

        let request: JsonRpcRequest = match serde_json::from_str(&line) {
            Ok(req) => req,
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

        if let Some(res) = handle_mcp_message(&request, &context) {
            let res_str = serde_json::to_string(&res).unwrap_or_default();
            let _ = writeln!(writer, "{}", res_str);
            let _ = writer.flush();
        }
    }
}

fn tool_definitions(allow_destructive: bool) -> Vec<Value> {
    let mut tools = vec![
        json!({
            "name": "devcleaner_scan_workspace",
            "description": t("Scans projects, AI storage, or caches to report safely cleanable targets (node_modules, target, .venv, etc.)."),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": t("Folder path to scan (default: current directory .)") },
                    "scope": { "type": "string", "enum": ["projects", "agents", "caches", "all"], "default": "projects" },
                    "min_size_mb": { "type": "number", "description": t("Minimum size threshold (MB)") }
                }
            }
        }),
        json!({
            "name": "devcleaner_preview_cleanup",
            "description": t("Builds a cleanup plan and returns a single-use token. Never deletes anything."),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "target_ids": { "type": "array", "items": { "type": "string" }, "description": t("List of target IDs returned by devcleaner_scan_workspace") },
                    "path": { "type": "string", "description": t("Workspace directory for target verification") }
                },
                "required": ["target_ids"]
            }
        }),
        json!({
            "name": "devcleaner_clean_safe",
            "description": t("DEPRECATED: now behaves exactly like devcleaner_preview_cleanup and never deletes anything. Use devcleaner_preview_cleanup + devcleaner_execute_cleanup."),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "target_ids": { "type": "array", "items": { "type": "string" }, "description": t("List of target IDs to clean") },
                    "path": { "type": "string", "description": t("Workspace directory for target verification") }
                },
                "required": ["target_ids"]
            }
        }),
        json!({
            "name": "devcleaner_list_caches",
            "description": t("Lists cache status and sizes for developer tools (Docker, npm, Cargo, pip, Gradle, Go, etc.)."),
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "devcleaner_clean_cache",
            "description": t("Cleans the cache of a specific tool (npm, pip, cargo, docker, etc.) via official CLI command."),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "provider_id": { "type": "string", "description": t("Provider ID to clean (e.g. npm, cargo, pip, docker)") }
                },
                "required": ["provider_id"]
            }
        }),
        json!({
            "name": "devcleaner_get_history",
            "description": t("Lists past cleanup and audit records performed by Dev Cleaner."),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": { "type": "number", "description": t("Number of records to list (default: 10)") }
                }
            }
        }),
        json!({
            "name": "devcleaner_inspect_target",
            "description": t("Inspects safety class, rule details, and cleanup eligibility for a specific target."),
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
            "name": "devcleaner_execute_cleanup",
            "description": t("Executes a previously previewed cleanup plan. Requires confirm:true, a single-use token, the --allow-destructive flag and the MCP destructive setting."),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "token": { "type": "string", "description": t("Single-use token returned by devcleaner_preview_cleanup") },
                    "confirm": { "type": "boolean", "description": t("Must be true; proves the caller saw the preview") }
                },
                "required": ["token", "confirm"]
            }
        }));
    }

    tools
}

fn handle_mcp_message(req: &JsonRpcRequest, ctx: &McpContext) -> Option<Value> {
    let id = req.id.clone()?;

    match req.method.as_str() {
        "initialize" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": "2024-11-05",
                "serverInfo": {
                    "name": "dev-cleaner-mcp",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": { "tools": {} }
            }
        })),
        "notifications/initialized" => None,
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
            let output_text = ctx.execute_tool(tool_name, &args);
            Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "content": [ { "type": "text", "text": output_text } ]
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

fn format_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.2} GB", b / GB)
    } else if b >= MB {
        format!("{:.1} MB", b / MB)
    } else if b >= KB {
        format!("{:.0} KB", b / KB)
    } else {
        format!("{} B", bytes)
    }
}

fn parse_scope(scope: &str) -> Option<ScanScope> {
    match scope {
        "projects" | "project" => Some(ScanScope::Project),
        "agents" => Some(ScanScope::Agents),
        "caches" => Some(ScanScope::GlobalCaches),
        "all" => Some(ScanScope::AllDrives),
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

/// Scans `root` and returns the discovered items plus the backend-owned target
/// map. Shared by preview and scan so both use identical discovery settings.
fn discover(
    root: &Path,
    scope: ScanScope,
    session_id: &str,
) -> Result<(Vec<CleanupItem>, Vec<StoredTarget>), AppError> {
    let state = AppState::new();
    let catalog = state.catalog()?;
    let token = CancellationToken::new();
    let limits = crate::scanner::limits::ScanLimits::default();
    let mut engine = crate::scanner::discovery::DiscoveryEngine::new(&catalog, token, limits);

    let config = crate::scanner::discovery::DiscoveryConfig {
        root,
        exclusions: &[],
        protected_paths: &[],
        scan_session_id: session_id,
        limits,
    };

    let outcome = engine.discover(config, |_| {}, |_| {})?;
    let _ = scope;
    Ok((outcome.items, outcome.targets))
}

fn build_session(
    id: &str,
    root: &Path,
    scope: ScanScope,
    items: Vec<CleanupItem>,
    targets: Vec<StoredTarget>,
) -> crate::scanner::session::ScanSession {
    crate::scanner::session::ScanSession {
        id: id.to_string(),
        scope,
        root: root.to_path_buf(),
        allowed_roots: vec![root.to_path_buf()],
        created: Instant::now(),
        items,
        targets: targets.into_iter().map(|t| (t.id.clone(), t)).collect(),
        summary: None,
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

    fn execute_tool(&self, name: &str, args: &Value) -> String {
        match name {
            "devcleaner_list_caches" => {
                let providers = crate::cleanup::official_actions::list_cache_providers();
                let mut summary = tf(
                    "Dev Cleaner: Status of {} Developer Tool Caches:",
                    &[&providers.len()],
                );
                summary.push('\n');
                for p in providers {
                    let status = if p.detected {
                        t("Installed / Detected")
                    } else {
                        t("Not found")
                    };
                    let ver = p.version.unwrap_or_else(|| "-".to_string());
                    summary.push_str(&format!("• {} ({}) -> {}\n", p.name, ver, status));
                }
                summary
            }
            "devcleaner_clean_cache" => self.clean_cache(args),
            "devcleaner_scan_workspace" => self.scan_workspace(args),
            "devcleaner_preview_cleanup" | "devcleaner_clean_safe" => self.preview_cleanup(args),
            "devcleaner_execute_cleanup" => self.execute_cleanup(args),
            "devcleaner_get_history" => {
                let limit = args.get("limit").and_then(|l| l.as_u64()).unwrap_or(10) as usize;
                let state = AppState::new();
                let records = state.audit.list_records(limit);
                serde_json::to_string_pretty(&records).unwrap_or_default()
            }
            "devcleaner_inspect_target" => self.inspect_target(args),
            _ => tf("Unknown tool: {}", &[&name]),
        }
    }

    fn clean_cache(&self, args: &Value) -> String {
        let provider_id = args
            .get("provider_id")
            .and_then(|p| p.as_str())
            .unwrap_or("");
        if provider_id.is_empty() {
            return t("Error: 'provider_id' parameter is required (e.g. 'npm', 'pip', 'cargo').");
        }

        let registry = crate::cleanup::official_actions::OfficialActionRegistry::new();
        let providers = crate::cleanup::official_actions::list_cache_providers();
        let found = providers
            .iter()
            .find(|p| p.id.eq_ignore_ascii_case(provider_id));

        match found {
            Some(p) => {
                if !p.detected {
                    return tf("Tool cache could not be cleaned: '{}' is not installed.", &[&p.name]);
                }
                if p.actions.is_empty() {
                    return tf("No official CLI cleanup command is defined for '{}'.", &[&p.name]);
                }

                let action = &p.actions[0];
                match crate::cleanup::official_actions::preview_action(
                    &registry,
                    &p.id,
                    &action.id,
                ) {
                    Ok(preview) => match crate::cleanup::official_actions::execute_action(
                        &registry,
                        &preview.token,
                    ) {
                        Ok(res) => {
                            let reclaimed = res.before_bytes.saturating_sub(res.after_bytes);
                            if res.success {
                                tf(
                                    "[OK] Success: {} cache cleaned. Reclaimed: {}",
                                    &[&p.name, &format_size(reclaimed)],
                                )
                            } else {
                                tf(
                                    "[WARN] {} cleanup failed (Exit code: {})",
                                    &[&p.name, &format!("{:?}", res.exit_code)],
                                )
                            }
                        }
                        Err(e) => tf("Error executing cleanup command: {}", &[&format!("{:?}", e)]),
                    },
                    Err(e) => tf("Failed to create action preview: {}", &[&format!("{:?}", e)]),
                }
            }
            None => tf(
                "Unknown provider ID: '{}'. Use 'devcleaner_list_caches' to list available providers.",
                &[&provider_id],
            ),
        }
    }

    fn scan_workspace(&self, args: &Value) -> String {
        let path_str = args.get("path").and_then(|p| p.as_str()).unwrap_or(".");
        let min_size_mb = args
            .get("min_size_mb")
            .and_then(|m| m.as_u64())
            .unwrap_or(0);
        let scope_str = args
            .get("scope")
            .and_then(|s| s.as_str())
            .unwrap_or("projects");
        let scope = match parse_scope(scope_str) {
            Some(scope) => scope,
            None => return tf("Error: unknown scope '{}'.", &[&scope_str]),
        };
        let path = PathBuf::from(path_str);

        match discover(&path, scope, "mcp_scan") {
            Ok((items, targets)) => {
                let min_bytes = min_size_mb * 1024 * 1024;
                let filtered_items: Vec<_> = items
                    .iter()
                    .filter(|it| it.estimated_reclaim_bytes.unwrap_or(0) >= min_bytes)
                    .collect();

                let mut total_bytes = 0u64;
                for item in &filtered_items {
                    total_bytes += item.estimated_reclaim_bytes.unwrap_or(0);
                }

                // Token bloat protection: detail the top 25, summarize the rest.
                let mut sorted = filtered_items.clone();
                sorted.sort_by_key(|it| std::cmp::Reverse(it.estimated_reclaim_bytes.unwrap_or(0)));
                let top_items: Vec<_> = sorted.into_iter().take(25).collect();

                let formatted_targets: Vec<_> = top_items
                    .iter()
                    .map(|it| {
                        json!({
                            "id": it.id,
                            "target_id": it.id,
                            "name": it.display_name,
                            "path": it.display_path,
                            "category": it.category,
                            "safety": it.safety_class,
                            "bytes": it.estimated_reclaim_bytes.unwrap_or(0),
                            "human": format_size(it.estimated_reclaim_bytes.unwrap_or(0))
                        })
                    })
                    .collect();

                let scan_id = format!("mcp-{}", uuid::Uuid::new_v4().simple());
                let session = Arc::new(build_session(
                    &scan_id,
                    &path,
                    scope,
                    items.clone(),
                    targets,
                ));
                self.scans().insert(
                    scan_id.clone(),
                    StoredScan {
                        session,
                        created: Instant::now(),
                    },
                );

                let payload = json!({
                    "scan_id": scan_id,
                    "path": path.to_string_lossy(),
                    "scope": scope_str,
                    "total_targets_found": filtered_items.len(),
                    "total_reclaimable_bytes": total_bytes,
                    "total_reclaimable_human": format_size(total_bytes),
                    "items_truncated": filtered_items.len() > 25,
                    "top_targets": formatted_targets,
                    "items": formatted_targets
                });
                serde_json::to_string_pretty(&payload).unwrap_or_default()
            }
            Err(e) => format!("Scan error: {:?}", e),
        }
    }

    fn preview_cleanup(&self, args: &Value) -> String {
        let target_ids = parse_target_ids(args);
        if target_ids.is_empty() {
            return t("Error: At least one 'target_id' must be provided.");
        }

        // Prefer the session created by `devcleaner_scan_workspace`: discovery
        // generates fresh IDs on every run, so re-scanning here could never
        // resolve the IDs the agent received from the scan.
        let requested_scan = args.get("scan_id").and_then(|s| s.as_str());
        let stored = {
            let scans = self.scans();
            match requested_scan {
                Some(id) => scans.get(id).map(|s| (s.session.clone(), s.created)),
                None => scans
                    .values()
                    .find(|s| {
                        target_ids
                            .iter()
                            .all(|id| s.session.targets.contains_key(id))
                    })
                    .map(|s| (s.session.clone(), s.created)),
            }
        };

        let session = match stored {
            Some((session, created))
                if created.elapsed() <= crate::scanner::session::SESSION_TTL =>
            {
                session
            }
            _ => {
                let path_str = args.get("path").and_then(|p| p.as_str()).unwrap_or(".");
                let root_path = PathBuf::from(path_str);
                let (items, targets) = match discover(&root_path, ScanScope::Project, "mcp_preview")
                {
                    Ok(found) => found,
                    Err(e) => return format!("Verification scan error: {:?}", e),
                };
                Arc::new(build_session(
                    "mcp_preview",
                    &root_path,
                    ScanScope::Project,
                    items,
                    targets,
                ))
            }
        };

        // Discovery records paths but does not measure them, and `build_plan`
        // refuses unmeasured targets. Measure only the selected IDs here so a
        // preview stays cheap even for a large workspace.
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

        let state = AppState::new();
        let catalog = match state.catalog() {
            Ok(idx) => idx,
            Err(e) => return format!("Failed to load catalog: {:?}", e),
        };
        let settings = state.settings.load();
        let policy = crate::cleanup::CleanupPolicy::from(&settings);

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

                self.grants().insert(
                    token,
                    PreviewGrant {
                        plan,
                        session,
                        created: Instant::now(),
                    },
                );
                serde_json::to_string_pretty(&payload).unwrap_or_default()
            }
            Err(e) => format!(
                "Failed to build cleanup plan (targets not found or unsafe): {:?}",
                e
            ),
        }
    }

    fn execute_cleanup(&self, args: &Value) -> String {
        let confirm = args
            .get("confirm")
            .and_then(|c| c.as_bool())
            .unwrap_or(false);
        if !confirm {
            return t("Blocked: 'confirm' must be true. Preview the plan first.");
        }
        if !self.options.allow_destructive {
            return t("Blocked: the MCP server was not started with --allow-destructive.");
        }

        let token = match args.get("token").and_then(|t| t.as_str()) {
            Some(token) if !token.is_empty() => token.to_string(),
            _ => return t("Error: 'token' is required."),
        };

        let state = AppState::new();
        let settings = state.settings.load();
        if !settings.mcp_allow_destructive {
            return t("Blocked: MCP destructive actions are disabled in Settings → Automation.");
        }

        // Remove first: a token is single-use even if execution later fails.
        let Some(grant) = self.grants().remove(&token) else {
            return t("PlanInvalid: unknown or already used preview token.");
        };
        if grant.created.elapsed() > PREVIEW_TTL || grant.plan.is_expired() {
            return t("PlanExpired: the preview token has expired. Run preview again.");
        }

        let catalog = match state.catalog() {
            Ok(idx) => idx,
            Err(e) => return format!("Failed to load catalog: {:?}", e),
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
                let _ = state.audit.append_record(&audit_entry);

                let payload = json!({
                    "status": "success",
                    "cleaned_targets_count": report.success_count,
                    "reclaimed_bytes": report.reclaim_bytes,
                    "reclaimed_human": format_size(report.reclaim_bytes),
                    "destination": "Windows Recycle Bin (Zero data loss)",
                    "errors": report.results.iter().filter(|r| !r.success).map(|r| json!({
                        "path": r.display_path,
                        "error": r.error
                    })).collect::<Vec<_>>()
                });
                serde_json::to_string_pretty(&payload).unwrap_or_default()
            }
            Err(e) => format!("Cleanup execution failed: {:?}", e),
        }
    }

    fn inspect_target(&self, args: &Value) -> String {
        let path_str = args.get("path").and_then(|p| p.as_str()).unwrap_or("");
        if path_str.is_empty() {
            return t("Error: 'path' parameter is required.");
        }
        let target_path = PathBuf::from(path_str);
        let state = AppState::new();
        let catalog = match state.catalog() {
            Ok(idx) => idx,
            Err(e) => return format!("Failed to load catalog: {:?}", e),
        };

        let exists = target_path.exists();
        let is_symlink = target_path
            .symlink_metadata()
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false);

        let matched_rule = catalog.rules().iter().find(|r| {
            if let Some(name) = target_path.file_name().and_then(|n| n.to_str()) {
                r.names
                    .iter()
                    .any(|rule_name| rule_name.eq_ignore_ascii_case(name))
            } else {
                false
            }
        });

        let payload = json!({
            "path": target_path.to_string_lossy(),
            "exists": exists,
            "is_symlink": is_symlink,
            "matched_rule": matched_rule.map(|r| json!({
                "id": r.id,
                "ecosystem": r.ecosystem,
                "category": r.category,
                "names": r.names,
                "safety": r.safety,
                "regenerate": r.regenerate
            }))
        });
        serde_json::to_string_pretty(&payload).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn call(options: McpOptions, request: &str) -> Value {
        let mut out = Vec::new();
        run_mcp_server_with(Cursor::new(format!("{request}\n")), &mut out, options);
        serde_json::from_slice(&out).expect("response json")
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
}
