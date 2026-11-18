pub mod agent_spec;
pub mod growth;
pub mod root_locator;

#[cfg(test)]
mod tests;

use serde::Serialize;
use std::path::PathBuf;
use std::time::Instant;

use crate::audit::StorageSnapshot;
use crate::catalog::model::{CleanupMethod, Confidence, SafetyClass, TargetKind};
use crate::catalog::project::stable_path_id;
use crate::safety::evidence_guard::EvidenceSnapshot;
use crate::safety::{active_use_for_provider, ActiveUse};
use crate::scanner::cancellation::CancellationToken;
use crate::scanner::limits::{ScanLimits, StopReason};
use crate::scanner::measurement::measure_path_with_deadline;
use crate::scanner::models::{CleanupItem, ItemStatus, StoredTarget};
use crate::settings::AppSettings;

use agent_spec::{provider_display_name, specs_for};
use root_locator::{locate_agent_roots, root_exists};

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRootInfo {
    pub path: String,
    pub kind: String,
    pub source: String,
    pub exists: bool,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderInfo {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub roots: Vec<AgentRootInfo>,
    pub read_only: bool,
    pub note: Option<String>,
}

pub fn list_agent_providers(settings: &AppSettings) -> Vec<AgentProviderInfo> {
    let roots = locate_agent_roots();
    let hidden = &settings.hidden_builtin_providers;
    let mut providers = Vec::new();
    for (id, note) in [
        (
            "codex",
            Some("Sessions, worktrees, and SQLite diagnostics are displayed read-only."),
        ),
        (
            "claude-code",
            Some("Conversations and file-history are preserved; only verified cache and task outputs can be cleaned."),
        ),
        (
            "antigravity",
            Some("Brain and conversations are preserved; browser recordings can only be cleaned when recordings stop."),
        ),
        (
            "opencode",
            Some("Configuration and opencode.db are preserved; task outputs, logs, and build caches can be cleaned."),
        ),
        (
            "t3code",
            Some("User profile is preserved; GPU/Code Cache and obsolete installer remnants can be cleaned."),
        ),
        (
            "bionic",
            Some("User settings are preserved; temporary Web/Code Cache and log files can be cleaned."),
        ),
        (
            "cursor",
            Some("Settings and chat history are preserved; GPU, Code Cache, and web caches can be cleaned."),
        ),
        (
            "windsurf",
            Some("Cascade chat history is preserved; Electron and GPU caches can be cleaned."),
        ),
        (
            "ollama",
            Some("Downloaded local models and identities are preserved read-only; temporary logs and update remnants can be cleaned."),
        ),
    ] {
        if hidden.iter().any(|h| h == id) {
            continue;
        }
        let provider_roots: Vec<AgentRootInfo> = roots
            .iter()
            .filter(|r| r.provider == id)
            .map(|r| AgentRootInfo {
                path: r.path.to_string_lossy().to_string(),
                kind: r.kind.to_string(),
                source: r.source.clone(),
                exists: root_exists(r),
            })
            .collect();
        providers.push(AgentProviderInfo {
            id: id.to_string(),
            name: provider_display_name(id).to_string(),
            installed: provider_roots.iter().any(|r| r.exists),
            roots: provider_roots,
            read_only: id == "codex",
            note: note.map(|n| n.to_string()),
        });
    }

    // User-defined tools. They are listed and scanned, but every target is
    // reported as KEEP because Dev Cleaner has no verified rule set for them.
    for custom in &settings.custom_agent_providers {
        let provider_roots: Vec<AgentRootInfo> = custom
            .root_paths
            .iter()
            .map(|raw| {
                let path = PathBuf::from(raw);
                AgentRootInfo {
                    path: raw.clone(),
                    kind: "custom-root".to_string(),
                    source: "user".to_string(),
                    exists: path.is_dir(),
                }
            })
            .collect();
        providers.push(AgentProviderInfo {
            id: format!("custom:{}", custom.id),
            name: custom.name.clone(),
            installed: provider_roots.iter().any(|r| r.exists),
            roots: provider_roots,
            read_only: true,
            note: Some("User-defined tool: targets are reported as KEEP only.".to_string()),
        });
    }

    providers
}

pub struct AgentScanOutcome {
    pub items: Vec<CleanupItem>,
    pub targets: Vec<StoredTarget>,
    pub snapshots: Vec<StorageSnapshot>,
    pub warnings: Vec<(String, Option<String>)>,
    pub entries_scanned: u64,
    pub stop_reason: Option<StopReason>,
}

/// Metadata-only scan of agent storage. Chat contents are never read; sizes and
/// timestamps are obtained from the filesystem.
pub fn scan_agents(
    session_id: &str,
    token: &CancellationToken,
    policy: &crate::cleanup::CleanupPolicy,
    limits: ScanLimits,
    exclusions: &[String],
) -> AgentScanOutcome {
    let roots = locate_agent_roots();
    let excluded: std::collections::HashSet<String> = exclusions
        .iter()
        .map(|name| name.trim().to_lowercase())
        .filter(|name| !name.is_empty())
        .collect();
    let mut items = Vec::new();
    let mut targets = Vec::new();
    let mut snapshots = Vec::new();
    let mut warnings = Vec::new();
    let mut entries_scanned = 0u64;
    let mut stop_reason: Option<StopReason> = None;
    let deadline = Some(Instant::now() + limits.timeout);

    let mut provider_active: std::collections::HashMap<(String, PathBuf), ActiveUse> =
        std::collections::HashMap::new();

    for root in &roots {
        // A candidate-limit stop is global, not per root: without this check
        // every remaining root still entered the loop only to break inside the
        // first spec, wasting filesystem checks and deadline bookkeeping.
        if stop_reason.is_some() {
            break;
        }
        if token.is_cancelled() {
            stop_reason = Some(StopReason::Cancelled);
            break;
        }
        if deadline.map(|d| Instant::now() >= d).unwrap_or(false) {
            stop_reason = Some(StopReason::Timeout);
            break;
        }
        if !root_exists(root) {
            continue;
        }
        // A provider can expose several roots. Caching "in use" per provider
        // meant the verdict of the first root was reused for every other root,
        // so a busy Codex home could block an idle one (or vice versa).
        let active = *provider_active
            .entry((root.provider.to_string(), root.path.clone()))
            .or_insert_with(|| active_use_for_provider(root.provider, &root.path));

        for spec in specs_for(root.kind) {
            if token.is_cancelled() {
                stop_reason = Some(StopReason::Cancelled);
                break;
            }
            if deadline.map(|d| Instant::now() >= d).unwrap_or(false) {
                stop_reason = Some(StopReason::Timeout);
                break;
            }
            if entries_scanned >= limits.max_candidates {
                stop_reason = Some(StopReason::CandidateLimit);
                break;
            }
            let path = root.path.join(spec.rel);
            if !path.exists() {
                continue;
            }
            // Apply the same exclusion names the project walk honours. Agent
            // targets used to ignore `excludedNames`, so a folder the user
            // excluded was still scanned and offered for cleanup.
            if path_is_excluded(&path, &root.path, &excluded) {
                continue;
            }
            entries_scanned += 1;
            let kind = if path.is_dir() {
                TargetKind::Directory
            } else {
                TargetKind::File
            };
            let size = measure_path_with_deadline(&path, kind, token, deadline);
            // An unmeasured target must not masquerade as an empty one: `Some(0)`
            // made it look like a cleanable 0 B directory and let it enter the
            // cleanup plan. Keep it visible, but blocked and size-less.
            let measured = size.is_some();
            let logical = size.as_ref().map(|s| s.logical_bytes);
            let allocated = size.as_ref().and_then(|s| s.allocated_bytes);
            let measured_bytes = allocated.or(logical);
            // `minSizeBytes` is backend-owned and must apply to every scope.
            // Agent targets used to ignore it, so a 100 MB minimum still
            // listed (and allowed cleaning) 2 KB cache folders.
            let below_min_size = limits.min_size_bytes > 0
                && measured_bytes
                    .map(|bytes| bytes < limits.min_size_bytes)
                    .unwrap_or(false);

            let path_key = crate::safety::path_guard::normalize_key(&path);
            let user_protected = policy.protected_paths.iter().any(|raw| {
                let key = crate::safety::path_guard::normalize_key(std::path::Path::new(raw));
                !key.is_empty()
                    && (path_key == key
                        || crate::safety::path_guard::is_within(&path_key, &key)
                        // A protected folder below the target must protect the
                        // whole subtree as well (H4).
                        || crate::safety::path_guard::is_within(&key, &path_key))
            });
            let cache_disabled = spec.category == "cache" && !policy.allow_agent_cache_cleanup;
            let recording_active = spec.requires_idle
                && policy.protect_browser_recordings
                && root_locator::recently_modified(&path, 120);
            if recording_active {
                warnings.push((
                    "RECORDING_ACTIVE".to_string(),
                    Some(path.to_string_lossy().to_string()),
                ));
            }

            let mut item_warnings: Vec<String> = Vec::new();
            if active == ActiveUse::Yes {
                item_warnings.push("PROVIDER_ACTIVE".to_string());
            }
            if recording_active {
                item_warnings.push("RECORDING_ACTIVE".to_string());
            }
            if cache_disabled {
                item_warnings.push("AGENT_CACHE_DISABLED".to_string());
            }
            if below_min_size {
                item_warnings.push("BELOW_MIN_SIZE".to_string());
            }
            if user_protected {
                item_warnings.push("USER_PROTECTED".to_string());
            }
            if spec.protected {
                item_warnings.push("PROTECTED_TARGET".to_string());
            }

            let selectable = measured
                && !spec.protected
                && !user_protected
                && active == ActiveUse::No
                && !recording_active
                && !cache_disabled
                && !below_min_size
                && spec.cleanup != CleanupMethod::None;

            let id = format!("t{}", &uuid::Uuid::new_v4().simple().to_string()[..24]);
            let display_name = spec.rel.to_string();
            let sys_time = std::fs::metadata(&path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok());
            let last_modified_ms = sys_time.map(|d| d.as_millis() as i64);
            let modified_at = sys_time.map(|d| {
                chrono::DateTime::from_timestamp(d.as_secs() as i64, 0)
                    .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
                    .unwrap_or_default()
            });

            let evidence = EvidenceSnapshot {
                rule_id: spec.rule_id.to_string(),
                target_name: display_name.clone(),
                project_root: Some(root.path.to_string_lossy().to_string()),
                workspace_root: None,
                marker_hits: Vec::new(),
                content_hits: Vec::new(),
            };

            items.push(CleanupItem {
                id: id.clone(),
                scan_session_id: session_id.to_string(),
                rule_id: spec.rule_id.to_string(),
                provider: root.provider.to_string(),
                ecosystem: "ai".to_string(),
                category: spec.category.to_string(),
                kind,
                project_id: Some(stable_path_id(&root.path)),
                project_name: Some(provider_display_name(root.provider).to_string()),
                project_root: Some(root.path.to_string_lossy().to_string()),
                project_detected: false,
                display_name,
                display_path: path.to_string_lossy().to_string(),
                logical_bytes: logical,
                allocated_bytes: allocated,
                estimated_reclaim_bytes: allocated.or(logical),
                safety_class: if spec.protected || user_protected {
                    SafetyClass::Keep
                } else {
                    spec.safety
                },
                confidence: Confidence::High,
                active_use: active,
                evidence_codes: vec!["PROVIDER_ROOT".to_string(), "CATALOG_TARGET".to_string()],
                warning_codes: item_warnings,
                cleanup_method: spec.cleanup,
                regenerate_hint: None,
                protected: spec.protected || user_protected,
                selectable,
                auto_selectable: false,
                last_modified_at: modified_at,
                last_modified_ms,
                status: if selectable {
                    ItemStatus::Ready
                } else {
                    ItemStatus::Blocked
                },
                parent_item_id: None,
                note: spec.note.map(|n| n.to_string()),
            });

            targets.push(StoredTarget {
                id,
                path,
                rule_id: spec.rule_id.to_string(),
                provider: root.provider.to_string(),
                category: spec.category.to_string(),
                kind,
                safety_class: if spec.protected || user_protected {
                    SafetyClass::Keep
                } else {
                    spec.safety
                },
                cleanup_method: spec.cleanup,
                project_root: Some(root.path.to_string_lossy().to_string()),
                evidence,
                logical_bytes: logical,
                allocated_bytes: allocated,
                modified_at: None,
                active_use: active,
                parent_id: None,
                protected: spec.protected || user_protected,
            });

            snapshots.push(StorageSnapshot {
                timestamp: chrono::Local::now().to_rfc3339(),
                provider: root.provider.to_string(),
                category: spec.category.to_string(),
                bytes: allocated.or(logical).unwrap_or(0),
                item_count: 1,
            });
        }
    }

    // User-defined providers: metadata only, always KEEP.
    for custom in &policy.custom_agent_providers {
        // A global stop reason (candidate limit, timeout, cancel) ends the whole
        // pass. This loop used to run unconditionally after a candidate-limit
        // stop, measuring every custom root and pushing items past the cap.
        if stop_reason.is_some() {
            break;
        }
        let provider_id = format!("custom:{}", custom.id);
        for raw in &custom.root_paths {
            if token.is_cancelled() {
                stop_reason = Some(StopReason::Cancelled);
                break;
            }
            if deadline.map(|d| Instant::now() >= d).unwrap_or(false) {
                stop_reason = Some(StopReason::Timeout);
                break;
            }
            if entries_scanned >= limits.max_candidates {
                stop_reason = Some(StopReason::CandidateLimit);
                break;
            }
            let path = PathBuf::from(raw);
            if !path.is_dir() {
                continue;
            }
            // User-defined roots must respect exclusions too. The whole path is
            // inspected (minus the drive prefix) because the provider root may
            // itself live inside an excluded folder.
            if components_are_excluded(&path, &excluded) {
                continue;
            }
            entries_scanned += 1;
            let size = measure_path_with_deadline(&path, TargetKind::Directory, token, deadline);
            let logical = size.as_ref().map(|s| s.logical_bytes);
            let allocated = size.as_ref().and_then(|s| s.allocated_bytes);
            let id = format!("t{}", &uuid::Uuid::new_v4().simple().to_string()[..24]);
            let rule_id = format!("custom.{}.keep", custom.id);

            items.push(CleanupItem {
                id: id.clone(),
                scan_session_id: session_id.to_string(),
                rule_id: rule_id.clone(),
                provider: provider_id.clone(),
                ecosystem: "ai".to_string(),
                category: "custom".to_string(),
                kind: TargetKind::Directory,
                project_id: Some(stable_path_id(&path)),
                project_name: Some(custom.name.clone()),
                project_root: Some(path.to_string_lossy().to_string()),
                project_detected: false,
                display_name: custom.name.clone(),
                display_path: path.to_string_lossy().to_string(),
                logical_bytes: logical,
                allocated_bytes: allocated,
                estimated_reclaim_bytes: allocated.or(logical),
                safety_class: SafetyClass::Keep,
                confidence: Confidence::High,
                active_use: ActiveUse::Unknown,
                evidence_codes: vec!["USER_PROVIDER_ROOT".to_string()],
                warning_codes: vec!["PROTECTED_TARGET".to_string()],
                cleanup_method: CleanupMethod::None,
                regenerate_hint: None,
                protected: true,
                selectable: false,
                auto_selectable: false,
                last_modified_at: None,
                last_modified_ms: None,
                status: ItemStatus::Blocked,
                parent_item_id: None,
                note: Some("User-defined tool; no automatic cleanup is performed.".to_string()),
            });

            targets.push(StoredTarget {
                id,
                path: path.clone(),
                rule_id,
                provider: provider_id.clone(),
                category: "custom".to_string(),
                kind: TargetKind::Directory,
                safety_class: SafetyClass::Keep,
                cleanup_method: CleanupMethod::None,
                project_root: Some(path.to_string_lossy().to_string()),
                evidence: EvidenceSnapshot {
                    rule_id: format!("custom.{}.keep", custom.id),
                    target_name: custom.name.clone(),
                    project_root: Some(path.to_string_lossy().to_string()),
                    workspace_root: None,
                    marker_hits: Vec::new(),
                    content_hits: Vec::new(),
                },
                logical_bytes: logical,
                allocated_bytes: allocated,
                modified_at: None,
                active_use: ActiveUse::Unknown,
                parent_id: None,
                protected: true,
            });

            snapshots.push(StorageSnapshot {
                timestamp: chrono::Local::now().to_rfc3339(),
                provider: provider_id.clone(),
                category: "custom".to_string(),
                bytes: allocated.or(logical).unwrap_or(0),
                item_count: 1,
            });
        }
    }

    if stop_reason.is_none() && token.is_cancelled() {
        stop_reason = Some(StopReason::Cancelled);
    }

    AgentScanOutcome {
        items,
        targets,
        snapshots,
        warnings,
        entries_scanned,
        stop_reason,
    }
}

/// True when a path below `root` contains a component named in `exclusions`.
///
/// The project walk skips excluded folder names at any depth. Agent targets are
/// resolved directly instead of walked, so the same rule is applied to the
/// relative components here.
fn path_is_excluded(
    path: &std::path::Path,
    root: &std::path::Path,
    exclusions: &std::collections::HashSet<String>,
) -> bool {
    if exclusions.is_empty() {
        return false;
    }
    match path.strip_prefix(root) {
        Ok(relative) => relative.components().any(|component| {
            exclusions.contains(&component.as_os_str().to_string_lossy().to_lowercase())
        }),
        Err(_) => false,
    }
}

/// Same rule for absolute user-provided roots: every component except the drive
/// prefix is compared, so `D:\\node_modules\\tool-cache` is excluded by name.
fn components_are_excluded(
    path: &std::path::Path,
    exclusions: &std::collections::HashSet<String>,
) -> bool {
    if exclusions.is_empty() {
        return false;
    }
    path.components().any(|component| match component {
        std::path::Component::Prefix(_) | std::path::Component::RootDir => false,
        other => exclusions.contains(&other.as_os_str().to_string_lossy().to_lowercase()),
    })
}
