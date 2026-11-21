#![cfg(windows)]

use windows::Win32::Foundation::HWND;
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow,
    ShowWindow, SW_RESTORE, SW_SHOW,
};

// NOTE: There is deliberately no "zombie process killer" here.
//
// A previous implementation enumerated processes whose executable name looked
// like Detergo and terminated every one without a *visible* window. That
// killed live MCP stdio servers and running CLI scans (they have no windows at
// all) and it also killed a GUI hidden in the tray, breaking single-instance
// behaviour.
//
// `tauri-plugin-single-instance` already owns this problem: a live GUI keeps a
// named mutex and a hidden message window for its whole lifetime, and the OS
// releases both when the process exits. A second launch therefore either
// forwards its arguments to the first instance (which shows the window) or the
// lock is already free. Killing processes by name is never required and is
// unsafe.

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
