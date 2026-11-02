import React, { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  FolderTree,
  Bot,
  Package,
  History,
  Settings,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useAppStore, AppView } from "@/stores/app-store";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { useUIText, UIText } from "@/lib/ui-text";
import { useSettingsSections } from "@/features/settings/settings-sections";
import "./shell.css";

const ITEMS: Array<{ view: AppView; icon: React.ReactNode; key: keyof UIText["nav"] }> = [
  { view: "overview", icon: <LayoutDashboard size={17} />, key: "overview" },
  { view: "projects", icon: <FolderTree size={17} />, key: "projects" },
  { view: "agents", icon: <Bot size={17} />, key: "agents" },
  { view: "caches", icon: <Package size={17} />, key: "caches" },
  { view: "history", icon: <History size={17} />, key: "history" },
];

export const NavRail: React.FC = () => {
  const ui = useUIText();
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const sidebarMode = usePreferencesStore((s) => s.sidebarMode);
  const setSidebarMode = usePreferencesStore((s) => s.setSidebarMode);
  const settingsSection = useUiStore((s) => s.settingsSection);
  const setSettingsSection = useUiStore((s) => s.setSettingsSection);
  const sections = useSettingsSections();
  const isCollapsed = sidebarMode === "collapsed";

  // Below 900px a full-width rail would eat a third of the window. The rail
  // folds to its icon track automatically there, without overwriting the
  // user's saved preference: widening the window restores their choice.
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= 900
  );

  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const sync = () => setIsNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const railCollapsed = isCollapsed || isNarrow;

  // The submenu is owned by the Settings button alone: it opens and closes only
  // on that click, so it stays out while the user moves between pages.
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);

  // The open/close animation needs the real content height. A grid `fr`
  // collapse resolves to 0 inside the rail's nested flex column, so the panel
  // measures its own content and hands the height to CSS via a custom property.
  const submenuInnerRef = useRef<HTMLDivElement | null>(null);
  const [submenuHeight, setSubmenuHeight] = useState(0);

  useEffect(() => {
    const inner = submenuInnerRef.current;
    if (!inner) return;
    const measure = () => setSubmenuHeight(inner.scrollHeight);
    measure();
    // Layout may still be settling on the first paint; one frame later the
    // content height is reliable. ResizeObserver keeps it right on zoom and
    // language changes afterwards.
    const raf = requestAnimationFrame(measure);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(inner);
    }
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [sections.length, railCollapsed]);

  const measureSubmenu = () => {
    const inner = submenuInnerRef.current;
    if (inner) setSubmenuHeight(inner.scrollHeight);
  };

  const toggleSidebar = () => setSidebarMode(isCollapsed ? "expanded" : "collapsed");
  const toggleLabel = isCollapsed ? ui.settings.sidebarExpanded : ui.settings.sidebarCollapsed;

  // Leaving Settings collapses the submenu through the same animated path as a
  // manual toggle, so it never stays expanded over an unrelated page.
  useEffect(() => {
    if (view !== "settings") setSettingsMenuOpen(false);
  }, [view]);

  const openSettings = () => {
    // Measure before toggling so the height variable is already correct in the
    // render that adds `is-open`, avoiding a one-frame jump.
    measureSubmenu();
    // Already on Settings: the button acts as a pure toggle. Coming from another
    // page it opens the submenu and shows Settings at the same time.
    if (view === "settings") {
      setSettingsMenuOpen((prev) => !prev);
      return;
    }
    setView("settings");
    setSettingsMenuOpen(true);
  };

  const chooseSection = (sectionId: (typeof sections)[number]["id"]) => {
    setSettingsSection(sectionId);
    setView("settings");
  };

  const activeSection = sections.find((section) => section.id === settingsSection) ?? sections[0];

  return (
    <nav
      className={`nav-rail ${railCollapsed ? "collapsed" : ""} ${isNarrow ? "is-narrow" : ""}`}
      aria-label={ui.nav.overview}
    >
      <div className="nav-rail-items">
        {ITEMS.map((item) => (
          <button
            key={item.view}
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

        <div className="nav-settings-wrap">
          <button
            type="button"
            className={`nav-item ${view === "settings" ? "active" : ""}`}
            onClick={openSettings}
            title={railCollapsed ? ui.nav.settings : undefined}
            aria-label={ui.nav.settings}
            aria-expanded={settingsMenuOpen}
            aria-controls="nav-settings-submenu"
            aria-current={view === "settings" ? "page" : undefined}
          >
            <Settings size={17} />
            <span className="nav-item-label">{ui.nav.settings}</span>
            <ChevronDown
              size={13}
              className={`nav-item-chevron ${settingsMenuOpen ? "is-open" : ""}`}
            />
          </button>

          <div
            id="nav-settings-submenu"
            className={`nav-submenu ${settingsMenuOpen ? "is-open" : ""}`}
            role="menu"
            aria-label={ui.nav.settings}
            aria-hidden={!settingsMenuOpen}
            style={{ "--nav-submenu-height": `${submenuHeight}px` } as React.CSSProperties}
          >
            <div className="nav-submenu-inner" ref={submenuInnerRef}>
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  role="menuitem"
                  tabIndex={settingsMenuOpen ? 0 : -1}
                  className={`nav-submenu-item ${
                    view === "settings" && section.id === activeSection.id ? "active" : ""
                  }`}
                  onClick={() => chooseSection(section.id)}
                  title={railCollapsed ? section.label : section.hint}
                  aria-current={
                    view === "settings" && section.id === activeSection.id ? "page" : undefined
                  }
                >
                  {section.icon}
                  <span className="nav-item-label">{section.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
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
