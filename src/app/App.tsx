import React, { Suspense, lazy, useEffect, useRef } from "react";
import { ScanHeader } from "@/features/scan/ScanHeader";
import { NavRail } from "@/features/shell/NavRail";
import { OverviewView } from "@/features/overview/OverviewView";
import { ProjectsView } from "@/features/items/ProjectsView";
import { SelectionActionBar } from "@/features/results/SelectionActionBar";
import { CleanupPlanDialog } from "@/features/cleanup/CleanupPlanDialog";
import { CleanupResultDialog } from "@/features/cleanup/CleanupResultDialog";
import { CleanupProgressDock } from "@/features/cleanup/CleanupProgressDock";
import { Toast } from "@/components/primitives/Toast";
import { CloseGuardDialog } from "@/features/shell/CloseGuardDialog";
import {
  BridgeUnavailableScreen,
  useBridgeStatus,
} from "@/components/common/BridgeUnavailableScreen";
import { ViewSkeleton } from "@/components/common/ViewSkeleton";
import { StaleScanBanner } from "@/features/shell/StaleScanBanner";
import { PartialScanBanner } from "@/features/shell/PartialScanBanner";
import { ScanWarningsBanner } from "@/features/shell/ScanWarningsBanner";
import {
  usePreferencesStore,
  flushPreferences,
  hasPendingPreferencesWrite,
} from "@/stores/preferences-store";
import {
  useScanStore,
  LAST_SCAN_SCHEMA_SUPPORTED,
  flushLastScanPersist,
  hasScheduledScanPersist,
} from "@/stores/scan-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useCacheStore } from "@/stores/cache-store";
import { AppView, useAppStore } from "@/stores/app-store";
import { isGlobalShortcutBlocked, useUiStore } from "@/stores/ui-store";
import { useUIText, getUIText, localizeAppError, loadUIText } from "@/lib/ui-text";
import { log } from "@/lib/logging";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { consumeAppDataResetNotice } from "@/lib/app-data-reset";
import { useScanController } from "@/features/scan/useScanController";
import { isScanActiveNow } from "@/features/scan/scan-activity";
import { DEFAULT_SHORTCUTS } from "@/types";
import { matchesShortcut } from "@/lib/shortcuts";
import "@/styles/index.css";
import "@/features/shell/shell.css";

// Views that are not on the first screen load on demand. Overview and Projects
// stay eager because they are the default landing surfaces.
const AgentsView = lazy(() =>
  import("@/features/agents/AgentsView").then((m) => ({ default: m.AgentsView })),
);
const CachesView = lazy(() =>
  import("@/features/caches/CachesView").then((m) => ({ default: m.CachesView })),
);
const DocsView = lazy(() =>
  import("@/features/docs/DocsView").then((m) => ({ default: m.DocsView })),
);
const HistoryView = lazy(() =>
  import("@/features/history/HistoryView").then((m) => ({ default: m.HistoryView })),
);
const SettingsView = lazy(() =>
  import("@/features/settings/SettingsView").then((m) => ({ default: m.SettingsView })),
);
const AboutView = lazy(() =>
  import("@/features/settings/AboutView").then((m) => ({ default: m.AboutView })),
);

const NAV_MAP: Record<string, AppView> = {
  navOverview: "overview",
  navProjects: "projects",
  navAgents: "agents",
  navCaches: "caches",
  navDocs: "docs",
  navHistory: "history",
  navSettings: "settings",
};

const AppShell: React.FC = () => {
  const loadPreferences = usePreferencesStore((s) => s.loadPreferences);
  const view = useAppStore((s) => s.view);
  const { startScan, cancelScan } = useScanController();
  const ui = useUIText();
  const language = usePreferencesStore((s) => s.language);
  const preferencesLoaded = usePreferencesStore((s) => s.isLoaded);

  // A factory reset leaves a one-shot sessionStorage flag before reloading.
  // Wait for the persisted language and its dictionary so the confirmation is
  // localized instead of flashing English on the first frame.
  useEffect(() => {
    if (!preferencesLoaded) return;
    let cancelled = false;
    void loadUIText(language).then(() => {
      if (cancelled || !consumeAppDataResetNotice()) return;
      useUiStore
        .getState()
        .showToast(getUIText(language).settings.resetAppDataSuccess, "success", 6500);
    });
    return () => {
      cancelled = true;
    };
  }, [preferencesLoaded, language]);

  // The keydown listener is registered once. These refs keep it pointing at the
  // current controller functions without re-registering the listener.
  const startScanRef = useRef(startScan);
  const cancelScanRef = useRef(cancelScan);
  useEffect(() => {
    startScanRef.current = startScan;
    cancelScanRef.current = cancelScan;
  }, [startScan, cancelScan]);

  // Boot sequence: settings first, then the last scan. They used to be two
  // independent effects, so whichever resolved last won; a stale
  // `lastScanPath` could survive next to a snapshot from a different scope.
  // Running them in order makes the snapshot authoritative and the path only a
  // fallback for an empty workspace.
  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      try {
        const prefs = await scannerApi.getAppSettings();
        if (cancelled) return;
        loadPreferences(prefs);
      } catch (err) {
        if (cancelled) return;
        const prefs = usePreferencesStore.getState();
        const text = getUIText(prefs.language);
        useUiStore
          .getState()
          .showToast(`${text.errors.title}: ${localizeAppError(err, text)}`, "error", 8000);
      }
    };

    const restoreLastScan = async () => {
      try {
        // Captured before the await: if the user resets the workspace while the
        // snapshot is being read, the restore must not repopulate the view.
        const resetToken = useScanStore.getState().workspaceResetToken;
        const snapshot = await scannerApi.getLastScan();
        if (cancelled) {
          return;
        }
        if (useScanStore.getState().workspaceResetToken !== resetToken) {
          return;
        }
        if (!snapshot) {
          applyLastPathFallback();
          return;
        }
        if (snapshot.schemaVersion !== LAST_SCAN_SCHEMA_SUPPORTED) {
          log.warn("Dropping incompatible last scan", snapshot.schemaVersion);
          // Fire-and-forget: a failure here must not surface as an unhandled
          // rejection during startup. The incompatible snapshot is simply left
          // for the next attempt.
          scannerApi
            .clearLastScan()
            .catch((err) => log.warn("Could not clear the incompatible last scan", err));
          applyLastPathFallback();
          return;
        }
        const store = useScanStore.getState();
        if (store.status === "idle" && store.itemIds.length === 0) {
          store.restoreScan(snapshot);
          // Selections belong to the old session; a restored snapshot has no
          // selected rows and stale ids would target missing items.
          useSelectionStore.getState().clearSelection();
          return;
        }
        applyLastPathFallback();
      } catch (err) {
        // A missing snapshot is normal; a real failure is only logged.
        log.warn("Could not restore the last scan", err);
        applyLastPathFallback();
      }
    };

    const applyLastPathFallback = () => {
      const store = useScanStore.getState();
      const lastPath = usePreferencesStore.getState().lastScanPath;
      if (lastPath && !store.currentRootPath) {
        useScanStore.setState({ currentRootPath: lastPath });
      }
    };

    void (async () => {
      await loadSettings();
      if (cancelled) return;
      await restoreLastScan();
    })();

    return () => {
      cancelled = true;
    };
  }, [loadPreferences]);

  // A debounced settings write must survive a fast close: flush on hide and
  // before the window unloads. The last-scan snapshot is debounced too, so a
  // cleanup performed right before closing must reach disk as well.
  useEffect(() => {
    const flush = () => {
      // Only flush what is actually pending. `flushPreferences` writes the whole
      // settings file, and `flushLastScanPersist` rewrites the snapshot; doing
      // that unconditionally meant every launch (and every StrictMode mount)
      // wrote both files back unchanged.
      if (hasPendingPreferencesWrite()) {
        // The store logs the failure; the rejection is swallowed here so a
        // close-time write cannot surface as an unhandled rejection.
        void flushPreferences().catch(() => {});
      }
      if (hasScheduledScanPersist()) void flushLastScanPersist();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, []);

  // Global Dynamic Keyboard Shortcuts Listener
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      // A modal owns the keyboard: navigating or starting a scan underneath a
      // confirmation dialog changed the page the dialog was describing. The
      // dialog-depth counter also covers Settings and other plain dialogs that
      // never set `activeModal`.
      if (isGlobalShortcutBlocked(useUiStore.getState())) return;

      const prefs = usePreferencesStore.getState();
      const shortcuts = prefs.shortcuts ?? DEFAULT_SHORTCUTS;

      if (matchesShortcut(event, shortcuts.toggleSidebar)) {
        event.preventDefault();
        prefs.setSidebarMode(prefs.sidebarMode === "collapsed" ? "expanded" : "collapsed");
        return;
      }

      if (matchesShortcut(event, shortcuts.focusSearch)) {
        event.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>(
          'input[type="search"], .search-field-input, #search-input',
        );
        searchInput?.focus();
        return;
      }

      if (matchesShortcut(event, shortcuts.startStopScan)) {
        event.preventDefault();
        // Read live state instead of the closure: a captured `isScanning` would
        // go stale right after the first scan starts.
        if (isScanActiveNow()) {
          void cancelScanRef.current();
        } else {
          const appStore = useAppStore.getState();
          // Mirror the header button: the primary action belongs to the view
          // the user is on. Always starting a project scan here made Ctrl+Enter
          // ignore the Caches and Agents pages.
          if (appStore.view === "caches") {
            const cache = useCacheStore.getState();
            if (cache.measuring) {
              void cache.cancelMeasure();
            } else {
              void cache.startMeasure();
            }
          } else if (appStore.view === "agents") {
            void startScanRef.current(undefined, "agents");
          } else {
            const scope = useScanStore.getState().scope;
            void startScanRef.current(undefined, scope === "allDrives" ? "allDrives" : "project");
          }
        }
        return;
      }

      const appStore = useAppStore.getState();
      for (const [actionId, viewName] of Object.entries(NAV_MAP)) {
        if (matchesShortcut(event, shortcuts[actionId])) {
          event.preventDefault();
          appStore.setView(viewName);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="app-container">
      <a className="skip-link" href="#main">
        {ui.common.skipToContent}
      </a>
      <ScanHeader />
      <div className="app-body">
        <NavRail />
        <main
          id="main"
          tabIndex={-1}
          className={`view-container ${view === "docs" ? "view-container--docs" : ""}`}
        >
          <PartialScanBanner />
          <ScanWarningsBanner />
          <StaleScanBanner />
          <Suspense fallback={<ViewSkeleton />}>
            {view === "overview" && <OverviewView />}
            {view === "projects" && <ProjectsView />}
            {view === "agents" && <AgentsView />}
            {view === "caches" && <CachesView />}
            {view === "docs" && <DocsView />}
            {view === "history" && <HistoryView />}
            {view === "settings" && <SettingsView />}
            {view === "about" && <AboutView />}
          </Suspense>
        </main>
      </div>

      <SelectionActionBar />
      <CleanupPlanDialog />
      <CleanupResultDialog />
      <CleanupProgressDock />
      <CloseGuardDialog />
      <Toast />
    </div>
  );
};

/**
 * The concept preview is a development-only harness. Keeping the branch in a
 * hook-free wrapper preserves the rules of hooks, and the `import.meta.env.DEV`
 * guard keeps the bundled harness out of production builds.
 */
const conceptLoader = import.meta.env.DEV
  ? () => import("@/features/concepts/ConceptContainer")
  : null;

const ConceptContainer = conceptLoader
  ? lazy(() => conceptLoader().then((m) => ({ default: m.ConceptContainer })))
  : null;

export const App: React.FC = () => {
  const { status, retry } = useBridgeStatus();
  const showConcept =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("concept");

  if (showConcept && ConceptContainer) {
    return (
      <Suspense fallback={null}>
        <ConceptContainer />
      </Suspense>
    );
  }
  // Render optimistically while the bridge resolves: the proxy queues calls and
  // the app only needs to be replaced when the bridge is definitively missing.
  if (status === "unavailable") {
    return <BridgeUnavailableScreen onRetry={retry} />;
  }
  return <AppShell />;
};
