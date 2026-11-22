use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

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

    let mut allowed_roots: Vec<PathBuf> = Vec::new();
    if !request.root_path.trim().is_empty() {
        allowed_roots.push(PathBuf::from(&request.root_path));
    }
    if request.scope == crate::scanner::models::ScanScope::AllDrives {
        for root in crate::platform::fixed_drive_roots() {
            allowed_roots.push(PathBuf::from(root));
        }
    }
    if request.scope == crate::scanner::models::ScanScope::Agents
        || request.scope == crate::scanner::models::ScanScope::Combined
        || request.include_agents.unwrap_or(false)
    {
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
            "Scan root was not specified.".to_string(),
        ));
    }
    let session_root = allowed_roots[0].clone();
    let session = state
        .registry
        .create_session(request.scope, session_root, allowed_roots);

    // Installed only after the request passed validation: the early error
    // above used to leave a dead token in the slot, which made
    // `active_operation()` report a scan forever and blocked "reset app data"
    // until another scan or an explicit cancel.
    let token = CancellationToken::new();
    {
        let mut current = crate::lock!(state.scan_token);
        if let Some(old) = current.take() {
            old.cancel();
        }
        *current = Some(token.clone());
    }

    // A closed frontend channel must not abort the scan, but the lost progress
    // events must be reported instead of silently vanishing (Y-3).
    let dropped_events = Arc::new(AtomicU64::new(0));
    let dropped_for_task = Arc::clone(&dropped_events);
    let mut result = run_scan(
        request,
        session,
        token.clone(),
        catalog,
        &policy,
        move |event| {
            if on_event.send(event).is_err() {
                dropped_for_task.fetch_add(1, Ordering::Relaxed);
            }
        },
    )
    .await;

    if let Ok(mut current) = state.scan_token.lock() {
        release_scan_token(&mut current, &token);
    }

    if let Ok(summary) = result.as_mut() {
        summary.dropped_events = dropped_events.load(Ordering::Relaxed);
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
    let mut current = crate::lock!(state.scan_token);
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
        return Ok(crate::lock!(handle).summary.clone());
    }
    if let Some(handle) = state.registry.latest_session() {
        return Ok(crate::lock!(handle).summary.clone());
    }
    Ok(None)
}

#[tauri::command]
pub fn get_known_locations() -> Vec<KnownLocation> {
    get_known_dev_locations()
}

fn validate_shell_argument(value: &str, label: &str) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Err(AppError::InvalidPath(format!("{} cannot be empty.", label)));
    }
    if value
        .chars()
        .any(|c| c == '"' || c == '\0' || c == '\r' || c == '\n')
    {
        return Err(AppError::InvalidPath(format!(
            "{} contains invalid characters.",
            label
        )));
    }
    Ok(())
}

#[tauri::command]
pub fn open_path_in_explorer(path: String) -> Result<(), AppError> {
    validate_shell_argument(&path, "Path")?;
    let p = std::path::Path::new(&path);
    if !p.is_absolute() {
        return Err(AppError::InvalidPath(
            "Path to open must be absolute.".to_string(),
        ));
    }
    if !p.exists() {
        return Err(AppError::PathNotFound(path));
    }
    // Prefer the canonical path so a path containing traversal segments or a
    // trailing quote cannot alter the Explorer command line, and strip any
    // `\\?\` verbatim prefix that Explorer rejects.
    let canonical = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    #[cfg(windows)]
    {
        let raw_text = canonical.to_string_lossy().replace('/', "\\");
        let display = if let Some(unc) = raw_text.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{unc}")
        } else if let Some(stripped) = raw_text.strip_prefix(r"\\?\") {
            stripped.to_string()
        } else {
            raw_text
        };
        let explorer = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
            .join("explorer.exe");
        if canonical.is_dir() {
            Command::new(&explorer)
                .arg(&display)
                .spawn()
                .map_err(|e| AppError::Unknown(e.to_string()))?;
        } else {
            use std::os::windows::process::CommandExt;
            let mut command = Command::new(&explorer);
            command.raw_arg(format!("/select,\"{}\"", display.replace('"', "\"\"")));
            command
                .spawn()
                .map_err(|e| AppError::Unknown(e.to_string()))?;
        }
    }
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        if !canonical.is_dir() {
            command.arg("-R");
        }
        command
            .arg(&canonical)
            .spawn()
            .map_err(|e| AppError::Unknown(e.to_string()))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let target = if canonical.is_dir() {
            canonical.as_path()
        } else {
            canonical.parent().unwrap_or(canonical.as_path())
        };
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| AppError::Unknown(e.to_string()))?;
    }
    Ok(())
}

/// Validates a URL before handing it to the OS protocol handler.
///
/// A prefix check alone accepted `https://` (empty host), `https:\\evil` and
/// `mailto:` with no address. The host rules mirror what a browser needs, while
/// still allowing IDN hosts and bracketed IPv6 literals.
fn validate_open_url(url: &str) -> Result<(), AppError> {
    let invalid = |reason: &str| Err(AppError::Unknown(format!("Invalid URL: {reason}")));
    let lower = url.to_ascii_lowercase();

    if lower.starts_with("http://") || lower.starts_with("https://") {
        let scheme_len = if lower.starts_with("https://") { 8 } else { 7 };
        let rest = &url[scheme_len..];
        if rest.contains('\\') {
            return invalid("backslashes are not allowed");
        }
        let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
        // Drop any userinfo; the host is whatever follows the last '@'.
        let host_port = authority.rsplit('@').next().unwrap_or("");
        let host = if host_port.starts_with('[') {
            // `[::1]:8080` must not be truncated at the first colon.
            match host_port.find(']') {
                Some(end) => &host_port[..=end],
                None => return invalid("malformed IPv6 host"),
            }
        } else {
            host_port.split(':').next().unwrap_or("")
        };
        if host.is_empty() || host == "[]" {
            return invalid("host is missing");
        }
        if host
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '<' | '>' | '"'))
        {
            return invalid("host contains invalid characters");
        }
        return Ok(());
    }

    if let Some(rest) = lower.strip_prefix("mailto:") {
        let address = &url[url.len() - rest.len()..];
        let address = address.split(['?', '#']).next().unwrap_or("");
        if address.trim().is_empty() {
            return invalid("mail address is missing");
        }
        if address
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '\\' | '<' | '>' | '"'))
        {
            return invalid("mail address contains invalid characters");
        }
        let mut parts = address.split('@');
        let local = parts.next().unwrap_or("");
        let domain = parts.next().unwrap_or("");
        if local.is_empty() || domain.is_empty() || parts.next().is_some() || !domain.contains('.')
        {
            return invalid("mail address is malformed");
        }
        return Ok(());
    }

    invalid("unsupported protocol")
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), AppError> {
    validate_shell_argument(&url, "URL")?;
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(AppError::Unknown(
            "Invalid URL: whitespace or control characters are not allowed".to_string(),
        ));
    }
    validate_open_url(&url)?;
    #[cfg(target_os = "windows")]
    {
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let verb: Vec<u16> = "open\0".encode_utf16().collect();
        let target: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
        let code = unsafe {
            ShellExecuteW(
                None,
                PCWSTR(verb.as_ptr()),
                PCWSTR(target.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
        if (code.0 as isize) <= 32 {
            crate::logging::warn("ShellExecuteW failed to open URL", code.0 as isize);
            return Err(AppError::Unknown(
                "Could not open the requested link in the default application.".to_string(),
            ));
        }
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
    use super::{release_scan_token, validate_open_url, validate_shell_argument};
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
        assert!(validate_shell_argument("C:\\Work\\app", "Path").is_ok());
        assert!(validate_shell_argument("C:\\Work\\a\"b", "Path").is_err());
        assert!(validate_shell_argument("C:\\Work\\a\nb", "Path").is_err());
        assert!(validate_shell_argument("  ", "Path").is_err());
    }

    #[test]
    fn open_url_accepts_normal_web_and_mail_urls() {
        assert!(validate_open_url("https://example.com/docs").is_ok());
        assert!(validate_open_url("http://localhost:1420/path?q=1").is_ok());
        assert!(validate_open_url("https://[::1]:8443/").is_ok());
        assert!(validate_open_url("mailto:support@example.com").is_ok());
        assert!(validate_open_url("mailto:support@example.com?subject=Hi").is_ok());
    }

    #[test]
    fn open_url_rejects_empty_hosts_and_unsafe_forms() {
        assert!(validate_open_url("https://").is_err());
        assert!(validate_open_url("https:///path").is_err());
        assert!(validate_open_url("https://?query").is_err());
        // A backslash lets the OS resolve a local/UNC path instead of a URL.
        assert!(validate_open_url("https://example.com\\@evil.test").is_err());
        assert!(validate_open_url("https://exa mple.com").is_err());
        assert!(validate_open_url("file:///C:/Windows").is_err());
        assert!(validate_open_url("javascript:alert(1)").is_err());
        assert!(validate_open_url("mailto:").is_err());
        assert!(validate_open_url("mailto:not-an-address").is_err());
        assert!(validate_open_url("mailto:a@b@c.test").is_err());
        assert!(validate_open_url("mailto:a@b.test\\c").is_err());
    }
}
