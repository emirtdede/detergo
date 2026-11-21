use std::time::Instant;

use serde_json::{json, Value};

use crate::cli::i18n::t;
use crate::scanner::cancellation::CancellationToken;

use super::{
    format_size, make_room_for_system_grant, mcp_state, McpContext, SystemPreviewGrant,
    ToolCallOutput, PREVIEW_TTL,
};

impl McpContext {
    pub(super) fn system_scan(&self, cancel: &CancellationToken) -> ToolCallOutput {
        let elevated = crate::platform::is_elevated();
        let outcome = crate::system_cleaner::measure::scan(elevated, cancel);
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

    pub(super) fn system_preview(
        &self,
        args: &Value,
        cancel: &CancellationToken,
    ) -> ToolCallOutput {
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

        let actions = crate::system_cleaner::measure::measure_actions(&ids, elevated, cancel);
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
            "next_step": "Call detergo_system_execute with this token and confirm:true."
        });
        ToolCallOutput::ok(serde_json::to_string_pretty(&payload).unwrap_or_default())
    }

    pub(super) fn system_execute(
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
                "Blocked: 'confirm' must be true. Run detergo_system_preview first.",
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
                "PlanExpired: the system preview token has expired. Run detergo_system_preview again.",
            ));
        }

        let elevated = crate::platform::is_elevated();
        let report = crate::system_cleaner::execute::execute(&grant.ids, elevated, cancel, |_| {});
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
}
