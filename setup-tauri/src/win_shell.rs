use std::path::{Path, PathBuf};

pub const APP_NAME: &str = "Detergo";
pub const PUBLISHER: &str = "Vellium";
pub const UNINSTALL_REG_SUBKEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Detergo";
pub const RUN_REG_SUBKEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
pub const RUN_ONCE_REG_SUBKEY: &str = r"Software\Microsoft\Windows\CurrentVersion\RunOnce";

#[derive(Debug, Clone, Default)]
pub struct InstalledState {
    pub version: Option<String>,
    pub install_dir: Option<PathBuf>,
}

pub fn default_install_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(r"C:\Program Files"));
    base.join("Programs").join(APP_NAME)
}

pub fn user_data_dir() -> PathBuf {
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    base.join("detergo")
}

pub fn desktop_shortcut_path() -> Option<PathBuf> {
    std::env::var("USERPROFILE").ok().map(|p| {
        PathBuf::from(p)
            .join("Desktop")
            .join(format!("{APP_NAME}.lnk"))
    })
}

pub fn start_menu_shortcut_path() -> Option<PathBuf> {
    std::env::var("APPDATA").ok().map(|p| {
        PathBuf::from(p)
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs")
            .join(format!("{APP_NAME}.lnk"))
    })
}

fn normalize_path_entry(entry: &str) -> String {
    entry
        .trim()
        .trim_matches('"')
        .trim_end_matches(['\\', '/'])
        .to_ascii_lowercase()
}

#[cfg(windows)]
fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
pub fn detect_windows_ui_language() -> String {
    use windows::Win32::Globalization::GetUserDefaultLocaleName;

    let mut buf = [0u16; 85];
    let len = unsafe { GetUserDefaultLocaleName(&mut buf) };
    if len <= 1 {
        return "en".to_string();
    }
    let raw = String::from_utf16_lossy(&buf[..(len as usize - 1)]);
    let lower = raw.trim().to_ascii_lowercase();
    if lower.is_empty() {
        "en".to_string()
    } else {
        lower
    }
}

#[cfg(not(windows))]
pub fn detect_windows_ui_language() -> String {
    "en".to_string()
}

#[cfg(windows)]
fn read_reg_string(subkey: &str, name: &str) -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
        REG_VALUE_TYPE,
    };

    let subkey_w = to_wide(subkey);
    let name_w = to_wide(name);
    unsafe {
        let mut hkey = HKEY::default();
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey_w.as_ptr()),
            0,
            KEY_READ,
            &mut hkey,
        )
        .is_err()
        {
            return None;
        }
        let mut val_type = REG_VALUE_TYPE(0);
        let mut byte_len: u32 = 0;
        let query_len = RegQueryValueExW(
            hkey,
            PCWSTR(name_w.as_ptr()),
            None,
            Some(&mut val_type),
            None,
            Some(&mut byte_len),
        );
        if query_len.is_err() || byte_len == 0 {
            let _ = RegCloseKey(hkey);
            return None;
        }
        let mut buf: Vec<u16> = vec![0; (byte_len as usize).div_ceil(2)];
        let query_data = RegQueryValueExW(
            hkey,
            PCWSTR(name_w.as_ptr()),
            None,
            Some(&mut val_type),
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

#[cfg(windows)]
fn write_reg_string(subkey: &str, name: &str, value: &str, expand: bool) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
        REG_EXPAND_SZ, REG_OPTION_NON_VOLATILE, REG_SZ,
    };

    let subkey_w = to_wide(subkey);
    let name_w = to_wide(name);
    let value_w = to_wide(value);
    let bytes =
        unsafe { std::slice::from_raw_parts(value_w.as_ptr() as *const u8, value_w.len() * 2) };
    let kind = if expand { REG_EXPAND_SZ } else { REG_SZ };

    unsafe {
        let mut hkey = HKEY::default();
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey_w.as_ptr()),
            0,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut hkey,
            None,
        )
        .ok()
        .map_err(|e| format!("Could not open registry key {subkey}: {e}"))?;

        let status = RegSetValueExW(hkey, PCWSTR(name_w.as_ptr()), 0, kind, Some(bytes));
        let _ = RegCloseKey(hkey);
        status
            .ok()
            .map_err(|e| format!("Could not write registry value {name}: {e}"))?;
    }
    Ok(())
}

#[cfg(windows)]
fn write_reg_dword(subkey: &str, name: &str, value: u32) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
        REG_DWORD, REG_OPTION_NON_VOLATILE,
    };

    let subkey_w = to_wide(subkey);
    let name_w = to_wide(name);
    let bytes = value.to_le_bytes();

    unsafe {
        let mut hkey = HKEY::default();
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey_w.as_ptr()),
            0,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut hkey,
            None,
        )
        .ok()
        .map_err(|e| format!("Could not open registry key {subkey}: {e}"))?;

        let status = RegSetValueExW(hkey, PCWSTR(name_w.as_ptr()), 0, REG_DWORD, Some(&bytes));
        let _ = RegCloseKey(hkey);
        status
            .ok()
            .map_err(|e| format!("Could not write registry DWORD {name}: {e}"))?;
    }
    Ok(())
}

#[cfg(windows)]
fn delete_reg_value(subkey: &str, name: &str) {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegDeleteValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
    };

    let subkey_w = to_wide(subkey);
    let name_w = to_wide(name);
    unsafe {
        let mut hkey = HKEY::default();
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey_w.as_ptr()),
            0,
            KEY_SET_VALUE,
            &mut hkey,
        )
        .is_ok()
        {
            let _ = RegDeleteValueW(hkey, PCWSTR(name_w.as_ptr()));
            let _ = RegCloseKey(hkey);
        }
    }
}

#[cfg(windows)]
fn delete_reg_tree(subkey: &str) {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{RegDeleteTreeW, HKEY_CURRENT_USER};

    let subkey_w = to_wide(subkey);
    unsafe {
        let _ = RegDeleteTreeW(HKEY_CURRENT_USER, PCWSTR(subkey_w.as_ptr()));
    }
}

#[cfg(windows)]
pub fn read_installed_state() -> InstalledState {
    let version =
        read_reg_string(UNINSTALL_REG_SUBKEY, "DisplayVersion").filter(|v| !v.trim().is_empty());
    let install_dir = read_reg_string(UNINSTALL_REG_SUBKEY, "InstallLocation")
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from);
    InstalledState {
        version,
        install_dir,
    }
}

#[cfg(not(windows))]
pub fn read_installed_state() -> InstalledState {
    InstalledState::default()
}

#[cfg(windows)]
pub fn write_uninstall_registry(
    install_dir: &Path,
    version: &str,
    estimated_kb: u32,
) -> Result<(), String> {
    let install_str = install_dir.to_string_lossy();
    let icon_path = install_dir.join("app.ico");
    let uninst_path = install_dir.join("uninstall.exe");

    write_reg_string(UNINSTALL_REG_SUBKEY, "DisplayName", APP_NAME, false)?;
    write_reg_string(UNINSTALL_REG_SUBKEY, "DisplayVersion", version, false)?;
    write_reg_string(UNINSTALL_REG_SUBKEY, "Publisher", PUBLISHER, false)?;
    write_reg_string(UNINSTALL_REG_SUBKEY, "InstallLocation", &install_str, false)?;
    write_reg_string(
        UNINSTALL_REG_SUBKEY,
        "DisplayIcon",
        &format!("\"{}\"", icon_path.to_string_lossy()),
        false,
    )?;
    write_reg_string(
        UNINSTALL_REG_SUBKEY,
        "UninstallString",
        &format!("\"{}\" --uninstall", uninst_path.to_string_lossy()),
        false,
    )?;
    write_reg_string(
        UNINSTALL_REG_SUBKEY,
        "QuietUninstallString",
        &format!("\"{}\" --uninstall /S", uninst_path.to_string_lossy()),
        false,
    )?;
    write_reg_dword(UNINSTALL_REG_SUBKEY, "EstimatedSize", estimated_kb)?;
    write_reg_dword(UNINSTALL_REG_SUBKEY, "NoModify", 1)?;
    write_reg_dword(UNINSTALL_REG_SUBKEY, "NoRepair", 1)?;
    Ok(())
}

#[cfg(not(windows))]
pub fn write_uninstall_registry(
    _install_dir: &Path,
    _version: &str,
    _estimated_kb: u32,
) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
pub fn remove_uninstall_registry() {
    delete_reg_tree(UNINSTALL_REG_SUBKEY);
}

#[cfg(not(windows))]
pub fn remove_uninstall_registry() {}

#[cfg(windows)]
pub fn set_startup_entry(target_exe: &Path, enabled: bool) -> Result<(), String> {
    if enabled {
        write_reg_string(
            RUN_REG_SUBKEY,
            APP_NAME,
            &format!("\"{}\"", target_exe.to_string_lossy()),
            false,
        )
    } else {
        delete_reg_value(RUN_REG_SUBKEY, APP_NAME);
        Ok(())
    }
}

#[cfg(not(windows))]
pub fn set_startup_entry(_target_exe: &Path, _enabled: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
pub fn create_shortcut(
    lnk_path: &Path,
    target_exe: &Path,
    icon_path: &Path,
    description: &str,
) -> Result<(), String> {
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    if let Some(parent) = lnk_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let target_w = to_wide(&target_exe.to_string_lossy());
    let workdir_w = to_wide(&target_exe.parent().unwrap_or(target_exe).to_string_lossy());
    let icon_w = to_wide(&icon_path.to_string_lossy());
    let desc_w = to_wide(description);
    let lnk_w = to_wide(&lnk_path.to_string_lossy());

    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let should_uninit = hr.is_ok();

        let result: Result<(), String> = (|| {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| format!("CoCreateInstance(ShellLink) failed: {e}"))?;
            link.SetPath(PCWSTR(target_w.as_ptr()))
                .map_err(|e| format!("IShellLinkW::SetPath failed: {e}"))?;
            link.SetWorkingDirectory(PCWSTR(workdir_w.as_ptr()))
                .map_err(|e| format!("IShellLinkW::SetWorkingDirectory failed: {e}"))?;
            link.SetIconLocation(PCWSTR(icon_w.as_ptr()), 0)
                .map_err(|e| format!("IShellLinkW::SetIconLocation failed: {e}"))?;
            link.SetDescription(PCWSTR(desc_w.as_ptr()))
                .map_err(|e| format!("IShellLinkW::SetDescription failed: {e}"))?;
            let persist: IPersistFile = link
                .cast()
                .map_err(|e| format!("QueryInterface(IPersistFile) failed: {e}"))?;
            persist
                .Save(PCWSTR(lnk_w.as_ptr()), true)
                .map_err(|e| format!("IPersistFile::Save failed: {e}"))?;
            Ok(())
        })();

        if should_uninit {
            CoUninitialize();
        }
        result
    }
}

#[cfg(not(windows))]
pub fn create_shortcut(
    _lnk_path: &Path,
    _target_exe: &Path,
    _icon_path: &Path,
    _description: &str,
) -> Result<(), String> {
    Ok(())
}

pub fn remove_shortcuts() {
    if let Some(desktop) = desktop_shortcut_path() {
        let _ = std::fs::remove_file(desktop);
    }
    if let Some(start_menu) = start_menu_shortcut_path() {
        let _ = std::fs::remove_file(start_menu);
    }
}

#[cfg(windows)]
fn broadcast_environment_change() {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };

    let env_w = to_wide("Environment");
    let mut result: usize = 0;
    unsafe {
        let _ = SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            WPARAM(0),
            LPARAM(env_w.as_ptr() as isize),
            SMTO_ABORTIFHUNG,
            3000,
            Some(&mut result),
        );
    }
}

#[cfg(windows)]
pub fn add_to_user_path(dir: &Path) -> Result<(), String> {
    let target = dir.to_string_lossy().trim_end_matches('\\').to_string();
    let target_norm = normalize_path_entry(&target);
    let current = read_reg_string("Environment", "Path").unwrap_or_default();

    let mut parts: Vec<String> = current
        .split(';')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if !parts.iter().any(|p| normalize_path_entry(p) == target_norm) {
        parts.push(target);
        write_reg_string("Environment", "Path", &parts.join(";"), true)?;
        broadcast_environment_change();
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn add_to_user_path(_dir: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
pub fn remove_from_user_path(dir: &Path) {
    let target_norm = normalize_path_entry(&dir.to_string_lossy());
    let Some(current) = read_reg_string("Environment", "Path") else {
        return;
    };
    let parts: Vec<String> = current
        .split(';')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && normalize_path_entry(s) != target_norm)
        .collect();
    let next = parts.join(";");
    if next != current {
        let _ = write_reg_string("Environment", "Path", &next, true);
        broadcast_environment_change();
    }
}

#[cfg(not(windows))]
pub fn remove_from_user_path(_dir: &Path) {}

#[cfg(windows)]
pub fn notify_shell_refresh(updated_paths: &[PathBuf]) {
    use std::ffi::c_void;
    use windows::Win32::UI::Shell::{
        SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNE_UPDATEITEM, SHCNF_FLUSH, SHCNF_PATHW,
    };

    unsafe {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_FLUSH, None, None);
        for path in updated_paths {
            if path.exists() {
                let wide = to_wide(&path.to_string_lossy());
                SHChangeNotify(
                    SHCNE_UPDATEITEM,
                    SHCNF_PATHW | SHCNF_FLUSH,
                    Some(wide.as_ptr() as *const c_void),
                    None,
                );
            }
        }
    }
}

#[cfg(not(windows))]
pub fn notify_shell_refresh(_updated_paths: &[PathBuf]) {}

#[cfg(windows)]
pub fn stop_running_detergo(install_dir: &Path) {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, TerminateProcess, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };

    let target_exe_norm = normalize_path_entry(&install_dir.join("detergo.exe").to_string_lossy());
    let my_pid = std::process::id();

    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                if entry.th32ProcessID != my_pid {
                    if let Ok(proc_handle) = OpenProcess(
                        PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE,
                        false,
                        entry.th32ProcessID,
                    ) {
                        let mut buf = [0u16; 1024];
                        let mut len = buf.len() as u32;
                        if QueryFullProcessImageNameW(
                            proc_handle,
                            PROCESS_NAME_FORMAT(0),
                            PWSTR(buf.as_mut_ptr()),
                            &mut len,
                        )
                        .is_ok()
                        {
                            let img = String::from_utf16_lossy(&buf[..len as usize]);
                            if normalize_path_entry(&img) == target_exe_norm {
                                let _ = TerminateProcess(proc_handle, 0);
                            }
                        }
                        let _ = CloseHandle(proc_handle);
                    }
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }
}

#[cfg(not(windows))]
pub fn stop_running_detergo(_install_dir: &Path) {}

#[cfg(windows)]
pub fn schedule_self_delete(install_dir: &Path) {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let temp_dir = std::env::temp_dir();
    let uninst = install_dir.join("uninstall.exe");
    let temp_uninst = temp_dir.join(format!("detergo-uninst-{}.exe", std::process::id()));

    // On NTFS a running executable can be renamed/moved across directories on
    // the same volume while still executing. Moving `uninstall.exe` into `%TEMP%`
    // lets us remove the empty installation directory synchronously before exit.
    let active_uninst = if uninst.exists() && std::fs::rename(&uninst, &temp_uninst).is_ok() {
        let _ = std::fs::remove_dir(install_dir);
        temp_uninst
    } else {
        uninst
    };

    let dir_str = install_dir.to_string_lossy();
    let uninst_str = active_uninst.to_string_lossy();

    let _ = write_reg_string(
        RUN_ONCE_REG_SUBKEY,
        "DetergoRemoveInstallDir",
        &format!("cmd.exe /c rmdir /q \"{dir_str}\""),
        false,
    );

    let raw_cmd = format!(
        "/D /S /C \"for /L %i in (1,1,20) do (del /f /q \"{uninst_str}\" >nul 2>&1 & rmdir /q \"{dir_str}\" >nul 2>&1 & if not exist \"{uninst_str}\" exit /b 0 & ping 127.0.0.1 -n 2 >nul)\""
    );
    let _ = Command::new("cmd.exe")
        .current_dir(&temp_dir)
        .raw_arg(raw_cmd)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

#[cfg(not(windows))]
pub fn schedule_self_delete(_install_dir: &Path) {}

#[cfg(windows)]
pub fn launch_installed_exe(install_dir: &Path) -> Result<(), String> {
    use std::process::Command;
    let exe = install_dir.join("detergo.exe");
    if !exe.is_file() {
        return Err(format!("Installed executable not found: {}", exe.display()));
    }
    Command::new(&exe)
        .current_dir(install_dir)
        .spawn()
        .map_err(|e| format!("Could not launch Detergo: {e}"))?;
    Ok(())
}

#[cfg(not(windows))]
pub fn launch_installed_exe(_install_dir: &Path) -> Result<(), String> {
    Ok(())
}
