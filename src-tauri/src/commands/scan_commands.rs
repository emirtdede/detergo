use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::catalog::Rule;
use crate::commands::AppState;
use crate::error::AppError;
use crate::platform::{get_known_dev_locations, KnownLocation};
use crate::scanner::cancellation::CancellationToken;
use crate::scanner::models::{ScanEvent, ScanRequest, ScanSummary};
use crate::scanner::run_scan;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDto {
    pub schema_version: u32,
    pub rules: Vec<Rule>,
    pub valid: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn start_scan(
    mut request: ScanRequest,
    on_event: Channel<ScanEvent>,
    state: State<'_, AppState>,
) -> Result<ScanSummary, AppError> {
    let catalog = state.catalog()?;
    let settings = state.settings.load();
    // Scan limits, exclusions and protected paths are backend-owned. The
    // request may choose the root/scope, but it cannot weaken safety settings.
    request.exclusions = settings.excluded_names.clone();
    request.protected_paths = settings.protected_paths.clone();
    request.max_depth = Some(settings.max_depth);
    request.max_candidates = Some(settings.max_candidates);
    request.timeout_minutes = Some(settings.timeout_minutes);
    request.min_size_bytes = Some(settings.min_size_bytes);
    let policy = crate::cleanup::CleanupPolicy::from(&settings);
    let token = CancellationToken::new();
    {
        let mut current = state.scan_token.lock().unwrap();
        if let Some(old) = current.take() {
            old.cancel();
        }
        *current = Some(token.clone());
    }

    let mut allowed_roots: Vec<PathBuf> = Vec::new();
    if !request.root_path.trim().is_empty() {
        allowed_roots.push(PathBuf::from(&request.root_path));
    }
    if request.scope == crate::scanner::models::ScanScope::AllDrives {
        for root in crate::platform::fixed_drive_roots() {
            allowed_roots.push(PathBuf::from(root));
        }
    }
    if request.scope == crate::scanner::models::ScanScope::Agents {
        for root in crate::providers::root_locator::locate_agent_roots() {
            if root.path.is_dir() && !allowed_roots.iter().any(|p| p == &root.path) {
                allowed_roots.push(root.path);
            }
        }
        if let Ok(profile) = std::env::var("USERPROFILE") {
            let profile = PathBuf::from(profile);
            if profile.is_dir() && !allowed_roots.contains(&profile) {
                allowed_roots.push(profile);
            }
        }
    }
    if allowed_roots.is_empty() {
        return Err(AppError::InvalidPath(
            "Tarama kökü belirtilmedi.".to_string(),
        ));
    }
    let session_root = allowed_roots[0].clone();
    let session = state
        .registry
        .create_session(request.scope, session_root, allowed_roots);

    let result = run_scan(request, session, token.clone(), catalog, &policy, move |event| {
        let _ = on_event.send(event);
    })
    .await;

    if let Ok(mut current) = state.scan_token.lock() {
        release_scan_token(&mut current, &token);
    }

    result
}

/// Clears the shared "current scan" slot only when it still belongs to
/// `token`. A finishing scan must never erase the cancellation handle of a
/// newer scan that already replaced it.
fn release_scan_token(slot: &mut Option<CancellationToken>, token: &CancellationToken) {
    if slot.as_ref().map(|t| t.same(token)).unwrap_or(false) {
        *slot = None;
    }
}

#[tauri::command]
pub fn cancel_scan(state: State<'_, AppState>) -> Result<(), AppError> {
    let mut current = state.scan_token.lock().unwrap();
    if let Some(token) = current.take() {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
pub fn get_catalog(state: State<'_, AppState>) -> CatalogDto {
    match &state.catalog {
        Some(catalog) => CatalogDto {
            schema_version: catalog.schema_version(),
            rules: catalog.rules().to_vec(),
            valid: true,
            error: None,
        },
        None => CatalogDto {
            schema_version: 0,
            rules: Vec::new(),
            valid: false,
            error: state.catalog_error.clone(),
        },
    }
}

#[tauri::command]
pub fn get_scan_summary(
    scan_session_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<ScanSummary>, AppError> {
    if let Some(id) = scan_session_id {
        let handle = state.registry.get_session(&id)?;
        return Ok(handle.lock().unwrap().summary.clone());
    }
    if let Some(handle) = state.registry.latest_session() {
        return Ok(handle.lock().unwrap().summary.clone());
    }
    Ok(None)
}

#[tauri::command]
pub fn get_known_locations() -> Vec<KnownLocation> {
    get_known_dev_locations()
}

fn validate_shell_argument(value: &str, label: &str) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Err(AppError::InvalidPath(format!("{} boş olamaz.", label)));
    }
    if value
        .chars()
        .any(|c| c == '"' || c == '\0' || c == '\r' || c == '\n')
    {
        return Err(AppError::InvalidPath(format!(
            "{} geçersiz karakter içeriyor.",
            label
        )));
    }
    Ok(())
}

#[tauri::command]
pub fn open_path_in_explorer(path: String) -> Result<(), AppError> {
    validate_shell_argument(&path, "Yol")?;
    let p = std::path::Path::new(&path);
    if !p.is_absolute() {
        return Err(AppError::InvalidPath(
            "Açılacak yol mutlak olmalıdır.".to_string(),
        ));
    }
    if !p.exists() {
        return Err(AppError::PathNotFound(path));
    }
    // Prefer the canonical path so a path containing traversal segments or a
    // trailing quote cannot alter the Explorer command line.
    let safe = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    if safe.is_dir() {
        Command::new("explorer")
            .arg(&safe)
            .spawn()
            .map_err(|e| AppError::Unknown(e.to_string()))?;
    } else {
        Command::new("explorer")
            .arg(format!("/select,{}", safe.to_string_lossy()))
            .spawn()
            .map_err(|e| AppError::Unknown(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), AppError> {
    validate_shell_argument(&url, "URL")?;
    let allowed = ["http://", "https://", "mailto:"];
    if !allowed.iter().any(|p| url.starts_with(p)) {
        return Err(AppError::Unknown("Geçersiz URL protokolü".to_string()));
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map_err(|e| AppError::Unknown(e.to_string()))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::Unknown(e.to_string()))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::Unknown(e.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{release_scan_token, validate_shell_argument};
    use crate::scanner::cancellation::CancellationToken;

    #[test]
    fn finishing_scan_only_clears_its_own_token() {
        let older = CancellationToken::new();
        let newer = CancellationToken::new();
        let mut slot = Some(newer.clone());
        release_scan_token(&mut slot, &older);
        assert!(
            slot.as_ref().map(|t| t.same(&newer)).unwrap_or(false),
            "a newer scan token must survive"
        );
        release_scan_token(&mut slot, &newer);
        assert!(slot.is_none());
    }

    #[test]
    fn shell_arguments_reject_line_breaks_and_quotes() {
        assert!(validate_shell_argument("C:\\Work\\app", "Yol").is_ok());
        assert!(validate_shell_argument("C:\\Work\\a\"b", "Yol").is_err());
        assert!(validate_shell_argument("C:\\Work\\a\nb", "Yol").is_err());
        assert!(validate_shell_argument("  ", "Yol").is_err());
    }
}
