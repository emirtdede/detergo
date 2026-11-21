use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use serde_json::{json, Value};

use crate::cleanup::DeleteMode;
use crate::cli::i18n::{t, tf};
use crate::scanner::cancellation::CancellationToken;
use crate::scanner::models::ScanScope;

use super::{
    audit_record, cleanup_status, format_size, make_room_for_grant, make_room_for_scan, mcp_state,
    McpContext, PreviewGrant, StoredScan, ToolCallOutput, PREVIEW_TTL,
};

fn parse_scope(scope: &str) -> Option<ScanScope> {
    match scope {
        "projects" | "project" => Some(ScanScope::Project),
        "agents" => Some(ScanScope::Agents),
        "all" => Some(ScanScope::AllDrives),
        "combined" => Some(ScanScope::Combined),
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

fn encode_cursor(scan_id: &str, offset: usize) -> String {
    format!("v1:{scan_id}:{offset}")
}

fn decode_cursor(cursor: &str) -> Option<(String, usize)> {
    let rest = cursor.strip_prefix("v1:")?;
    let (scan_id, offset_str) = rest.rsplit_once(':')?;
    if scan_id.is_empty() {
        return None;
    }
    let offset = offset_str.parse::<usize>().ok()?;
    Some((scan_id.to_string(), offset))
}

fn format_scan_item(it: &crate::scanner::models::CleanupItem) -> Value {
    json!({
        "target_id": it.id,
        "name": it.display_name,
        "path": it.display_path,
        "category": it.category,
        "safety": it.safety_class,
        "measured": it.logical_bytes.is_some(),
        "bytes": it.estimated_reclaim_bytes,
        "human": it.estimated_reclaim_bytes.map(format_size),
        "last_modified_ms": it.last_modified_ms,
        "status": it.status,
        "warnings": it.warning_codes,
    })
}

impl McpContext {
    pub(super) fn scan_workspace(
        &self,
        args: &Value,
        cancel: &CancellationToken,
    ) -> ToolCallOutput {
        let page_limit = args
            .get("limit")
            .and_then(|v| v.as_u64())
            .map(|n| (n as usize).clamp(1, 200))
            .unwrap_or(25);

        // Cursor pagination: serve the requested page from the cached scan
        // session without re-walking the filesystem.
        if let Some(cursor) = args
            .get("cursor")
            .and_then(|c| c.as_str())
            .filter(|s| !s.is_empty())
        {
            let Some((scan_id, offset)) = decode_cursor(cursor) else {
                return ToolCallOutput::error(
                    "InvalidCursor: cursor is malformed. Call detergo_scan_workspace without a cursor to start a fresh scan.",
                );
            };
            let scans = self.scans();
            let Some(stored) = scans
                .get(&scan_id)
                .filter(|s| s.created.elapsed() <= crate::scanner::session::SESSION_TTL)
            else {
                return ToolCallOutput::error(format!(
                    "ExpiredCursor: scan session '{scan_id}' has expired or was evicted. Run detergo_scan_workspace again."
                ));
            };
            let by_id: std::collections::HashMap<&str, &crate::scanner::models::CleanupItem> =
                stored
                    .session
                    .items
                    .iter()
                    .map(|it| (it.id.as_str(), it))
                    .collect();
            let page_ids = stored.ordered_item_ids.iter().skip(offset).take(page_limit);
            let formatted_targets: Vec<Value> = page_ids
                .filter_map(|id| by_id.get(id.as_str()).copied())
                .map(format_scan_item)
                .collect();
            let next_offset = offset.saturating_add(formatted_targets.len());
            let has_more = next_offset < stored.ordered_item_ids.len();
            let next_cursor = has_more.then(|| encode_cursor(&scan_id, next_offset));
            let payload = json!({
                "scan_id": scan_id,
                "path": stored.path_str,
                "scope": stored.scope_label,
                "older_than_days": stored.older_than_days,
                "total_targets_found": stored.session.items.len(),
                "total_matching_items": stored.ordered_item_ids.len(),
                "total_reclaimable_bytes": stored.total_reclaimable_bytes,
                "total_reclaimable_human": format_size(stored.total_reclaimable_bytes),
                "cleanable_bytes": stored.cleanable_bytes,
                "items_truncated": has_more,
                "nextCursor": next_cursor,
                "items": formatted_targets
            });
            return ToolCallOutput::ok(serde_json::to_string_pretty(&payload).unwrap_or_default());
        }

        let path_str = args.get("path").and_then(|p| p.as_str()).unwrap_or(".");
        let min_size_mb = args
            .get("min_size_mb")
            .and_then(|m| m.as_u64())
            .unwrap_or(0);
        let older_than_days = args
            .get("older_than_days")
            .and_then(|v| v.as_u64())
            .filter(|&d| d > 0);

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
            serde_json::from_str::<Value>(&self.list_caches(cancel).text).ok()
        } else {
            None
        };
        let system_payload = if want_system {
            serde_json::from_str::<Value>(&self.system_scan(cancel).text).ok()
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
            min_size_bytes: if min_bytes > 0 { Some(min_bytes) } else { None },
            protected_paths: Vec::new(),
        };

        let (summary, scanned) = match crate::scanner::run_scan_blocking_with_token(
            request,
            catalog,
            &settings,
            &policy,
            cancel.clone(),
        ) {
            Ok(found) => found,
            Err(err) => return ToolCallOutput::error(format!("Scan error: {err}")),
        };
        if cancel.is_cancelled() {
            return ToolCallOutput::error("Cancelled: scan was cancelled by client.");
        }

        let now_ms = chrono::Utc::now().timestamp_millis();
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
                    && older_than_days.is_none_or(|days| {
                        crate::format::is_older_than_days(it.last_modified_ms, days, now_ms)
                    })
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

        let mut sorted = filtered_items.clone();
        sorted.sort_by_key(|it| std::cmp::Reverse(it.estimated_reclaim_bytes.unwrap_or(0)));
        let ordered_item_ids: Vec<String> = sorted.iter().map(|it| it.id.clone()).collect();
        let top_items: Vec<_> = sorted.into_iter().take(page_limit).collect();

        let formatted_targets: Vec<_> = top_items.iter().map(|it| format_scan_item(it)).collect();
        let has_more = ordered_item_ids.len() > formatted_targets.len();

        let scan_id = scanned.id.clone();
        let next_cursor = has_more.then(|| encode_cursor(&scan_id, formatted_targets.len()));
        let session = Arc::new(scanned);
        {
            let mut scans = self.scans();
            make_room_for_scan(&mut scans);
            scans.insert(
                scan_id.clone(),
                StoredScan {
                    session,
                    ordered_item_ids: ordered_item_ids.clone(),
                    total_reclaimable_bytes: total_bytes,
                    cleanable_bytes: summary.cleanable_bytes,
                    path_str: path_str.to_string(),
                    scope_label: scope_label.clone(),
                    older_than_days,
                    created: Instant::now(),
                },
            );
        }

        let mut payload = json!({
            "scan_id": scan_id,
            "path": path_str,
            "scope": scope_label,
            "older_than_days": older_than_days,
            "total_targets_found": items.len(),
            "total_matching_items": ordered_item_ids.len(),
            "measured_targets": filtered_items.iter().filter(|it| it.logical_bytes.is_some()).count(),
            "total_reclaimable_bytes": total_bytes,
            "total_reclaimable_human": format_size(total_bytes),
            "cleanable_bytes": summary.cleanable_bytes,
            "items_truncated": has_more,
            "nextCursor": next_cursor,
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

    pub(super) fn preview_cleanup(
        &self,
        args: &Value,
        cancel: &CancellationToken,
    ) -> ToolCallOutput {
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

        let requested_scan = args.get("scan_id").and_then(|s| s.as_str());
        let stored = {
            let scans = self.scans();
            match requested_scan {
                Some(id) => match scans.get(id) {
                    Some(scan) if scan.created.elapsed() <= crate::scanner::session::SESSION_TTL => {
                        Some((scan.session.clone(), scan.created))
                    }
                    _ => {
                        return ToolCallOutput::error(format!(
                            "PlanInvalid: unknown or expired scan_id '{}'. Run detergo_scan_workspace again.",
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

        let Some((session, _)) = stored else {
            return ToolCallOutput::error(
                "PlanInvalid: target_ids do not belong to any active scan session (the scan may have expired). Run detergo_scan_workspace first and pass its scan_id and target_ids.",
            );
        };

        let mut session = (*session).clone();
        for id in &target_ids {
            if cancel.is_cancelled() {
                return ToolCallOutput::error("Cancelled: preview was cancelled by client.");
            }
            if let Some(target) = session.targets.get_mut(id) {
                if target.logical_bytes.is_none() {
                    if let Some(size) =
                        crate::scanner::measurement::measure_path(&target.path, target.kind, cancel)
                    {
                        target.logical_bytes = Some(size.logical_bytes);
                        target.allocated_bytes = size.allocated_bytes;
                    }
                }
            }
        }
        let session = Arc::new(session);
        let incremental_older_than_days = args
            .get("incremental_older_than_days")
            .and_then(|v| v.as_u64())
            .filter(|&d| d > 0)
            .map(|d| u32::try_from(d.min(3650)).unwrap_or(3650));

        match crate::cleanup::build_plan_with_options(
            &session,
            &target_ids,
            DeleteMode::RecycleBin,
            &catalog,
            &policy,
            incremental_older_than_days,
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
                            "incremental_slice_count": item.incremental_slice_count,
                        })
                    })
                    .collect();
                let payload = json!({
                    "status": "preview",
                    "token": token,
                    "plan_id": plan.id,
                    "expires_in_seconds": PREVIEW_TTL.as_secs(),
                    "incremental_older_than_days": plan.incremental_older_than_days,
                    "eligible_count": plan.eligible_count,
                    "blocked_count": plan.blocked_count,
                    "total_estimated_bytes": plan.total_estimated_bytes,
                    "total_estimated_human": format_size(plan.total_estimated_bytes),
                    "destination": "Windows Recycle Bin (zero data loss)",
                    "items": items_json,
                    "next_step": "Call detergo_execute_cleanup with this token and confirm:true (requires --allow-destructive and the MCP setting)."
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

    pub(super) fn execute_cleanup(
        &self,
        args: &Value,
        cancel: &CancellationToken,
    ) -> ToolCallOutput {
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

        match crate::cleanup::execute_plan(
            &grant.plan,
            &grant.session,
            &catalog,
            &policy,
            &confirmation,
            false,
            cancel,
        ) {
            Ok(report) => {
                let audit_error = if settings.history_enabled {
                    let audit_entry = audit_record(&grant.plan, &report);
                    state
                        .audit
                        .append_record(&audit_entry)
                        .err()
                        .map(|err| err.to_string())
                } else {
                    None
                };

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

    pub(super) fn inspect_target(&self, args: &Value) -> ToolCallOutput {
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
