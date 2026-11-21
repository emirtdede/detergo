//! Installation channel and Windows Authenticode signature inspection.
//!
//! Detecting the installation channel guarantees that:
//!  - Microsoft Store (MSIX) installations delegate updates exclusively to the
//!    Store (compliant with Microsoft Store Policy and preventing duplicate
//!    MSIX + NSIS installs);
//!  - Installed NSIS/MSI copies receive installer packages;
//!  - Portable executables receive portable packages without altering the host.

use std::path::Path;

use serde::{Deserialize, Serialize};

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InstallChannel {
    MsixStore,
    Installer,
    Portable,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SignatureStatus {
    /// Authenticode signature verified cleanly by Windows WinVerifyTrust.
    Valid,
    /// Binary has no Authenticode signature (expected for unsigned dev/OSS builds).
    Unsigned,
    /// Signature is present but tampered, expired, or not trusted by OS policy.
    Untrusted,
    /// Signature verification is not available on this platform.
    Unavailable,
}

/// Detects the channel for the currently running executable.
pub fn detect_install_channel() -> InstallChannel {
    if is_msix_packaged() {
        return InstallChannel::MsixStore;
    }
    match std::env::current_exe() {
        Ok(exe) => classify_executable_path(&exe),
        Err(_) => InstallChannel::Portable,
    }
}

/// Classifies a non-MSIX executable path into `Installer` vs `Portable`.
pub fn classify_executable_path(exe: &Path) -> InstallChannel {
    if let Some(dir) = exe.parent() {
        if dir.join("uninstall.exe").is_file() || dir.join("Uninstall.exe").is_file() {
            return InstallChannel::Installer;
        }
    }
    let normalized = exe
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();
    if normalized.contains("\\windowsapps\\") {
        return InstallChannel::MsixStore;
    }
    if normalized.contains("\\program files\\")
        || normalized.contains("\\program files (x86)\\")
        || normalized.contains("\\appdata\\local\\programs\\")
    {
        return InstallChannel::Installer;
    }
    InstallChannel::Portable
}

#[cfg(windows)]
fn is_msix_packaged() -> bool {
    use std::ffi::c_void;
    use windows::core::s;
    use windows::Win32::Foundation::HMODULE;

    type GetCurrentPackageFullNameFn = unsafe extern "system" fn(*mut u32, *mut u16) -> i32;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleA(lp_module_name: *const u8) -> HMODULE;
        fn GetProcAddress(h_module: HMODULE, lp_proc_name: *const u8) -> *const c_void;
    }

    // APPMODEL_ERROR_NO_PACKAGE = 15700, ERROR_INSUFFICIENT_BUFFER = 122, ERROR_SUCCESS = 0.
    const ERROR_SUCCESS: i32 = 0;
    const ERROR_INSUFFICIENT_BUFFER: i32 = 122;

    unsafe {
        let module = GetModuleHandleA(s!("kernel32.dll").as_ptr());
        if module.is_invalid() {
            return false;
        }
        let proc = GetProcAddress(module, s!("GetCurrentPackageFullName").as_ptr());
        if proc.is_null() {
            return false;
        }
        let func: GetCurrentPackageFullNameFn = std::mem::transmute(proc);
        let mut length: u32 = 0;
        let status = func(&mut length, std::ptr::null_mut());
        status == ERROR_INSUFFICIENT_BUFFER || (status == ERROR_SUCCESS && length > 0)
    }
}

#[cfg(not(windows))]
fn is_msix_packaged() -> bool {
    false
}

/// Checks Windows Authenticode signature status via `WinVerifyTrust` loaded
/// dynamically from `wintrust.dll` (zero extra crate dependencies).
#[cfg(windows)]
pub fn verify_authenticode_signature(path: &Path) -> SignatureStatus {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{s, GUID};
    use windows::Win32::Foundation::{HANDLE, HMODULE, HWND};

    #[repr(C)]
    struct WinTrustFileInfo {
        cb_struct: u32,
        pcwsz_file_path: *const u16,
        h_file: HANDLE,
        pg_known_subject: *const GUID,
    }

    #[repr(C)]
    struct WinTrustData {
        cb_struct: u32,
        p_policy_callback_data: *mut c_void,
        p_sip_client_data: *mut c_void,
        dw_ui_choice: u32,
        fdw_revocation_checks: u32,
        dw_union_choice: u32,
        p_file: *mut WinTrustFileInfo,
        dw_state_action: u32,
        h_wvt_state_data: HANDLE,
        pwsz_url_reference: *const u16,
        dw_prov_flags: u32,
        dw_ui_context: u32,
        p_signature_settings: *mut c_void,
    }

    type WinVerifyTrustFn = unsafe extern "system" fn(HWND, *const GUID, *mut c_void) -> i32;

    #[link(name = "kernel32")]
    extern "system" {
        fn LoadLibraryA(lp_lib_file_name: *const u8) -> HMODULE;
        fn FreeLibrary(h_lib_module: HMODULE) -> i32;
        fn GetProcAddress(h_module: HMODULE, lp_proc_name: *const u8) -> *const c_void;
    }

    // WINTRUST_ACTION_GENERIC_VERIFY_V2 = {00AAC56B-CD44-11d0-8CC2-00C04FC295EE}
    const ACTION_GENERIC_VERIFY_V2: GUID = GUID::from_u128(0x00aac56b_cd44_11d0_8cc2_00c04fc295ee);
    const WTD_UI_NONE: u32 = 2;
    const WTD_REVOKE_NONE: u32 = 0;
    const WTD_CHOICE_FILE: u32 = 1;
    const WTD_STATEACTION_VERIFY: u32 = 1;
    const WTD_STATEACTION_CLOSE: u32 = 2;
    // TRUST_E_NOSIGNATURE = 0x800B0100 as signed i32
    const TRUST_E_NOSIGNATURE: i32 = -2146762496;

    let wide_path: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let lib = LoadLibraryA(s!("wintrust.dll").as_ptr());
        if lib.is_invalid() {
            return SignatureStatus::Unavailable;
        }
        let proc = GetProcAddress(lib, s!("WinVerifyTrust").as_ptr());
        if proc.is_null() {
            let _ = FreeLibrary(lib);
            return SignatureStatus::Unavailable;
        }
        let win_verify_trust: WinVerifyTrustFn = std::mem::transmute(proc);

        let mut file_info = WinTrustFileInfo {
            cb_struct: std::mem::size_of::<WinTrustFileInfo>() as u32,
            pcwsz_file_path: wide_path.as_ptr(),
            h_file: HANDLE::default(),
            pg_known_subject: std::ptr::null(),
        };
        let mut data = WinTrustData {
            cb_struct: std::mem::size_of::<WinTrustData>() as u32,
            p_policy_callback_data: std::ptr::null_mut(),
            p_sip_client_data: std::ptr::null_mut(),
            dw_ui_choice: WTD_UI_NONE,
            fdw_revocation_checks: WTD_REVOKE_NONE,
            dw_union_choice: WTD_CHOICE_FILE,
            p_file: &mut file_info,
            dw_state_action: WTD_STATEACTION_VERIFY,
            h_wvt_state_data: HANDLE::default(),
            pwsz_url_reference: std::ptr::null(),
            dw_prov_flags: 0,
            dw_ui_context: 0,
            p_signature_settings: std::ptr::null_mut(),
        };

        let status = win_verify_trust(
            HWND(std::ptr::null_mut()),
            &ACTION_GENERIC_VERIFY_V2,
            (&mut data as *mut WinTrustData).cast(),
        );

        data.dw_state_action = WTD_STATEACTION_CLOSE;
        let _ = win_verify_trust(
            HWND(std::ptr::null_mut()),
            &ACTION_GENERIC_VERIFY_V2,
            (&mut data as *mut WinTrustData).cast(),
        );
        let _ = FreeLibrary(lib);

        match status {
            0 => SignatureStatus::Valid,
            TRUST_E_NOSIGNATURE => SignatureStatus::Unsigned,
            _ => SignatureStatus::Untrusted,
        }
    }
}

#[cfg(not(windows))]
pub fn verify_authenticode_signature(_path: &Path) -> SignatureStatus {
    SignatureStatus::Unavailable
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn classifies_installer_and_portable_paths() {
        assert_eq!(
            classify_executable_path(&PathBuf::from(r"C:\Program Files\Detergo\detergo.exe")),
            InstallChannel::Installer
        );
        assert_eq!(
            classify_executable_path(&PathBuf::from(
                r"C:\Users\dev\AppData\Local\Programs\Detergo\detergo.exe"
            )),
            InstallChannel::Installer
        );
        assert_eq!(
            classify_executable_path(&PathBuf::from(
                r"C:\Program Files\WindowsApps\Vellium.Detergo_1.0.0\detergo.exe"
            )),
            InstallChannel::MsixStore
        );
        assert_eq!(
            classify_executable_path(&PathBuf::from(r"D:\Tools\Detergo-1.0.0-Portable.exe")),
            InstallChannel::Portable
        );
    }

    #[test]
    fn detects_uninstall_exe_sibling_as_installer() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("uninstall.exe"), b"").expect("write uninstall");
        let exe = dir.path().join("detergo.exe");
        assert_eq!(classify_executable_path(&exe), InstallChannel::Installer);
    }
}
