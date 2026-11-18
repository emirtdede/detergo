import { useEffect, useReducer } from "react";

import { usePreferencesStore } from "@/stores/preferences-store";
import { resolveUiLocale } from "@/lib/ui-text";
import { loadLegalLocale } from "./legal-content";

/**
 * Loads the legal convenience dictionary for the active language and returns a
 * revision number that changes once it is available.
 *
 * `getLegalDocument` and `getLegalDocMeta` are synchronous by design (they are
 * also used outside React), so components depend on this revision to re-render
 * after the chunk arrives.
 */
export function useLegalLocale(locale?: string | null): number {
  const language = usePreferencesStore((s) => s.language);
  const active = resolveUiLocale(locale ?? language);
  const [revision, bump] = useReducer((tick: number) => tick + 1, 0);

  useEffect(() => {
    let alive = true;
    void loadLegalLocale(active).then(() => {
      if (alive) bump();
    });
    return () => {
      alive = false;
    };
  }, [active]);

  return revision;
}
