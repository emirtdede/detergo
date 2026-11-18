import { normalizeSearchText } from "@/lib/search";
import { resolveUiLocale } from "@/lib/ui-text";
import { translateDocs } from "./docs-i18n";
import docsIndex from "./docs-index.generated.json";

/**
 * Full-text index for the documentation body.
 *
 * The topic list only carries titles and a handful of keywords, so searching
 * for a phrase that appears in the article body ("TOCTOU", "Recycle Bin",
 * "GitHub Actions") needs the body strings themselves.
 *
 * The body lives in JSX components, which used to be imported as raw source and
 * parsed in the browser: 107 KB of source shipped in the production bundle just
 * to build a hidden search index. The strings are now extracted at build time
 * by `scripts/build-docs-index.mjs` (wired to `prebuild`), and this module only
 * does the cheap per-locale work:
 *
 *  - pick the authored string list for the active component locale;
 *  - enrich each string with its translated value from `docs-locales/*.json`,
 *    so both the English term and the translated term are searchable;
 *  - normalize everything once and memoize it per resolved locale.
 */

const indexCache = new Map<string, Record<string, string>>();

/** Lazily build the normalized body index for one UI locale. */
export function getDocsBodyIndex(locale?: string | null): Record<string, string> {
  const resolved = resolveUiLocale(locale ?? "en");
  const cached = indexCache.get(resolved);
  if (cached) return cached;

  // The Turkish component is authored in Turkish rather than through `t()`, so
  // it has its own extracted corpus. Every other locale searches the English
  // source plus its dictionary translation.
  const topics = resolved === "tr" ? docsIndex.tr : docsIndex.en;
  const index: Record<string, string> = {};

  for (const [topicId, strings] of Object.entries(topics)) {
    const searchable: string[] = [];
    for (const text of strings) {
      searchable.push(text);
      // English source strings are the keys of the docs dictionaries.
      const localized = translateDocs(resolved, text);
      if (localized !== text) searchable.push(localized);
    }
    index[topicId] = normalizeSearchText(searchable.join(" "), resolved);
  }

  indexCache.set(resolved, index);
  return index;
}
