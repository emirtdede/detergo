#![cfg(windows)]

use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    AttachThreadInput, GetCurrentProcessId, GetCurrentThreadId, OpenProcess, TerminateProcess,
    PROCESS_TERMINATE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindowThreadProcessId, IsWindowVisible,
    SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
};

/// Forces a window to the immediate foreground on Windows, bypassing OS focus locks.
pub fn force_foreground(hwnd: HWND) {
    unsafe {
        let foreground_hwnd = GetForegroundWindow();
        let foreground_thread = GetWindowThreadProcessId(foreground_hwnd, None);
        let current_thread = GetCurrentThreadId();

        if foreground_thread != 0 && foreground_thread != current_thread {
            let _ = AttachThreadInput(foreground_thread, current_thread, true);
            let _ = ShowWindow(hwnd, SW_SHOW);
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = BringWindowToTop(hwnd);
            let _ = SetForegroundWindow(hwnd);
            let _ = AttachThreadInput(foreground_thread, current_thread, false);
        } else {
            let _ = ShowWindow(hwnd, SW_SHOW);
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = BringWindowToTop(hwnd);
            let _ = SetForegroundWindow(hwnd);
        }
    }
}

struct WindowSearchState {
    target_pid: u32,
    found_windows: Vec<HWND>,
}

unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let state = &mut *(lparam.0 as *mut WindowSearchState);
    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == state.target_pid {
        state.found_windows.push(hwnd);
    }
    BOOL(1)
}

/// Checks if a process has any visible or valid top-level window.
pub fn process_has_window(pid: u32) -> bool {
    let mut state = WindowSearchState {
        target_pid: pid,
        found_windows: Vec::new(),
    };
    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_callback),
            LPARAM(&mut state as *mut WindowSearchState as isize),
        );
    }
    state
        .found_windows
        .iter()
        .any(|&hwnd| unsafe { IsWindowVisible(hwnd).as_bool() })
}

/// Pre-flight orphan cleanup:
/// If another instance of Dev Cleaner is running in the background as a headless
/// zombie (e.g. from an aborted CLI command, background task, or crashed webview)
/// without any window, terminate it cleanly so the current launch can claim the
/// single-instance lock and present a visible desktop window.
pub fn preflight_cleanup_zombies() {
    unsafe {
        let current_pid = GetCurrentProcessId();
        let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(handle) => handle,
            Err(_) => return,
        };

        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let pid = entry.th32ProcessID;
                if pid != current_pid && pid != 0 {
                    let len = entry
                        .szExeFile
                        .iter()
                        .position(|&c| c == 0)
                        .unwrap_or(entry.szExeFile.len());
                    let exe_name = OsString::from_wide(&entry.szExeFile[..len])
                        .to_string_lossy()
                        .to_lowercase();

                    if exe_name.contains("dev-cleaner")
                        || exe_name.contains("dev cleaner")
                        || exe_name.contains("node-cleaner")
                        || exe_name.contains("node cleaner")
                    {
                        // Check if this instance has a visible window
                        let has_win = process_has_window(pid);
                        if !has_win {
                            // Headless zombie process holding the lock! Terminate it.
                            if let Ok(proc_handle) = OpenProcess(PROCESS_TERMINATE, false, pid) {
                                let _ = TerminateProcess(proc_handle, 1);
                                let _ = windows::Win32::Foundation::CloseHandle(proc_handle);
                            }
                        }
                    }
                }

                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }

        let _ = windows::Win32::Foundation::CloseHandle(snapshot);
    }
}
