import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, ChevronDown, ChevronUp, FolderOpen, Search } from "lucide-react";
import { Checkbox } from "@/components/primitives/Checkbox";
import { EmptyState } from "@/components/primitives/EmptyState";
import { IconButton } from "@/components/primitives/IconButton";
import { SearchField } from "@/components/primitives/SearchField";
import { SafetyBadge } from "./SafetyBadge";
import { useSelectionStore } from "@/stores/selection-store";
import { useScanStore } from "@/stores/scan-store";
import { usePreferencesStore } from "@/stores/preferences-store";
import {
  useUIText,
  useBackendLocaleRevision,
  localizeAppError,
  localizeWarningCode,
  localizeCategory,
  localizeBackendNote,
} from "@/lib/ui-text";
import { useUiStore } from "@/stores/ui-store";
import { formatBytes } from "@/lib/formatters";
import { maskPath, truncatePath } from "@/lib/format/path";
import { useThrottledValue, SCAN_AGGREGATE_THROTTLE_MS } from "@/lib/hooks/use-throttled-value";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { CleanupItem, SafetyClass, SortOption } from "@/types";
import { bulkSelectableIds, effectiveSelectedIds, isEffectiveTarget } from "./selection-helpers";
import {
  categoryOptionsOf,
  createItemComparator,
  normalizedItemSearchHaystack,
  projectOptionsOf,
} from "./table-utils";
import { createTextCollator, normalizeSearchText } from "@/lib/search";
import "./items.css";

const EMPTY_ITEMS_BY_ID: Record<string, CleanupItem> = {};

interface ItemTableProps {
  items: CleanupItem[];
  showProject?: boolean;
  emptyText?: string;
  /** Isolates search input per view so Projects and Agents never leak filters. */
  scopeKey?: "projects" | "agents";
}

interface SortHeaderProps {
  field: SortOption["field"];
  label: string;
  hint?: string;
  numeric?: boolean;
  sort: SortOption;
  sortHint: string;
  onToggle: (field: SortOption["field"]) => void;
}

/**
 * Module-level header cell.
 *
 * Declaring it inside `ItemTable` created a new component type on every render,
 * so React unmounted and remounted all header buttons (losing focus) whenever a
 * row was selected or the sort changed (D-8).
 */
const SortHeader: React.FC<SortHeaderProps> = ({
  field,
  label,
  hint,
  numeric,
  sort,
  sortHint,
  onToggle,
}) => {
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
        onClick={() => onToggle(field)}
        aria-label={`${label} - ${sortHint}`}
        title={hint ? `${hint} - ${sortHint}` : sortHint}
      >
        <span>{label}</span>
        {active && (sort.direction === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
      </button>
    </div>
  );
};

export const ItemTable: React.FC<ItemTableProps> = ({
  items,
  showProject = true,
  emptyText,
  scopeKey = "projects",
}) => {
  const ui = useUIText();
  const searchQuery = useUiStore((s) => s.searchByScope[scopeKey] ?? "");
  const setScopeSearchQuery = useUiStore((s) => s.setScopeSearchQuery);
  const setSearchQuery = (q: string) => setScopeSearchQuery(scopeKey, q);
  const lastClickedIndexRef = useRef<number | null>(null);
  const shiftHeldRef = useRef(false);
  const [safetyFilter, setSafetyFilter] = useState<SafetyClass | "all">("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [ageFilter, setAgeFilter] = useState<"all" | "7" | "30" | "90" | "180">("all");
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const hasSelection = selectedIds.size > 0;
  const itemsById = useScanStore((s) => (hasSelection ? s.itemsById : EMPTY_ITEMS_BY_ID));
  const toggleSelection = useSelectionStore((s) => s.toggleSelection);
  const deselectMany = useSelectionStore((s) => s.deselectMany);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);
  const sort = usePreferencesStore((s) => s.sort);
  const setSort = usePreferencesStore((s) => s.setSort);
  const language = usePreferencesStore((s) => s.language);
  const backendRevision = useBackendLocaleRevision();
  const showToast = useUiStore((s) => s.showToast);
  const parentRef = useRef<HTMLDivElement>(null);

  const warningLabel = (code: string): string => localizeWarningCode(code, ui);

  // Measurement batches change the row map up to 20 times per second. Filtering
  // and sorting 50,000 rows is O(n log n) and only the *displayed* order needs
  // to be that fresh: throttling the sortable snapshot to a cadence a person can
  // follow removes most of the work from the main thread during a scan.
  const sortableItems = useThrottledValue(items, SCAN_AGGREGATE_THROTTLE_MS);

  // Deliberate dependency list: both option lists depend on the sortable rows
  // only. `projectOptions` holds user data and `categoryOptions` holds slugs; the
  // visible category labels are resolved during render, so `backendRevision`
  // (subscribed above) refreshes them without rebuilding these lists. Moving
  // the localization into these memos would require adding `backendRevision`
  // and `language` to both dependency arrays - see
  // `src/test/table-options.test.ts` for the contract this relies on.
  const projectOptions = useMemo(() => projectOptionsOf(sortableItems), [sortableItems]);
  const categoryOptions = useMemo(() => categoryOptionsOf(sortableItems), [sortableItems]);

  // A filter that no longer exists in the new result set silently produced an
  // empty table ("no matches") right after a rescan. Normalize back to "all".
  useEffect(() => {
    setProjectFilter((current) =>
      current === "all" || projectOptions.includes(current) ? current : "all",
    );
  }, [projectOptions]);

  useEffect(() => {
    setCategoryFilter((current) =>
      current === "all" || categoryOptions.includes(current) ? current : "all",
    );
  }, [categoryOptions]);

  // Search text is derived, never written back into the store objects: mutating
  // an item during render breaks StrictMode and silently pollutes the store.
  // The index is locale-aware so the label the user sees (for example
  // "Önbellek") is searchable and Turkish İ/I casing matches.
  const collator = useMemo(() => createTextCollator(language), [language]);
  const normalizedQuery = useMemo(
    () => normalizeSearchText(searchQuery.trim(), language),
    [searchQuery, language],
  );
  const hasQuery = normalizedQuery.length > 0;

  // Building this index costs one normalized string per row. With 50,000 rows
  // that was pure waste whenever the search box was empty, so it is built on
  // the first non-empty query only.
  const searchIndex = useMemo(() => {
    if (!hasQuery) return null;
    const index = new Map<string, string>();
    for (const item of sortableItems) {
      index.set(item.id, normalizedItemSearchHaystack(item, language));
    }
    return index;
  }, [sortableItems, language, hasQuery, backendRevision]);

  const comparator = useMemo(
    () => createItemComparator(sort, collator, language),
    // `createItemComparator` localizes category labels, so the backend
    // dictionary revision belongs here too.
    [sort, collator, language, backendRevision],
  );

  // On massive result sets (>2,000 rows), defer filter/sort state transitions so
  // filter chip and sort header clicks paint their active state in <16 ms while
  // smaller tables and unit tests stay 100% synchronous.
  const deferredFilterCriteria = useDeferredValue({
    safetyFilter,
    projectFilter,
    categoryFilter,
    ageFilter,
    sort,
  });
  const activeCriteria =
    sortableItems.length > 2000
      ? deferredFilterCriteria
      : { safetyFilter, projectFilter, categoryFilter, ageFilter, sort };

  const filtered = useMemo(() => {
    const {
      safetyFilter: activeSafety,
      projectFilter: activeProject,
      categoryFilter: activeCategory,
      ageFilter: activeAge,
      sort: activeSort,
    } = activeCriteria;
    const minAgeCutoffMs = activeAge === "all" ? null : Date.now() - Number(activeAge) * 86_400_000;
    const matches = sortableItems.filter((item) => {
      if (activeSafety !== "all" && item.safetyClass !== activeSafety) return false;
      if (activeProject !== "all" && (item.projectName ?? "") !== activeProject) return false;
      if (activeCategory !== "all" && item.category !== activeCategory) return false;
      if (minAgeCutoffMs !== null) {
        const mtime =
          typeof item.lastModifiedMs === "number"
            ? item.lastModifiedMs
            : item.lastModifiedAt
              ? Date.parse(item.lastModifiedAt)
              : NaN;
        if (!Number.isFinite(mtime) || mtime > minAgeCutoffMs) return false;
      }
      if (!hasQuery) return true;
      return searchIndex?.get(item.id)?.includes(normalizedQuery) ?? false;
    });

    const direction = activeSort.direction === "asc" ? 1 : -1;
    return matches.sort((a, b) => comparator(a, b) * direction);
  }, [sortableItems, searchIndex, hasQuery, normalizedQuery, activeCriteria, comparator]);

  // Selecting rows is always an explicit user action. `autoSelectable` stays
  // false for provider/agent targets (safe default), but filtering must not
  // leave the bulk-select button disabled: every row the backend marked as
  // selectable can be picked deliberately.
  const selectableIds = useMemo(() => bulkSelectableIds(filtered), [filtered]);
  // Same predicate as the action bar: the counter must describe the rows the
  // action bar would actually clean, not every remembered id. The header
  // checkbox state is derived in one pass; calling `every` + `some` inline ran
  // two full scans on every render, i.e. twice per row click at 50k rows.
  const effectiveSelectedCount = useMemo(
    () => effectiveSelectedIds(selectedIds, itemsById).length,
    [selectedIds, itemsById],
  );
  const selectionState = useMemo(() => {
    if (selectableIds.length === 0) return { all: false, some: false };
    let selected = 0;
    for (const id of selectableIds) if (selectedIds.has(id)) selected += 1;
    return {
      all: selected === selectableIds.length,
      some: selected > 0 && selected < selectableIds.length,
    };
  }, [selectableIds, selectedIds]);
  const allSelected = selectionState.all;
  const someSelected = selectionState.some;

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

  const sortHeader = (
    field: SortOption["field"],
    label: string,
    hint?: string,
    numeric?: boolean,
  ) => (
    <SortHeader
      field={field}
      label={label}
      hint={hint}
      numeric={numeric}
      sort={sort}
      sortHint={ui.table.sortHint}
      onToggle={toggleSort}
    />
  );

  const clearFilters = () => {
    setSearchQuery("");
    setSafetyFilter("all");
    setProjectFilter("all");
    setCategoryFilter("all");
    setAgeFilter("all");
    // `minSizeBytes` is a persisted scan preference, not a table-local filter.
    // Clearing the visible filters must not silently rewrite that setting.
    // The table no longer hides below-minimum rows: the backend marks them
    // BLOCKED/BELOW_MIN_SIZE so they stay visible as disabled rows.
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
        <select
          className="items-filter-select"
          value={ageFilter}
          onChange={(e) => setAgeFilter(e.target.value as "all" | "7" | "30" | "90" | "180")}
          aria-label={ui.table.ageFilter}
        >
          <option value="all">{ui.table.allAges}</option>
          <option value="7">{ui.table.olderThan7d}</option>
          <option value="30">{ui.table.olderThan30d}</option>
          <option value="90">{ui.table.olderThan90d}</option>
          <option value="180">{ui.table.olderThan180d}</option>
        </select>
      </div>

      <div className="items-meta">
        <span>{ui.common.showing(filtered.length)}</span>
        <span>{ui.table.selected(effectiveSelectedCount)}</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          variant="compact"
          live
          icon={<Search size={20} />}
          title={emptyText ?? (items.length === 0 ? ui.table.noItems : ui.table.noResults)}
          actions={
            items.length > 0 &&
            (searchQuery.trim() ||
              safetyFilter !== "all" ||
              projectFilter !== "all" ||
              categoryFilter !== "all" ||
              ageFilter !== "all") ? (
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
              {sortHeader("name", ui.table.name)}
              {showProject
                ? sortHeader("project", ui.table.project)
                : sortHeader("category", ui.table.category)}
              {sortHeader("safety", ui.table.safety)}
              {sortHeader("size", ui.table.reclaim, ui.table.reclaimHint, true)}{" "}
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
                // A size that was never measured cannot be cleaned: the plan
                // rejects it with NOT_MEASURED. Keeping it selectable only led
                // to a failed preview after the user picked rows.
                const isSelectable = isEffectiveTarget(item);
                const warningTexts = item.warningCodes.slice(0, 2).map(warningLabel);
                const warnings = warningTexts.join(", ");
                return (
                  <div
                    key={item.id}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    className={`items-row ${isSelected ? "is-selected" : ""} ${
                      isSelectable ? "" : "is-blocked"
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
                        onClick={(e) => {
                          shiftHeldRef.current = e.shiftKey;
                        }}
                        onChange={() => {
                          if (!isSelectable) return;
                          const idx = virtualRow.index;
                          if (shiftHeldRef.current && lastClickedIndexRef.current !== null) {
                            const start = Math.min(lastClickedIndexRef.current, idx);
                            const end = Math.max(lastClickedIndexRef.current, idx);
                            const rangeIds: string[] = [];
                            for (let r = start; r <= end; r++) {
                              const candidate = filtered[r];
                              if (candidate && isEffectiveTarget(candidate)) {
                                rangeIds.push(candidate.id);
                              }
                            }
                            if (isSelected) deselectMany(rangeIds);
                            else selectMany(rangeIds);
                          } else {
                            toggleSelection(item.id);
                          }
                          lastClickedIndexRef.current = idx;
                          shiftHeldRef.current = false;
                        }}
                        disabled={!isSelectable}
                        aria-label={`${ui.table.selectRow}: ${item.displayName}`}
                      />
                    </div>
                    <div className="items-name" role="cell">
                      <strong>{item.displayName}</strong>
                      <span className="items-path" title={displayPath(item.displayPath)}>
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
                      {item.estimatedReclaimBytes === null
                        ? ui.table.unmeasured
                        : formatBytes(item.estimatedReclaimBytes, language)}
                    </div>
                    <div className="items-actions" role="cell">
                      <IconButton
                        size="sm"
                        aria-label={`${ui.table.openFolder}: ${item.displayName}`}
                        tooltip={ui.table.openFolder}
                        onClick={async () => {
                          try {
                            await scannerApi.openPathInExplorer(item.displayPath);
                          } catch (err) {
                            showToast(
                              `${ui.errors.title}: ${localizeAppError(err, ui)}`,
                              "error",
                              6000,
                            );
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
