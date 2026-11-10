import React, { useEffect, useState } from "react";
import {
  LayoutDashboard,
  FolderTree,
  Bot,
  Package,
  History,
  BookOpen,
  Settings,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useAppStore, AppView } from "@/stores/app-store";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUIText, UIText } from "@/lib/ui-text";
import "./shell.css";

const ITEMS: Array<{ view: AppView; icon: React.ReactNode; key: keyof UIText["nav"] }> = [
  { view: "overview", icon: <LayoutDashboard size={17} />, key: "overview" },
  { view: "projects", icon: <FolderTree size={17} />, key: "projects" },
  { view: "agents", icon: <Bot size={17} />, key: "agents" },
  { view: "caches", icon: <Package size={17} />, key: "caches" },
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

  // Below 900px a full-width rail would eat a third of the window. The rail
  // folds to its icon track automatically there, without overwriting the
  // user's saved preference: widening the window restores their choice.
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= 900,
  );

  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const sync = () => setIsNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const railCollapsed = isCollapsed || isNarrow;
  const toggleSidebar = () => setSidebarMode(isCollapsed ? "expanded" : "collapsed");

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
