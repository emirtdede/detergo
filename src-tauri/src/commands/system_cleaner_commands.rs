use std::time::Instant;

use tauri::ipc::Channel;
use tauri::State;

use crate::commands::AppState;
use crate::error::AppError;
use crate::scanner::cancellation::CancellationToken;
use crate::system_cleaner::{
    execute, measure, schedule, SystemActionId, SystemAutomationConfig, SystemCleanReport,
    SystemEvent, SystemPreview, SystemScanReport,
};

/// How long a confirmation token stays valid.
const PREVIEW_TTL_MS: u64 = 5 * 60 * 1000;

pub struct PendingSystemPreview {
    token: String,
    ids: Vec<SystemActionId>,
    expires: Instant,
}

fn normalize_drive_letter(value: &str) -> Option<char> {
    value
        .trim()
        .trim_start_matches(r"\\?\")
        .chars()
        .next()
        .filter(|ch| ch.is_ascii_alphabetic())
        .map(|ch| ch.to_ascii_uppercase())
}

fn disk_for_system_drive() -> Option<crate::commands::system_commands::DiskSpaceInfo> {
    let disks = crate::commands::system_commands::get_disk_pressure();
    let system_drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string());
    let target_letter = normalize_drive_letter(&system_drive);
    disks
        .iter()
        .find(|disk| {
            target_letter.is_some() && normalize_drive_letter(&disk.drive) == target_letter
        })
        .or_else(|| disks.first())
        .cloned()
}

#[tauri::command]
pub async fn system_scan(state: State<'_, AppState>) -> Result<SystemScanReport, AppError> {
    let token = CancellationToken::new();
    {
        let mut slot = crate::lock!(state.system_token);
        if slot.is_some() {
            return Err(AppError::Blocked(
                "A system cleanup or scan is already running.".to_string(),
            ));
        }
        *slot = Some(token.clone());
    }

    let elevated = crate::platform::is_elevated();
    let worker_token = token.clone();
    let outcome_result =
        tokio::task::spawn_blocking(move || measure::scan(elevated, &worker_token))
            .await
            .map_err(|e| AppError::Unknown(format!("System measurement failed: {e}")));

    {
        let mut slot = crate::lock!(state.system_token);
        if slot.as_ref().map(|t| t.same(&token)).unwrap_or(false) {
            *slot = None;
        }
    }

    let outcome = outcome_result?;
    if token.is_cancelled() {
        return Err(AppError::ScanCancelled(
            "System scan was cancelled.".to_string(),
        ));
    }

    let total = outcome
        .actions
        .iter()
        .filter(|action| action.measured)
        .fold(0u64, |sum, action| sum.saturating_add(action.bytes));

    Ok(SystemScanReport {
        elevated,
        actions: outcome.actions,
        total_bytes: total,
        disk: disk_for_system_drive(),
        scanned_at: chrono::Local::now().to_rfc3339(),
        warnings: outcome.warnings,
    })
}

#[tauri::command]
pub async fn system_preview(
    action_ids: Vec<SystemActionId>,
    state: State<'_, AppState>,
) -> Result<SystemPreview, AppError> {
    if action_ids.is_empty() {
        return Err(AppError::InvalidPath(
            "Select at least one cleanup action.".to_string(),
        ));
    }

    // Deduplicate while keeping the display order.
    let mut ids: Vec<SystemActionId> = Vec::new();
    for id in action_ids {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }

    let elevated = crate::platform::is_elevated();
    let requires_admin = ids
        .iter()
        .any(|id| crate::system_cleaner::actions::spec(*id).requires_admin);
    if requires_admin && !elevated {
        return Err(AppError::Blocked(
            "This selection needs administrator rights.".to_string(),
        ));
    }

    let token = CancellationToken::new();
    let ids_for_measure = ids.clone();
    let actions = tokio::task::spawn_blocking(move || {
        measure::measure_actions(&ids_for_measure, elevated, &token)
    })
    .await
    .map_err(|e| AppError::Unknown(format!("System preview failed: {e}")))?;

    // An action that cannot run in this session must never reach a token.
    for action in &actions {
        if !measure::is_action_available(action.id, elevated) {
            return Err(AppError::Blocked(format!(
                "The action '{}' is not available in this session.",
                action.id.as_str()
            )));
        }
    }

    let total = actions
        .iter()
        .fold(0u64, |sum, action| sum.saturating_add(action.bytes));
    let token_text = format!("sys-{}", uuid::Uuid::new_v4().simple());

    {
        let mut slot = crate::lock!(state.system_preview);
        *slot = Some(PendingSystemPreview {
            token: token_text.clone(),
            ids,
            expires: Instant::now() + std::time::Duration::from_millis(PREVIEW_TTL_MS),
        });
    }

    Ok(SystemPreview {
        token: token_text,
        actions,
        total_bytes: total,
        expires_ms: PREVIEW_TTL_MS,
        requires_admin,
        elevated,
    })
}

#[tauri::command]
pub async fn system_execute(
    token: String,
    on_event: Channel<SystemEvent>,
    state: State<'_, AppState>,
) -> Result<SystemCleanReport, AppError> {
    let pending = {
        let mut slot = crate::lock!(state.system_preview);
        match slot.take() {
            Some(pending) if pending.token == token => pending,
            _ => {
                return Err(AppError::PlanInvalid(
                    "The cleanup confirmation expired. Measure the actions again.".to_string(),
                ))
            }
        }
    };
    if Instant::now() > pending.expires {
        return Err(AppError::PlanExpired(
            "The cleanup confirmation expired. Measure the actions again.".to_string(),
        ));
    }

    let worker_token = CancellationToken::new();
    {
        let mut slot = crate::lock!(state.system_token);
        if slot.is_some() {
            return Err(AppError::Blocked(
                "A system cleanup is already running.".to_string(),
            ));
        }
        *slot = Some(worker_token.clone());
    }

    let elevated = crate::platform::is_elevated();
    let ids = pending.ids;
    let token_for_worker = worker_token.clone();
    let result = tokio::task::spawn_blocking(move || {
        execute::execute(&ids, elevated, &token_for_worker, move |event| {
            let _ = on_event.send(event);
        })
    })
    .await
    .map_err(|e| AppError::Unknown(format!("System cleanup failed: {e}")));

    {
        let mut slot = crate::lock!(state.system_token);
        if slot
            .as_ref()
            .map(|t| t.same(&worker_token))
            .unwrap_or(false)
        {
            *slot = None;
        }
    }

    let report = result?;
    let settings = state.settings.load();
    execute::record_audit(&state.audit, &report, settings.history_enabled);
    Ok(report)
}

#[tauri::command]
pub fn system_cancel(state: State<'_, AppState>) -> Result<(), AppError> {
    let slot = crate::lock!(state.system_token);
    // Signal the running worker without releasing the slot, so a second run is
    // rejected while the old one is still winding down.
    if let Some(token) = slot.as_ref() {
        token.cancel();
    }
    Ok(())
}

/// Relaunches the app elevated and exits the current process.
#[tauri::command]
pub fn system_restart_elevated(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if crate::platform::is_elevated() {
        return Ok(());
    }
    if let Some(operation) = state.active_operation() {
        return Err(AppError::Blocked(format!(
            "Wait for the {operation} to finish before restarting."
        )));
    }

    crate::platform::relaunch_elevated(&["--open-view".to_string(), "system".to_string()])?;

    // Give the IPC response a moment to reach the webview, then terminate so the
    // elevated instance does not race the single-instance guard.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        app.exit(0);
    });
    Ok(())
}

#[tauri::command]
pub async fn get_system_automation(
    state: State<'_, AppState>,
) -> Result<SystemAutomationConfig, AppError> {
    // `schtasks /Query` can take seconds on a busy machine; keep it off the
    // IPC thread so opening the page never stutters.
    let path = state.system_automation.path().to_path_buf();
    tokio::task::spawn_blocking(move || {
        schedule::SystemAutomationRepository::with_path(path).load()
    })
    .await
    .map_err(|e| AppError::Unknown(format!("Could not read the schedule: {e}")))
}

#[tauri::command]
pub async fn set_system_automation(
    mut config: SystemAutomationConfig,
    state: State<'_, AppState>,
) -> Result<SystemAutomationConfig, AppError> {
    config.normalize();
    let path = state.system_automation.path().to_path_buf();
    tokio::task::spawn_blocking(move || {
        if config.enabled {
            schedule::install(&config)?;
        } else {
            schedule::uninstall()?;
        }
        config.installed = schedule::is_installed();
        let repository = schedule::SystemAutomationRepository::with_path(path);
        repository.save(&config)?;
        Ok(repository.load())
    })
    .await
    .map_err(|e| AppError::Unknown(format!("Could not save the schedule: {e}")))?
}

#[tauri::command]
pub async fn remove_system_automation(
    state: State<'_, AppState>,
) -> Result<SystemAutomationConfig, AppError> {
    let path = state.system_automation.path().to_path_buf();
    tokio::task::spawn_blocking(move || {
        schedule::uninstall()?;
        schedule::SystemAutomationRepository::with_path(path).clear()?;
        Ok(SystemAutomationConfig::default())
    })
    .await
    .map_err(|e| AppError::Unknown(format!("Could not remove the schedule: {e}")))?
}

/// Launches Windows Disk Cleanup (`cleanmgr /d c:`, `/sageset:1`, or `/sagerun:1`).
#[tauri::command]
pub fn system_launch_cleanmgr(mode: String) -> Result<(), AppError> {
    crate::system_cleaner::cleanmgr::launch_native(&mode)
}

/// Opened from the elevated relaunch; consumed once by the frontend.
#[tauri::command]
pub fn take_launch_view() -> Option<String> {
    crate::commands::app_state::take_launch_view()
}
