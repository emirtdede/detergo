import { CleanupItem } from "@/types";

/**
 * A row that can actually enter a cleanup plan.
 *
 * This is the single source of truth shared by the table's checkbox, the
 * "selected" counter and the selection action bar. They used to disagree: the
 * table counted every stored id while the action bar filtered the same list,
 * so the two numbers described different sets.
 *
 * An unmeasured row is excluded because the cleanup plan blocks it as
 * `NOT_MEASURED`; a protected or `keep` row can never be cleaned either.
 */
export function isEffectiveTarget(item: CleanupItem | null | undefined): item is CleanupItem {
  return (
    !!item &&
    item.selectable &&
    !item.protected &&
    item.safetyClass !== "keep" &&
    item.status !== "deleted" &&
    item.logicalBytes !== null
  );
}

/**
 * Rows a bulk action may select. This is deliberately based on `selectable`
 * (a backend verdict) rather than `autoSelectable` (the safe-default rule for
 * automatic selection). Bulk select is an explicit user action, so filtering
 * must never leave the button disabled or silently restrict the selection.
 */
export function bulkSelectableIds(items: CleanupItem[]): string[] {
  return items.filter(isEffectiveTarget).map((item) => item.id);
}

/**
 * Filters a stored selection down to rows that still exist and can be cleaned.
 * Used by counters and the action bar so both report the same number.
 */
export function effectiveSelectedIds(
  selectedIds: Iterable<string>,
  itemsById: Record<string, CleanupItem | undefined>,
): string[] {
  const result: string[] = [];
  for (const id of selectedIds) {
    if (isEffectiveTarget(itemsById[id])) result.push(id);
  }
  return result;
}
