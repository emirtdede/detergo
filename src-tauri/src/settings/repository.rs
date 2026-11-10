use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::settings::model::AppSettings;

pub struct SettingsRepository {
    config_path: PathBuf,
}

impl SettingsRepository {
    pub fn new() -> Self {
        let base_dir = dirs_or_fallback();
        let app_dir = crate::platform::resolve_app_dir(&base_dir);
        let config_path = app_dir.join("config.json");
        Self { config_path }
    }

    pub fn with_path(config_path: PathBuf) -> Self {
        if let Some(parent) = config_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        Self { config_path }
    }

    pub fn path(&self) -> &Path {
        &self.config_path
    }

    pub fn load(&self) -> AppSettings {
        if !self.config_path.exists() {
            return AppSettings::default();
        }
        let Ok(mut file) = File::open(&self.config_path) else {
            return AppSettings::default();
        };
        let mut content = String::new();
        if file.read_to_string(&mut content).is_err() {
            return AppSettings::default();
        }
        match serde_json::from_str::<AppSettings>(&content) {
            Ok(mut settings) => {
                settings.migrate();
                settings
            }
            Err(_) => {
                // Preserve the unreadable file for manual recovery instead of
                // silently discarding the user's configuration.
                let backup = self
                    .config_path
                    .with_extension(format!("corrupt.{}.json", chrono::Utc::now().timestamp()));
                let _ = fs::copy(&self.config_path, &backup);
                AppSettings::default()
            }
        }
    }

    pub fn save(&self, settings: &AppSettings) -> Result<(), AppError> {
        let mut normalized = settings.clone();
        normalized.migrate();

        let parent = self.config_path.parent().unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent).map_err(|e| {
            AppError::SettingsWriteFailed(format!("Failed to create settings directory: {}", e))
        })?;

        let json_str = serde_json::to_string_pretty(&normalized)
            .map_err(|e| AppError::SettingsWriteFailed(e.to_string()))?;

        let temp_path = parent.join(format!(
            "config.tmp.{}.{}.json",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ));

        let write_result = (|| -> std::io::Result<()> {
            let mut temp_file = File::create(&temp_path)?;
            temp_file.write_all(json_str.as_bytes())?;
            temp_file.flush()?;
            temp_file.sync_all()?;
            Ok(())
        })();
        if let Err(e) = write_result {
            let _ = fs::remove_file(&temp_path);
            return Err(AppError::SettingsWriteFailed(format!(
                "Failed to write temporary settings file: {}",
                e
            )));
        }

        if let Err(e) = replace_file(&temp_path, &self.config_path) {
            let _ = fs::remove_file(&temp_path);
            return Err(AppError::SettingsWriteFailed(format!(
                "Failed to replace settings file: {}",
                e
            )));
        }

        Ok(())
    }
}

/// Replaces the destination with the fully written temp file. On Windows the
/// replacement is done by the filesystem (`MoveFileExW` with replace + write
/// through), so a failed save leaves the previous configuration untouched.
#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MOVE_FILE_FLAGS,
    };

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let from_w = wide(from);
    let to_w = wide(to);
    let flags = MOVE_FILE_FLAGS(MOVEFILE_REPLACE_EXISTING.0 | MOVEFILE_WRITE_THROUGH.0);
    unsafe { MoveFileExW(PCWSTR(from_w.as_ptr()), PCWSTR(to_w.as_ptr()), flags) }
        .map_err(|e| std::io::Error::from_raw_os_error(e.code().0))
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::rename(from, to)
}

impl Default for SettingsRepository {
    fn default() -> Self {
        Self::new()
    }
}

fn dirs_or_fallback() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata);
    }
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        return PathBuf::from(userprofile).join(".config");
    }
    PathBuf::from(".")
}
