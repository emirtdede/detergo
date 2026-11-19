import React, { useEffect, useState } from "react";
import {
  LayoutDashboard,
  FolderTree,
  Bot,
  Package,
  HardDrive,
  History,
  BookOpen,
  Settings,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  Heart,
} from "lucide-react";
import { useAppStore, AppView } from "@/stores/app-store";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { useUIText, UIText } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { log } from "@/lib/logging";
import { BREAKPOINTS, NARROW_RAIL_MEDIA_QUERY } from "@/lib/layout";
import { REPOSITORY_URL, SPONSOR_URL } from "@/lib/links";
import "./shell.css";

/**
 * The GitHub mark, inlined because the icon set no longer ships brand logos.
 * `currentColor` keeps it on the same contrast token as the other rail icons.
 */
const GitHubMark: React.FC = () => (
  <svg
    width={17}
    height={17}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
);

const ITEMS: Array<{ view: AppView; icon: React.ReactNode; key: keyof UIText["nav"] }> = [
  { view: "overview", icon: <LayoutDashboard size={17} />, key: "overview" },
  { view: "projects", icon: <FolderTree size={17} />, key: "projects" },
  { view: "agents", icon: <Bot size={17} />, key: "agents" },
  { view: "caches", icon: <Package size={17} />, key: "caches" },
  { view: "system", icon: <HardDrive size={17} />, key: "system" },
  { view: "docs", icon: <BookOpen size={17} />, key: "docs" },
  { view: "history", icon: <History size={17} />, key: "history" },
];

export const NavRail: React.FC = () => {
  const ui = useUIText();
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const sidebarMode = usePreferencesStore((s) => s.sidebarMode);
  const setSidebarMode = usePreferencesStore((s) => s.setSidebarMode);
  const isCollapsed = sidebarMode === "collapsed";

  // Below the narrow-rail breakpoint a full-width rail would eat a third of the
  // window. The rail folds to its icon track automatically there, without
  // overwriting the user's saved preference: widening the window restores their
  // choice.
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= BREAKPOINTS.narrowRail,
  );

  useEffect(() => {
    const query = window.matchMedia(NARROW_RAIL_MEDIA_QUERY);
    const sync = () => setIsNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const railCollapsed = isCollapsed || isNarrow;
  const toggleSidebar = () => setSidebarMode(isCollapsed ? "expanded" : "collapsed");

  const openExternal = (url: string) => {
    // The external-link command can fail (no browser association, blocked
    // handler). Reported instead of leaving an unhandled rejection.
    scannerApi.openUrl(url).catch((err) => {
      log.warn("Could not open the external link", err);
      useUiStore.getState().showToast(ui.errors.title, "error");
    });
  };

  return (
    <nav
      id="primary-navigation"
      className={`nav-rail ${railCollapsed ? "collapsed" : ""} ${isNarrow ? "is-narrow" : ""}`}
      aria-label={ui.nav.primary}
    >
      <div id="primary-navigation-items" className="nav-rail-items">
        {ITEMS.map((item) => (
          <button
            key={item.view}
            data-view={item.view}
            type="button"
            className={`nav-item ${view === item.view ? "active" : ""}`}
            onClick={() => setView(item.view)}
            title={railCollapsed ? ui.nav[item.key] : undefined}
            aria-label={ui.nav[item.key]}
            aria-current={view === item.view ? "page" : undefined}
          >
            {item.icon}
            <span className="nav-item-label">{ui.nav[item.key]}</span>
          </button>
        ))}

        <button
          data-view="settings"
          type="button"
          className={`nav-item ${view === "settings" ? "active" : ""}`}
          onClick={() => setView("settings")}
          title={railCollapsed ? ui.nav.settings : undefined}
          aria-label={ui.nav.settings}
          aria-current={view === "settings" ? "page" : undefined}
        >
          <Settings size={17} />
          <span className="nav-item-label">{ui.nav.settings}</span>
        </button>

        <button
          data-view="about"
          type="button"
          className={`nav-item ${view === "about" ? "active" : ""}`}
          onClick={() => setView("about")}
          title={railCollapsed ? ui.nav.about : undefined}
          aria-label={ui.nav.about}
          aria-current={view === "about" ? "page" : undefined}
        >
          <Info size={17} />
          <span className="nav-item-label">{ui.nav.about}</span>
        </button>
      </div>

      <div className="nav-rail-links">
        <button
          type="button"
          className="nav-item"
          onClick={() => openExternal(REPOSITORY_URL)}
          title={railCollapsed ? ui.nav.github : REPOSITORY_URL}
          aria-label={ui.nav.github}
        >
          <GitHubMark />
          <span className="nav-item-label">{ui.nav.github}</span>
        </button>

        <button
          type="button"
          className="nav-item"
          onClick={() => openExternal(SPONSOR_URL)}
          title={railCollapsed ? ui.nav.sponsor : SPONSOR_URL}
          aria-label={ui.nav.sponsor}
        >
          <Heart size={17} />
          <span className="nav-item-label">{ui.nav.sponsor}</span>
        </button>
      </div>

      <button
        type="button"
        className="nav-item nav-collapse-toggle"
        onClick={toggleSidebar}
        title={isCollapsed ? ui.settings.sidebarExpanded : ui.settings.sidebarCollapsed}
        aria-label={ui.settings.sidebar}
        aria-expanded={!isCollapsed}
        aria-controls="primary-navigation-items"
      >
        {isCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        <span className="nav-item-label">{ui.settings.sidebar}</span>
      </button>
    </nav>
  );
};
