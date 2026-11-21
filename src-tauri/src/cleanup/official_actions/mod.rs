//! Global developer tool cache discovery, measurement, preview, and execution.
//!
//! Supports both official tool CLI subcommands (e.g. `npm cache clean --force`,
//! `docker builder prune -f`) and audited Recycle Bin cache cleanup for tools
//! that ship no built-in cache purge command (Cargo, Gradle, Maven, vcpkg,
//! Hugging Face, Ollama, Electron).

mod catalog;
mod exec;
mod wsl;

#[cfg(test)]
mod tests;

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::catalog::TargetKind;
use crate::error::AppError;
use crate::scanner::cancellation::CancellationToken;
use crate::scanner::measurement::measure_path_with_deadline;

pub use exec::find_executable;

use catalog::{provider_def, resolve_provider_paths, ActionKind, ProviderDef, ACTIONS};

/// True when a cache provider holds large user-pulled assets (like local LLM
/// weights) that bulk commands (`detergo c all -y`) should skip unless the
/// user explicitly names that provider.
pub fn is_opt_in_only_provider(id: &str) -> bool {
    provider_def(id)
        .map(|(_, def)| def.opt_in_only)
        .unwrap_or(false)
}
use exec::{
    command_for_executable, execute_safe_cache_recycle, probe_versions, run_command_with_timeout,
    tail, COMMAND_TIMEOUT,
};

const PREVIEW_MEASURE_BUDGET: Duration = Duration::from_secs(8);
const CACHE_PATH_MEASURE_BUDGET: Duration = Duration::from_secs(8);
const MAX_PENDING_ACTIONS: usize = 16;
const PENDING_TTL: Duration = Duration::from_secs(300);

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachePathInfo {
    pub path: String,
    pub exists: bool,
    #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<u64>>))]
    pub bytes: Option<u64>,
    pub unmeasured_reason: Option<String>,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialActionInfo {
    pub id: String,
    pub label: String,
    pub description: String,
    pub executable: Option<String>,
    pub args: Vec<String>,
    pub available: bool,
    pub unavailable_reason: Option<String>,
    pub requires_network: bool,
    pub impact: String,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheProviderInfo {
    pub id: String,
    pub name: String,
    pub detected: bool,
    pub version: Option<String>,
    pub cache_paths: Vec<CachePathInfo>,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub total_bytes: u64,
    pub actions: Vec<OfficialActionInfo>,
    pub read_only: bool,
    pub note: Option<String>,
    pub measured: bool,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CacheMeasureEvent {
    Started {
        #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<usize>))]
        provider_count: usize,
    },
    PathMeasured {
        provider_id: String,
        path: String,
        exists: bool,
        #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<u64>>))]
        bytes: Option<u64>,
        unmeasured_reason: Option<String>,
    },
    ProviderFinished {
        provider_id: String,
        #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
        total_bytes: u64,
    },
    Finished,
    Cancelled,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialActionPreview {
    pub token: String,
    pub provider_id: String,
    pub action_id: String,
    pub executable: String,
    pub args: Vec<String>,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub before_bytes: u64,
    pub measurement_truncated: bool,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub expires_ms: u64,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialActionResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub provider_id: String,
    pub action_id: String,
    pub label: String,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub before_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub after_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<i64>))]
    pub delta_bytes: i64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub duration_ms: u64,
    pub stdout_tail: String,
    pub stderr_tail: String,
    pub note: Option<String>,
    pub measurement_truncated: bool,
    pub audit_error: Option<String>,
}

fn action_infos(def: &ProviderDef) -> Vec<OfficialActionInfo> {
    def.actions
        .iter()
        .map(|a| match a.kind {
            ActionKind::Command { exe, args } => {
                let resolved = find_executable(exe);
                OfficialActionInfo {
                    id: a.id.to_string(),
                    label: a.label.to_string(),
                    description: a.description.to_string(),
                    executable: resolved.as_ref().map(|p| p.to_string_lossy().to_string()),
                    args: args.iter().map(|s| s.to_string()).collect(),
                    available: resolved.is_some(),
                    unavailable_reason: if resolved.is_none() {
                        Some(format!("'{}' was not found on the system PATH.", exe))
                    } else {
                        None
                    },
                    requires_network: a.requires_network,
                    impact: a.impact.to_string(),
                }
            }
            ActionKind::SafeCacheRecycle { .. } => {
                let existing: Vec<String> = resolve_provider_paths(def)
                    .into_iter()
                    .filter(|p| p.exists())
                    .map(|p| p.to_string_lossy().to_string())
                    .collect();
                let available = !existing.is_empty();
                OfficialActionInfo {
                    id: a.id.to_string(),
                    label: a.label.to_string(),
                    description: a.description.to_string(),
                    executable: Some("Recycle Bin (verified cache)".to_string()),
                    args: existing,
                    available,
                    unavailable_reason: if !available {
                        Some("No existing cache directory was found on disk.".to_string())
                    } else {
                        None
                    },
                    requires_network: a.requires_network,
                    impact: a.impact.to_string(),
                }
            }
        })
        .collect()
}

pub fn list_cache_providers() -> Vec<CacheProviderInfo> {
    let version_names: Vec<&str> = ACTIONS.iter().map(|def| def.version_exe).collect();
    let versions = probe_versions(&version_names);

    ACTIONS
        .iter()
        .map(|def| {
            let resolved_paths = resolve_provider_paths(def);
            let paths: Vec<CachePathInfo> = resolved_paths
                .iter()
                .map(|expanded| CachePathInfo {
                    path: expanded.to_string_lossy().to_string(),
                    exists: expanded.exists(),
                    bytes: None,
                    unmeasured_reason: if def.read_only && expanded.is_dir() {
                        Some("readOnly".to_string())
                    } else {
                        None
                    },
                })
                .collect();

            let detected =
                paths.iter().any(|p| p.exists) || find_executable(def.version_exe).is_some();

            CacheProviderInfo {
                id: def.id.to_string(),
                name: def.name.to_string(),
                detected,
                version: versions.get(def.version_exe).cloned(),
                cache_paths: paths,
                total_bytes: 0,
                actions: action_infos(def),
                read_only: def.read_only,
                note: def.note.map(|n| n.to_string()),
                measured: false,
            }
        })
        .collect()
}

fn measure_dirs(
    paths: &[CachePathInfo],
    token: &CancellationToken,
    files_only: bool,
    read_only: bool,
    deadline: Option<Instant>,
) -> Vec<CachePathInfo> {
    paths
        .iter()
        .map(|info| {
            let path = PathBuf::from(&info.path);
            let bytes = if !path.exists() || (files_only && !path.is_file()) {
                None
            } else if path.is_file() {
                crate::platform::facts(&path)
                    .map(|f| f.allocated_bytes)
                    .or_else(|| std::fs::metadata(&path).ok().map(|m| m.len()))
            } else {
                measure_path_with_deadline(&path, TargetKind::Directory, token, deadline)
                    .map(|s| s.allocated_bytes.unwrap_or(s.logical_bytes))
            };
            let unmeasured_reason = if bytes.is_none() && path.exists() {
                Some(if read_only { "readOnly" } else { "error" }.to_string())
            } else {
                None
            };
            CachePathInfo {
                path: info.path.clone(),
                exists: path.exists(),
                bytes,
                unmeasured_reason,
            }
        })
        .collect()
}

fn measure_cache_path(
    def: &ProviderDef,
    path: &Path,
    token: &CancellationToken,
    deadline: Instant,
) -> Option<u64> {
    if !path.exists() {
        return None;
    }
    if path.is_file() {
        return crate::platform::facts(path)
            .map(|f| f.allocated_bytes)
            .or_else(|| std::fs::metadata(path).ok().map(|m| m.len()));
    }
    if def.read_only {
        return None;
    }
    measure_path_with_deadline(path, TargetKind::Directory, token, Some(deadline))
        .map(|s| s.allocated_bytes.unwrap_or(s.logical_bytes))
}

pub fn measure_cache_providers<F>(
    token: &CancellationToken,
    provider_ids: Option<&[String]>,
    mut emit: F,
) where
    F: FnMut(CacheMeasureEvent),
{
    let selected: Vec<&ProviderDef> = match provider_ids {
        Some(ids) if !ids.is_empty() => ACTIONS
            .iter()
            .filter(|def| ids.iter().any(|id| id == def.id))
            .collect(),
        _ => ACTIONS.iter().collect(),
    };

    emit(CacheMeasureEvent::Started {
        provider_count: selected.len(),
    });

    if selected.is_empty() {
        emit(CacheMeasureEvent::Finished);
        return;
    }

    let worker_count = selected.len().min(4);
    let next_index = std::sync::atomic::AtomicUsize::new(0);
    let (tx, rx) = crossbeam_channel::unbounded::<CacheMeasureEvent>();

    std::thread::scope(|scope| {
        for _ in 0..worker_count {
            let tx = tx.clone();
            let selected = &selected;
            let next_index = &next_index;
            scope.spawn(move || loop {
                if token.is_cancelled() {
                    return;
                }
                let idx = next_index.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let Some(def) = selected.get(idx) else {
                    return;
                };
                let mut total_bytes = 0u64;
                for path in resolve_provider_paths(def) {
                    if token.is_cancelled() {
                        return;
                    }
                    let exists = path.exists();
                    let deadline = Instant::now() + CACHE_PATH_MEASURE_BUDGET;
                    let bytes = measure_cache_path(def, &path, token, deadline);
                    if let Some(bytes) = bytes {
                        total_bytes = total_bytes.saturating_add(bytes);
                    }
                    let unmeasured_reason = if bytes.is_none() && exists {
                        let reason = if def.read_only {
                            "readOnly"
                        } else if Instant::now() >= deadline {
                            "timedOut"
                        } else {
                            "error"
                        };
                        Some(reason.to_string())
                    } else {
                        None
                    };
                    let _ = tx.send(CacheMeasureEvent::PathMeasured {
                        provider_id: def.id.to_string(),
                        path: path.to_string_lossy().to_string(),
                        exists,
                        bytes,
                        unmeasured_reason,
                    });
                }
                if token.is_cancelled() {
                    return;
                }
                let _ = tx.send(CacheMeasureEvent::ProviderFinished {
                    provider_id: def.id.to_string(),
                    total_bytes,
                });
            });
        }
        drop(tx);

        for event in rx {
            if token.is_cancelled() {
                break;
            }
            emit(event);
        }
    });

    if token.is_cancelled() {
        emit(CacheMeasureEvent::Cancelled);
    } else {
        emit(CacheMeasureEvent::Finished);
    }
}

enum PendingExecution {
    Command {
        exe: PathBuf,
        args: Vec<String>,
    },
    SafeRecycle {
        paths: Vec<PathBuf>,
        blocked_processes: &'static [&'static str],
    },
}

struct PendingAction {
    provider_id: String,
    action_id: String,
    before_bytes: u64,
    before_truncated: bool,
    execution: PendingExecution,
    created: Instant,
}

#[derive(Default)]
pub struct OfficialActionRegistry {
    pending: Mutex<HashMap<String, PendingAction>>,
}

impl OfficialActionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock_pending(&self) -> std::sync::MutexGuard<'_, HashMap<String, PendingAction>> {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn issue(
        &self,
        provider_id: &str,
        action_id: &str,
        execution: PendingExecution,
        before_bytes: u64,
        before_truncated: bool,
    ) -> String {
        let token = uuid::Uuid::new_v4().simple().to_string();
        let mut pending = self.lock_pending();
        pending.retain(|_, p| p.created.elapsed() < PENDING_TTL);
        if pending.len() >= MAX_PENDING_ACTIONS {
            let oldest = pending
                .iter()
                .min_by_key(|(_, p)| p.created)
                .map(|(token, _)| token.clone());
            if let Some(token) = oldest {
                pending.remove(&token);
            }
        }
        pending.insert(
            token.clone(),
            PendingAction {
                provider_id: provider_id.to_string(),
                action_id: action_id.to_string(),
                before_bytes,
                before_truncated,
                execution,
                created: Instant::now(),
            },
        );
        token
    }

    fn take(&self, token: &str) -> Result<PendingAction, AppError> {
        let mut pending = self.lock_pending();
        let action = pending
            .remove(token)
            .ok_or_else(|| AppError::PlanInvalid("Action preview token is invalid.".to_string()))?;
        if action.created.elapsed() >= PENDING_TTL {
            return Err(AppError::PlanExpired(
                "Action preview token has expired.".to_string(),
            ));
        }
        Ok(action)
    }
}

pub fn preview_action(
    registry: &OfficialActionRegistry,
    provider_id: &str,
    action_id: &str,
    token: &CancellationToken,
) -> Result<OfficialActionPreview, AppError> {
    let (_, def) = provider_def(provider_id)
        .ok_or_else(|| AppError::InvalidPath(format!("Unknown provider: {}", provider_id)))?;
    if def.read_only {
        return Err(AppError::Blocked(
            "This provider is read-only; automated cleanup is not supported.".to_string(),
        ));
    }
    let action = def
        .actions
        .iter()
        .find(|a| a.id == action_id)
        .ok_or_else(|| AppError::InvalidPath(format!("Unknown action: {}", action_id)))?;

    let (execution, display_exe, display_args, target_paths) = match action.kind {
        ActionKind::Command { exe, args } => {
            let resolved = find_executable(exe)
                .ok_or_else(|| AppError::PlatformUnsupported(format!("'{}' not found.", exe)))?;
            let owned_args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
            let display = resolved.to_string_lossy().to_string();
            let paths = resolve_provider_paths(def);
            (
                PendingExecution::Command {
                    exe: resolved,
                    args: owned_args.clone(),
                },
                display,
                owned_args,
                paths,
            )
        }
        ActionKind::SafeCacheRecycle { blocked_processes } => {
            let resolved_paths: Vec<PathBuf> = resolve_provider_paths(def)
                .into_iter()
                .filter(|p| p.exists())
                .collect();
            if resolved_paths.is_empty() {
                return Err(AppError::PathNotFound(format!(
                    "No cache directory exists for '{}'.",
                    def.name
                )));
            }
            let arg_list: Vec<String> = resolved_paths
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            (
                PendingExecution::SafeRecycle {
                    paths: resolved_paths.clone(),
                    blocked_processes,
                },
                "Recycle Bin (verified cache)".to_string(),
                arg_list,
                resolved_paths,
            )
        }
    };

    let path_infos: Vec<CachePathInfo> = target_paths
        .iter()
        .map(|expanded| CachePathInfo {
            path: expanded.to_string_lossy().to_string(),
            exists: expanded.exists(),
            bytes: None,
            unmeasured_reason: None,
        })
        .collect();

    let measured = measure_dirs(
        &path_infos,
        token,
        false,
        false,
        Some(Instant::now() + PREVIEW_MEASURE_BUDGET),
    );
    let before: u64 = measured.iter().filter_map(|p| p.bytes).sum();
    let truncated = measured.iter().any(|p| p.exists && p.bytes.is_none());
    let issued_token = registry.issue(provider_id, action_id, execution, before, truncated);

    Ok(OfficialActionPreview {
        token: issued_token,
        provider_id: provider_id.to_string(),
        action_id: action_id.to_string(),
        executable: display_exe,
        args: display_args,
        before_bytes: before,
        measurement_truncated: truncated,
        expires_ms: crate::cleanup::plan::now_ms() + 300_000,
    })
}

pub fn execute_action(
    registry: &OfficialActionRegistry,
    token: &str,
) -> Result<OfficialActionResult, AppError> {
    let pending = registry.take(token)?;
    let provider_id = pending.provider_id;
    let action_id = pending.action_id;
    let before = pending.before_bytes;
    let before_truncated = pending.before_truncated;
    let (_, def) = provider_def(&provider_id)
        .ok_or_else(|| AppError::InvalidPath("Unknown provider.".to_string()))?;
    let action = def
        .actions
        .iter()
        .find(|a| a.id == action_id)
        .ok_or_else(|| AppError::InvalidPath("Unknown action.".to_string()))?;

    let started = Instant::now();
    let (success, exit_code, stdout_tail, stderr_tail, paths_to_remeasure) = match pending.execution
    {
        PendingExecution::Command { exe, args } => {
            if !exe.is_file() {
                return Err(AppError::PlatformUnsupported(format!(
                    "'{}' is no longer available.",
                    exe.display()
                )));
            }
            let cmd = command_for_executable(&exe, &args)?;
            let output = run_command_with_timeout(cmd, COMMAND_TIMEOUT)?;
            (
                output.status.success(),
                output.status.code(),
                tail(&String::from_utf8_lossy(&output.stdout), 2000),
                tail(&String::from_utf8_lossy(&output.stderr), 2000),
                resolve_provider_paths(def),
            )
        }
        PendingExecution::SafeRecycle {
            paths,
            blocked_processes,
        } => {
            let (ok, stdout, stderr) = execute_safe_cache_recycle(&paths, blocked_processes)?;
            (
                ok,
                Some(if ok { 0 } else { 1 }),
                tail(&stdout, 2000),
                tail(&stderr, 2000),
                paths,
            )
        }
    };

    let token_cancel = CancellationToken::new();
    let path_infos: Vec<CachePathInfo> = paths_to_remeasure
        .iter()
        .map(|expanded| CachePathInfo {
            path: expanded.to_string_lossy().to_string(),
            exists: expanded.exists(),
            bytes: None,
            unmeasured_reason: None,
        })
        .collect();
    let measured = measure_dirs(
        &path_infos,
        &token_cancel,
        false,
        false,
        Some(Instant::now() + PREVIEW_MEASURE_BUDGET),
    );
    let after: u64 = measured.iter().filter_map(|p| p.bytes).sum();
    let after_truncated = measured.iter().any(|p| p.exists && p.bytes.is_none());
    let delta = after as i64 - before as i64;
    let measurement_truncated = before_truncated || after_truncated;

    Ok(OfficialActionResult {
        success,
        exit_code,
        provider_id,
        action_id,
        label: action.label.to_string(),
        before_bytes: before,
        after_bytes: after,
        delta_bytes: delta,
        duration_ms: started.elapsed().as_millis() as u64,
        stdout_tail,
        stderr_tail,
        note: Some(if measurement_truncated {
            let reason = if before_truncated && after_truncated {
                "Size measurements before and after the action were time-limited; the change value is incomplete."
            } else if before_truncated {
                "The size measurement before the action was time-limited; the change value is incomplete."
            } else {
                "Size measurement after the action was time-limited; the change value is incomplete."
            };
            format!(
                "Exit code for {}: {:?}. {}",
                action.label, exit_code, reason
            )
        } else {
            format!("Exit code for {}: {:?}", action.label, exit_code)
        }),
        measurement_truncated,
        audit_error: None,
    })
}
