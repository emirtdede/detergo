#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
mod installer;
mod sfx;
mod win_shell;

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use cli::SetupCliArgs;
use installer::{InstallOptions, UninstallOptions, APP_VERSION};

struct SetupRuntimeState {
    cli: SetupCliArgs,
    exe_path: PathBuf,
    busy: Mutex<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupContextDto {
    mode: String,
    app_version: String,
    installed_version: Option<String>,
    default_install_dir: String,
    user_data_dir: String,
    required_mb: u32,
    system_language: String,
}

#[tauri::command]
fn get_setup_context(state: State<'_, SetupRuntimeState>) -> SetupContextDto {
    let installed = win_shell::read_installed_state();
    let default_dir = state
        .cli
        .custom_dir
        .clone()
        .or_else(|| {
            if state.cli.uninstall {
                state.exe_path.parent().map(PathBuf::from)
            } else {
                None
            }
        })
        .or(installed.install_dir)
        .unwrap_or_else(win_shell::default_install_dir);

    SetupContextDto {
        mode: if state.cli.uninstall {
            "uninstall".to_string()
        } else {
            "install".to_string()
        },
        app_version: APP_VERSION.to_string(),
        installed_version: installed.version,
        default_install_dir: default_dir.to_string_lossy().to_string(),
        user_data_dir: win_shell::user_data_dir().to_string_lossy().to_string(),
        required_mb: 24,
        system_language: win_shell::detect_windows_ui_language(),
    }
}

#[tauri::command]
async fn start_install(
    options: InstallOptions,
    app: AppHandle,
    state: State<'_, SetupRuntimeState>,
) -> Result<(), String> {
    {
        let mut busy = state.busy.lock().unwrap_or_else(|p| p.into_inner());
        if *busy {
            return Err("Another setup operation is already running.".to_string());
        }
        *busy = true;
    }

    let exe_path = state.exe_path.clone();
    let app_for_emit = app.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        installer::run_install(&exe_path, &options, |ev| {
            let _ = app_for_emit.emit("setup-progress", ev);
        })
    })
    .await
    .map_err(|e| format!("Setup worker failed: {e}"))?;

    {
        let mut busy = state.busy.lock().unwrap_or_else(|p| p.into_inner());
        *busy = false;
    }
    outcome
}

#[tauri::command]
async fn start_uninstall(
    options: UninstallOptions,
    app: AppHandle,
    state: State<'_, SetupRuntimeState>,
) -> Result<(), String> {
    {
        let mut busy = state.busy.lock().unwrap_or_else(|p| p.into_inner());
        if *busy {
            return Err("Another setup operation is already running.".to_string());
        }
        *busy = true;
    }

    let app_for_emit = app.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        installer::run_uninstall(&options, |ev| {
            let _ = app_for_emit.emit("setup-progress", ev);
        })
    })
    .await
    .map_err(|e| format!("Uninstall worker failed: {e}"))?;

    {
        let mut busy = state.busy.lock().unwrap_or_else(|p| p.into_inner());
        *busy = false;
    }
    outcome
}

#[tauri::command]
fn launch_installed_app(install_dir: String) -> Result<(), String> {
    win_shell::launch_installed_exe(std::path::Path::new(install_dir.trim()))
}

fn run_headless(cli: &SetupCliArgs, exe_path: &std::path::Path) -> i32 {
    let installed = win_shell::read_installed_state();
    if cli.uninstall {
        let dir = cli
            .custom_dir
            .clone()
            .or_else(|| exe_path.parent().map(PathBuf::from))
            .or(installed.install_dir)
            .unwrap_or_else(win_shell::default_install_dir);
        let opts = UninstallOptions {
            install_dir: dir.to_string_lossy().to_string(),
            delete_user_data: cli.delete_user_data,
        };
        match installer::run_uninstall(&opts, |_| {}) {
            Ok(()) => 0,
            Err(_) => 1,
        }
    } else {
        let dir = cli
            .custom_dir
            .clone()
            .or(installed.install_dir)
            .unwrap_or_else(win_shell::default_install_dir);
        let opts = InstallOptions {
            install_dir: dir.to_string_lossy().to_string(),
            language: win_shell::detect_windows_ui_language(),
            create_desktop_shortcut: true,
            create_start_menu_shortcut: true,
            start_on_login: false,
            add_to_path: true,
        };
        match installer::run_install(exe_path, &opts, |_| {}) {
            Ok(()) => 0,
            Err(_) => 1,
        }
    }
}

fn main() {
    let cli = SetupCliArgs::from_env();
    let exe_path = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("detergo-setup.exe"));

    // Headless silent install/uninstall runs purely in Rust before WebView2 is
    // ever initialized.
    if cli.silent {
        let code = run_headless(&cli, &exe_path);
        std::process::exit(code);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(SetupRuntimeState {
            cli,
            exe_path,
            busy: Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            get_setup_context,
            start_install,
            start_uninstall,
            launch_installed_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running Detergo Setup");
}
