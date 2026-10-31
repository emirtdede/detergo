import { useCallback } from "react";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useScanStore } from "@/stores/scan-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useUiStore } from "@/stores/ui-store";
import { AppErrorDto, ScanEvent, ScanRequest, ScanScope } from "@/types";

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
