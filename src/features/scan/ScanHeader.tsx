import React, { useEffect, useState, useRef } from "react";
import {
  Bot,
  FolderOpen,
  Folder,
  FolderPlus,
  FolderTree,
  HardDrive,
  Package,
  Play,
  SlidersHorizontal,
  Square,
  Star,
  Check,
  X,
  History,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Checkbox } from "@/components/primitives/Checkbox";
import { Dialog } from "@/components/primitives/Dialog";
import { useScanStore } from "@/stores/scan-store";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { useCacheStore } from "@/stores/cache-store";
import { useSystemStore } from "@/stores/system-store";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { KnownLocation } from "@/types";
import { getUIText, localizeAppError, useUIText } from "@/lib/ui-text";
import { maskPath, truncatePath } from "@/lib/format/path";
import { formatBytes } from "@/lib/formatters";
import { getKnownLocationLabel } from "./scan-helpers";
import { ALL_SCAN_TARGETS, ScanTargetKey, useScanTargetsStore } from "./scan-activity";
import { useScanController } from "./useScanController";
import "./scan.css";

export interface ScanHeaderProps {
  collapsed?: boolean;
}

export const ScanHeader: React.FC<ScanHeaderProps> = ({ collapsed = false }) => {
  const ui = useUIText();
  const currentRootPath = useScanStore((s) => s.currentRootPath);
  const scanScope = useScanStore((s) => s.scope);
  const progress = useScanStore((s) => s.progress);
  const cacheMeasuring = useCacheStore((s) => s.measuring);
  const measureDone = useCacheStore((s) => s.measureDone);
  const measureTotal = useCacheStore((s) => s.measureTotal);
  const systemLoading = useSystemStore((s) => s.loading);
  const { isScanning, status, combinedActive, startSelectedScan, cancelScan } = useScanController();
  const selectedTargets = useScanTargetsStore((s) => s.targets);
  const allDrivesSelected = useScanTargetsStore((s) => s.allDrives);
  const activeTargets = useScanTargetsStore((s) => s.activeTargets);
  const activeAllDrives = useScanTargetsStore((s) => s.activeAllDrives);
  const toggleTarget = useScanTargetsStore((s) => s.toggleTarget);
  const selectAllTargets = useScanTargetsStore((s) => s.selectAllTargets);
  const setAllDrives = useScanTargetsStore((s) => s.setAllDrives);
  // After a user cancel the walk reports `cancelled` while the combined run is
  // still winding down (the cache step may be finishing). Re-enabling the button
  // in that window invited a second press that looked like the real stop.
  const stopping = status === "cancelling" || (status === "cancelled" && combinedActive);
  const walkRunning = status === "scanning" || status === "measuring" || status === "cancelling";
  const canStop = walkRunning || combinedActive || cacheMeasuring || systemLoading;

  const language = usePreferencesStore((s) => s.language);

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
  const [isHubOpen, setIsHubOpen] = useState(false);
  // Changing the folder used to wipe the current results instantly. Ask first
  // when there is something to lose; selecting a new location is not an
  // implicit "reset workspace" command.
  const [pendingLocation, setPendingLocation] = useState<{
    path: string;
    source?: string;
  } | null>(null);
  const resultCount = useScanStore((s) => s.itemIds.length);
  const hubContainerRef = useRef<HTMLDivElement>(null);
  const hubTriggerRef = useRef<HTMLButtonElement>(null);
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

  // Click outside and escape key handler for the unified Scan Hub popover
  useEffect(() => {
    if (!isHubOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (hubContainerRef.current && !hubContainerRef.current.contains(e.target as Node)) {
        setIsHubOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsHubOpen(false);
        hubTriggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isHubOpen]);

  // A running scan owns the location and scope, so close the hub popover.
  useEffect(() => {
    if (!isScanning) return;
    setIsHubOpen(false);
  }, [isScanning]);

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
      setAllDrives(true);
      return;
    }
    useScanStore.setState({ currentRootPath: path, scope: "project" });
    setAllDrives(false);
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
    setIsHubOpen(false);
    try {
      const selected = await scannerApi.selectFolderDialog(ui.header.folderNotSelected);
      if (selected) {
        requestLocationChange(selected);
      }
    } catch (err) {
      showToast(`${ui.errors.title}: ${localizeAppError(err, ui)}`, "error", 6000);
    } finally {
      isSelectingFolderRef.current = false;
    }
  };

  const handleSelectLocation = (path: string, source?: string) => {
    if (isScanning) return;
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

  const targetLabel = (key: ScanTargetKey): string => {
    switch (key) {
      case "projects":
        return ui.nav.projects;
      case "agents":
        return ui.nav.agents;
      case "caches":
        return ui.nav.caches;
      case "system":
        return ui.nav.system;
    }
  };

  const targetIcon = (key: ScanTargetKey): React.ReactNode => {
    switch (key) {
      case "projects":
        return <FolderTree size={14} />;
      case "agents":
        return <Bot size={14} />;
      case "caches":
        return <Package size={14} />;
      case "system":
        return <HardDrive size={14} />;
    }
  };

  const effectiveAllDrives = allDrivesSelected;
  const allTargetsSelected =
    selectedTargets.length === ALL_SCAN_TARGETS.length && !effectiveAllDrives;

  const primaryScanLabel = (() => {
    if (effectiveAllDrives && selectedTargets.length === 1 && selectedTargets[0] === "projects") {
      return ui.common.allDrives;
    }
    if (allTargetsSelected) return ui.common.scanAll;
    if (selectedTargets.length === 1) {
      return `${ui.common.scan}: ${targetLabel(selectedTargets[0])}`;
    }
    return `${ui.common.scan} (${selectedTargets.length}/${ALL_SCAN_TARGETS.length})`;
  })();

  const selectedTargetsSummary = selectedTargets
    .map((key) =>
      key === "projects" && effectiveAllDrives
        ? `${targetLabel(key)} (${ui.common.allDrives})`
        : targetLabel(key),
    )
    .join(", ");

  const runningTargets: ScanTargetKey[] =
    activeTargets.length > 0
      ? activeTargets
      : [
          ...(walkRunning && scanScope !== "agents" ? (["projects"] as const) : []),
          ...(walkRunning &&
          (scanScope === "agents" ||
            scanScope === "combined" ||
            (scanScope === "allDrives" && selectedTargets.includes("agents")))
            ? (["agents"] as const)
            : []),
          ...(cacheMeasuring ? (["caches"] as const) : []),
          ...(systemLoading ? (["system"] as const) : []),
        ];

  const activeScopeLabel = (() => {
    if (activeAllDrives && runningTargets.length <= 1) return ui.common.allDrives;
    if (runningTargets.length >= ALL_SCAN_TARGETS.length) return ui.common.scanAll;
    if (runningTargets.length === 1) return targetLabel(runningTargets[0]);
    if (runningTargets.length === 2) {
      return `${targetLabel(runningTargets[0])} + ${targetLabel(runningTargets[1])}`;
    }
    if (runningTargets.length > 2) {
      return `${targetLabel(runningTargets[0])} + ${targetLabel(runningTargets[1])} +${runningTargets.length - 2}`;
    }
    return ui.common.scanning;
  })();

  const { activeProgressDetail, progressPct } = (() => {
    if (stopping) {
      return { activeProgressDetail: ui.plan.cancelling, progressPct: null as number | null };
    }
    if (walkRunning) {
      if (progress && progress.entriesFound > 0) {
        if (progress.entriesMeasured > 0) {
          const pct = Math.min(
            100,
            Math.round((progress.entriesMeasured / progress.entriesFound) * 100),
          );
          const detail =
            status === "measuring"
              ? `${pct}% · ${progress.entriesMeasured}/${progress.entriesFound} · ${formatBytes(progress.bytesMeasured, language)}`
              : `${progress.entriesMeasured}/${progress.entriesFound} · ${formatBytes(progress.bytesMeasured, language)}`;
          return { activeProgressDetail: detail, progressPct: status === "measuring" ? pct : null };
        }
        return {
          activeProgressDetail:
            progress.directoriesVisited > 0
              ? `${progress.entriesFound} · ${progress.directoriesVisited.toLocaleString(language || undefined)}`
              : `${progress.entriesFound}`,
          progressPct: null as number | null,
        };
      }
      if (progress && progress.directoriesVisited > 0) {
        return {
          activeProgressDetail: `${ui.common.scanning} · ${progress.directoriesVisited.toLocaleString(language || undefined)}`,
          progressPct: null as number | null,
        };
      }
      return { activeProgressDetail: ui.common.scanning, progressPct: null as number | null };
    }
    if (cacheMeasuring) {
      if (measureTotal > 0) {
        const pct = Math.min(100, Math.round((measureDone / measureTotal) * 100));
        return {
          activeProgressDetail: `${measureDone}/${measureTotal} (${pct}%)`,
          progressPct: pct,
        };
      }
      return { activeProgressDetail: ui.caches.measuring, progressPct: null as number | null };
    }
    if (systemLoading) {
      return { activeProgressDetail: ui.caches.measuring, progressPct: null as number | null };
    }
    return { activeProgressDetail: ui.common.scanning, progressPct: null as number | null };
  })();

  const handleStartSelectedScan = () => {
    setIsHubOpen(false);
    void startSelectedScan();
  };

  const handleCancelScan = () => {
    void cancelScan();
  };

  const activeLocationDisplay = isAllDrives
    ? allDrivesLabel
    : currentRootPath
      ? shownPath(currentRootPath, 34)
      : ui.common.chooseFolder;

  const activeLocationTitle = isAllDrives
    ? allDrivesLabel
    : currentRootPath
      ? maskPaths
        ? maskPath(currentRootPath)
        : currentRootPath
      : ui.header.chooseFolderSub;

  // Exclude Desktop, Documents, and the duplicate All Drives entry (already
  // represented by the dedicated scope toggle below) so the entire popover fits
  // cleanly without vertical scrolling.
  const quickLocations = knownLocations.filter((loc) => {
    const id = loc.id.toLowerCase();
    return (
      loc.source !== "all-drives" &&
      id !== "loc-all-drives" &&
      id !== "loc-desktop" &&
      id !== "desktop" &&
      id !== "loc-documents" &&
      id !== "documents"
    );
  });

  return (
    <>
      <div
        className={`sidebar-scan-dock ${isScanning ? "is-scanning" : ""} ${collapsed ? "is-collapsed" : ""}`}
        ref={hubContainerRef}
        data-tauri-drag-region="false"
      >
        {isScanning ? (
          <div className="scan-hub-btn scan-hub-btn--active">
            <div
              className="scan-hub-live"
              role="status"
              aria-live="polite"
              title={`${activeScopeLabel} - ${activeProgressDetail}`}
            >
              <span className="command-scan-pulse" aria-hidden="true" />
              <span className="scan-hub-live-text">
                <span className="command-scan-scope">{activeScopeLabel}</span>
                <span className="command-scan-sep" aria-hidden="true">
                  ·
                </span>
                <span className="command-scan-metric">{activeProgressDetail}</span>
              </span>
            </div>

            {canStop && (
              <button
                type="button"
                className={`scan-hub-stop ${stopping ? "is-stopping" : ""}`}
                onClick={handleCancelScan}
                disabled={stopping}
                aria-busy={stopping}
                aria-label={stopping ? ui.plan.cancelling : ui.common.stop}
                title={
                  collapsed
                    ? `${stopping ? ui.plan.cancelling : ui.common.stop} (${activeScopeLabel} - ${activeProgressDetail})`
                    : stopping
                      ? ui.plan.cancelling
                      : ui.common.stop
                }
              >
                <Square size={11} fill="currentColor" />
              </button>
            )}

            <div
              className="command-progress-track"
              role="progressbar"
              aria-label={activeScopeLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPct ?? undefined}
            >
              <div
                className={`command-progress-bar ${progressPct === null ? "is-indeterminate" : ""}`}
                style={progressPct !== null ? { width: `${progressPct}%` } : undefined}
              />
            </div>
          </div>
        ) : (
          <div className={`scan-hub-btn ${isHubOpen ? "is-open" : ""}`}>
            <button
              type="button"
              className="scan-hub-primary"
              onClick={handleStartSelectedScan}
              title={`${primaryScanLabel} · ${activeLocationTitle} (${selectedTargetsSummary})`}
            >
              <Play size={12} fill="currentColor" className="scan-hub-play-icon" />
              <span className="scan-hub-primary-label">{primaryScanLabel}</span>
            </button>

            <button
              ref={hubTriggerRef}
              type="button"
              className={`scan-hub-config ${isHubOpen ? "is-open" : ""}`}
              onClick={() => {
                if (!isHubOpen) refreshKnownLocations();
                setIsHubOpen((prev) => !prev);
              }}
              aria-label={ui.header.changeLocation}
              aria-expanded={isHubOpen}
              aria-controls={isHubOpen ? "location-menu" : undefined}
              title={`${ui.header.changeLocation} · ${activeLocationTitle}`}
            >
              <SlidersHorizontal size={13} />
            </button>
          </div>
        )}

        {/* Unified Scan Hub Popover: Directory Selection + Scan Scope */}
        {isHubOpen && !isScanning && (
          <div
            id="location-menu"
            className="location-dropdown-menu scan-hub-popover"
            data-tauri-drag-region="false"
          >
            {/* Section 1: Single Folder Picker Button + Quick Drives/Locations */}
            <div className="location-menu-section">
              <div className="location-menu-section-header">
                <span>{ui.header.changeLocation}</span>
              </div>

              <div className="scan-hub-folder-bar">
                <button
                  type="button"
                  className="scan-hub-folder-trigger"
                  onClick={handleSelectFolder}
                  title={activeLocationTitle}
                >
                  {currentRootPath ? (
                    <FolderOpen size={14} className="command-folder-icon" />
                  ) : (
                    <FolderPlus size={14} className="command-folder-icon" />
                  )}
                  <span className="scan-hub-folder-path">{activeLocationDisplay}</span>
                </button>

                {currentRootPath && (
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

              <div className="scan-hub-locations-list">
                {quickLocations.map((loc) => {
                  const isSelected =
                    !isAllDrives &&
                    Boolean(currentRootPath) &&
                    currentRootPath?.toLowerCase() === loc.path.toLowerCase();
                  const label = getKnownLocationLabel(loc, ui);
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      className={`location-menu-item scan-hub-loc-item ${isSelected ? "is-selected" : ""}`}
                      onClick={() => handleSelectLocation(loc.path, loc.source)}
                      title={maskPaths ? maskPath(loc.path) : loc.path}
                    >
                      <div className="location-menu-item-icon">
                        <Folder size={13} />
                      </div>
                      <div className="location-menu-item-info">
                        <span className="location-menu-item-title">{label}</span>
                        <span className="location-menu-item-path">{shownPath(loc.path, 34)}</span>
                      </div>
                      {isSelected && (
                        <div className="location-menu-item-check">
                          <Check size={13} />
                        </div>
                      )}
                    </button>
                  );
                })}

                {favorites.length > 0 && (
                  <>
                    <div className="location-menu-section-header">
                      <span>{ui.header.favorites}</span>
                      <span className="location-menu-badge">{favorites.length}</span>
                    </div>
                    {favorites.slice(0, 3).map((fav) => {
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
                              <Star size={13} fill="#FFB800" color="#FFB800" />
                            </div>
                            <div className="location-menu-item-info">
                              <span className="location-menu-item-title">{fav.label}</span>
                              <span className="location-menu-item-path">
                                {shownPath(fav.path, 30)}
                              </span>
                            </div>
                            {isSelected && (
                              <div className="location-menu-item-check">
                                <Check size={13} />
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
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </>
                )}

                {recentLocations.length > 0 && (
                  <>
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
                    {recentLocations.slice(0, 3).map((path) => {
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
                              <History size={13} />
                            </div>
                            <div className="location-menu-item-info">
                              <span className="location-menu-item-title">{name}</span>
                              <span className="location-menu-item-path">{shownPath(path, 28)}</span>
                            </div>
                            {isSelected && (
                              <div className="location-menu-item-check">
                                <Check size={13} />
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
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>

            <div className="location-menu-divider" />

            {/* Section 2: Scan Targets (Compact 2x2 Grid + All Drives) */}
            <div className="location-menu-section">
              <div className="location-menu-section-header">
                <span>{ui.overview.coverage}</span>
                <span className="location-menu-badge">
                  {selectedTargets.length}/{ALL_SCAN_TARGETS.length}
                </span>
              </div>

              <div className="scan-scope-grid">
                {ALL_SCAN_TARGETS.map((key) => {
                  const checked = selectedTargets.includes(key);
                  const isOnlySelected = checked && selectedTargets.length === 1;
                  return (
                    <div key={key} className={`scan-scope-option ${checked ? "is-selected" : ""}`}>
                      <Checkbox
                        id={`scan-target-${key}`}
                        checked={checked}
                        disabled={isOnlySelected}
                        onChange={() => toggleTarget(key)}
                        label={
                          <span className="scan-scope-label">
                            <span className="scan-scope-icon" aria-hidden="true">
                              {targetIcon(key)}
                            </span>
                            <span className="scan-scope-title">{targetLabel(key)}</span>
                          </span>
                        }
                      />
                    </div>
                  );
                })}
              </div>

              <div
                className={`scan-scope-option scan-scope-option--subtle ${effectiveAllDrives ? "is-selected" : ""}`}
              >
                <Checkbox
                  id="scan-target-all-drives"
                  checked={effectiveAllDrives}
                  onChange={(next) => {
                    setAllDrives(next);
                    if (!next && isAllDrives) {
                      useScanStore.setState({
                        scope: selectedTargets.includes("agents") ? "combined" : "project",
                      });
                    }
                  }}
                  label={
                    <span className="scan-scope-label">
                      <span className="scan-scope-icon" aria-hidden="true">
                        <HardDrive size={13} />
                      </span>
                      <span className="scan-scope-title">{ui.common.allDrives}</span>
                    </span>
                  }
                />
              </div>
            </div>

            <div className="location-menu-divider" />

            {/* Footer: Select All + Primary Start Scan */}
            <div className="scan-scope-footer">
              <Button
                variant="ghost"
                size="sm"
                onClick={selectAllTargets}
                disabled={allTargetsSelected}
              >
                {ui.system.selectAll}
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<Play size={11} fill="currentColor" />}
                onClick={handleStartSelectedScan}
              >
                {ui.common.scan}
              </Button>
            </div>
          </div>
        )}
      </div>

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
