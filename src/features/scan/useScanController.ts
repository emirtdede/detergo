import { useCallback } from "react";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useScanStore, persistLastScanNow } from "@/stores/scan-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useUiStore } from "@/stores/ui-store";
import { AppErrorDto, ScanEvent, ScanRequest, ScanScope } from "@/types";
import { appendScanHistory } from "@/features/history/scan-history";
import { notificationService } from "@/lib/notifications/notification-service";

function toAppError(err: unknown): AppErrorDto {
  if (err && typeof err === "object" && "code" in err) {
    const candidate = err as { code?: string; message?: string };
    return {
      code: (candidate.code as AppErrorDto["code"]) ?? "Unknown",
      message: candidate.message ?? String(err),
    };
  }
  return { code: "Unknown", message: typeof err === "string" ? err : String(err) };
}

export function useScanController() {
  const status = useScanStore((s) => s.status);
  const isScanning = status === "scanning" || status === "measuring" || status === "cancelling";

  const startScan = useCallback(async (rootOverride?: string, scope: ScanScope = "project") => {
    const current = useScanStore.getState();
    if (
      current.status === "scanning" ||
      current.status === "measuring" ||
      current.status === "cancelling"
    ) {
      return;
    }

    let root =
      rootOverride ?? current.currentRootPath ?? usePreferencesStore.getState().lastScanPath ?? "";
    if (scope === "project" && !root) {
      const picked = await scannerApi.selectFolderDialog();
      if (!picked) return;
      root = picked;
    }
    // A full-disk scan is virtual: the backend enumerates local volumes itself,
    // so there is no single root path to send.
    if (scope === "allDrives") {
      root = "";
    }

    const prefs = usePreferencesStore.getState();
    useSelectionStore.getState().clearSelection();
    useScanStore.getState().startScanState("pending", root, scope);

    const handleEvent = (event: ScanEvent) => {
      const store = useScanStore.getState();
      switch (event.type) {
        case "started":
          if (store.scanId !== event.scanId) {
            useScanStore.setState({ scanId: event.scanId });
          }
          break;
        case "candidates":
          store.addItems(event.items);
          break;
        case "measured":
          store.applyMeasurements(event.updates);
          break;
        case "progress":
          store.updateProgress(event.progress);
          break;
        case "warning":
          store.addWarning({ code: event.code, path: event.path });
          break;
        case "completed":
          store.completeScan(event.summary);
          break;
        case "cancelled":
          store.cancelScanState(event.summary);
          break;
        case "failed":
          store.failScan(event.error);
          break;
      }
    };

    const request: ScanRequest = {
      rootPath: scope === "agents" ? "" : root,
      scope,
      exclusions: prefs.excludedNames,
      protectedPaths: prefs.protectedPaths,
      profile: prefs.scanProfile,
      maxDepth: prefs.maxDepth,
      maxCandidates: prefs.maxCandidates,
      timeoutMinutes: prefs.timeoutMinutes,
      minSizeBytes: prefs.minSizeBytes,
    };

    try {
      const summary = await scannerApi.startScan(request, handleEvent);
      const store = useScanStore.getState();
      if (store.status !== "completed" && store.status !== "cancelled") {
        if (summary.partial) store.cancelScanState(summary);
        else store.completeScan(summary);
      }
      if (scope === "project" && root) {
        prefs.addRecentLocation(root);
      }
      // Persist only completed/cancelled results; failures keep the previous
      // snapshot untouched so the user still opens to something useful.
      const finished = useScanStore.getState();
      if (finished.status === "completed" || finished.status === "cancelled") {
        void persistLastScanNow();
        appendScanHistory({
          id: finished.scanId || `scan-${Date.now()}`,
          timestamp: new Date().toISOString(),
          scope:
            finished.scope === "project"
              ? "Proje Bağımlılıkları"
              : finished.scope === "agents"
                ? "AI Ajanları"
                : "Tüm Sürücüler",
          rootPath: finished.currentRootPath || "Tüm Sürücüler",
          itemCount: finished.itemIds.length,
          cleanableBytes: finished.summary
            ? Math.max(0, finished.summary.totalBytes - finished.summary.protectedBytes)
            : 0,
          durationMs: finished.summary?.durationMs ?? 0,
          status: finished.status === "completed" ? "completed" : "cancelled",
        });

        if (finished.status === "completed") {
          const reclaimBytes = finished.summary
            ? Math.max(0, finished.summary.totalBytes - finished.summary.protectedBytes)
            : 0;
          notificationService.notifyScanComplete({
            targetCount: finished.itemIds.length,
            reclaimBytes,
            durationMs: finished.summary?.durationMs,
          });
        }
      }
    } catch (err) {
      const error = toAppError(err);
      useScanStore.getState().failScan(error);
      if (error.code !== "ScanCancelled") {
        useUiStore.getState().showToast(error.message, "error", 6000);
      }
    }
  }, []);

  const cancelScan = useCallback(async () => {
    if (!isScanning) return;
    useScanStore.setState({ status: "cancelling" });
    try {
      await scannerApi.cancelScan();
    } catch (err) {
      useUiStore.getState().showToast(toAppError(err).message, "error");
    }
  }, [isScanning]);

  return { isScanning, status, startScan, cancelScan };
}
