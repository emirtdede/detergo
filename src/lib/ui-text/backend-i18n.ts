import { usePreferencesStore } from "@/stores/preferences-store";
import { resolveUiLocale } from "@/lib/ui-locale";
import tr from "./backend-locales/tr.json";
import actionIds from "./backend-action-ids.json";

/**
 * Localization for strings that originate in the Rust backend or in the static
 * catalog (action descriptions, impact notes, unavailability reasons and
 * category names). The source of truth is English; every supported locale has
 * a JSON dictionary generated from the same source strings.
 *
 * Loading model: 73 files of backend strings are ~1.2 MB, and an `eager` glob
 * inlined every one of them into the entry chunk even though 72 of them can
 * never be shown. The glob is therefore non-eager (one chunk per language) and
 * the active language is fetched by `loadBackendLocale`, which `useUIText`
 * joins with its existing locale load. Turkish stays eager because the UI text
 * for `tr` is eager too (`src/lib/ui-text/index.ts`), so a Turkish first paint
 * must not degrade to English backend strings.
 */
const BACKEND_LOADERS = import.meta.glob(
  ["./backend-locales/*.json", "!./backend-locales/tr.json"],
  {
    import: "default",
  },
) as Record<string, () => Promise<Record<string, string>>>;

const dictionaries: Record<string, Record<string, string>> = { tr };

/** In-flight language loads, keyed by resolved locale. */
const pendingBackend = new Map<string, Promise<void>>();

/**
 * Increments whenever a dictionary finishes loading. Consumers that derive
 * localized values inside `useMemo` depend on it so a language load cannot
 * leave them holding English labels until an unrelated state change.
 */
let backendRevision = 0;
const listeners = new Set<() => void>();

export function getBackendLocaleRevision(): number {
  return backendRevision;
}

function notifyBackendLocaleLoaded(): void {
  backendRevision += 1;
  for (const listener of listeners) listener();
}

export function subscribeBackendLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Loads the backend dictionary for `locale` once. Resolves even when the chunk
 * fails, so a missing translation cannot block first paint; the English source
 * string remains the fallback.
 */
export function loadBackendLocale(locale?: string | null): Promise<void> {
  const resolved = resolveUiLocale(locale ?? activeLocale());
  if (resolved === "en" || dictionaries[resolved]) return Promise.resolve();

  const inflight = pendingBackend.get(resolved);
  if (inflight) return inflight;

  const loader = BACKEND_LOADERS[`./backend-locales/${resolved}.json`];
  const promise = (loader ? loader() : Promise.resolve({}))
    .then((data) => {
      dictionaries[resolved] = (data as Record<string, string>) ?? {};
    })
    .catch(() => {
      // Remember the failure instead of retrying on every call site.
      dictionaries[resolved] = {};
    })
    .then(() => {
      notifyBackendLocaleLoaded();
    })
    .finally(() => {
      pendingBackend.delete(resolved);
    });

  pendingBackend.set(resolved, promise);
  return promise;
}

const ACTION_ID_TO_EN = actionIds as Record<string, string>;

function activeLocale(): string {
  return resolveUiLocale(usePreferencesStore.getState().language ?? "en");
}

function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? params[name] : match,
  );
}

/** Resolve a backend string to its localized counterpart, if one exists. */
export function translateBackendText(text: string, language?: string | null): string {
  if (!text) return "";
  const locale = resolveUiLocale(language ?? activeLocale());
  const trim = text.trim();
  const dict = dictionaries[locale];

  if (locale === "en") {
    // English is the source language: normalize known parameterized messages.
    return trim;
  }
  // Not loaded yet: show the English source instead of a raw key. The caller
  // re-renders when the chunk arrives (see `subscribeBackendLocale`).
  if (!dict) return trim;
  if (dict[trim] !== undefined) return dict[trim];

  // Parameterized messages: extract the variable part and rebuild from the
  // translated template.
  const exePath = trim.match(/^'(.+)' was not found on the system PATH\.$/);
  if (exePath) {
    const template = dict["'{exe}' was not found on the system PATH."];
    if (template) return interpolate(template, { exe: exePath[1] });
  }
  const exeShort = trim.match(/^'(.+)' was not found\.$/);
  if (exeShort) {
    const template = dict["'{exe}' was not found."];
    if (template) return interpolate(template, { exe: exeShort[1] });
  }
  const hideTray = trim.match(/^Failed to hide window to tray: (.+)$/);
  if (hideTray) {
    const template = dict["Failed to hide window to tray: {err}"];
    if (template) return interpolate(template, { err: hideTray[1] });
  }

  return trim;
}

/** Resolve an official action id (or its English description) to a label. */
export function translateActionDescription(
  actionIdOrDescription: string,
  language?: string | null,
): string {
  if (!actionIdOrDescription) return "";
  const locale = resolveUiLocale(language ?? activeLocale());
  if (locale === "en") {
    return ACTION_ID_TO_EN[actionIdOrDescription] ?? actionIdOrDescription;
  }
  const english = ACTION_ID_TO_EN[actionIdOrDescription] ?? actionIdOrDescription;
  return translateBackendText(english, locale);
}
