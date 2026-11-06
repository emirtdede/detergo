import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { formatBytes } from "@/lib/formatters";
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

  constructor() {
    this.checkPermission();
  }

  private async checkPermission() {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "granted") {
        this.hasPermission = true;
      } else if (Notification.permission !== "denied") {
        try {
          const res = await Notification.requestPermission();
          this.hasPermission = res === "granted";
        } catch {
          this.hasPermission = false;
        }
      }
    }
  }

  public async requestDesktopPermission(): Promise<boolean> {
    if (typeof window === "undefined" || !("Notification" in window)) {
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

  private playChime() {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch {
      // Audio not permitted or context unavailable, silently ignore
    }
  }

  private sendDesktop(title: string, body: string) {
    if (!this.hasPermission) {
      this.checkPermission();
    }
    try {
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
        new Notification(title, {
          body,
          icon: "/icons/icon.png",
          silent: false,
        });
      }
    } catch (e) {
      console.warn("Desktop notification error:", e);
    }
  }

  private dispatch(
    channel: NotificationChannel,
    title: string,
    message: string,
    level: "info" | "success" | "warning" | "error" = "info"
  ) {
    if (channel === "none") return;

    const prefs = usePreferencesStore.getState().notifications;
    const sound = prefs?.soundEnabled ?? true;

    if (sound && (channel === "both" || channel === "in_app" || channel === "desktop")) {
      this.playChime();
    }

    if (channel === "both" || channel === "in_app") {
      useUiStore.getState().showToast(`${title}: ${message}`, level);
    }

    if (channel === "both" || channel === "desktop") {
      this.sendDesktop(title, message);
    }
  }

  public notifyScanComplete(evt: ScanCompletedEvent) {
    const channel = usePreferencesStore.getState().notifications?.scanComplete ?? "both";
    const title = "Dev Cleaner: Tarama Tamamlandı";
    const body = `${evt.targetCount} hedef bulundu, ${formatBytes(evt.reclaimBytes)} alan geri kazanılabilir.`;
    this.dispatch(channel, title, body, "success");
  }

  public notifyCleanComplete(evt: CleanCompletedEvent) {
    const channel = usePreferencesStore.getState().notifications?.cleanComplete ?? "both";
    const title = "Dev Cleaner: Temizlik Tamamlandı";
    const body = `${evt.count} hedef başarıyla ${evt.destination ?? "Geri Dönüşüm Kutusuna"} taşındı (${formatBytes(evt.bytes)}).`;
    this.dispatch(channel, title, body, "success");
  }

  public notifyDiskPressure(evt: DiskPressureEvent) {
    const channel = usePreferencesStore.getState().notifications?.diskPressure ?? "both";
    const title = "Dev Cleaner: Kritik Disk Alanı Uyarısı";
    const body = `${evt.drive} sürücüsünde doluluk oranı %${evt.percentUsed.toFixed(0)} seviyesine ulaştı. Kalan: ${formatBytes(evt.freeBytes)}.`;
    this.dispatch(channel, title, body, "warning");
  }

  public notifyProcessLock(evt: ProcessLockEvent) {
    const channel = usePreferencesStore.getState().notifications?.processLock ?? "in_app";
    const title = "Dev Cleaner: Kilitli Dosya / Süreç Uyarısı";
    const body = `${evt.path} başka bir geliştirici süreci tarafından kilitlendiği için korundu.`;
    this.dispatch(channel, title, body, "warning");
  }

  public notifyAutomationWebhook(evt: WebhookEvent) {
    const channel = usePreferencesStore.getState().notifications?.automationWebhook ?? "both";
    if (evt.status === "success") {
      this.dispatch(channel, "Dev Cleaner: Webhook İletildi", `Veriler başarıyla ${evt.url} adresine aktarıldı.`, "success");
    } else {
      this.dispatch(channel, "Dev Cleaner: Webhook Uyarısı", `Hedef sunucuya erişilemedi: ${evt.error ?? evt.url}`, "error");
    }
  }

  public testDesktopNotification() {
    this.sendDesktop("Dev Cleaner: Test Bildirimi", "Windows 11 Masaüstü Bildirim Sistemi kusursuz çalışıyor!");
    this.playChime();
  }

  public testInAppNotification() {
    useUiStore.getState().showToast("Dev Cleaner: Uygulama İçi Bildirim Sistemi aktif ve çalışıyor!", "info");
    this.playChime();
  }
}

export const notificationService = new NotificationService();
