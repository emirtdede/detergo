import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notificationService } from "@/lib/notifications/notification-service";
import { getUIText } from "@/lib/ui-text";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import type { NotificationChannel, NotificationPreferences } from "@/types";

// The native notification plugin is the desktop path inside the Tauri shell;
// mock it so the routing assertions can verify the payload without an OS toast.
const pluginSend = vi.fn();
const pluginGranted = vi.fn(async () => true);
const pluginRequest = vi.fn(async (): Promise<NotificationPermission> => "granted");
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => pluginGranted(),
  requestPermission: () => pluginRequest(),
  sendNotification: (payload: unknown) => pluginSend(payload),
}));

// Covers the notification matrix in MANUAL_SMOKE_CHECKLIST_2.2.1_TR.md (S-04):
// the OS toast itself is rendered by WebView2, but channel routing, permission
// handling and payload text are all decided here and can be asserted.

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  static instances: Array<{ title: string; options?: NotificationOptions }> = [];

  constructor(title: string, options?: NotificationOptions) {
    FakeNotification.instances.push({ title, options });
  }
}

const FULL_NOTIFICATIONS: NotificationPreferences = {
  scanComplete: "both",
  cleanComplete: "both",
  diskPressure: "both",
  processLock: "in_app",
  automationWebhook: "both",
  // Keep the chime out of the test: jsdom has no AudioContext and the sound
  // path is orthogonal to channel routing.
  soundEnabled: false,
};

function setChannel(key: keyof NotificationPreferences, value: NotificationChannel) {
  const current = usePreferencesStore.getState().notifications ?? FULL_NOTIFICATIONS;
  usePreferencesStore.setState({ notifications: { ...current, [key]: value } });
}

describe("notification service routing", () => {
  beforeEach(() => {
    FakeNotification.permission = "granted";
    FakeNotification.instances = [];
    pluginSend.mockClear();
    pluginGranted.mockClear();
    pluginRequest.mockClear();
    vi.stubGlobal("Notification", FakeNotification);
    useUiStore.setState({ toast: null });
    usePreferencesStore.setState({ language: "en" });
    setChannel("scanComplete", "both");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends an OS notification and an in-app toast for channel=both", () => {
    notificationService.notifyScanComplete({ targetCount: 3, reclaimBytes: 1024 });

    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0].title.length).toBeGreaterThan(0);
    expect(FakeNotification.instances[0].options?.body).toContain("3");
    expect(FakeNotification.instances[0].options?.icon).toBe("/icons/notification.png");
    expect(useUiStore.getState().toast?.type).toBe("success");
  });

  it("keeps desktop-only notifications out of the in-app toast area", () => {
    setChannel("scanComplete", "desktop");
    notificationService.notifyScanComplete({ targetCount: 1, reclaimBytes: 0 });

    expect(FakeNotification.instances).toHaveLength(1);
    expect(useUiStore.getState().toast).toBeNull();
  });

  it("keeps in-app-only notifications off the desktop", () => {
    setChannel("scanComplete", "in_app");
    notificationService.notifyScanComplete({ targetCount: 1, reclaimBytes: 0 });

    expect(FakeNotification.instances).toHaveLength(0);
    expect(useUiStore.getState().toast?.type).toBe("success");
  });

  it("does nothing for channel=none", () => {
    setChannel("scanComplete", "none");
    notificationService.notifyScanComplete({ targetCount: 1, reclaimBytes: 0 });

    expect(FakeNotification.instances).toHaveLength(0);
    expect(useUiStore.getState().toast).toBeNull();
  });

  it("never constructs an OS notification without permission", () => {
    FakeNotification.permission = "denied";
    notificationService.notifyScanComplete({ targetCount: 1, reclaimBytes: 0 });

    expect(FakeNotification.instances).toHaveLength(0);
    // The in-app path still works, so a denied permission degrades instead of
    // silently dropping the event.
    expect(useUiStore.getState().toast?.type).toBe("success");
  });

  it("reports webhook failures on the error channel without echoing raw text", () => {
    setChannel("automationWebhook", "in_app");
    notificationService.notifyAutomationWebhook({
      url: "http://127.0.0.1:9/hook",
      status: "error",
      // A legacy caller may still hand over free-form text. It must never reach
      // the UI: `reqwest` errors embed the credential-bearing webhook URL, and
      // the Action Center keeps this string in its history.
      error: "connection refused",
    });

    expect(useUiStore.getState().toast?.type).toBe("error");
    expect(useUiStore.getState().toast?.message).toContain(getUIText("en").errors.network);
    expect(useUiStore.getState().toast?.message).not.toContain("connection refused");
  });

  it("renders a classified HTTP failure as its status code", () => {
    setChannel("automationWebhook", "in_app");
    notificationService.notifyAutomationWebhook({
      url: "https://discord.com/api/webhooks/1/token",
      status: "error",
      error: "http_404",
    });

    const message = useUiStore.getState().toast?.message ?? "";
    expect(message).toContain("HTTP 404");
    // The webhook path is the bearer token; only the classified code may leak.
    expect(message).not.toContain("token");
  });

  it("localizes the payload when the language changes", () => {
    usePreferencesStore.setState({ language: "tr" });
    notificationService.notifyScanComplete({ targetCount: 2, reclaimBytes: 2048 });

    const body = FakeNotification.instances[0].options?.body ?? "";
    expect(body).toContain("2");
    expect(body).not.toMatch(/^Scan complete/i);
  });

  // WebView2 ignores `new Notification()`, so inside the Tauri shell desktop
  // delivery must go through the native plugin (real Windows toast).
  it("uses the native plugin inside the Tauri shell", async () => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    setChannel("scanComplete", "desktop");
    try {
      notificationService.notifyScanComplete({ targetCount: 4, reclaimBytes: 0 });
      await vi.waitFor(() => expect(pluginSend).toHaveBeenCalledTimes(1));
    } finally {
      delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }

    expect(FakeNotification.instances).toHaveLength(0);
    expect(useUiStore.getState().toast).toBeNull();
    const payload = pluginSend.mock.calls[0][0] as { title: string; body: string };
    expect(payload.body).toContain("4");
  });

  it("falls back to an in-app toast when desktop-only delivery is denied", async () => {
    FakeNotification.permission = "denied";
    setChannel("scanComplete", "desktop");
    notificationService.notifyScanComplete({ targetCount: 1, reclaimBytes: 0 });

    expect(FakeNotification.instances).toHaveLength(0);
    // A desktop-only preference must not drop the event just because the OS
    // refused the toast.
    await vi.waitFor(() => expect(useUiStore.getState().toast?.type).toBe("success"));
  });

  it("falls back in-app when the native plugin denies permission", async () => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    pluginGranted.mockResolvedValueOnce(false);
    pluginRequest.mockResolvedValueOnce("denied");
    setChannel("scanComplete", "desktop");
    try {
      notificationService.notifyScanComplete({ targetCount: 1, reclaimBytes: 0 });
      await vi.waitFor(() => expect(useUiStore.getState().toast?.type).toBe("success"));
    } finally {
      delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
    expect(pluginSend).not.toHaveBeenCalled();
  });

  it("mentions the stop reason when a partial scan finishes", () => {
    setChannel("scanComplete", "in_app");
    notificationService.notifyScanComplete({
      targetCount: 2,
      reclaimBytes: 1024,
      partial: true,
      stopReason: "timeout",
    });

    expect(useUiStore.getState().toast?.message.toLowerCase()).toContain("partial");
    expect(useUiStore.getState().toast?.message.toLowerCase()).toContain("timeout");
  });

  it("sends the desktop test notification through the native plugin", async () => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    try {
      await notificationService.testDesktopNotification();
    } finally {
      delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }

    expect(FakeNotification.instances).toHaveLength(0);
    expect(pluginSend).toHaveBeenCalledTimes(1);
  });
});
