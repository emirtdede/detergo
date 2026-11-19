//! Size measurement for the system action list.
//!
//! Each action gets a bounded walk so opening the tab cannot hang on a huge
//! temp folder. A truncated walk is reported as unmeasured instead of showing a
//! number the user would read as exact.

use std::path::Path;
use std::time::{Duration, Instant};

use crate::catalog::TargetKind;
use crate::platform::is_reparse_point;
use crate::scanner::cancellation::CancellationToken;
use crate::scanner::measurement::measure_path_with_deadline;

use super::actions::{spec, ActionSpec, Engine};
use super::{SystemActionId, SystemActionInfo};

/// Per-action budget. `%TEMP%` with a million files still reports within this
/// window as "not measured" rather than freezing the page.
const MEASURE_BUDGET: Duration = Duration::from_secs(15);

pub struct ScanOutcome {
    pub actions: Vec<SystemActionInfo>,
    pub warnings: Vec<String>,
}

pub fn scan(elevated: bool, token: &CancellationToken) -> ScanOutcome {
    let mut actions = Vec::new();
    let mut warnings = Vec::new();

    for action in super::actions::ACTIONS {
        let info = measure_one(action, elevated, token);
        if info.available && !info.measured && info.reason.as_deref() == Some("unmeasured") {
            warnings.push(action.id.as_str().to_string());
        }
        actions.push(info);
    }

    ScanOutcome { actions, warnings }
}

fn measure_one(
    action: &'static ActionSpec,
    elevated: bool,
    token: &CancellationToken,
) -> SystemActionInfo {
    let mut info = SystemActionInfo {
        id: action.id,
        safety: action.safety,
        requires_admin: action.requires_admin,
        available: true,
        reason: None,
        path: action_path(action),
        bytes: 0,
        file_count: 0,
        measured: false,
    };

    match action.engine {
        Engine::RecycleBin => match super::recycle::size_bytes() {
            Some(bytes) => {
                info.bytes = bytes;
                info.measured = true;
            }
            None => info.reason = Some("unavailable".to_string()),
        },
        Engine::CleanMgr | Engine::Dism => {
            info.reason = Some(if elevated {
                "windowsReports".to_string()
            } else {
                "needsAdmin".to_string()
            });
        }
        Engine::Native => {
            let Some(root) = super::guard::root_for(action.id) else {
                info.available = false;
                info.reason = Some("notPresent".to_string());
                return info;
            };
            if std::fs::symlink_metadata(&root).is_err() || is_reparse_point(&root) {
                info.available = false;
                info.reason = Some("notPresent".to_string());
                return info;
            }
            match measure(&root, token) {
                Some((bytes, files)) => {
                    info.bytes = bytes;
                    info.file_count = files;
                    info.measured = true;
                }
                None => {
                    info.reason = Some(if !elevated && action.requires_admin {
                        "needsAdmin".to_string()
                    } else {
                        "unmeasured".to_string()
                    });
                }
            }
        }
    }

    info
}

/// A path the user can recognise. Tool actions show the executable so the row
/// is not an opaque label.
fn action_path(action: &ActionSpec) -> Option<String> {
    if let Some(root) = super::guard::root_for(action.id) {
        return Some(root.to_string_lossy().to_string());
    }
    match action.engine {
        Engine::RecycleBin => Some("Windows Recycle Bin (all drives)".to_string()),
        Engine::CleanMgr => Some(
            crate::system_cleaner::cleanmgr::executable()
                .to_string_lossy()
                .to_string(),
        ),
        Engine::Dism => Some(
            crate::system_cleaner::dism::executable()
                .to_string_lossy()
                .to_string(),
        ),
        Engine::Native => None,
    }
}

fn measure(root: &Path, token: &CancellationToken) -> Option<(u64, u64)> {
    let deadline = Instant::now() + MEASURE_BUDGET;
    let size = measure_path_with_deadline(root, TargetKind::Directory, token, Some(deadline))?;
    Some((size.logical_bytes, size.file_count))
}

/// Re-measures only the selected actions for the confirmation dialog.
pub fn measure_actions(
    ids: &[SystemActionId],
    elevated: bool,
    token: &CancellationToken,
) -> Vec<SystemActionInfo> {
    ids.iter()
        .map(|id| measure_one(spec(*id), elevated, token))
        .collect()
}

/// Whether the action can run in the current session.
pub fn is_action_available(id: SystemActionId, elevated: bool) -> bool {
    let action = spec(id);
    if action.requires_admin && !elevated {
        return false;
    }
    match action.engine {
        Engine::Native => super::guard::root_for(id)
            .map(|root| std::fs::symlink_metadata(root).is_ok())
            .unwrap_or(false),
        _ => true,
    }
}
