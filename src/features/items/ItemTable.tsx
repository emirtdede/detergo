import React, { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, ChevronDown, ChevronUp, FolderOpen, ShieldCheck } from "lucide-react";
import { Checkbox } from "@/components/primitives/Checkbox";
import { IconButton } from "@/components/primitives/IconButton";
import { SearchField } from "@/components/primitives/SearchField";
import { SafetyBadge } from "./SafetyBadge";
import { useSelectionStore } from "@/stores/selection-store";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUIText } from "@/lib/ui-text";
import { useUiStore } from "@/stores/ui-store";
import { formatBytes } from "@/lib/formatters";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { CleanupItem, SafetyClass, SortOption } from "@/types";
import "./items.css";

export function maskPath(path: string): string {
  return path.replace(/([A-Za-z]:\\Users\\)([^\\]+)/i, "$1•••");
}

interface ItemTableProps {
  items: CleanupItem[];
  showProject?: boolean;
  emptyText?: string;
}

const SAFETY_RANK: Record<SafetyClass, number> = {
  safe: 0,
  regenerate: 1,
  review: 2,
  keep: 3,
};

function compareItems(a: CleanupItem, b: CleanupItem, sort: SortOption): number {
  switch (sort.field) {
    case "size":
      return (a.logicalBytes ?? -1) - (b.logicalBytes ?? -1);
    case "reclaim":
      return (a.estimatedReclaimBytes ?? -1) - (b.estimatedReclaimBytes ?? -1);
    case "modified":
      return (
        new Date(a.lastModifiedAt ?? 0).getTime() - new Date(b.lastModifiedAt ?? 0).getTime()
      );
    case "safety":
      return SAFETY_RANK[a.safetyClass] - SAFETY_RANK[b.safetyClass];
    case "project":
      return (a.projectName ?? "").localeCompare(b.projectName ?? "");
    case "category":
      return a.category.localeCompare(b.category);
    case "method":
      return a.cleanupMethod.localeCompare(b.cleanupMethod);
    case "name":
    default:
      return a.displayName.localeCompare(b.displayName);
  }
}

export const ItemTable: React.FC<ItemTableProps> = ({ items, showProject = true, emptyText }) => {
  const ui = useUIText();
  const searchQuery = useUiStore((s) => s.searchQuery);
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  const [safetyFilter, setSafetyFilter] = useState<SafetyClass | "all">("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const toggleSelection = useSelectionStore((s) => s.toggleSelection);
  const deselectMany = useSelectionStore((s) => s.deselectMany);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);
  const minSizeBytes = usePreferencesStore((s) => s.minSizeBytes);
  const sort = usePreferencesStore((s) => s.sort);
  const setSort = usePreferencesStore((s) => s.setSort);
  const showToast = useUiStore((s) => s.showToast);
  const parentRef = useRef<HTMLDivElement>(null);

  const warningLabel = (code: string): string => {
    switch (code) {
      case "USER_PROTECTED":
        return ui.warnings.userProtected;
      case "TARGET_ACTIVE":
        return ui.warnings.targetActive;
      case "PROVIDER_ACTIVE":
        return ui.warnings.providerActive;
      case "RECORDING_ACTIVE":
        return ui.warnings.recordingActive;
      case "AGENT_CACHE_DISABLED":
        return ui.warnings.agentCacheDisabled;
      case "PROTECTED_TARGET":
        return ui.warnings.protectedTarget;
      case "NO_PROJECT_MARKER":
        return ui.warnings.noProjectMarker;
      default:
        return ui.warnings.other(code);
    }
  };

  const projectOptions = useMemo(() => {
    const values = new Set<string>();
    for (const item of items) {
      if (item.projectName) values.add(item.projectName);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const categoryOptions = useMemo(() => {
    const values = new Set<string>();
    for (const item of items) values.add(item.category);
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const matches = items.filter((item) => {
      if (safetyFilter !== "all" && item.safetyClass !== safetyFilter) return false;
      if (projectFilter !== "all" && (item.projectName ?? "") !== projectFilter) return false;
      if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
      if (
        minSizeBytes > 0 &&
        item.estimatedReclaimBytes !== null &&
        item.estimatedReclaimBytes < minSizeBytes
      ) {
        return false;
      }
      if (!query) return true;
      return (
        item.displayPath.toLowerCase().includes(query) ||
        item.displayName.toLowerCase().includes(query) ||
        (item.projectName ?? "").toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query) ||
        item.ruleId.toLowerCase().includes(query)
      );
    });

    const direction = sort.direction === "asc" ? 1 : -1;
    return matches.sort((a, b) => compareItems(a, b, sort) * direction);
  }, [items, searchQuery, safetyFilter, projectFilter, categoryFilter, minSizeBytes, sort]);

  const safeIds = useMemo(
    () => filtered.filter((item) => item.autoSelectable).map((item) => item.id),
    [filtered]
  );
  const allSafeSelected = safeIds.length > 0 && safeIds.every((id) => selectedIds.has(id));
  const someSelected = filtered.some((item) => selectedIds.has(item.id));

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 12,
  });

  const displayPath = (path: string) => (maskPaths ? maskPath(path) : path);

  const toggleSort = (field: SortOption["field"]) => {
    setSort({
      field,
      direction: sort.field === field && sort.direction === "desc" ? "asc" : "desc",
    });
  };

  const SortHeader: React.FC<{
    field: SortOption["field"];
    label: string;
    numeric?: boolean;
    hint?: string;
  }> = ({ field, label, numeric, hint }) => {
    const active = sort.field === field;
    return (
      <div className={numeric ? "items-col-num" : undefined}>
        <button
          type="button"
          className={`items-sort ${active ? "active" : ""}`}
          onClick={() => toggleSort(field)}
          aria-label={`${label} — ${ui.table.sortHint}`}
          aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
          title={hint ? `${hint} — ${ui.table.sortHint}` : ui.table.sortHint}
        >
          <span>{label}</span>
          {active &&
            (sort.direction === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
        </button>
      </div>
    );
  };

  return (
    <div className="items-view">
      <div className="items-toolbar">
        <SearchField value={searchQuery} onChange={setSearchQuery} placeholder={ui.table.searchPlaceholder} />
        {showProject && (
          <select
            className="items-filter-select"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            aria-label={ui.table.projectFilter}
          >
            <option value="all">{ui.table.allProjects}</option>
            {projectOptions.map((project) => (
              <option key={project} value={project}>{project}</option>
            ))}
          </select>
        )}
        <select
          className="items-filter-select"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label={ui.table.categoryFilter}
        >
          <option value="all">{ui.table.allCategories}</option>
          {categoryOptions.map((category) => (
            <option key={category} value={category}>{category}</option>
          ))}
        </select>
        <select
          className="items-filter-select"
          value={safetyFilter}
          onChange={(e) => setSafetyFilter(e.target.value as SafetyClass | "all")}
          aria-label={ui.table.safety}
        >
          <option value="all">{ui.table.allSafety}</option>
          <option value="safe">{ui.safety.safe}</option>
          <option value="regenerate">{ui.safety.regenerate}</option>
          <option value="review">{ui.safety.review}</option>
          <option value="keep">{ui.safety.keep}</option>
        </select>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            if (safeIds.length === 0) return;
            selectMany(safeIds);
          }}
          disabled={safeIds.length === 0}
        >
          <ShieldCheck size={13} /> {ui.table.selectSafe}
        </button>
      </div>

      <div className="items-meta">
        <span>{ui.common.showing(filtered.length)}</span>
        <span>{ui.table.selected(selectedIds.size)}</span>
      </div>

      <div className="items-table">
        <div className="items-head" role="row">
          <div>
            <Checkbox
              checked={allSafeSelected}
              indeterminate={!allSafeSelected && someSelected}
              onChange={() => {
                if (allSafeSelected) deselectMany(safeIds);
                else selectMany(safeIds);
              }}
              aria-label={ui.table.selectAll}
              disabled={safeIds.length === 0}
            />
          </div>
          <SortHeader field="name" label={ui.table.name} />
          {showProject ? (
            <SortHeader field="project" label={ui.table.project} />
          ) : (
            <SortHeader field="category" label={ui.table.category} />
          )}
          <SortHeader field="safety" label={ui.table.safety} />
          <SortHeader field="size" label={ui.table.size} numeric hint={ui.table.sizeHint} />
          <SortHeader field="reclaim" label={ui.table.reclaim} numeric hint={ui.table.reclaimHint} />
          <SortHeader field="method" label={ui.table.method} />
          <div />
        </div>

        <div className="items-viewport" ref={parentRef} role="grid">
          {filtered.length === 0 ? (
            <div className="items-empty">{emptyText ?? ui.table.noResults}</div>
          ) : (
            <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const item = filtered[virtualRow.index];
                const isSelected = selectedIds.has(item.id);
                const warningTexts = item.warningCodes.slice(0, 2).map(warningLabel);
                const warnings = warningTexts.join(", ");
                return (
                  <div
                    key={item.id}
                    className={`items-row ${isSelected ? "is-selected" : ""} ${
                      item.selectable ? "" : "is-blocked"
                    }`}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    role="row"
                    title={[item.note, warnings, item.regenerateHint].filter(Boolean).join("\n")}
                  >
                    <div>
                      <Checkbox
                        checked={isSelected}
                        onChange={() => {
                          if (!item.selectable) return;
                          toggleSelection(item.id);
                        }}
                        disabled={!item.selectable}
                        aria-label={ui.table.selectRow}
                      />
                    </div>
                    <div className="items-name">
                      <strong>{item.displayName}</strong>
                      <span className="items-path">{displayPath(item.displayPath)}</span>
                      {warnings && (
                        <span className="items-warning" title={warnings}>
                          <AlertTriangle size={11} />
                          <span className="items-warning-text">{warnings}</span>
                        </span>
                      )}
                    </div>
                    {showProject ? (
                      <div className="items-cell">{item.projectName ?? "-"}</div>
                    ) : (
                      <div className="items-cell">{item.category}</div>
                    )}
                    <div>
                      <SafetyBadge safety={item.safetyClass} />
                    </div>
                    <div className="items-cell items-size">
                      {item.logicalBytes === null
                        ? ui.table.unmeasured
                        : formatBytes(item.logicalBytes)}
                    </div>
                    <div className="items-cell items-size">
                      {item.estimatedReclaimBytes === null
                        ? "-"
                        : formatBytes(item.estimatedReclaimBytes)}
                    </div>
                    <div className="items-cell">
                      {item.cleanupMethod === "trash"
                        ? ui.plan.trash
                        : item.cleanupMethod === "permanent"
                          ? ui.plan.permanent
                          : item.cleanupMethod === "officialTool"
                            ? ui.table.officialTool
                            : "-"}
                    </div>
                    <div className="items-actions">
                      <IconButton
                        size="sm"
                        aria-label={ui.table.openFolder}
                        tooltip={ui.table.openFolder}
                        onClick={async () => {
                          try {
                            await scannerApi.openPathInExplorer(item.displayPath);
                          } catch {
                            showToast(ui.errors.title, "error");
                          }
                        }}
                      >
                        <FolderOpen size={14} />
                      </IconButton>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default ItemTable;
