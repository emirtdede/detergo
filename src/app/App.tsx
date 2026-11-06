import React, { useEffect } from "react";
import { ConceptContainer } from "@/features/concepts/ConceptContainer";
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
import { Toast } from "@/components/primitives/Toast";
import { CloseGuardDialog } from "@/features/shell/CloseGuardDialog";
import { StaleScanBanner } from "@/features/shell/StaleScanBanner";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useScanStore } from "@/stores/scan-store";
import { useAppStore } from "@/stores/app-store";
import { useUiStore } from "@/stores/ui-store";
import { useUIText } from "@/lib/ui-text";
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

export const App: React.FC = () => {
  const isConceptMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("concept");

  if (isConceptMode) {
    return <ConceptContainer />;
  }

  const loadPreferences = usePreferencesStore((s) => s.loadPreferences);
  const view = useAppStore((s) => s.view);
  const { startScan, cancelScan, isScanning } = useScanController();
  const showToast = useUiStore((s) => s.showToast);
  const ui = useUIText();

  useEffect(() => {
    scannerApi
      .getAppSettings()
      .then((prefs) => {
        loadPreferences(prefs);
        const activePath = useScanStore.getState().currentRootPath;
        if (prefs.lastScanPath && !activePath) {
          useScanStore.setState({ currentRootPath: prefs.lastScanPath });
        }
      })
      .catch((err) => {
        // Never fail silently: the UI keeps defaults, but the user is told.
        showToast(`${ui.errors.title}: ${String(err)}`, "error", 8000);
      });
  }, [loadPreferences, showToast, ui.errors.title]);

  // Reopen with the last scan instead of an empty screen. The snapshot is
  // intentionally restored after settings so a concurrently running scan can
  // never be overwritten.
  useEffect(() => {
    let cancelled = false;
    scannerApi
      .getLastScan()
      .then((snapshot) => {
        if (cancelled || !snapshot) return;
        const store = useScanStore.getState();
        if (store.status !== "idle" || store.itemIds.length > 0) return;
        store.restoreScan(snapshot);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isScanning, startScan, cancelScan]);

  // RTL Language handling
  const currentLang = usePreferencesStore((s) => s.language);
  useEffect(() => {
    const lang = currentLang ?? "en";
    const rtlLanguages = new Set(["ar", "he", "fa", "ur"]);
    document.documentElement.dir = rtlLanguages.has(lang) ? "rtl" : "ltr";
  }, [currentLang]);

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
          'input[type="search"], .search-field-input, #search-input'
        );
        searchInput?.focus();
        return;
      }

      if (matchesShortcut(event, shortcuts.startStopScan)) {
        event.preventDefault();
        if (isScanning) {
          cancelScan();
        } else {
          void startScan();
        }
        return;
      }

      const appStore = useAppStore.getState();
      const navMap: Record<string, string> = {
        navOverview: "overview",
        navProjects: "projects",
        navAgents: "agents",
        navCaches: "caches",
        navDocs: "docs",
        navHistory: "history",
        navSettings: "settings",
      };

      for (const [actionId, viewName] of Object.entries(navMap)) {
        if (matchesShortcut(event, shortcuts[actionId])) {
          event.preventDefault();
          appStore.setView(viewName as any);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="app-container">
      <a className="skip-link" href="#main">{ui.common.skipToContent}</a>
      <ScanHeader />
      <div className="app-body">
        <NavRail />
        <main id="main" tabIndex={-1} className={`view-container ${view === "docs" ? "view-container--docs" : ""}`}>
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
      <CloseGuardDialog />
      <Toast />
    </div>
  );
};
