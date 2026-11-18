import { useCallback, useEffect, useReducer } from "react";
import { usePreferencesStore } from "@/stores/preferences-store";
import { resolveUiLocale } from "@/lib/ui-text";

/**
 * Documentation body translations.
 *
 * Each JSON file maps an English source string (exactly as written in the
 * documentation JSX) to its localized text. Unknown strings fall back to the
 * English source, so code identifiers, commands and paths stay untouched.
 *
 * The dictionaries are loaded per language on demand: 72 files of prose would
 * otherwise sit in the entry chunk even for users who never open the docs.
 */
const DOCS_LOADERS = import.meta.glob("./docs-locales/*.json", {
  import: "default",
}) as Record<string, () => Promise<Record<string, string>>>;

const dictionaries: Record<string, Record<string, string>> = {};
const pendingDocsLocales = new Map<string, Promise<void>>();

/** Loads the docs dictionary for a locale; English needs none. */
export function loadDocsLocale(locale: string): Promise<void> {
  const resolved = resolveUiLocale(locale as never);
  if (resolved === "en" || dictionaries[resolved]) return Promise.resolve();

  const inflight = pendingDocsLocales.get(resolved);
  if (inflight) return inflight;

  const load = DOCS_LOADERS[`./docs-locales/${resolved}.json`];
  const promise = (load ? load() : Promise.resolve({}))
    .then((data) => {
      dictionaries[resolved] = data ?? {};
    })
    .catch(() => {
      // A missing dictionary leaves the English source in place.
      dictionaries[resolved] = {};
    })
    .finally(() => {
      pendingDocsLocales.delete(resolved);
    });

  pendingDocsLocales.set(resolved, promise);
  return promise;
}

/**
 * Synchronous lookup. Returns the English source until the active language has
 * loaded, which is why every caller must also subscribe through
 * `useDocsLocale` (or `useDocsT`, which does it internally).
 */
export function translateDocs(locale: string, text: string): string {
  const resolved = resolveUiLocale(locale as never);
  if (resolved === "en") return text;
  return dictionaries[resolved]?.[text] ?? text;
}

/** Whether a generated documentation dictionary exists for this locale. */
export function hasDocsLocale(locale: string): boolean {
  return dictionaries[resolveUiLocale(locale as never)] !== undefined;
}

/**
 * Loads the docs dictionary for the active language and returns a revision
 * number that changes once it is available. Depend on it in `useMemo` so
 * derived data (topic titles, search index) recomputes after the load.
 */
export function useDocsLocale(locale?: string | null): number {
  const language = usePreferencesStore((s) => s.language);
  const active = locale ?? language ?? "en";
  const [revision, bump] = useReducer((tick: number) => tick + 1, 0);

  useEffect(() => {
    let alive = true;
    void loadDocsLocale(active).then(() => {
      if (alive) bump();
    });
    return () => {
      alive = false;
    };
  }, [active]);

  return revision;
}

export function useDocsT(): (text: string) => string {
  const language = usePreferencesStore((s) => s.language);
  useDocsLocale(language);
  return useCallback((text: string) => translateDocs(language ?? "en", text), [language]);
}
