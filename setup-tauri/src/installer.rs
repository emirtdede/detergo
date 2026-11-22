use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::cli::is_safe_install_dir;
use crate::sfx;
use crate::win_shell;

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOptions {
    pub install_dir: String,
    pub language: String,
    pub create_desktop_shortcut: bool,
    pub create_start_menu_shortcut: bool,
    pub start_on_login: bool,
    pub add_to_path: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallOptions {
    pub install_dir: String,
    pub delete_user_data: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupProgressEvent {
    pub step_key: String,
    pub percent: u8,
}

pub fn run_install<F>(
    exe_path: &Path,
    options: &InstallOptions,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(SetupProgressEvent),
{
    let target_dir = PathBuf::from(options.install_dir.trim());
    if !is_safe_install_dir(&target_dir) {
        return Err("Please choose a valid absolute installation folder.".to_string());
    }

    on_progress(SetupProgressEvent {
        step_key: "stepPreparing".to_string(),
        percent: 8,
    });
    win_shell::stop_running_detergo(&target_dir);
    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Could not create target directory: {e}"))?;

    on_progress(SetupProgressEvent {
        step_key: "stepExtracting".to_string(),
        percent: 20,
    });
    sfx::extract_payload(exe_path, &target_dir, |done, total| {
        let pct = 20 + ((done * 45) / total.max(1)) as u8;
        on_progress(SetupProgressEvent {
            step_key: "stepExtracting".to_string(),
            percent: pct.min(65),
        });
    })?;

    on_progress(SetupProgressEvent {
        step_key: "stepUninstaller".to_string(),
        percent: 72,
    });
    let uninst_path = target_dir.join("uninstall.exe");
    sfx::write_uninstaller_stub(exe_path, &uninst_path)?;

    on_progress(SetupProgressEvent {
        step_key: "stepShortcuts".to_string(),
        percent: 84,
    });
    let main_exe = target_dir.join("detergo.exe");
    let app_ico = target_dir.join("app.ico");
    let icon_for_shortcut = if app_ico.is_file() {
        app_ico.as_path()
    } else {
        main_exe.as_path()
    };

    let mut refresh_targets = vec![main_exe.clone()];
    if options.create_desktop_shortcut {
        if let Some(desktop) = win_shell::desktop_shortcut_path() {
            win_shell::create_shortcut(
                &desktop,
                &main_exe,
                icon_for_shortcut,
                "Detergo - Developer & AI Storage Cleaner",
            )?;
            refresh_targets.push(desktop);
        }
    }
    if options.create_start_menu_shortcut {
        if let Some(start_menu) = win_shell::start_menu_shortcut_path() {
            win_shell::create_shortcut(
                &start_menu,
                &main_exe,
                icon_for_shortcut,
                "Detergo - Developer & AI Storage Cleaner",
            )?;
            refresh_targets.push(start_menu);
        }
    }

    win_shell::set_startup_entry(&main_exe, options.start_on_login)?;
    if options.add_to_path {
        win_shell::add_to_user_path(&target_dir)?;
    }

    let estimated_kb = compute_dir_size_kb(&target_dir).max(16_000);
    win_shell::write_uninstall_registry(&target_dir, APP_VERSION, estimated_kb)?;
    seed_preferred_language(&options.language);

    on_progress(SetupProgressEvent {
        step_key: "stepRefreshing".to_string(),
        percent: 96,
    });
    win_shell::notify_shell_refresh(&refresh_targets);

    on_progress(SetupProgressEvent {
        step_key: "stepRefreshing".to_string(),
        percent: 100,
    });
    Ok(())
}

pub fn run_uninstall<F>(options: &UninstallOptions, mut on_progress: F) -> Result<(), String>
where
    F: FnMut(SetupProgressEvent),
{
    let target_dir = PathBuf::from(options.install_dir.trim());

    on_progress(SetupProgressEvent {
        step_key: "stepRemovingFiles".to_string(),
        percent: 18,
    });
    win_shell::stop_running_detergo(&target_dir);

    for rel in ["detergo.exe", "detergo.com", "app.ico"] {
        let p = target_dir.join(rel);
        if p.exists() {
            let _ = fs::remove_file(&p);
        }
    }

    on_progress(SetupProgressEvent {
        step_key: "stepRemovingShortcuts".to_string(),
        percent: 58,
    });
    win_shell::remove_shortcuts();
    let _ = win_shell::set_startup_entry(&target_dir.join("detergo.exe"), false);
    win_shell::remove_from_user_path(&target_dir);
    win_shell::remove_uninstall_registry();

    if options.delete_user_data {
        on_progress(SetupProgressEvent {
            step_key: "stepRemovingData".to_string(),
            percent: 82,
        });
        let data_dir = win_shell::user_data_dir();
        if data_dir.exists() {
            let _ = fs::remove_dir_all(&data_dir);
        }
    }

    on_progress(SetupProgressEvent {
        step_key: "stepRefreshing".to_string(),
        percent: 94,
    });
    win_shell::notify_shell_refresh(&[]);
    if is_safe_install_dir(&target_dir) {
        win_shell::schedule_self_delete(&target_dir);
    }

    on_progress(SetupProgressEvent {
        step_key: "stepRefreshing".to_string(),
        percent: 100,
    });
    Ok(())
}

fn compute_dir_size_kb(dir: &Path) -> u32 {
    let mut total: u64 = 0;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    total = total.saturating_add(meta.len());
                }
            }
        }
    }
    (total / 1024).min(u32::MAX as u64) as u32
}

/// Seeds the chosen installer language into `%APPDATA%\detergo\config.json` on
/// fresh installs so Detergo immediately opens in the user's selected language.
fn seed_preferred_language(language: &str) {
    let trimmed = language.trim();
    if trimmed.is_empty() {
        return;
    }
    let data_dir = win_shell::user_data_dir();
    let config_path = data_dir.join("config.json");
    if config_path.exists() {
        return;
    }
    if fs::create_dir_all(&data_dir).is_ok() {
        let initial = serde_json::json!({
            "schemaVersion": 5,
            "language": trimmed,
        });
        if let Ok(text) = serde_json::to_string_pretty(&initial) {
            let _ = fs::write(&config_path, text);
        }
    }
}
