use tauri::State;

use crate::commands::AppState;
use crate::error::AppError;
use crate::settings::AppSettings;

#[tauri::command]
pub fn get_app_settings(state: State<'_, AppState>) -> AppSettings {
    state.settings.load()
}

#[tauri::command]
pub fn save_app_settings(settings: AppSettings, state: State<'_, AppState>) -> Result<(), AppError> {
    state.settings.save(&settings)
}
