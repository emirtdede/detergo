import { scannerApi } from "@/lib/tauri/scanner-api";
import { useCleanupRunStore } from "@/stores/cleanup-run-store";
import { useSystemStore } from "@/stores/system-store";

export interface QuitApi {
  cancelCleanup: () => Promise<void>;
  systemCancel?: () => Promise<void>;
  quitApp: () => Promise<void>;
}

/**
 * Quit without cutting an active cleanup in half.
 *
 * The backend `quit_app` command cancels and waits for the run itself, but the
 * UI must also enter the "cancelling" state first: otherwise the progress dock
 * keeps claiming work is running while the process is already waiting to die.
 */
export async function requestQuit(api: QuitApi = scannerApi): Promise<void> {
  const run = useCleanupRunStore.getState();
  if (run.progress) {
    run.markCancelling();
    try {
      // The backend repeats this idempotently; doing it here shortens the
      // window in which a large target is still being processed.
      await api.cancelCleanup();
    } catch {
      // A failed cancel request must not trap the user in the app. The native
      // quit command still cancels and waits before exiting.
    }
  }
  if (useSystemStore.getState().running) {
    try {
      await api.systemCancel?.();
    } catch {
      // Backend quit_app cancels and waits for system_token as well.
    }
  }
  await api.quitApp();
}
