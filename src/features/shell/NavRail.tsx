import React from "react";
import {
  LayoutDashboard,
  FolderTree,
  Bot,
  Package,
  History,
  Settings,
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
  { view: "history", icon: <History size={17} />, key: "history" },
  { view: "settings", icon: <Settings size={17} />, key: "settings" },
];

export const NavRail: React.FC = () => {
  const ui = useUIText();
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const sidebarMode = usePreferencesStore((s) => s.sidebarMode);
  const setSidebarMode = usePreferencesStore((s) => s.setSidebarMode);
  const isCollapsed = sidebarMode === "collapsed";

  const toggleSidebar = () => setSidebarMode(isCollapsed ? "expanded" : "collapsed");
  const toggleLabel = isCollapsed ? ui.settings.sidebarExpanded : ui.settings.sidebarCollapsed;

  return (
    <nav
      className={`nav-rail ${isCollapsed ? "collapsed" : ""}`}
      aria-label={ui.nav.overview}
    >
      <div className="nav-rail-items">
        {ITEMS.map((item) => (
          <button
            key={item.view}
            type="button"
            className={`nav-item ${view === item.view ? "active" : ""}`}
            onClick={() => setView(item.view)}
            title={isCollapsed ? ui.nav[item.key] : undefined}
            aria-label={ui.nav[item.key]}
            aria-current={view === item.view ? "page" : undefined}
          >
            {item.icon}
            <span className="nav-item-label">{ui.nav[item.key]}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        className="nav-item nav-collapse-toggle"
        onClick={toggleSidebar}
        title={toggleLabel}
        aria-label={toggleLabel}
        aria-expanded={!isCollapsed}
      >
        {isCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        <span className="nav-item-label">{ui.settings.sidebar}</span>
      </button>
    </nav>
  );
};
