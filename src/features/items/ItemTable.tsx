import React, { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, ChevronDown, ChevronUp, FolderOpen, Search } from "lucide-react";
import { Checkbox } from "@/components/primitives/Checkbox";
import { EmptyState } from "@/components/primitives/EmptyState";
import { IconButton } from "@/components/primitives/IconButton";
import { SearchField } from "@/components/primitives/SearchField";
import { SafetyBadge } from "./SafetyBadge";
import { useSelectionStore } from "@/stores/selection-store";
import { usePreferencesStore } from "@/stores/preferences-store";
import {
  useUIText,
  localizeWarningCode,
  localizeCategory,
  localizeBackendNote,
} from "@/lib/ui-text";
import { useUiStore } from "@/stores/ui-store";
import { formatBytes } from "@/lib/formatters";
import { maskPath, truncatePath } from "@/lib/format/path";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { CleanupItem, SafetyClass, SortOption } from "@/types";
import { bulkSelectableIds } from "./selection-helpers";
import "./items.css";

const SEARCH_FIELDS = (item: CleanupItem): string[] => [
  item.displayPath,
  item.displayName,
  item.projectName ?? "",
  item.category,
  item.ruleId,
];

function searchHaystackFor(item: CleanupItem): string {
  return SEARCH_FIELDS(item).join(" ").toLowerCase();
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
    case "modified":
      const aTime =
        a.lastModifiedMs ?? (a.lastModifiedAt ? new Date(a.lastModifiedAt).getTime() : 0);
      const bTime =
        b.lastModifiedMs ?? (b.lastModifiedAt ? new Date(b.lastModifiedAt).getTime() : 0);
      return aTime - bTime;
    case "safety":
      return SAFETY_RANK[a.safetyClass] - SAFETY_RANK[b.safetyClass];
    case "project":
      return (a.projectName ?? "") < (b.projectName ?? "")
        ? -1
        : (a.projectName ?? "") > (b.projectName ?? "")
          ? 1
          : 0;
    case "category":
      return a.category < b.category ? -1 : a.category > b.category ? 1 : 0;
    case "name":
    default:
      return a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0;
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
  const language = usePreferencesStore((s) => s.language);
  const showToast = useUiStore((s) => s.showToast);
  const parentRef = useRef<HTMLDivElement>(null);

  const warningLabel = (code: string): string => localizeWarningCode(code, ui);

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

  // Search text is derived, never written back into the store objects: mutating
  // an item during render breaks StrictMode and silently pollutes the store.
  const searchIndex = useMemo(() => {
    const index = new Map<string, string>();
    for (const item of items) {
      index.set(item.id, searchHaystackFor(item));
    }
    return index;
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
      return searchIndex.get(item.id)?.includes(query) ?? false;
    });

    const direction = sort.direction === "asc" ? 1 : -1;
    return matches.sort((a, b) => compareItems(a, b, sort) * direction);
  }, [
    items,
    searchIndex,
    searchQuery,
    safetyFilter,
    projectFilter,
    categoryFilter,
    minSizeBytes,
    sort,
  ]);

  // Selecting rows is always an explicit user action. `autoSelectable` stays
  // false for provider/agent targets (safe default), but filtering must not
  // leave the bulk-select button disabled: every row the backend marked as
  // selectable can be picked deliberately.
  const selectableIds = useMemo(() => bulkSelectableIds(filtered), [filtered]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const someSelected = selectableIds.some((id) => selectedIds.has(id));

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
    const sortState = active ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
    return (
      <div
        role="columnheader"
        aria-sort={sortState}
        className={numeric ? "items-col-num" : undefined}
      >
        <button
          type="button"
          className={`items-sort ${active ? "active" : ""}`}
          onClick={() => toggleSort(field)}
          aria-label={`${label} — ${ui.table.sortHint}`}
          title={hint ? `${hint} — ${ui.table.sortHint}` : ui.table.sortHint}
        >
          <span>{label}</span>
          {active &&
            (sort.direction === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
        </button>
      </div>
    );
  };

  const clearFilters = () => {
    setSearchQuery("");
    setSafetyFilter("all");
    setProjectFilter("all");
    setCategoryFilter("all");
  };

  return (
    <div className="items-view">
      <div className="items-toolbar">
        <SearchField
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={ui.table.searchPlaceholder}
        />
        {showProject && (
          <select
            className="items-filter-select"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            aria-label={ui.table.projectFilter}
          >
            <option value="all">{ui.table.allProjects}</option>
            {projectOptions.map((project) => (
              <option key={project} value={project}>
                {project}
              </option>
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
            <option key={category} value={category}>
              {localizeCategory(category, language)}
            </option>
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
      </div>

      <div className="items-meta">
        <span>{ui.common.showing(filtered.length)}</span>
        <span>{ui.table.selected(selectedIds.size)}</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          variant="compact"
          live
          icon={<Search size={20} />}
          title={emptyText ?? (items.length === 0 ? ui.table.noItems : ui.table.noResults)}
          description={
            items.length === 0
              ? undefined
              : searchQuery.trim() ||
                  safetyFilter !== "all" ||
                  projectFilter !== "all" ||
                  categoryFilter !== "all"
                ? ui.table.noResults
                : undefined
          }
          actions={
            items.length > 0 &&
            (searchQuery.trim() ||
              safetyFilter !== "all" ||
              projectFilter !== "all" ||
              categoryFilter !== "all") ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>
                {ui.table.clearFilters}
              </button>
            ) : undefined
          }
        />
      ) : (
        <div
          className="items-table"
          role="table"
          aria-label={ui.table.label}
          aria-rowcount={filtered.length + 1}
        >
          <div className="items-head" role="rowgroup">
            <div className="items-head-row" role="row" aria-rowindex={1}>
              <div role="columnheader">
                <Checkbox
                  checked={allSelected}
                  indeterminate={!allSelected && someSelected}
                  onChange={() => {
                    if (allSelected) deselectMany(selectableIds);
                    else selectMany(selectableIds);
                  }}
                  aria-label={ui.table.selectAll}
                  disabled={selectableIds.length === 0}
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
              <div role="columnheader" aria-label={ui.table.actions} />
            </div>
          </div>

          <div className="items-viewport" ref={parentRef} role="rowgroup">
            <div
              role="presentation"
              style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}
            >
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
                    aria-rowindex={virtualRow.index + 2}
                    title={[
                      localizeBackendNote(item.note, ui),
                      warnings,
                      localizeBackendNote(item.regenerateHint, ui),
                    ]
                      .filter(Boolean)
                      .join("\n")}
                  >
                    <div role="cell">
                      <Checkbox
                        checked={isSelected}
                        onChange={() => {
                          if (!item.selectable) return;
                          toggleSelection(item.id);
                        }}
                        disabled={!item.selectable}
                        aria-label={`${ui.table.selectRow}: ${item.displayName}`}
                      />
                    </div>
                    <div className="items-name" role="cell">
                      <strong>{item.displayName}</strong>
                      <span className="items-path" title={item.displayPath}>
                        {truncatePath(displayPath(item.displayPath), 52)}
                      </span>
                      {warnings && (
                        <span className="items-warning" title={warnings}>
                          <AlertTriangle size={11} />
                          <span className="items-warning-text">{warnings}</span>
                        </span>
                      )}
                    </div>
                    {showProject ? (
                      <div className="items-cell" role="cell">
                        {item.projectName ?? "-"}
                      </div>
                    ) : (
                      <div className="items-cell" role="cell">
                        {localizeCategory(item.category, language)}
                      </div>
                    )}
                    <div role="cell">
                      <SafetyBadge safety={item.safetyClass} />
                    </div>
                    <div className="items-cell items-size" role="cell">
                      {item.logicalBytes === null
                        ? ui.table.unmeasured
                        : formatBytes(item.logicalBytes, language)}
                    </div>
                    <div className="items-actions" role="cell">
                      <IconButton
                        size="sm"
                        aria-label={`${ui.table.openFolder}: ${item.displayName}`}
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
          </div>
        </div>
      )}
    </div>
  );
};
export default ItemTable;
