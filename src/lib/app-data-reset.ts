/**
 * Coordinates the factory-reset flow between the Settings action and the
 * module-level persistence helpers.
 *
 * `window.location.reload()` fires `pagehide`, and the app flushes settings and
 * the last-scan snapshot from that listener. Those flushes run *after* the
 * backend has deleted the files, so they would recreate `config.json` and
 * `last-scan.json` from the old in-memory state. The flag below tells both
 * flush paths to stay quiet until the document is torn down.
 */
const RESET_NOTICE_KEY = "dev_cleaner_reset_completed";

let resetInProgress = false;

/** Marks the current document as disposable; persistence must stop. */
export function beginAppDataReset(): void {
  resetInProgress = true;
}

/**
 * Restores normal persistence when the backend refused the reset (for example
 * because a cleanup started between the click and the command).
 */
export function cancelAppDataReset(): void {
  resetInProgress = false;
}

/** True once the reset succeeded and the webview is about to reload. */
export function isAppDataResetting(): boolean {
  return resetInProgress;
}

/**
 * Leaves a one-shot flag for the next document. `sessionStorage` survives a
 * reload and is scoped to this window, which is exactly the lifetime needed
 * for the "reset completed" toast.
 */
export function markAppDataResetCompleted(): void {
  try {
    sessionStorage.setItem(RESET_NOTICE_KEY, "1");
  } catch {
    // The reset itself already succeeded; losing the toast is acceptable.
  }
}

/** Reads and clears the one-shot reset notice. */
export function consumeAppDataResetNotice(): boolean {
  try {
    if (sessionStorage.getItem(RESET_NOTICE_KEY) !== "1") return false;
    sessionStorage.removeItem(RESET_NOTICE_KEY);
    return true;
  } catch {
    return false;
  }
}
