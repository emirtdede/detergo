import { scannerApi } from "@/lib/tauri/scanner-api";
import { usePreferencesStore } from "@/stores/preferences-store";
import { log } from "@/lib/logging";
import { notificationService } from "./notification-service";
import { classifyWebhookFailure } from "@/lib/errors/webhook-failure";

/**
 * Notifications and webhooks are fired from the frontend because the settings
 * live here (and are mirrored to the backend). Every helper fails soft: an
 * automation problem must never turn a finished scan/cleanup into an error.
 */

/** A volume above this usage is reported as "almost full". */
const DISK_PRESSURE_PERCENT = 90;

/**
 * A drive that stays above the threshold would otherwise trigger the same
 * warning after every scan and every cleanup. Six hours keeps the alert
 * useful without turning it into noise; a drive that recovers and fills up
 * again is allowed to notify immediately.
 */
const DISK_PRESSURE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * The cooldown must survive a restart. Keeping it only in memory meant that
 * opening the app twice in a row re-sent the same "disk almost full" alert.
 * A broken or unavailable store degrades to the in-memory behaviour.
 *
 * The key carries the shipped product name. 2.2.1 wrote the same cooldown under
 * the retired `node-cleaner.` prefix; that entry is migrated on read and removed
 * so the old identity cannot reappear in a WebView2 profile dump.
 */
const DISK_COOLDOWN_STORAGE_KEY = "detergo.disk-pressure-cooldown.v1";
const LEGACY_DISK_COOLDOWN_STORAGE_KEY = "node-cleaner.disk-pressure-cooldown.v1";

/**
 * `localStorage` as a global resolves to Node's experimental stub in some test
 * runners; the browser storage lives on `window`. Returning null degrades to the
 * in-memory cooldown instead of throwing.
 */
function getStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    // Storage disabled by privacy settings.
  }
  return null;
}

function readDiskCooldown(): Map<string, number> {
  const map = new Map<string, number>();
  try {
    const storage = getStorage();
    if (!storage) return map;
    let raw = storage.getItem(DISK_COOLDOWN_STORAGE_KEY);
    if (!raw) {
      // 2.2.1 and earlier stored the same map under the retired product name.
      const legacy = storage.getItem(LEGACY_DISK_COOLDOWN_STORAGE_KEY);
      if (legacy) {
        storage.setItem(DISK_COOLDOWN_STORAGE_KEY, legacy);
        raw = legacy;
      }
      try {
        storage.removeItem(LEGACY_DISK_COOLDOWN_STORAGE_KEY);
      } catch {
        // Read-only storage: the migration still happened for this session.
      }
    }
    if (!raw) return map;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return map;
    const now = Date.now();
    for (const [drive, value] of Object.entries(parsed as Record<string, unknown>)) {
      // Ignore stale entries: they would suppress a legitimate alert forever.
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (now - value >= DISK_PRESSURE_COOLDOWN_MS) continue;
      map.set(drive, value);
    }
  } catch {
    // Storage can be disabled or full; the alert still works for this session.
  }
  return map;
}

function writeDiskCooldown(map: Map<string, number>): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    storage.setItem(DISK_COOLDOWN_STORAGE_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    // Same fallback as above: memory-only cooldown, never a user-visible error.
  }
}

/**
 * Lazily initialised: reading `localStorage` at module import ran before the
 * webview had a profile to read and made the map impossible to re-seed in a
 * test. `resetDiskPressureCooldown` drops it so the next check re-reads.
 */
let lastDiskAlertAt: Map<string, number> | null = null;

function cooldownEntries(): Map<string, number> {
  if (lastDiskAlertAt === null) lastDiskAlertAt = readDiskCooldown();
  return lastDiskAlertAt;
}

// Exported for tests: module state must not leak between cases.
export function resetDiskPressureCooldown(): void {
  lastDiskAlertAt = null;
  try {
    getStorage()?.removeItem(DISK_COOLDOWN_STORAGE_KEY);
    getStorage()?.removeItem(LEGACY_DISK_COOLDOWN_STORAGE_KEY);
  } catch {
    // Storage unavailable: clearing memory is still correct.
  }
}

function isWebhookEnabled(event: "scan" | "clean"): boolean {
  const prefs = usePreferencesStore.getState();
  return Boolean(event === "scan" ? prefs.webhookOnScan : prefs.webhookOnClean);
}

export async function dispatchLifecycleWebhook(
  event: "scan" | "clean",
  payload: Record<string, unknown>,
): Promise<void> {
  const prefs = usePreferencesStore.getState();
  const url = prefs.webhookUrl?.trim();
  // No URL or the per-event toggle off means the user never asked for a call.
  // Do not surface "disabled" as an error.
  if (!url || !isWebhookEnabled(event)) return;
  try {
    const result = await scannerApi.dispatchWebhook(event, payload);
    notificationService.notifyAutomationWebhook({
      url,
      status: result.ok ? "success" : "error",
      // The backend message can contain the full URL (its path is the token).
      // Only a classified reason may reach the notification center, which keeps
      // the message in OS history.
      error: result.ok ? undefined : classifyWebhookFailure(result.status),
    });
  } catch (err) {
    log.warn(`Webhook (${event}) could not be delivered`, err);
    notificationService.notifyAutomationWebhook({
      url,
      status: "error",
      error: "network",
    });
  }
}

/**
 * Looks at every local volume and warns about the fullest one when it crosses
 * the pressure threshold. Reporting only the worst volume avoids one toast per
 * drive after a single scan.
 */
export async function checkDiskPressure(): Promise<void> {
  const channel = usePreferencesStore.getState().notifications?.diskPressure;
  if (channel === "none") return;
  try {
    const volumes = await scannerApi.getDiskPressure();
    const critical = volumes
      .filter((volume) => volume.totalBytes > 0 && volume.percentUsed >= DISK_PRESSURE_PERCENT)
      .sort((a, b) => b.percentUsed - a.percentUsed);
    // Forget drives that are healthy again so their next fill-up is reported.
    const cooldowns = cooldownEntries();
    const criticalDrives = new Set(critical.map((volume) => volume.drive));
    let cooldownChanged = false;
    for (const drive of [...cooldowns.keys()]) {
      if (!criticalDrives.has(drive)) {
        cooldowns.delete(drive);
        cooldownChanged = true;
      }
    }
    const worst = critical[0];
    if (worst) {
      const last = cooldowns.get(worst.drive) ?? 0;
      // On cooldown: do not notify, but still fall through to the write below.
      // Returning here dropped the pruning done above, so a drive that
      // recovered stayed "recently alerted" in storage and its next fill-up was
      // silenced even though the user had never been told about it again.
      if (Date.now() - last >= DISK_PRESSURE_COOLDOWN_MS) {
        cooldowns.set(worst.drive, Date.now());
        cooldownChanged = true;
        notificationService.notifyDiskPressure({
          drive: worst.drive,
          freeBytes: worst.freeBytes,
          percentUsed: worst.percentUsed,
        });
      }
    }
    if (cooldownChanged) writeDiskCooldown(cooldowns);
  } catch (err) {
    log.warn("Disk pressure check failed", err);
  }
}

function isLockCode(code?: string | null): boolean {
  if (!code) return false;
  const normalized = code.toUpperCase().replace(/[-_\s]/g, "");
  return (
    normalized === "INUSE" ||
    normalized === "PROCESSLOCK" ||
    normalized === "RECYCLEBINSHARINGVIOLATION" ||
    normalized === "SHARINGVIOLATION"
  );
}

/** Surfaces files that could not be cleaned because a process held them. */
export function notifyLockedTargets(
  results: Array<{ success: boolean; displayPath: string; errorCode?: string | null }>,
): void {
  const locked = results.filter((result) => !result.success && isLockCode(result.errorCode));
  for (const result of locked.slice(0, 3)) {
    notificationService.notifyProcessLock({
      path: result.displayPath,
      reason: result.errorCode ?? undefined,
    });
  }
}
