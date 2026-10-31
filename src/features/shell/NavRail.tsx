import React from "react";
import {
  LayoutDashboard,
  FolderTree,
  Bot,
  Package,
  History,
  Settings,
} from "lucide-react";
import { useAppStore, AppView } from "@/stores/app-store";
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

  return (
    <nav className="nav-rail" aria-label={ui.nav.overview}>
      {ITEMS.map((item) => (
        <button
          key={item.view}
          type="button"
          className={`nav-item ${view === item.view ? "active" : ""}`}
          onClick={() => setView(item.view)}
          title={ui.nav[item.key]}
          aria-current={view === item.view ? "page" : undefined}
        >
          {item.icon}
          <span>{ui.nav[item.key]}</span>
        </button>
      ))}
    </nav>
  );
};
