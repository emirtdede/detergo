use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::error::AppError;

/// Free/total space for one local volume. The frontend turns this into a
/// localized "disk is almost full" notification; the backend only reports
/// facts so the threshold stays a presentation concern.
#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiskSpaceInfo {
    pub drive: String,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub free_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub total_bytes: u64,
    pub percent_used: f64,
}

/// Snapshot of the current CLI & MCP executable environment so Docs and
/// Settings can show the exact running executable path and let Portable users
/// register a `dev-cleaner` shim in their per-user `PATH` with one click.
#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CliEnvironmentStatus {
    pub executable_path: String,
    pub shim_dir: String,
    pub in_path: bool,
    pub shim_up_to_date: bool,
}

fn cli_shim_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("APPDATA").map(PathBuf::from))
        .unwrap_or_else(|_| PathBuf::from("."));
    base.join("dev-cleaner").join("bin")
}

fn build_cmd_shim_content(exe_path: &Path) -> String {
    // Escape `%` as `%%` so folders like `100%Work` are never expanded by cmd.
    let escaped = exe_path.to_string_lossy().replace('%', "%%");
    format!("@echo off\r\nsetlocal\r\n\"{escaped}\" %*\r\nexit /b %ERRORLEVEL%\r\n")
}

fn normalize_path_entry(entry: &str) -> String {
    entry
        .trim()
        .trim_matches('"')
        .trim_end_matches(['\\', '/'])
        .to_ascii_lowercase()
}

#[cfg(windows)]
fn read_user_path_registry() -> Option<String> {
    use windows::core::w;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
        REG_VALUE_TYPE,
    };

    unsafe {
        let mut hkey = HKEY::default();
        if RegOpenKeyExW(HKEY_CURRENT_USER, w!("Environment"), 0, KEY_READ, &mut hkey).is_err() {
            return None;
        }
        let mut value_type = REG_VALUE_TYPE(0);
        let mut byte_len: u32 = 0;
        let query_len = RegQueryValueExW(
            hkey,
            w!("Path"),
            None,
            Some(&mut value_type),
            None,
            Some(&mut byte_len),
        );
        if query_len.is_err() || byte_len == 0 {
            let _ = RegCloseKey(hkey);
            return Some(String::new());
        }
        let mut buf: Vec<u16> = vec![0; (byte_len as usize).div_ceil(2)];
        let query_data = RegQueryValueExW(
            hkey,
            w!("Path"),
            None,
            Some(&mut value_type),
            Some(buf.as_mut_ptr() as *mut u8),
            Some(&mut byte_len),
        );
        let _ = RegCloseKey(hkey);
        if query_data.is_err() {
            return None;
        }
        while buf.last() == Some(&0) {
            buf.pop();
        }
        Some(String::from_utf16_lossy(&buf))
    }
}

#[cfg(not(windows))]
fn read_user_path_registry() -> Option<String> {
    std::env::var("PATH").ok()
}

#[cfg(windows)]
fn write_user_path_registry(new_path: &str) -> Result<(), AppError> {
    use windows::core::w;
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
        REG_EXPAND_SZ,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };

    let wide: Vec<u16> = new_path.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = unsafe { std::slice::from_raw_parts(wide.as_ptr() as *const u8, wide.len() * 2) };

    unsafe {
        let mut hkey = HKEY::default();
        if let Err(err) = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            w!("Environment"),
            0,
            KEY_SET_VALUE,
            &mut hkey,
        )
        .ok()
        {
            return Err(AppError::Unknown(format!(
                "Could not open HKCU\\Environment: {err}"
            )));
        }
        let status = RegSetValueExW(hkey, w!("Path"), 0, REG_EXPAND_SZ, Some(bytes));
        let _ = RegCloseKey(hkey);
        if let Err(err) = status.ok() {
            return Err(AppError::Unknown(format!(
                "Could not update user PATH: {err}"
            )));
        }

        let env_wide: Vec<u16> = "Environment"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut result: usize = 0;
        let _ = SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            WPARAM(0),
            LPARAM(env_wide.as_ptr() as isize),
            SMTO_ABORTIFHUNG,
            3000,
            Some(&mut result),
        );
    }
    Ok(())
}

#[cfg(not(windows))]
fn write_user_path_registry(_new_path: &str) -> Result<(), AppError> {
    Err(AppError::PlatformUnsupported(
        "Automatic PATH registration is only supported on Windows.".to_string(),
    ))
}

fn path_contains_dir(path_env: &str, dir: &Path) -> bool {
    let target = normalize_path_entry(&dir.to_string_lossy());
    if target.is_empty() {
        return false;
    }
    path_env
        .split(';')
        .any(|entry| normalize_path_entry(entry) == target)
}

#[tauri::command]
pub fn get_cli_environment_status() -> CliEnvironmentStatus {
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("dev-cleaner.exe"));
    let shim_dir = cli_shim_dir();
    let shim_file = shim_dir.join("dev-cleaner.cmd");
    let expected_shim = build_cmd_shim_content(&exe);

    let exe_name_is_standard = exe
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.eq_ignore_ascii_case("dev-cleaner.exe"));

    let user_path = read_user_path_registry()
        .or_else(|| std::env::var("PATH").ok())
        .unwrap_or_default();

    let exe_dir_in_path = exe_name_is_standard
        && exe
            .parent()
            .is_some_and(|parent| path_contains_dir(&user_path, parent));

    let shim_in_path = path_contains_dir(&user_path, &shim_dir);
    let shim_matches = std::fs::read_to_string(&shim_file)
        .map(|actual| actual == expected_shim)
        .unwrap_or(false);

    let in_path = exe_dir_in_path || (shim_in_path && shim_file.exists());
    let shim_up_to_date = exe_dir_in_path || (shim_in_path && shim_matches);

    CliEnvironmentStatus {
        executable_path: exe.to_string_lossy().to_string(),
        shim_dir: shim_dir.to_string_lossy().to_string(),
        in_path,
        shim_up_to_date,
    }
}

#[tauri::command]
pub fn register_cli_in_user_path() -> Result<CliEnvironmentStatus, AppError> {
    let exe = std::env::current_exe()
        .map_err(|e| AppError::Unknown(format!("Could not locate the running binary: {e}")))?;
    let shim_dir = cli_shim_dir();
    std::fs::create_dir_all(&shim_dir)
        .map_err(|e| AppError::Unknown(format!("Could not create CLI bin directory: {e}")))?;

    let shim_file = shim_dir.join("dev-cleaner.cmd");
    let content = build_cmd_shim_content(&exe);
    std::fs::write(&shim_file, content)
        .map_err(|e| AppError::Unknown(format!("Could not write dev-cleaner.cmd shim: {e}")))?;

    let current = read_user_path_registry().unwrap_or_default();
    if !path_contains_dir(&current, &shim_dir) {
        let dir_text = shim_dir.to_string_lossy();
        let trimmed = current.trim_end_matches(';');
        let updated = if trimmed.is_empty() {
            dir_text.to_string()
        } else {
            format!("{trimmed};{dir_text}")
        };
        write_user_path_registry(&updated)?;
    }

    Ok(get_cli_environment_status())
}

/// Reads space for every fixed/removable local volume. Network drives are
/// excluded by `fixed_drive_roots`, matching the scan scope.
#[tauri::command]
pub fn get_disk_pressure() -> Vec<DiskSpaceInfo> {
    let mut out = Vec::new();
    for root in crate::platform::fixed_drive_roots() {
        if let Some((free, total)) =
            crate::platform::windows::fs_meta::volume_space(Path::new(&root))
        {
            if total == 0 {
                continue;
            }
            let used = total.saturating_sub(free);
            out.push(DiskSpaceInfo {
                drive: root,
                free_bytes: free,
                total_bytes: total,
                percent_used: (used as f64 / total as f64) * 100.0,
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_used_is_derived_from_free_and_total() {
        let total = 1_000u64;
        let free = 250u64;
        let used = total - free;
        let info = DiskSpaceInfo {
            drive: "C:\\".into(),
            free_bytes: free,
            total_bytes: total,
            percent_used: (used as f64 / total as f64) * 100.0,
        };
        assert!((info.percent_used - 75.0).abs() < f64::EPSILON);
    }

    #[test]
    fn cmd_shim_escapes_percent_signs_and_forwards_exit_code() {
        let shim = build_cmd_shim_content(Path::new(r"C:\Users\100%Dev\Dev-Cleaner.exe"));
        assert!(shim.contains(r#""C:\Users\100%%Dev\Dev-Cleaner.exe" %*"#));
        assert!(shim.contains("exit /b %ERRORLEVEL%"));
        assert!(!shim.contains("start "));
    }

    #[test]
    fn path_contains_dir_is_case_and_slash_insensitive() {
        let env = r"C:\Windows\System32;C:\Users\emir\AppData\Local\dev-cleaner\bin\;D:\Tools";
        assert!(path_contains_dir(
            env,
            Path::new(r"c:\users\emir\appdata\local\dev-cleaner\bin")
        ));
        assert!(!path_contains_dir(env, Path::new(r"C:\Other\bin")));
    }
}
