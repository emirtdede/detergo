import { usePreferencesStore } from "@/stores/preferences-store";
import { resolveUiLocale } from "@/lib/ui-locale";

/**
 * Localization for strings that originate in the Rust backend or in the static
 * catalog (action descriptions, impact notes, unavailability reasons and
 * category names). The source of truth is English; every supported locale has
 * a JSON dictionary generated from the same source strings.
 */
const modules = import.meta.glob("./backend-locales/*.json", {
  eager: true,
  import: "default",
}) as Record<string, Record<string, string>>;

const dictionaries: Record<string, Record<string, string>> = {};
for (const [path, data] of Object.entries(modules)) {
  const locale = path
    .split("/")
    .pop()
    ?.replace(/\.json$/, "");
  if (locale) dictionaries[locale] = data as Record<string, string>;
}

import actionIds from "./backend-action-ids.json";

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
