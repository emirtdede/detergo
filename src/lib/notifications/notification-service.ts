import { getUIText } from "@/lib/ui-text";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { formatBytes } from "@/lib/formatters";
import { log } from "@/lib/logging";
import { NotificationChannel } from "@/types";

export interface ScanCompletedEvent {
  targetCount: number;
  reclaimBytes: number;
  durationMs?: number;
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
    // Only read the current permission. Asking here would show a system prompt
    // before the user has done anything; the request belongs to an explicit
    // user action (Settings → notifications).
    this.readPermission();
    this.primeAudio();
  }

  private readPermission() {
    if (typeof window !== "undefined" && "Notification" in window) {
      this.hasPermission = Notification.permission === "granted";
    }
  }

  public async requestDesktopPermission(): Promise<boolean> {
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
   * True only when an OS toast can actually be rendered by the page.
   *
   * Inside the Tauri shell the page is hosted by WebView2. WebView2 surfaces
   * web notifications through `ICoreWebView2_24::add_NotificationReceived` and
   * the host application is responsible for drawing the toast. wry (and
   * therefore Tauri) registers no handler, so `new Notification()` constructs an
   * object and shows nothing. See `docs/architecture/NOTIFICATIONS.md` for the
   * evidence and for the 2.3 plan (native toast + AUMID).
   */
  private canShowDesktop(): boolean {
    if (typeof window === "undefined") return false;
    if ("__TAURI_INTERNALS__" in window) return false;
    return "Notification" in window;
  }

  private sendDesktop(title: string, body: string) {
    if (!this.canShowDesktop()) return;
    if (!this.hasPermission) {
      this.readPermission();
    }
    try {
      if (Notification.permission === "granted") {
        new Notification(title, {
          body,
          icon: "/icons/icon.png",
          silent: false,
        });
      }
    } catch (e) {
      log.warn("Desktop notification error", e);
    }
  }

  private dispatch(
    channel: NotificationChannel,
    title: string,
    message: string,
    level: "info" | "success" | "warning" | "error" = "info",
  ) {
    if (channel === "none") return;

    const prefs = usePreferencesStore.getState().notifications;
    const sound = prefs?.soundEnabled ?? true;

    if (sound && (channel === "both" || channel === "in_app" || channel === "desktop")) {
      this.playChime();
    }

    // An explicit desktop choice must never become a silent no-op: when the
    // shell cannot raise an OS toast, deliver the same message in-app instead.
    const wantsDesktop = channel === "both" || channel === "desktop";
    const desktopAvailable = this.canShowDesktop();
    const wantsInApp =
      channel === "in_app" || channel === "both" || (wantsDesktop && !desktopAvailable);

    if (wantsInApp) {
      useUiStore.getState().showToast(`${title}: ${message}`, level);
    }

    if (wantsDesktop && desktopAvailable) {
      this.sendDesktop(title, message);
    }
  }

  public notifyScanComplete(evt: ScanCompletedEvent) {
    const lang = usePreferencesStore.getState().language;
    const ui = getUIText(lang);
    const channel = usePreferencesStore.getState().notifications?.scanComplete ?? "both";
    const title = ui.notifications.scanDoneTitle;
    const body = ui.notifications.scanDoneBody(
      evt.targetCount,
      formatBytes(evt.reclaimBytes, lang),
    );
    this.dispatch(channel, title, body, "success");
  }

  public notifyCleanComplete(evt: CleanCompletedEvent) {
    const lang = usePreferencesStore.getState().language;
    const ui = getUIText(lang);
    const channel = usePreferencesStore.getState().notifications?.cleanComplete ?? "both";
    const dest = evt.destination ?? ui.notifications.destTrash;
    const title = ui.notifications.cleanDoneTitle;
    const body = ui.notifications.cleanDoneBody(evt.count, dest, formatBytes(evt.bytes, lang));
    this.dispatch(channel, title, body, "success");
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
    this.dispatch(channel, title, body, "warning");
  }

  public notifyProcessLock(evt: ProcessLockEvent) {
    const lang = usePreferencesStore.getState().language;
    const ui = getUIText(lang);
    const channel = usePreferencesStore.getState().notifications?.processLock ?? "in_app";
    const title = ui.notifications.lockAlertTitle;
    const body = ui.notifications.lockAlertBody(evt.path);
    this.dispatch(channel, title, body, "warning");
  }

  public notifyAutomationWebhook(evt: WebhookEvent) {
    const lang = usePreferencesStore.getState().language;
    const ui = getUIText(lang);
    const channel = usePreferencesStore.getState().notifications?.automationWebhook ?? "both";
    if (evt.status === "success") {
      this.dispatch(
        channel,
        ui.notifications.webhookSuccess,
        ui.notifications.webhookSuccessBody(evt.url),
        "success",
      );
    } else {
      this.dispatch(
        channel,
        ui.notifications.webhookError,
        ui.notifications.webhookErrorBody(evt.error ?? evt.url),
        "error",
      );
    }
  }

  public testDesktopNotification() {
    const lang = usePreferencesStore.getState().language;
    const ui = getUIText(lang);
    if (this.canShowDesktop()) {
      this.sendDesktop(ui.notifications.testDesktopTitle, ui.notifications.testDesktopBody);
    } else {
      // The shell cannot raise an OS toast; show the same message in-app so the
      // user gets concrete feedback instead of a button that does nothing.
      useUiStore.getState().showToast(ui.notifications.testDesktopBody, "info");
    }
    this.playChime();
  }

  public testInAppNotification() {
    const lang = usePreferencesStore.getState().language;
    const ui = getUIText(lang);
    useUiStore.getState().showToast(ui.notifications.testInAppToast, "info");
    this.playChime();
  }
}

export const notificationService = new NotificationService();
