/**
 * Single source of truth for keyboard shortcut parsing, validation and matching.
 *
 * The rules used to live in three places — the recorder in `SettingsView`, the
 * persisted-settings normaliser in `preferences-store` and the runtime matcher in
 * `App` — and they drifted: the recorder accepted a bare `A` or `Tab`, the
 * normaliser only rejected modifier-only chords, and the matcher happily fired
 * on a single letter. Sharing one parser keeps all three in agreement.
 */

import { RESERVED_SHORTCUTS } from "@/types";

const MODIFIER_PARTS = new Set(["ctrl", "alt", "shift", "meta"]);
/** `KeyboardEvent.key` values that are modifiers on their own. */
const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);
/** F1..F24 are the only keys allowed without a primary modifier. */
const FUNCTION_KEY = /^f([1-9]|1[0-9]|2[0-4])$/i;
/** Keys that must never become a global shortcut without a modifier. */
const BARE_BLOCKED = new Set([
  "Tab",
  "Enter",
  "Escape",
  "Backspace",
  " ",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Delete",
  "Insert",
]);

export interface ParsedCombo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** Lower-cased key, with `" "` normalised to `"space"`. */
  key: string;
}

export type ShortcutRejection = "empty" | "noKey" | "reserved" | "needsModifier" | "blockedKey";

export type ShortcutValidation = { ok: true } | { ok: false; reason: ShortcutRejection };

/** Parses `Ctrl+Shift+K` into its modifier flags and key. */
export function parseCombo(combo: string): ParsedCombo | null {
  if (!combo || typeof combo !== "string") return null;
  const raw = combo.trim();
  const parts = raw
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  // `Ctrl++` is how a literal plus key is written: the split drops the empty
  // token between the two `+` signs, so the key part was lost and the chord
  // could never be recorded or matched.
  if (raw.endsWith("+")) parts.push("+");
  if (parts.length === 0) return null;

  const keyPart = parts.find((part) => !MODIFIER_PARTS.has(part));
  if (!keyPart) return null;

  return {
    ctrl: parts.includes("ctrl"),
    alt: parts.includes("alt"),
    shift: parts.includes("shift"),
    meta: parts.includes("meta"),
    key: keyPart === " " ? "space" : keyPart,
  };
}

/** Builds the canonical combo string from a keydown event. */
export function comboFromEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;

  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");

  let keyName = event.key;
  if (keyName === " ") keyName = "Space";
  else if (keyName.length === 1) keyName = keyName.toUpperCase();
  parts.push(keyName);
  return parts.join("+");
}

/**
 * Validates a shortcut that would become a *global* binding.
 *
 * A binding without Ctrl/Alt/Meta would swallow ordinary typing: `A` would
 * navigate away on every keystroke and `Tab` would break keyboard accessibility.
 * Function keys are the one accepted exception.
 */
export function validateShortcut(combo: string): ShortcutValidation {
  const trimmed = combo.trim();
  if (!trimmed) return { ok: false, reason: "empty" };

  const parsed = parseCombo(trimmed);
  if (!parsed) return { ok: false, reason: "noKey" };

  if (RESERVED_SHORTCUTS.has(trimmed)) return { ok: false, reason: "reserved" };
  if (RESERVED_SHORTCUTS.has(normalizeComboCase(trimmed))) {
    return { ok: false, reason: "reserved" };
  }

  const isFunctionKey = FUNCTION_KEY.test(parsed.key);
  const hasPrimary = parsed.ctrl || parsed.alt || parsed.meta;
  if (!hasPrimary && !isFunctionKey) return { ok: false, reason: "needsModifier" };
  if (!hasPrimary && BARE_BLOCKED.has(trimmed)) return { ok: false, reason: "blockedKey" };

  return { ok: true };
}

/** `ctrl+shift+k` → `Ctrl+Shift+K`, matching `DEFAULT_SHORTCUTS` casing. */
export function normalizeComboCase(combo: string): string {
  const parsed = parseCombo(combo);
  if (!parsed) return combo.trim();
  const parts: string[] = [];
  if (parsed.ctrl) parts.push("Ctrl");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  if (parsed.meta) parts.push("Meta");
  const key = parsed.key;
  parts.push(key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1));
  return parts.join("+");
}

/**
 * Whether a keydown matches a stored combo.
 *
 * `Ctrl` is the platform's primary modifier: Ctrl on Windows/Linux, Cmd on
 * macOS. On macOS the primary modifier *is* Meta, so an explicit `Meta` check
 * must not treat it as an undeclared extra modifier.
 */
export function matchesShortcut(event: KeyboardEvent, combo?: string | null): boolean {
  if (!combo) return false;
  const parsed = parseCombo(combo);
  if (!parsed) return false;

  // Refuse a binding that could never have been valid: a stale file or a hand
  // edited config must not turn a plain letter into a global shortcut.
  if (
    !parsed.ctrl &&
    !parsed.alt &&
    !parsed.meta &&
    !FUNCTION_KEY.test(parsed.key) // F1..F24
  ) {
    return false;
  }

  const isMac =
    typeof navigator !== "undefined" &&
    /mac|iphone|ipad/i.test(`${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`);

  if (parsed.ctrl) {
    if (isMac ? !event.metaKey : !event.ctrlKey) return false;
  } else if (!parsed.meta && (isMac ? event.metaKey : event.ctrlKey)) {
    // The platform primary is only "unexpected" when the combo does not declare
    // it. The old check ignored `parsed.meta`, so every `Meta+K` recorded with
    // Cmd on macOS was rejected here before the explicit Meta check below and
    // never fired.
    return false;
  }

  if (parsed.meta && !event.metaKey) return false;
  if (!parsed.meta && !(parsed.ctrl && isMac) && event.metaKey) return false;
  if (parsed.alt !== event.altKey) return false;
  if (parsed.shift !== event.shiftKey) return false;

  let eventKey = event.key.toLowerCase();
  if (eventKey === " ") eventKey = "space";
  return eventKey === parsed.key;
}
