/** Formats a saved-at timestamp for display, falling back to "-" when unset or invalid. */
export function formatSavedAt(value: string | null, language?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(language || undefined);
}
