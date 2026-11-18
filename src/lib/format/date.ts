/** Formats a saved-at timestamp for display, falling back to "-" when unset or invalid. */
export function formatSavedAt(value: string | null, language?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(language || undefined);
}

/**
 * Newest parseable timestamp (epoch ms) across the given entries.
 *
 * Returns `0` when the list is empty or nothing parses, so a caller can test
 * `> 0` instead of special-casing an invalid date. Deliberately a loop rather
 * than `Math.max(...dates)`: spreading one argument per record hits the
 * engine's argument-count limit on a long history and allocates an intermediate
 * array for no reason.
 */
export function latestTimestampMs(entries: ReadonlyArray<{ timestamp: string }>): number {
  let newest = 0;
  for (const entry of entries) {
    const time = new Date(entry.timestamp).getTime();
    if (Number.isFinite(time) && time > newest) newest = time;
  }
  return newest;
}
