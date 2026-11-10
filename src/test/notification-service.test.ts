import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notificationService } from "@/lib/notifications/notification-service";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import type { NotificationChannel, NotificationPreferences } from "@/types";

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

  it("reports webhook failures on the error channel", () => {
    setChannel("automationWebhook", "in_app");
    notificationService.notifyAutomationWebhook({
      url: "http://127.0.0.1:9/hook",
      status: "error",
      error: "connection refused",
    });

    expect(useUiStore.getState().toast?.type).toBe("error");
    expect(useUiStore.getState().toast?.message).toContain("connection refused");
  });

  it("localizes the payload when the language changes", () => {
    usePreferencesStore.setState({ language: "tr" });
    notificationService.notifyScanComplete({ targetCount: 2, reclaimBytes: 2048 });

    const body = FakeNotification.instances[0].options?.body ?? "";
    expect(body).toContain("2");
    expect(body).not.toMatch(/^Scan complete/i);
  });
});
