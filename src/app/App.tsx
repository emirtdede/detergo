import React, { useEffect } from "react";
import { ScanHeader } from "@/features/scan/ScanHeader";
import { NavRail } from "@/features/shell/NavRail";
import { OverviewView } from "@/features/overview/OverviewView";
import { ProjectsView } from "@/features/items/ProjectsView";
import { AgentsView } from "@/features/agents/AgentsView";
import { CachesView } from "@/features/caches/CachesView";
import { HistoryView } from "@/features/history/HistoryView";
import { SettingsView } from "@/features/settings/SettingsView";
import { SelectionActionBar } from "@/features/results/SelectionActionBar";
import { CleanupPlanDialog } from "@/features/cleanup/CleanupPlanDialog";
import { CleanupResultDialog } from "@/features/cleanup/CleanupResultDialog";
import { Toast } from "@/components/primitives/Toast";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useScanStore } from "@/stores/scan-store";
import { useAppStore } from "@/stores/app-store";
import { useUiStore } from "@/stores/ui-store";
import { useUIText } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import "@/styles/index.css";
import "@/features/shell/shell.css";

export const App: React.FC = () => {
  const loadPreferences = usePreferencesStore((s) => s.loadPreferences);
  const view = useAppStore((s) => s.view);
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

  // Ctrl/Cmd+B toggles the sidebar between expanded and compact modes.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "b") return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      event.preventDefault();
      const prefs = usePreferencesStore.getState();
      prefs.setSidebarMode(prefs.sidebarMode === "collapsed" ? "expanded" : "collapsed");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="app-container">
      <ScanHeader />
      <div className="app-body">
        <NavRail />
        <main className="view-container">
          {view === "overview" && <OverviewView />}
          {view === "projects" && <ProjectsView />}
          {view === "agents" && <AgentsView />}
          {view === "caches" && <CachesView />}
          {view === "history" && <HistoryView />}
          {view === "settings" && <SettingsView />}
        </main>
      </div>

      <SelectionActionBar />
      <CleanupPlanDialog />
      <CleanupResultDialog />
      <Toast />
    </div>
  );
};
