import React, { useEffect, useState, useRef } from "react";
import {
  FolderOpen,
  Folder,
  FolderPlus,
  Play,
  Square,
  Star,
  ChevronDown,
  Check,
  X,
  History,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Logo } from "@/components/brand/Logo";
import { WindowControls } from "@/components/layout/WindowControls";
import { useScanStore } from "@/stores/scan-store";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { useAppStore } from "@/stores/app-store";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { KnownLocation, ScanScope } from "@/types";
import { useUIText } from "@/lib/ui-text";
import { truncatePath } from "@/lib/formatters";
import { maskPath } from "@/lib/format/path";
import { getKnownLocationLabel } from "./scan-helpers";
import { useScanController } from "./useScanController";
import "./scan.css";
import { useCacheStore } from "@/stores/cache-store";

export const ScanHeader: React.FC = () => {
  const ui = useUIText();
  const currentRootPath = useScanStore((s) => s.currentRootPath);
  const scanScope = useScanStore((s) => s.scope);
  const { isScanning, startScan, cancelScan } = useScanController();

  const favorites = usePreferencesStore((s) => s.favorites);
  const recentLocations = usePreferencesStore((s) => s.recentLocations);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);
  const addFavorite = usePreferencesStore((s) => s.addFavorite);
  const removeFavorite = usePreferencesStore((s) => s.removeFavorite);
  const addRecentLocation = usePreferencesStore((s) => s.addRecentLocation);
  const removeRecentLocation = usePreferencesStore((s) => s.removeRecentLocation);
  const clearRecentLocations = usePreferencesStore((s) => s.clearRecentLocations);

  const showToast = useUiStore((s) => s.showToast);

  const [knownLocations, setKnownLocations] = useState<KnownLocation[]>([]);
  const [isLocationMenuOpen, setIsLocationMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const locationTriggerRef = useRef<HTMLButtonElement>(null);
  const isSelectingFolderRef = useRef(false);

  useEffect(() => {
    scannerApi
      .getKnownLocations()
      .then((locs) => setKnownLocations(locs))
      .catch(() => showToast(ui.errors.title, "error"));
  }, [showToast, ui.errors.title]);

  // Volumes can be mounted or unmounted while the app runs, so refresh the
  // list every time the location menu opens.
  const refreshKnownLocations = () => {
    scannerApi
      .getKnownLocations()
      .then((locs) => setKnownLocations(locs))
      .catch(() => {
        /* keep the previous list on transient failures */
      });
  };

  const isAllDrives = scanScope === "allDrives";
  const allDrivesLoc = knownLocations.find((loc) => loc.source === "all-drives");
  const allDrivesLabel = allDrivesLoc
    ? getKnownLocationLabel(allDrivesLoc, ui)
    : ui.common.allDrives;

  const shownPath = (path: string, maxChars: number) =>
    truncatePath(maskPaths ? maskPath(path) : path, maxChars);

  // Click outside and escape key handler
  useEffect(() => {
    if (!isLocationMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setIsLocationMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsLocationMenuOpen(false);
        locationTriggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isLocationMenuOpen]);

  // A running scan owns the location, so the menu must not stay open with
  // selectable entries that are now inert.
  useEffect(() => {
    if (isScanning) setIsLocationMenuOpen(false);
  }, [isScanning]);

  const currentFavorite = currentRootPath
    ? favorites.find((f) => f.path.toLowerCase() === currentRootPath.toLowerCase())
    : null;
  const isFavorite = Boolean(currentFavorite);

  const handleSelectFolder = async () => {
    if (isScanning || isSelectingFolderRef.current) return;
    isSelectingFolderRef.current = true;
    setIsLocationMenuOpen(false);
    try {
      const selected = await scannerApi.selectFolderDialog(ui.header.folderNotSelected);
      if (selected) {
        useScanStore.getState().resetScan();
        useScanStore.setState({ currentRootPath: selected });
        addRecentLocation(selected);
      }
    } catch {
      showToast(ui.errors.title, "error");
    } finally {
      isSelectingFolderRef.current = false;
    }
  };

  const handleSelectLocation = (path: string, source?: string) => {
    if (isScanning) return;
    setIsLocationMenuOpen(false);
    useScanStore.getState().resetScan();
    if (source === "all-drives") {
      useScanStore.setState({ scope: "allDrives" });
      return;
    }
    useScanStore.setState({ currentRootPath: path, scope: "project" });
    addRecentLocation(path);
  };

  const toggleFavorite = () => {
    if (!currentRootPath) return;
    if (currentFavorite) {
      removeFavorite(currentFavorite.id);
      showToast(ui.header.favoriteRemoved, "info");
    } else {
      addFavorite(currentRootPath);
      showToast(ui.header.favoriteAdded, "success");
    }
  };

  const handleStartScan = (pathOverride?: string) => {
    const view = useAppStore.getState().view;
    const scope: ScanScope = view === "agents" ? "agents" : isAllDrives ? "allDrives" : "project";
    if (view === "caches") {
      void useCacheStore.getState().startMeasure();
      return;
    }
    startScan(scope === "allDrives" ? undefined : pathOverride, scope);

    // Combined Full Scan: measure tool caches alongside the project scan
    if (view !== "agents" && !useCacheStore.getState().measuring) {
      if (!useCacheStore.getState().loaded) {
        useCacheStore
          .getState()
          .loadProviders()
          .then(() => {
            void useCacheStore.getState().startMeasure();
          });
      } else {
        void useCacheStore.getState().startMeasure();
      }
    }
  };

  const handleCancelScan = () => {
    cancelScan();
  };

  return (
    <header className="top-command-bar" data-tauri-drag-region="deep">
      {/* 1. Left: Single Brand Title */}
      <div className="command-brand" data-tauri-drag-region="false">
        <Logo size={18} showWordmark={false} />
        <span className="command-brand-title">Dev Cleaner</span>
      </div>

      {/* 2. Center: Single Location Dropdown Trigger & Popover Menu */}
      <div className="command-center">
        <div
          className={`location-dropdown-container ${isLocationMenuOpen ? "menu-open" : ""}`}
          ref={menuContainerRef}
          data-tauri-drag-region="false"
        >
          <div className={`command-location-group ${isScanning ? "is-scanning" : ""}`}>
            <button
              ref={locationTriggerRef}
              type="button"
              className="command-location-pill"
              onClick={() => {
                if (isScanning) return;
                if (!isLocationMenuOpen) refreshKnownLocations();
                setIsLocationMenuOpen((prev) => !prev);
              }}
              disabled={isScanning}
              aria-label={ui.header.changeLocation}
              aria-expanded={isLocationMenuOpen}
              aria-controls={isLocationMenuOpen ? "location-menu" : undefined}
              title={
                isAllDrives
                  ? allDrivesLabel
                  : currentRootPath
                    ? maskPaths
                      ? maskPath(currentRootPath)
                      : currentRootPath
                    : ui.header.folderNotSelected
              }
            >
              <FolderOpen size={14} className="command-folder-icon" />
              <span className="command-path-text">
                {isAllDrives
                  ? allDrivesLabel
                  : currentRootPath
                    ? shownPath(currentRootPath, 34)
                    : ui.header.folderNotSelected}
              </span>

              {!isScanning && (
                <ChevronDown
                  size={13}
                  className={`command-chevron-icon ${isLocationMenuOpen ? "open" : ""}`}
                />
              )}
            </button>

            {currentRootPath && !isScanning && (
              <button
                type="button"
                className={`command-star-btn ${isFavorite ? "active" : ""}`}
                onClick={toggleFavorite}
                aria-pressed={isFavorite}
                aria-label={isFavorite ? ui.header.removeFavorite : ui.header.addFavorite}
                title={isFavorite ? ui.header.removeFavorite : ui.header.addFavorite}
              >
                <Star
                  size={12}
                  fill={isFavorite ? "#FFB800" : "none"}
                  color={isFavorite ? "#FFB800" : "var(--text-muted)"}
                />
              </button>
            )}
          </div>

          {/* Location Dropdown Menu — disclosure, not a menu widget */}
          {isLocationMenuOpen && !isScanning && (
            <div
              id="location-menu"
              className="location-dropdown-menu"
              data-tauri-drag-region="false"
            >
              {/* 1. First: choose a different location */}
              <div className="location-menu-section">
                <button
                  type="button"
                  className="location-menu-item location-menu-action"
                  onClick={handleSelectFolder}
                >
                  <div className="location-menu-item-icon action-icon">
                    <FolderPlus size={16} />
                  </div>
                  <div className="location-menu-item-info">
                    <span className="location-menu-item-title">{ui.common.chooseFolder}</span>
                    <span className="location-menu-item-path">{ui.header.chooseFolderSub}</span>
                  </div>
                </button>
              </div>

              <div className="location-menu-divider" />

              {/* 2. Varsayılan Konumlar */}
              <div className="location-menu-section">
                <div className="location-menu-section-header">
                  <span>{ui.header.defaultLocations}</span>
                </div>
                {knownLocations.map((loc) => {
                  const isVirtual = loc.source === "all-drives";
                  const isSelected = isVirtual
                    ? isAllDrives
                    : !isAllDrives &&
                      Boolean(currentRootPath) &&
                      currentRootPath?.toLowerCase() === loc.path.toLowerCase();
                  const label = getKnownLocationLabel(loc, ui);
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      className={`location-menu-item ${isSelected ? "is-selected" : ""}`}
                      onClick={() => handleSelectLocation(loc.path, loc.source)}
                      title={isVirtual ? label : maskPaths ? maskPath(loc.path) : loc.path}
                    >
                      <div className="location-menu-item-icon">
                        <Folder size={15} />
                      </div>
                      <div className="location-menu-item-info">
                        <span className="location-menu-item-title">{label}</span>
                        {!isVirtual && (
                          <span className="location-menu-item-path">{shownPath(loc.path, 34)}</span>
                        )}
                      </div>
                      {isSelected && (
                        <div className="location-menu-item-check">
                          <Check size={14} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* 3. Favoriler (Varsa veya Bilgi) */}
              <div className="location-menu-divider" />
              <div className="location-menu-section">
                <div className="location-menu-section-header">
                  <span>{ui.header.favorites}</span>
                  {favorites.length > 0 && (
                    <span className="location-menu-badge">{favorites.length}</span>
                  )}
                </div>

                {favorites.length > 0 ? (
                  favorites.map((fav) => {
                    const isSelected = currentRootPath?.toLowerCase() === fav.path.toLowerCase();
                    return (
                      <div
                        key={fav.id}
                        className={`location-menu-item-row ${isSelected ? "is-selected" : ""}`}
                      >
                        <button
                          type="button"
                          className="location-menu-item-select"
                          onClick={() => handleSelectLocation(fav.path)}
                        >
                          <div className="location-menu-item-icon fav-icon">
                            <Star size={15} fill="#FFB800" color="#FFB800" />
                          </div>
                          <div className="location-menu-item-info">
                            <span className="location-menu-item-title">{fav.label}</span>
                            <span className="location-menu-item-path">
                              {shownPath(fav.path, 30)}
                            </span>
                          </div>
                          {isSelected && (
                            <div className="location-menu-item-check">
                              <Check size={14} />
                            </div>
                          )}
                        </button>
                        <button
                          type="button"
                          className="location-menu-item-remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFavorite(fav.id);
                            showToast(ui.header.favoriteRemoved, "info");
                          }}
                          aria-label={`${ui.header.removeFavorite}: ${fav.label}`}
                          title={ui.header.removeFavorite}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <div className="location-menu-empty">
                    <span>{ui.header.noFavorites}</span>
                  </div>
                )}
              </div>

              {/* 4. Son Tarananlar (Varsa) */}
              {recentLocations.length > 0 && (
                <>
                  <div className="location-menu-divider" />
                  <div className="location-menu-section">
                    <div className="location-menu-section-header">
                      <span>{ui.header.recent}</span>
                      <button
                        type="button"
                        className="location-menu-clear-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          clearRecentLocations();
                        }}
                        title={ui.common.clear}
                      >
                        <Trash2 size={11} />
                        <span>{ui.common.clear}</span>
                      </button>
                    </div>
                    {recentLocations.slice(0, 5).map((path, idx) => {
                      const isSelected = currentRootPath?.toLowerCase() === path.toLowerCase();
                      const name = path.split(/[/\\]/).filter(Boolean).pop() || path;
                      return (
                        <div
                          key={idx}
                          className={`location-menu-item-row ${isSelected ? "is-selected" : ""}`}
                        >
                          <button
                            type="button"
                            className="location-menu-item-select"
                            onClick={() => handleSelectLocation(path)}
                          >
                            <div className="location-menu-item-icon recent-icon">
                              <History size={14} />
                            </div>
                            <div className="location-menu-item-info">
                              <span className="location-menu-item-title">{name}</span>
                              <span className="location-menu-item-path">{shownPath(path, 30)}</span>
                            </div>
                            {isSelected && (
                              <div className="location-menu-item-check">
                                <Check size={14} />
                              </div>
                            )}
                          </button>
                          <button
                            type="button"
                            className="location-menu-item-remove"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeRecentLocation(path);
                            }}
                            aria-label={`${ui.common.remove}: ${name}`}
                            title={ui.common.remove}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 3. Right: Actions + Window Controls */}
      <div className="command-actions">
        {isScanning ? (
          <Button
            variant="danger-outline"
            size="sm"
            className="command-scan-btn is-cancelling"
            icon={<Square size={11} fill="currentColor" />}
            onClick={handleCancelScan}
          >
            {ui.common.stop}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            className="command-scan-btn"
            icon={<Play size={11} fill="currentColor" />}
            onClick={() => handleStartScan()}
          >
            {ui.common.scan}
          </Button>
        )}

        <WindowControls />
      </div>
    </header>
  );
};
