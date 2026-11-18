import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DiskSpaceInfo } from "@/types";

// Only the two calls reached on this path are stubbed; the real module pulls in
// the whole Tauri bridge, which does not exist under jsdom.
const getDiskPressure = vi.fn<() => Promise<DiskSpaceInfo[]>>();
const notifyDiskPressure = vi.fn();

vi.mock("@/lib/tauri/scanner-api", () => ({
  scannerApi: {
    getDiskPressure: () => getDiskPressure(),
  },
}));

vi.mock("@/lib/notifications/notification-service", () => ({
  notificationService: {
    notifyDiskPressure: (payload: unknown) => notifyDiskPressure(payload),
  },
}));

import { checkDiskPressure, resetDiskPressureCooldown } from "@/lib/notifications/lifecycle";
import { usePreferencesStore } from "@/stores/preferences-store";

const COOLDOWN_KEY = "dev-cleaner.disk-pressure-cooldown.v1";
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * jsdom in this Node build leaves `window.localStorage` undefined (the global
 * `localStorage` belongs to Node's experimental implementation, which needs a
 * `--localstorage-file`). Install a real `Storage` so the cooldown path — which
 * correctly degrades to memory when storage is missing — is actually exercised.
 */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

function volume(drive: string, percentUsed: number): DiskSpaceInfo {
  return { drive, percentUsed, freeBytes: 5, totalBytes: 100 };
}

function storedCooldowns(): Record<string, number> {
  const raw = window.localStorage.getItem(COOLDOWN_KEY);
  return raw ? (JSON.parse(raw) as Record<string, number>) : {};
}

describe("disk pressure cooldown", () => {
  const storage = new MemoryStorage();

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
    resetDiskPressureCooldown();
    getDiskPressure.mockReset();
    notifyDiskPressure.mockReset();
    usePreferencesStore.setState({
      notifications: {
        scanComplete: "both",
        cleanComplete: "both",
        diskPressure: "both",
        processLock: "in_app",
        automationWebhook: "both",
        soundEnabled: false,
      },
    });
  });

  it("prunes a recovered drive even when the critical drive is on cooldown", async () => {
    const now = Date.now();
    // `C:` alerted recently but is healthy again; `D:` alerted recently and is
    // still critical. The prune of `C:` used to be skipped by an early return,
    // so `C:` stayed in storage and its next fill-up was silenced.
    window.localStorage.setItem(COOLDOWN_KEY, JSON.stringify({ "C:": now, "D:": now }));
    getDiskPressure.mockResolvedValue([volume("D:", 95)]);

    await checkDiskPressure();

    expect(notifyDiskPressure).not.toHaveBeenCalled();
    expect(storedCooldowns()).toEqual({ "D:": now });
  });

  it("notifies and records the cooldown for a newly critical drive", async () => {
    getDiskPressure.mockResolvedValue([volume("E:", 92)]);

    await checkDiskPressure();

    expect(notifyDiskPressure).toHaveBeenCalledTimes(1);
    expect(storedCooldowns()["E:"]).toBeGreaterThan(0);
  });

  it("alerts again once the cooldown has elapsed", async () => {
    window.localStorage.setItem(
      COOLDOWN_KEY,
      JSON.stringify({ "D:": Date.now() - SIX_HOURS_MS - 1 }),
    );
    getDiskPressure.mockResolvedValue([volume("D:", 97)]);

    await checkDiskPressure();

    expect(notifyDiskPressure).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the notification channel is off", async () => {
    usePreferencesStore.setState({
      notifications: {
        scanComplete: "both",
        cleanComplete: "both",
        diskPressure: "none",
        processLock: "in_app",
        automationWebhook: "both",
        soundEnabled: false,
      },
    });
    getDiskPressure.mockResolvedValue([volume("D:", 99)]);

    await checkDiskPressure();

    expect(getDiskPressure).not.toHaveBeenCalled();
    expect(notifyDiskPressure).not.toHaveBeenCalled();
  });
});
