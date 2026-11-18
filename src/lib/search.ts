/**
 * Locale-aware text search and sorting helpers.
 *
 * `toLowerCase()` is not sufficient for languages with non-default case
 * mappings. Turkish is the canonical example: "İstanbul".toLowerCase() yields
 * "i̇stanbul" (i + combining dot), while "istanbul" never matches. The locale
 * overload fixes that. NFKD + combining-mark removal keeps search forgiving
 * for accented input ("Önbellek" also matches "onbellek").
 */
export function normalizeSearchText(value: string, locale?: string | null): string {
  if (!value) return "";
  const lower = value.toLocaleLowerCase(locale || undefined);
  return lower.normalize("NFKD").replace(/\p{M}/gu, "");
}

/** One collator per locale is reused; constructing it per comparison is slow. */
export function createTextCollator(locale?: string | null): Intl.Collator {
  return new Intl.Collator(locale || undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
