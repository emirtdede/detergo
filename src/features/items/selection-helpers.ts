import { CleanupItem } from "@/types";

/**
 * Rows a bulk action may select. This is deliberately based on `selectable`
 * (a backend verdict) rather than `autoSelectable` (the safe-default rule for
 * automatic selection). Bulk select is an explicit user action, so filtering
 * must never leave the button disabled or silently restrict the selection.
 */
export function bulkSelectableIds(items: CleanupItem[]): string[] {
  return items.filter((item) => item.selectable && !item.protected).map((item) => item.id);
}
