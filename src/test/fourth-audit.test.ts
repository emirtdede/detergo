import { describe, it, expect, beforeEach } from "vitest";

import { comboFromEvent, matchesShortcut, parseCombo, validateShortcut } from "@/lib/shortcuts";
import { formatSavedAt } from "@/lib/format/date";
import { readScanHistory } from "@/features/history/scan-history";

const storageMap = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storageMap.set(key, value);
  },
  removeItem: (key: string) => {
    storageMap.delete(key);
  },
  clear: () => {
    storageMap.clear();
  },
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

function keyEvent(
  key: string,
  modifiers: {
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
    meta?: boolean;
  } = {},
): KeyboardEvent {
  return {
    key,
    ctrlKey: modifiers.ctrl ?? false,
    altKey: modifiers.alt ?? false,
    shiftKey: modifiers.shift ?? false,
    metaKey: modifiers.meta ?? false,
  } as KeyboardEvent;
}

/** Forces `matchesShortcut`'s platform branch without touching the real UA. */
function withPlatform(platform: string, run: () => void) {
  const originalPlatform = Object.getOwnPropertyDescriptor(navigator, "platform");
  const originalUserAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent");
  Object.defineProperty(navigator, "platform", { value: platform, configurable: true });
  Object.defineProperty(navigator, "userAgent", { value: platform, configurable: true });
  try {
    run();
  } finally {
    if (originalPlatform) Object.defineProperty(navigator, "platform", originalPlatform);
    if (originalUserAgent) Object.defineProperty(navigator, "userAgent", originalUserAgent);
  }
}

describe("fourth audit round", () => {
  beforeEach(() => {
    storageMap.clear();
  });

  describe("shortcut matching", () => {
    it("fires a Meta binding recorded on macOS", () => {
      withPlatform("MacIntel", () => {
        // Recording Cmd+K produced "Meta+K"; `matchesShortcut` rejected it as an
        // undeclared extra modifier, so the saved binding never worked.
        const combo = comboFromEvent(keyEvent("k", { meta: true }));
        expect(combo).toBe("Meta+K");
        expect(matchesShortcut(keyEvent("k", { meta: true }), combo)).toBe(true);
      });
    });

    it("still fires a Ctrl binding on Windows", () => {
      withPlatform("Win32", () => {
        expect(matchesShortcut(keyEvent("k", { ctrl: true }), "Ctrl+K")).toBe(true);
        expect(matchesShortcut(keyEvent("k", { meta: true }), "Ctrl+K")).toBe(false);
        // A stored Meta combo must not match a plain Ctrl chord on Windows.
        expect(matchesShortcut(keyEvent("k", { ctrl: true }), "Meta+K")).toBe(false);
        expect(matchesShortcut(keyEvent("k", { meta: true }), "Meta+K")).toBe(true);
      });
    });

    it("parses and matches a literal plus key", () => {
      // The split dropped the empty token, so the key part was unreachable.
      expect(parseCombo("Ctrl++")).toMatchObject({ ctrl: true, key: "+" });
      expect(validateShortcut("Ctrl++")).toEqual({ ok: true });
      withPlatform("Win32", () => {
        expect(matchesShortcut(keyEvent("+", { ctrl: true }), "Ctrl++")).toBe(true);
      });
    });
  });

  describe("history timestamps", () => {
    it("renders a placeholder for an unparseable timestamp instead of throwing", () => {
      // `new Date(x).toLocaleString()` throws RangeError on an invalid date,
      // which unmounted the entire History view during render.
      expect(() => formatSavedAt("not-a-date", "en")).not.toThrow();
      expect(formatSavedAt("not-a-date", "en")).toBe("-");
      expect(formatSavedAt("", "en")).toBe("-");
    });
  });

  describe("scan history healing", () => {
    it("rewrites a stored record whose only problem is an unmasked path", () => {
      storageMap.set(
        "detergo_scan_history",
        JSON.stringify([
          {
            id: "scan-1",
            timestamp: new Date().toISOString(),
            scope: "project",
            rootPath: "C:\\Users\\alice\\Projects\\app",
            itemCount: 3,
            cleanableBytes: 1024,
            durationMs: 10,
            status: "completed",
          },
        ]),
      );

      const read = readScanHistory();
      expect(read.records[0].rootPath).not.toContain("alice");

      // The repaired list must also be persisted, not only returned.
      const stored = JSON.parse(storageMap.get("detergo_scan_history") ?? "[]");
      expect(stored[0].rootPath).not.toContain("alice");
    });

    it("leaves an already masked file untouched", () => {
      const record = {
        id: "scan-1",
        timestamp: new Date().toISOString(),
        scope: "project",
        rootPath: "D:\\Projects\\app",
        itemCount: 1,
        cleanableBytes: 0,
        durationMs: 1,
        status: "completed",
      };
      const original = JSON.stringify([record]);
      storageMap.set("detergo_scan_history", original);

      readScanHistory();
      expect(storageMap.get("detergo_scan_history")).toBe(original);
    });
  });
});
