import { getUIText, localizeStopReason } from "@/lib/ui-text";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { formatBytes } from "@/lib/formatters";
import { maskPath } from "@/lib/format/path";
import { log } from "@/lib/logging";
import { isTauriEnvironment } from "@/lib/tauri/scanner-api";
import { describeWebhookFailure } from "@/lib/errors/webhook-failure";
import { NotificationChannel } from "@/types";

/**
 * Webhook URLs are bearer credentials: Discord/Slack/Teams embed a
 * channel-scoped token in the path. Notifications are persisted by the OS
 * (Action Center history, lock screen) and by CLI logs, so only the origin may
 * be shown.
 */
export function redactWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.port
      ? `${parsed.protocol}//${parsed.hostname}:${parsed.port}`
      : `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return "webhook";
  }
}

export interface ScanCompletedEvent {
  targetCount: number;
  reclaimBytes: number;
  durationMs?: number;
  /** A limited/timed-out scan still deserves a completion notice. */
  partial?: boolean;
  stopReason?: string | null;
}

export interface CleanCompletedEvent {
  count: number;
  bytes: number;
  destination?: string;
}

export interface DiskPressureEvent {
  drive: string;
  freeBytes: number;
  percentUsed: number;
}

export interface ProcessLockEvent {
  path: string;
  reason?: string;
}

export interface WebhookEvent {
  url: string;
  status: "success" | "error";
  error?: string;
}

class NotificationService {
  private hasPermission = false;
  private audioCtx: AudioContext | null = null;
  private audioPrimed = false;

  constructor() {
    // Only read the current permission at startup. Requesting here would show a
    // system prompt before the user has done anything; the prompt is deferred
    // to the first delivery or to the explicit "test notification" action in
    // Settings, which goes through `requestDesktopPermission` or `sendDesktop`.
    this.readPermission();
    this.primeAudio();
  }

  private readPermission() {
    // Inside the Tauri shell permission is owned by the native notification
    // plugin, not by `window.Notification` (which WebView2 never renders).
    if (isTauriEnvironment()) return;
    if (typeof window !== "undefined" && "Notification" in window) {
      this.hasPermission = Notification.permission === "granted";
    }
  }

  public async requestDesktopPermission(): Promise<boolean> {
    if (isTauriEnvironment()) {
      try {
        const { isPermissionGranted, requestPermission } = await import(
          "@tauri-apps/plugin-notification"
        );
        let granted = await isPermissionGranted();
        if (!granted) {
          granted = (await requestPermission()) === "granted";
        }
        this.hasPermission = granted;
        return granted;
      } catch (e) {
        log.warn("Desktop notification permission request failed", e);
        return false;
      }
    }
    if (typeof window === "undefined" || !("Notification" in window)) {
      return false;
    }
    if (Notification.permission === "denied") {
      // The browser will not show the prompt again; report the stored decision.
      this.hasPermission = false;
      return false;
    }
    try {
      const res = await Notification.requestPermission();
      this.hasPermission = res === "granted";
      return this.hasPermission;
    } catch {
      return false;
    }
  }

  /**
   * One context for the whole session (MDN: create one AudioContext and reuse
   * it). Creating a context per chime leaks hardware handles.
   */
  private getAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (this.audioCtx && this.audioCtx.state !== "closed") return this.audioCtx;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.audioCtx = new Ctor();
      return this.audioCtx;
    } catch {
      return null;
    }
  }

  /** Resumes a suspended context; browsers require a user gesture first. */
  private primeAudio() {
    if (this.audioPrimed) return;
    this.audioPrimed = true;
    const unlock = () => {
      const ctx = this.getAudioContext();
      if (ctx && ctx.state === "suspended") void ctx.resume();
    };
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", unlock, { once: true, capture: true });
  }

  private playChime() {
    const ctx = this.getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx.resume();
      return;
    }
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch {
      // Audio not permitted or context unavailable, silently ignore
    }
  }

  /**
   * True only when an OS toast can actually be rendered.
   *
   * Inside the Tauri shell we use `tauri-plugin-notification`, which talks to
   * the Windows toast APIs directly. A WebView2 `new Notification()` is a
   * no-op because wry registers no `NotificationReceived` handler, so that path
   * is only used by the browser preview.
   */
  private canShowDesktop(): boolean {
    if (typeof window === "undefined") return false;
    if (isTauriEnvironment()) return true;
    return "Notification" in window;
  }

  private async sendDesktop(title: string, body: string): Promise<boolean> {
    if (!this.canShowDesktop()) return false;

    if (isTauriEnvironment()) {
      try {
        const { isPermissionGranted, requestPermission, sendNotification } = await import(
          "@tauri-apps/plugin-notification"
        );
        let granted = await isPermissionGranted();
        if (!granted) {
          granted = (await requestPermission()) === "granted";
        }
        this.hasPermission = granted;
        if (!granted) return false;
        sendNotification({ title, body });
        return true;
      } catch (e) {
        log.warn("Desktop notification error", e);
        return false;
      }
    }

    if (!this.hasPermission) {
      this.readPermission();
    }
    try {
      if (Notification.permission === "granted") {
        new Notification(title, {
          body,
          icon: "/icons/notification.png",
          silent: false,
        });
        return true;
      }
    } catch (e) {
      log.warn("Desktop notification error", e);
    }
    return false;
  }

  private async dispatch(
    channel: NotificationChannel,
    title: string,
    message: string,
    level: "info" | "success" | "warning" | "error" = "info",
  ): Promise<void> {
    if (channel === "none") return;

    const prefs = usePreferencesStore.getState().notifications;
    const sound = prefs?.soundEnabled ?? true;

    // An explicit desktop choice must never become a silent no-op: when the
    // shell cannot raise an OS toast, deliver the same message in-app instead.
    const wantsDesktop = channel === "both" || channel === "desktop";
    const desktopAvailable = this.canShowDesktop();
    const wantsInApp =
      channel === "in_app" || channel === "both" || (wantsDesktop && !desktopAvailable);

    if (wantsInApp) {
      useUiStore.getState().showToast(`${title}: ${message}`, level);
      // Chime only when something was actually delivered. A permission-denied
      // desktop notification used to beep while showing nothing at all.
      if (sound) this.playChime();
    }

    if (wantsDesktop && desktopAvailable) {
      const delivered = await this.sendDesktop(title, message);
      if (delivered) {
        if (sound && !wantsInApp) this.playChime();
      } else if (!wantsInApp) {
        // Desktop-only preference fallback: never drop the message silently.
        useUiStore.getState().showToast(`${title}: ${message}`, level);
        if (sound) this.playChime();
      }
    }
  }

  public notifyScanComplete(evt: ScanCompletedEvent) {
    const lang = usePreferencesStore.getState().language;
    const ui = getUIText(lang);
    const channel = usePreferencesStore.getState().notifications?.scanComplete ?? "both";
    const title = ui.notifications.scanDoneTitle;
    const baseBody = ui.notifications.scanDoneBody(
      evt.targetCount,
      formatBytes(evt.reclaimBytes, lang),
    );
    // A partial scan still finished; staying silent made the app look stuck.
    // A depth-limit stop is reported as a completed scan, but it also hides
    // deeper targets, so it must be explained too. Reuse existing localized
    // strings so every locale mentions the limit.
    const body =
      evt.partial || evt.stopReason
        ? `${baseBody} ${ui.overview.partial} (${ui.overview.stopReason}: ${localizeStopReason(
            evt.stopReason,
            ui,
          )})`
        : baseBody;
    void this.dispatch(channel, title, body, "success");
  }

  public notifyCleanComplete(evt: CleanCompletedEvent) {
    const lang = usePreferencesStore.getState().language;
    const ui = getUIText(lang);
    const channel = usePreferencesStore.getState().notifications?.cleanComplete ?? "both";
    const dest = evt.destination ?? ui.notifications.destTrash;
    const title = ui.notifications.cleanDoneTitle;
    const body = ui.notifications.cleanDoneBody(evt.count, dest, formatBytes(evt.bytes, lang));
    void this.dispatch(channel, title, body, "success");
  }

  public notifyDiskPressure(evt: DiskPressureEvent) {
    const lang = usePreferencesStore.getState().language;
    const ui = getUIText(lang);
    const channel = usePreferencesStore.getState().notifications?.diskPressure ?? "both";
    const title = ui.notifications.diskAlertTitle;
    const body = ui.notifications.diskAlertBody(
      evt.drive,
      Number(evt.percentUsed.toFixed(0)),
      formatBytes(evt.freeBytes, lang),
    );
    void this.dispatch(channel, title, body, "warning");
  }

  public notifyProcessLock(evt: ProcessLockEvent) {
    const prefs = usePreferencesStore.getState();
    const ui = getUIText(prefs.language);
    const channel = prefs.notifications?.processLock ?? "in_app";
    const title = ui.notifications.lockAlertTitle;
    // "Mask paths on screen" must cover every surface the user sees, including
    // the OS notification center, not only the in-app table.
    const body = ui.notifications.lockAlertBody(prefs.maskPaths ? maskPath(evt.path) : evt.path);
    void this.dispatch(channel, title, body, "warning");
  }

  public notifyAutomationWebhook(evt: WebhookEvent) {
    const lang = usePreferencesStore.getState().language;
    const ui = getUIText(lang);
    const channel = usePreferencesStore.getState().notifications?.automationWebhook ?? "both";
    // Never echo the full URL: its path is the credential. The failure reason is
    // already classified (`http_404`, `network`, …) by the caller; anything else
    // is replaced with the generic network message, because the OS keeps this
    // text in the Action Center history.
    const target = redactWebhookUrl(evt.url);
    if (evt.status === "success") {
      void this.dispatch(
        channel,
        ui.notifications.webhookSuccess,
        ui.notifications.webhookSuccessBody(target),
        "success",
      );
    } else {
      void this.dispatch(
        channel,
        ui.notifications.webhookError,
        ui.notifications.webhookErrorBody(describeWebhookFailure(evt.error, ui)),
        "error",
      );
    }
  }

  public async testDesktopNotification(): Promise<void> {
    const lang = usePreferencesStore.getState().language;
    const ui = getUIText(lang);
    if (this.canShowDesktop()) {
      const delivered = await this.sendDesktop(
        ui.notifications.testDesktopTitle,
        ui.notifications.testDesktopBody,
      );
      if (!delivered) {
        // Permission denied or the host cannot raise a toast: still prove the
        // pipeline works with the same message in-app.
        useUiStore.getState().showToast(ui.notifications.testDesktopBody, "info");
      }
      this.playChime();
    } else {
      // The host cannot raise an OS toast; show the same message in-app so the
      // user gets concrete feedback instead of a button that does nothing.
      useUiStore.getState().showToast(ui.notifications.testDesktopBody, "info");
      this.playChime();
    }
  }

  public testInAppNotification() {
    const lang = usePreferencesStore.getState().language;
    const ui = getUIText(lang);
    useUiStore.getState().showToast(ui.notifications.testInAppToast, "info");
    this.playChime();
  }

  /**
   * Releases the audio hardware. The session-scoped `AudioContext` keeps a
   * device handle open until it is closed, and this window never unloads in
   * Tauri, so it has to be closed explicitly when the page goes away (D-9).
   */
  public dispose() {
    const ctx = this.audioCtx;
    this.audioCtx = null;
    this.audioPrimed = false;
    if (ctx && ctx.state !== "closed") {
      void ctx.close().catch(() => {
        // A context that is already closing is fine.
      });
    }
  }
}

export const notificationService = new NotificationService();

/** Hook for `pagehide`/teardown paths that do not import the class directly. */
export function disposeNotifications(): void {
  notificationService.dispose();
}
