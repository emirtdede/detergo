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
import { Dialog } from "@/components/primitives/Dialog";
import { Logo } from "@/components/brand/Logo";
import { WindowControls } from "@/components/layout/WindowControls";
import { useScanStore } from "@/stores/scan-store";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { KnownLocation, ScanScope } from "@/types";
import { getUIText, localizeAppError, useUIText } from "@/lib/ui-text";
import { maskPath, truncatePath } from "@/lib/format/path";
import { getKnownLocationLabel } from "./scan-helpers";
import { useScanController } from "./useScanController";
import "./scan.css";
import { useCacheStore } from "@/stores/cache-store";

export const ScanHeader: React.FC = () => {
  const ui = useUIText();
  const currentRootPath = useScanStore((s) => s.currentRootPath);
  const scanScope = useScanStore((s) => s.scope);
  const { isScanning, status, combinedActive, startScan, startFullScan, cancelScan } =
    useScanController();
  // After a user cancel the walk reports `cancelled` while the combined run is
  // still winding down (the cache step may be finishing). Re-enabling the button
  // in that window invited a second press that looked like the real stop.
  const stopping = status === "cancelling" || (status === "cancelled" && combinedActive);

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
  // The top bar button covers every scan the app can run; this menu keeps the
  // single-scope actions reachable for users who do not want a full pass.
  const [isScanMenuOpen, setIsScanMenuOpen] = useState(false);
  // Changing the folder used to wipe the current results instantly. Ask first
  // when there is something to lose; selecting a new location is not an
  // implicit "reset workspace" command.
  const [pendingLocation, setPendingLocation] = useState<{
    path: string;
    source?: string;
  } | null>(null);
  const resultCount = useScanStore((s) => s.itemIds.length);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const locationTriggerRef = useRef<HTMLButtonElement>(null);
  const scanMenuRef = useRef<HTMLDivElement>(null);
  const scanMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const isSelectingFolderRef = useRef(false);
  // Shared request generation for the known-locations fetches (see below).
  const locationRequestRef = useRef(0);

  useEffect(() => {
    // Cancelled guard: the list is fetched once on mount, and Settings or a
    // language switch can unmount the header while the IPC call is in flight.
    // Writing state afterwards is a no-op in React 18 but keeps a second
    // StrictMode request alive for a component that no longer exists. It shares
    // the request generation with `refreshKnownLocations` so an older response
    // can never win against a newer one.
    const request = locationRequestRef.current + 1;
    locationRequestRef.current = request;
    const isCurrent = () => request === locationRequestRef.current;
    scannerApi
      .getKnownLocations()
      .then((locs) => {
        if (isCurrent()) setKnownLocations(locs);
      })
      // The message is resolved when the failure happens, not captured from a
      // render: `ui` in the dependency list refetched the list on every
      // language change. The detail matters: "Error" alone told the user
      // nothing about which action failed or why.
      .catch((err) => {
        if (!isCurrent()) return;
        const activeUi = getUIText();
        showToast(`${activeUi.errors.title}: ${localizeAppError(err, activeUi)}`, "error", 6000);
      });
    return () => {
      // Invalidates the in-flight response without disturbing a later request.
      if (isCurrent()) locationRequestRef.current += 1;
    };
  }, [showToast]);

  // Volumes can be mounted or unmounted while the app runs, so refresh the
  // list every time the location menu opens.
  //
  // A shared generation keeps the mount fetch, this refresh and an unmount from
  // racing: the old code applied whichever response happened to land last, so a
  // list from an earlier request could overwrite a newer one (or write into a
  // detached header).
  const refreshKnownLocations = () => {
    const request = locationRequestRef.current + 1;
    locationRequestRef.current = request;
    scannerApi
      .getKnownLocations()
      .then((locs) => {
        if (request === locationRequestRef.current) setKnownLocations(locs);
      })
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
  // selectable entries that are now inert. The scope menu is equally inert:
  // both are closed by the same effect so a future menu cannot forget it.
  useEffect(() => {
    if (!isScanning) return;
    setIsLocationMenuOpen(false);
    setIsScanMenuOpen(false);
  }, [isScanning]);

  useEffect(() => {
    if (!isScanMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (scanMenuRef.current && !scanMenuRef.current.contains(e.target as Node)) {
        setIsScanMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsScanMenuOpen(false);
        scanMenuTriggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isScanMenuOpen]);

  const currentFavorite = currentRootPath
    ? favorites.find((f) => f.path.toLowerCase() === currentRootPath.toLowerCase())
    : null;
  const isFavorite = Boolean(currentFavorite);

  const applyLocation = (path: string, source?: string) => {
    // Changing the location discards the visible scan, but the persisted "last
    // scan" snapshot is a separate, user-owned record. Clearing it here deleted
    // the snapshot behind the user's back; only an explicit workspace reset
    // (`clearPersisted: true`) may do that.
    useScanStore.getState().resetScan();
    if (source === "all-drives") {
      // All-drives has no single root; keeping the previous project path would
      // leave a stale location (and a stray favorite star) behind.
      useScanStore.setState({ currentRootPath: null, scope: "allDrives" });
      return;
    }
    useScanStore.setState({ currentRootPath: path, scope: "project" });
    addRecentLocation(path);
  };

  const isSameLocation = (path: string, source?: string) => {
    if (source === "all-drives") return isAllDrives;
    return (
      !isAllDrives &&
      Boolean(currentRootPath) &&
      currentRootPath!.toLowerCase() === path.toLowerCase()
    );
  };

  const requestLocationChange = (path: string, source?: string) => {
    // Re-selecting the current folder is a no-op, not a destructive reset.
    if (isSameLocation(path, source)) return;
    // Only ask when a change would actually destroy something. Selecting the
    // same folder again is harmless, but still routes through the dialog when
    // results exist so the user stays in control.
    if (resultCount > 0) {
      setPendingLocation({ path, source });
      return;
    }
    applyLocation(path, source);
  };

  const handleSelectFolder = async () => {
    if (isScanning || isSelectingFolderRef.current) return;
    isSelectingFolderRef.current = true;
    setIsLocationMenuOpen(false);
    try {
      const selected = await scannerApi.selectFolderDialog(ui.header.folderNotSelected);
      if (selected) {
        requestLocationChange(selected);
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
    requestLocationChange(path, source);
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

  const handleStartFullScan = () => {
    setIsScanMenuOpen(false);
    // Projects + AI agent storage share one backend session; package caches
    // are measured in parallel by the same action.
    void startFullScan();
  };

  const handleStartScope = (scope: ScanScope) => {
    setIsScanMenuOpen(false);
    if (scope === "globalCaches") {
      void useCacheStore.getState().startMeasure();
      return;
    }
    void startScan(undefined, scope);
  };

  const handleCancelScan = () => {
    void cancelScan();
  };

  return (
    <>
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
                            <span className="location-menu-item-path">
                              {shownPath(loc.path, 34)}
                            </span>
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
                      {recentLocations.slice(0, 5).map((path) => {
                        const isSelected = currentRootPath?.toLowerCase() === path.toLowerCase();
                        const name = path.split(/[/\\]/).filter(Boolean).pop() || path;
                        return (
                          <div
                            key={path}
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
                                <span className="location-menu-item-path">
                                  {shownPath(path, 30)}
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
        <div className="command-actions" data-tauri-drag-region="false">
          {isScanning ? (
            <Button
              variant="danger-outline"
              size="sm"
              className={`command-scan-btn is-cancelling ${stopping ? "is-stopping" : ""}`}
              icon={<Square size={11} fill="currentColor" />}
              onClick={handleCancelScan}
              disabled={stopping}
              aria-busy={stopping}
            >
              {stopping ? ui.plan.cancelling : ui.common.stop}
            </Button>
          ) : (
            <div className="command-scan-group" ref={scanMenuRef}>
              <Button
                variant="primary"
                size="sm"
                className="command-scan-btn"
                icon={<Play size={11} fill="currentColor" />}
                onClick={handleStartFullScan}
              >
                {ui.common.scanAll}
              </Button>
              <button
                ref={scanMenuTriggerRef}
                type="button"
                className={`command-scan-menu-trigger ${isScanMenuOpen ? "is-open" : ""}`}
                onClick={() => setIsScanMenuOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={isScanMenuOpen}
                aria-controls={isScanMenuOpen ? "scan-scope-menu" : undefined}
                aria-label={ui.common.scanAll}
                title={ui.common.scanAllDesc}
              >
                <ChevronDown size={13} />
              </button>

              {isScanMenuOpen && (
                <div
                  id="scan-scope-menu"
                  className="command-scan-menu"
                  role="menu"
                  data-tauri-drag-region="false"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="location-menu-item"
                    onClick={handleStartFullScan}
                  >
                    <div className="location-menu-item-info">
                      <span className="location-menu-item-title">{ui.common.scanAll}</span>
                      <span className="location-menu-item-path">{ui.common.scanAllDesc}</span>
                    </div>
                  </button>
                  <div className="location-menu-divider" />
                  <button
                    type="button"
                    role="menuitem"
                    className="location-menu-item"
                    onClick={() => handleStartScope("project")}
                  >
                    <div className="location-menu-item-info">
                      <span className="location-menu-item-title">{ui.nav.projects}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="location-menu-item"
                    onClick={() => handleStartScope("agents")}
                  >
                    <div className="location-menu-item-info">
                      <span className="location-menu-item-title">{ui.nav.agents}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="location-menu-item"
                    onClick={() => handleStartScope("globalCaches")}
                  >
                    <div className="location-menu-item-info">
                      <span className="location-menu-item-title">{ui.nav.caches}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="location-menu-item"
                    onClick={() => handleStartScope("allDrives")}
                  >
                    <div className="location-menu-item-info">
                      <span className="location-menu-item-title">{ui.common.allDrives}</span>
                    </div>
                  </button>
                </div>
              )}
            </div>
          )}

          <WindowControls />
        </div>
      </header>

      <Dialog
        isOpen={pendingLocation !== null}
        onClose={() => setPendingLocation(null)}
        title={ui.header.changeLocation}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingLocation(null)}>
              {ui.common.cancel}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingLocation) {
                  applyLocation(pendingLocation.path, pendingLocation.source);
                }
                setPendingLocation(null);
              }}
            >
              {ui.common.confirm}
            </Button>
          </>
        }
      >
        <p
          style={{
            margin: 0,
            color: "var(--text-secondary)",
            fontSize: "var(--text-sm)",
            lineHeight: "var(--leading-relaxed)",
          }}
        >
          {ui.header.changeLocationConfirmDesc}
        </p>
      </Dialog>
    </>
  );
};
