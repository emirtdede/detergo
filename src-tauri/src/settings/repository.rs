use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::settings::model::AppSettings;

pub struct SettingsRepository {
    config_path: PathBuf,
}

/// Defaults tagged with "your settings could not be read", so the frontend
/// warning banner appears instead of the loss looking like a first launch.
fn recovered_default() -> AppSettings {
    AppSettings {
        recovered_from_corrupt: true,
        ..Default::default()
    }
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
        // A file that exists but cannot be opened or decoded is just as broken
        // as invalid JSON. Returning defaults silently hid permission errors and
        // encoding damage; the recovery flag makes the existing warning banner
        // explain why the user's settings are missing.
        let Ok(mut file) = File::open(&self.config_path) else {
            return recovered_default();
        };
        let mut content = String::new();
        if file.read_to_string(&mut content).is_err() {
            return recovered_default();
        }
        match serde_json::from_str::<AppSettings>(&content) {
            Ok(mut settings) => {
                // A stale flag written by an older build must not repeat the
                // warning on every launch.
                settings.recovered_from_corrupt = false;
                settings.migrate();
                settings
            }
            Err(_) => {
                // Preserve the unreadable file for manual recovery instead of
                // silently discarding the user's configuration.
                let backup = self
                    .config_path
                    .with_extension(format!("corrupt.{}.json", chrono::Utc::now().timestamp()));
                if let Err(err) = fs::copy(&self.config_path, &backup) {
                    // The banner promises recovery; if the copy failed, say so
                    // in the log instead of letting the next save destroy the
                    // only copy of the user's hand-edited settings.
                    crate::logging::warn(
                        &format!(
                            "could not back up the corrupt settings file {}",
                            self.config_path.display()
                        ),
                        err,
                    );
                }
                // A single bad/legacy field must not wipe protected paths,
                // exclusions or webhook settings. Merge the readable fields
                // one by one over the defaults; anything unparseable keeps the
                // default instead of taking the whole file down with it.
                let mut settings = recover_settings(&content).unwrap_or_default();
                settings.recovered_from_corrupt = true;
                settings.migrate();
                settings
            }
        }
    }

    pub fn save(&self, settings: &AppSettings) -> Result<(), AppError> {
        let mut normalized = settings.clone();
        // `recovered_from_corrupt` is a load-time diagnostic, not a persisted
        // preference: writing it back would make the recovery toast fire on a
        // later launch of an otherwise healthy file.
        normalized.recovered_from_corrupt = false;
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

        // Keep a copy of the previous file before the atomic replace. A user
        // whose settings were unreadable (or hand-edited) otherwise loses the
        // only copy the moment any setting is changed, and a failed
        // `corrupt.*.json` backup then has no fallback.
        if self.config_path.exists() {
            let previous = self.config_path.with_extension("bak.json");
            if let Err(e) = fs::copy(&self.config_path, &previous) {
                let _ = fs::remove_file(&temp_path);
                return Err(AppError::SettingsWriteFailed(format!(
                    "Failed to preserve the previous settings file: {}",
                    e
                )));
            }
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

    /// Removes the active settings file and every recovery artefact a previous
    /// save or load may have left behind (`config.bak.json`,
    /// `config.corrupt.*.json`, and abandoned `config.tmp.*.json` files).
    ///
    /// A factory reset must not leave an older file that a later recovery path
    /// could silently resurrect. The next `load` sees no file and returns the
    /// defaults, which is exactly what the reset promises.
    pub fn reset(&self) -> Result<(), AppError> {
        let parent = self.config_path.parent().unwrap_or_else(|| Path::new("."));
        let mut paths = vec![self.config_path.clone()];
        if let Ok(entries) = fs::read_dir(parent) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if is_settings_artifact(&name) {
                    paths.push(entry.path());
                }
            }
        }

        for path in paths {
            remove_if_present(&path).map_err(|err| {
                AppError::SettingsWriteFailed(format!(
                    "Failed to delete settings file {}: {err}",
                    path.display()
                ))
            })?;
        }
        Ok(())
    }
}

/// Files owned by `SettingsRepository`. The scan is prefix/suffix based so a
/// user's unrelated file in the data directory is never touched.
fn is_settings_artifact(name: &str) -> bool {
    name == "config.json"
        || name == "config.bak.json"
        || ((name.starts_with("config.corrupt.") || name.starts_with("config.tmp."))
            && name.ends_with(".json"))
}

fn remove_if_present(path: &Path) -> std::io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
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

/// Best-effort recovery for a config file that failed full deserialization.
///
/// Starts from the serialized defaults and adopts each top-level field only if
/// the resulting document still deserializes. A corrupt or unknown field is
/// dropped, but valid neighbours (protected paths, exclusions, shortcuts, ...)
/// are preserved instead of being reset with the whole file.
fn recover_settings(content: &str) -> Option<AppSettings> {
    let parsed: serde_json::Value = serde_json::from_str(content).ok()?;
    let object = parsed.as_object()?;
    let mut merged = serde_json::to_value(AppSettings::default()).ok()?;
    for (key, value) in object {
        let mut candidate = merged.clone();
        candidate[key.as_str()] = value.clone();
        if serde_json::from_value::<AppSettings>(candidate.clone()).is_ok() {
            merged = candidate;
        }
    }
    serde_json::from_value(merged).ok()
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
