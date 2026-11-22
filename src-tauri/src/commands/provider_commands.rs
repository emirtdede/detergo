use tauri::State;

use crate::commands::AppState;
use crate::error::AppError;
use crate::providers::agent_spec::is_builtin_provider;
use crate::providers::AgentProviderInfo;
use crate::settings::{AppSettings, CustomAgentProvider};

/// Lists built-in providers (minus hidden ones) plus user-defined tools.
#[tauri::command]
pub fn get_agent_providers(state: State<'_, AppState>) -> Vec<AgentProviderInfo> {
    crate::providers::list_agent_providers(&state.settings.load())
}

/// Adds a user-defined AI tool. Its roots are only ever reported as `KEEP`.
#[tauri::command]
pub fn add_custom_agent_provider(
    name: String,
    root_paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<AppSettings, AppError> {
    let display_name = name.trim().to_string();
    if display_name.is_empty() {
        return Err(AppError::InvalidPath(
            "Tool name cannot be empty.".to_string(),
        ));
    }

    let normalized: Vec<String> = root_paths
        .iter()
        .filter_map(|raw| crate::settings::normalize_protected_path(raw))
        .collect();
    if normalized.is_empty() {
        return Err(AppError::InvalidPath(
            "At least one valid folder path is required.".to_string(),
        ));
    }

    let mut settings = state.settings.load();
    let id = format!("u{}", &uuid::Uuid::new_v4().simple().to_string()[..10]);
    settings.custom_agent_providers.push(CustomAgentProvider {
        id,
        name: display_name,
        root_paths: normalized,
        created_at: chrono::Local::now().to_rfc3339(),
    });
    settings.normalize();
    state.settings.save(&settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn remove_custom_agent_provider(
    id: String,
    state: State<'_, AppState>,
) -> Result<AppSettings, AppError> {
    let id = id.trim().trim_start_matches("custom:").to_string();
    let mut settings = state.settings.load();
    settings.custom_agent_providers.retain(|p| p.id != id);
    settings.normalize();
    state.settings.save(&settings)?;
    Ok(settings)
}

/// Built-in providers can be hidden from the list, not deleted: their verified
/// cleanup rules stay available if the user brings the card back.
#[tauri::command]
pub fn set_agent_provider_hidden(
    id: String,
    hidden: bool,
    state: State<'_, AppState>,
) -> Result<AppSettings, AppError> {
    let id = id.trim().to_lowercase();
    if !is_builtin_provider(&id) {
        return Err(AppError::InvalidPath(format!(
            "Unknown built-in AI provider: {}",
            id
        )));
    }
    let mut settings = state.settings.load();
    settings.hidden_builtin_providers.retain(|h| h != &id);
    if hidden {
        settings.hidden_builtin_providers.push(id);
    }
    settings.normalize();
    state.settings.save(&settings)?;
    Ok(settings)
}
