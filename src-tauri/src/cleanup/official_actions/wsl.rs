//! Dynamic WSL virtual disk (`ext4.vhdx`) discovery via Windows Registry.
//!
//! Previously WSL pointed at `%LOCALAPPDATA%\Packages`, which contains every
//! installed Microsoft Store / UWP application on the machine. Reading
//! `HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss\*` (`BasePath`) finds
//! only actual WSL distribution virtual disks so sizes are exact and honest.

use std::path::PathBuf;

#[cfg(windows)]
fn expand_percent_env_vars(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        if let Some(end) = after.find('%') {
            let name = &after[..end];
            if !name.is_empty() {
                if let Ok(val) = std::env::var(name) {
                    out.push_str(&val);
                } else {
                    out.push('%');
                    out.push_str(name);
                    out.push('%');
                }
            } else {
                out.push('%');
            }
            rest = &after[end + 1..];
        } else {
            out.push_str(&rest[start..]);
            rest = "";
            break;
        }
    }
    out.push_str(rest);
    out
}

/// Returns existing WSL `ext4.vhdx` virtual disk paths on this machine.
#[cfg(windows)]
pub fn discover_wsl_vhdx_paths() -> Vec<PathBuf> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_READ, REG_EXPAND_SZ, REG_SZ, REG_VALUE_TYPE,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    let mut out: Vec<PathBuf> = Vec::new();
    let subkey = wide(r"Software\Microsoft\Windows\CurrentVersion\Lxss");
    let mut root_key = HKEY::default();

    let open_ok = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            0,
            KEY_READ,
            &mut root_key,
        )
    };
    if open_ok.is_err() {
        return out;
    }

    let mut index: u32 = 0;
    let value_name = wide("BasePath");

    loop {
        let mut name_buf = [0u16; 256];
        let mut name_len = name_buf.len() as u32;
        let enum_res = unsafe {
            RegEnumKeyExW(
                root_key,
                index,
                windows::core::PWSTR(name_buf.as_mut_ptr()),
                &mut name_len,
                None,
                windows::core::PWSTR::null(),
                None,
                None,
            )
        };
        if enum_res.is_err() {
            break;
        }
        index += 1;

        let mut child_key = HKEY::default();
        let child_open = unsafe {
            RegOpenKeyExW(
                root_key,
                PCWSTR(name_buf.as_ptr()),
                0,
                KEY_READ,
                &mut child_key,
            )
        };
        if child_open.is_err() {
            continue;
        }

        let mut reg_type = REG_VALUE_TYPE::default();
        let mut data_len: u32 = 0;
        let size_res = unsafe {
            RegQueryValueExW(
                child_key,
                PCWSTR(value_name.as_ptr()),
                None,
                Some(&mut reg_type),
                None,
                Some(&mut data_len),
            )
        };
        if size_res.is_ok()
            && data_len >= 2
            && (reg_type == REG_SZ || reg_type == REG_EXPAND_SZ)
            && data_len <= 65536
        {
            let mut raw = vec![0u8; data_len as usize];
            let read_res = unsafe {
                RegQueryValueExW(
                    child_key,
                    PCWSTR(value_name.as_ptr()),
                    None,
                    Some(&mut reg_type),
                    Some(raw.as_mut_ptr()),
                    Some(&mut data_len),
                )
            };
            if read_res.is_ok() {
                let units: Vec<u16> = raw[..data_len as usize]
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|c| u16::from_le_bytes(*c))
                    .take_while(|&u| u != 0)
                    .collect();
                let raw_path = OsString::from_wide(&units).to_string_lossy().to_string();
                let expanded = if reg_type == REG_EXPAND_SZ {
                    expand_percent_env_vars(&raw_path)
                } else {
                    raw_path
                };
                let cleaned = expanded.strip_prefix(r"\\?\").unwrap_or(&expanded);
                let base = PathBuf::from(cleaned);
                let vhdx = base.join("ext4.vhdx");
                if vhdx.is_file() && !out.contains(&vhdx) {
                    out.push(vhdx);
                }
            }
        }
        let _ = unsafe { RegCloseKey(child_key) };
    }

    let _ = unsafe { RegCloseKey(root_key) };

    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let wsl_root = PathBuf::from(local).join("wsl");
        if let Ok(entries) = std::fs::read_dir(&wsl_root) {
            for entry in entries.flatten() {
                let vhdx = entry.path().join("ext4.vhdx");
                if vhdx.is_file() && !out.contains(&vhdx) {
                    out.push(vhdx);
                }
            }
        }
    }

    out
}

#[cfg(not(windows))]
pub fn discover_wsl_vhdx_paths() -> Vec<PathBuf> {
    Vec::new()
}
