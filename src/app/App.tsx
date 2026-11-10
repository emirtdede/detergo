import React, { Suspense, lazy, useEffect, useRef } from "react";
import { ScanHeader } from "@/features/scan/ScanHeader";
import { NavRail } from "@/features/shell/NavRail";
import { OverviewView } from "@/features/overview/OverviewView";
import { ProjectsView } from "@/features/items/ProjectsView";
import { AgentsView } from "@/features/agents/AgentsView";
import { CachesView } from "@/features/caches/CachesView";
import { DocsView } from "@/features/docs/DocsView";
import { HistoryView } from "@/features/history/HistoryView";
import { SettingsView } from "@/features/settings/SettingsView";
import { AboutView } from "@/features/settings/AboutView";
import { SelectionActionBar } from "@/features/results/SelectionActionBar";
import { CleanupPlanDialog } from "@/features/cleanup/CleanupPlanDialog";
import { CleanupResultDialog } from "@/features/cleanup/CleanupResultDialog";
import { CleanupProgressDock } from "@/features/cleanup/CleanupProgressDock";
import { Toast } from "@/components/primitives/Toast";
import { CloseGuardDialog } from "@/features/shell/CloseGuardDialog";
import { StaleScanBanner } from "@/features/shell/StaleScanBanner";
import { usePreferencesStore, flushPreferences } from "@/stores/preferences-store";
import { useScanStore, LAST_SCAN_SCHEMA_SUPPORTED } from "@/stores/scan-store";
import { AppView, useAppStore } from "@/stores/app-store";
import { useUiStore } from "@/stores/ui-store";
import { useUIText, getUIText, localizeAppError } from "@/lib/ui-text";
import { log } from "@/lib/logging";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { useScanController } from "@/features/scan/useScanController";
import { DEFAULT_SHORTCUTS } from "@/types";
import "@/styles/index.css";
import "@/features/shell/shell.css";

function matchesShortcut(event: KeyboardEvent, combo?: string): boolean {
  if (!combo) return false;
  const parts = combo.split("+").map((p) => p.trim().toLowerCase());
  const needsCtrl = parts.includes("ctrl");
  const needsAlt = parts.includes("alt");
  const needsShift = parts.includes("shift");
  const needsMeta = parts.includes("meta");

  const keyPart = parts.find((p) => !["ctrl", "alt", "shift", "meta"].includes(p));
  if (!keyPart) return false;

  const hasCtrl = event.ctrlKey || (needsCtrl && event.metaKey);
  const hasAlt = event.altKey;
  const hasShift = event.shiftKey;
  const hasMeta = event.metaKey;

  if (needsCtrl !== hasCtrl) return false;
  if (needsAlt !== hasAlt) return false;
  if (needsShift !== hasShift) return false;
  if (!needsCtrl && needsMeta !== hasMeta) return false;

  let eventKey = event.key.toLowerCase();
  if (eventKey === " ") eventKey = "space";
  return eventKey === keyPart;
}

const NAV_MAP: Record<string, AppView> = {
  navOverview: "overview",
  navProjects: "projects",
  navAgents: "agents",
  navCaches: "caches",
  navDocs: "docs",
  navHistory: "history",
  navSettings: "settings",
};

/** True while a scan is running or winding down. */
function isScanActive(status: string): boolean {
  return status === "scanning" || status === "measuring" || status === "cancelling";
}

const AppShell: React.FC = () => {
  const loadPreferences = usePreferencesStore((s) => s.loadPreferences);
  const view = useAppStore((s) => s.view);
  const { startScan, cancelScan } = useScanController();
  const ui = useUIText();
  const language = usePreferencesStore((s) => s.language);

  // The keydown listener is registered once. These refs keep it pointing at the
  // current controller functions without re-registering the listener.
  const startScanRef = useRef(startScan);
  const cancelScanRef = useRef(cancelScan);
  useEffect(() => {
    startScanRef.current = startScan;
    cancelScanRef.current = cancelScan;
  }, [startScan, cancelScan]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = language || "en";
    }
  }, [language]);

  // Settings are loaded exactly once at boot. Reading the translated error text
  // lazily inside the handler keeps this effect independent of the language, so
  // switching language does not re-fetch settings from the backend.
  useEffect(() => {
    let cancelled = false;
    scannerApi
      .getAppSettings()
      .then((prefs) => {
        if (cancelled) return;
        loadPreferences(prefs);
        const activePath = useScanStore.getState().currentRootPath;
        if (prefs.lastScanPath && !activePath) {
          useScanStore.setState({ currentRootPath: prefs.lastScanPath });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const prefs = usePreferencesStore.getState();
        const text = getUIText(prefs.language);
        useUiStore
          .getState()
          .showToast(`${text.errors.title}: ${localizeAppError(err, text)}`, "error", 8000);
      });
    return () => {
      cancelled = true;
    };
  }, [loadPreferences]);

  // Reopen with the last scan instead of an empty screen. This runs once at
  // boot: reacting to scan status transitions would re-fetch the snapshot after
  // every scan and could clobber a newer scan with an older one.
  useEffect(() => {
    let cancelled = false;
    scannerApi
      .getLastScan()
      .then((snapshot) => {
        if (cancelled || !snapshot) return;
        if (snapshot.schemaVersion !== LAST_SCAN_SCHEMA_SUPPORTED) {
          log.warn("Dropping incompatible last scan", snapshot.schemaVersion);
          void scannerApi.clearLastScan();
          return;
        }
        const store = useScanStore.getState();
        if (store.status !== "idle" || store.itemIds.length > 0) return;
        store.restoreScan(snapshot);
      })
      .catch((err) => {
        // A missing snapshot is normal; a real failure is only logged.
        log.warn("Could not restore the last scan", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // RTL Language handling
  useEffect(() => {
    const lang = language ?? "en";
    const rtlLanguages = new Set(["ar", "he", "fa", "ur"]);
    document.documentElement.dir = rtlLanguages.has(lang) ? "rtl" : "ltr";
  }, [language]);

  // A debounced settings write must survive a fast close: flush on hide and
  // before the window unloads.
  useEffect(() => {
    const flush = () => {
      void flushPreferences();
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
        const status = useScanStore.getState().status;
        if (isScanActive(status)) {
          void cancelScanRef.current();
        } else {
          void startScanRef.current();
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
          <StaleScanBanner />
          {view === "overview" && <OverviewView />}
          {view === "projects" && <ProjectsView />}
          {view === "agents" && <AgentsView />}
          {view === "caches" && <CachesView />}
          {view === "docs" && <DocsView />}
          {view === "history" && <HistoryView />}
          {view === "settings" && <SettingsView />}
          {view === "about" && <AboutView />}
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
  return <AppShell />;
};
