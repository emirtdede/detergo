import { CleanupItem, SafetyClass, SortOption } from "@/types";
import { localizeCategory } from "@/lib/ui-text";
import { normalizeSearchText } from "@/lib/search";

/** Fields the table search actually displays or exposes to the user. */
export function itemSearchHaystack(item: CleanupItem, language?: string | null): string {
  return [
    item.displayPath,
    item.displayName,
    item.projectName ?? "",
    item.category,
    localizeCategory(item.category, language),
    item.ruleId,
  ].join(" ");
}

export function normalizedItemSearchHaystack(item: CleanupItem, language?: string | null): string {
  return normalizeSearchText(itemSearchHaystack(item, language), language);
}

/**
 * Distinct project names shown in the table's project filter.
 *
 * Kept as a pure function because the filter options are derived from `items`
 * alone. `ItemTable` caches the result with `useMemo(..., [items])` on purpose:
 * the labels are not localized (project names are user data), so no locale
 * revision belongs in the dependency list even though the table body
 * re-renders when the backend dictionary arrives.
 */
export function projectOptionsOf(items: readonly CleanupItem[]): string[] {
  const values = new Set<string>();
  for (const item of items) {
    if (item.projectName) values.add(item.projectName);
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

/**
 * Distinct category slugs shown in the table's category filter.
 *
 * This holds slugs, never localized labels: `ItemTable` resolves the label at
 * render time through `localizeCategory`, so changing the UI language updates
 * the visible options without recomputing this list.
 */
export function categoryOptionsOf(items: readonly CleanupItem[]): string[] {
  const values = new Set<string>();
  for (const item of items) values.add(item.category);
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

const SAFETY_RANK: Record<SafetyClass, number> = {
  safe: 0,
  regenerate: 1,
  review: 2,
  keep: 3,
};

/**
 * Compare two rows for the requested sort. Text comparisons use the active
 * UI locale's collation (so "apple" comes before "Zebra" and Turkish Ç/İ/Ş
 * sort correctly) instead of raw UTF-16 code units.
 */
export function compareItems(
  a: CleanupItem,
  b: CleanupItem,
  sort: SortOption,
  collator: Intl.Collator,
  language?: string | null,
): number {
  switch (sort.field) {
    case "size":
      // Sort by the same number the column and the action bar show. Sorting by
      // logical bytes while displaying reclaimable bytes produced descending
      // lists that looked unsorted.
      return (a.estimatedReclaimBytes ?? -1) - (b.estimatedReclaimBytes ?? -1);
    case "modified": {
      const aTime =
        a.lastModifiedMs ?? (a.lastModifiedAt ? new Date(a.lastModifiedAt).getTime() : 0);
      const bTime =
        b.lastModifiedMs ?? (b.lastModifiedAt ? new Date(b.lastModifiedAt).getTime() : 0);
      return aTime - bTime;
    }
    case "safety":
      return SAFETY_RANK[a.safetyClass] - SAFETY_RANK[b.safetyClass];
    case "project":
      return collator.compare(a.projectName ?? "", b.projectName ?? "");
    case "category":
      // The visible column uses the localized label, not the raw slug.
      return collator.compare(
        localizeCategory(a.category, language),
        localizeCategory(b.category, language),
      );
    case "name":
    default: {
      const byName = collator.compare(a.displayName, b.displayName);
      // Stable, deterministic tie-breaker for equal display names.
      return byName !== 0 ? byName : collator.compare(a.id, b.id);
    }
  }
}

/**
 * Builds a comparator for one sort pass.
 *
 * Sorting by category through `compareItems` localizes both slugs on every
 * comparison: 50,000 rows means roughly 800,000 dictionary lookups per click,
 * even though there are only a handful of distinct categories. This closes
 * over a per-slug label cache so each category is localized exactly once per
 * sort, and falls back to the shared comparator for every other field.
 */
export function createItemComparator(
  sort: SortOption,
  collator: Intl.Collator,
  language?: string | null,
): (a: CleanupItem, b: CleanupItem) => number {
  if (sort.field !== "category") {
    return (a, b) => compareItems(a, b, sort, collator, language);
  }
  const labelByCategory = new Map<string, string>();
  const labelOf = (category: string): string => {
    const cached = labelByCategory.get(category);
    if (cached !== undefined) return cached;
    const label = localizeCategory(category, language);
    labelByCategory.set(category, label);
    return label;
  };
  return (a, b) => collator.compare(labelOf(a.category), labelOf(b.category));
}
