use std::collections::HashMap;

use serde_json::{json, Value};

use crate::cli::i18n::{t, tf};
use crate::scanner::cancellation::CancellationToken;

use super::{format_size, mcp_state, McpContext, ToolCallOutput, PREVIEW_TTL};

impl McpContext {
    pub(super) fn list_caches(&self, cancel: &CancellationToken) -> ToolCallOutput {
        let mut providers = crate::cleanup::official_actions::list_cache_providers();
        let detected_ids: Vec<String> = providers
            .iter()
            .filter(|p| p.detected)
            .map(|p| p.id.clone())
            .collect();
        let mut totals: HashMap<String, u64> = HashMap::new();
        if !detected_ids.is_empty() {
            crate::cleanup::official_actions::measure_cache_providers(
                cancel,
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

    pub(super) fn preview_cache(&self, args: &Value, cancel: &CancellationToken) -> ToolCallOutput {
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
                "Unknown provider ID: '{}'. Use 'detergo_list_caches' to list available providers.",
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

        match crate::cleanup::official_actions::preview_action(
            &self.cache_registry,
            &p.id,
            &action.id,
            cancel,
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
                    "next_step": "Call detergo_clean_cache with preview_token and confirm:true."
                });
                ToolCallOutput::ok(serde_json::to_string_pretty(&payload).unwrap_or_default())
            }
            Err(e) => {
                ToolCallOutput::error(tf("Failed to create action preview: {}", &[&e.to_string()]))
            }
        }
    }

    pub(super) fn clean_cache(&self, args: &Value) -> ToolCallOutput {
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
                "Blocked: 'confirm' must be true. Run detergo_preview_cache and ask the user first.",
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
                "Error: 'preview_token' is required. Call detergo_preview_cache first with provider_id (and optional action_id) to obtain a preview_token.",
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
}
