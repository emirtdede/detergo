import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createTextCollator, normalizeSearchText } from "@/lib/search";
import {
  compareItems,
  createItemComparator,
  normalizedItemSearchHaystack,
} from "@/features/items/table-utils";
import {
  appendScanHistory,
  clearScanHistory,
  getScanHistory,
  SCAN_HISTORY_CHANGED_EVENT,
} from "@/features/history/scan-history";
import { shouldHandleSearchShortcut } from "@/components/primitives/SearchField";
import { getDocsBodyIndex } from "@/features/docs/docs-search";
import { makeItem } from "./fixtures";

const storageMap = new Map<string, string>();
const storageMock: Storage = {
  get length() {
    return storageMap.size;
  },
  clear: () => storageMap.clear(),
  getItem: (key: string) => storageMap.get(key) ?? null,
  key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
  removeItem: (key: string) => {
    storageMap.delete(key);
  },
  setItem: (key: string, value: string) => {
    storageMap.set(key, value);
  },
};
Object.defineProperty(window, "localStorage", { value: storageMock, configurable: true });
Object.defineProperty(globalThis, "localStorage", { value: storageMock, configurable: true });

describe("Ek 3 regressions", () => {
  beforeEach(() => {
    storageMap.clear();
  });

  describe("U5/U6 - locale-aware search normalization", () => {
    it("matches Turkish dotted/dotless İ and I", () => {
      expect(normalizeSearchText("İstanbul", "tr")).toBe("istanbul");
      expect(normalizeSearchText("ISTANBUL", "tr")).toBe("ıstanbul");
      expect(normalizeSearchText("İstanbul", "tr")).toContain(
        normalizeSearchText("istanbul", "tr"),
      );
    });

    it("folds accented labels so unaccented input matches", () => {
      expect(normalizeSearchText("Önbellek", "tr")).toBe("onbellek");
      // Dotless ı is a distinct Turkish letter, not an accent, so it survives.
      expect(normalizeSearchText("Bağımlılıklar", "tr")).toBe("bagımlılıklar");
    });

    it("indexes the localized category label the user actually sees", () => {
      const item = makeItem({ category: "cache", displayName: "npm" });
      const trHaystack = normalizedItemSearchHaystack(item, "tr");
      const enHaystack = normalizedItemSearchHaystack(item, "en");
      // "Önbellek" is the visible Turkish label; the English index never has it.
      expect(trHaystack).toContain("onbellek");
      expect(enHaystack).not.toContain("onbellek");
    });
  });

  describe("U7 - locale-aware sorting", () => {
    it("orders case-insensitively instead of by UTF-16 code units", () => {
      const collator = createTextCollator("en");
      expect(collator.compare("apple", "Zebra")).toBeLessThan(0);
    });

    it("uses Turkish collation for Ç/İ/ı", () => {
      const collator = createTextCollator("tr");
      expect(collator.compare("Çilek", "Deniz")).toBeLessThan(0);
      expect(collator.compare("ırmak", "İstanbul")).toBeLessThan(0);
    });

    it("sorts the category column by its visible, localized label", () => {
      const collator = createTextCollator("tr");
      const cache = makeItem({ category: "cache", displayName: "a" });
      const deps = makeItem({ category: "dependencies", displayName: "b" });
      // Raw slugs sort "cache" < "dependencies"; the Turkish labels are
      // "Önbellek" and "Bağımlılıklar", so the visible order must flip.
      const result = compareItems(
        cache,
        deps,
        { field: "category", direction: "asc" },
        collator,
        "tr",
      );
      expect(result).toBeGreaterThan(0);
    });

    it("caches localized category labels without changing the sort order", () => {
      const collator = createTextCollator("tr");
      const cache = makeItem({ category: "cache", displayName: "a" });
      const deps = makeItem({ category: "dependencies", displayName: "b" });
      // Same three rows repeated so a stale cache would show up as an
      // inconsistent comparator (a < b and b < a at the same time).
      const rows = [cache, deps, makeItem({ category: "cache", displayName: "c" })];

      const cached = createItemComparator({ field: "category", direction: "asc" }, collator, "tr");
      const sorted = [...rows].sort(cached).map((item) => item.category);
      // Turkish labels are "Bağımlılıklar" < "Önbellek", so dependencies come
      // first - the cache must preserve exactly what the shared comparator does.
      expect(sorted).toEqual(["dependencies", "cache", "cache"]);

      // Every non-category field must delegate to `compareItems` unchanged.
      for (const field of ["name", "size", "modified", "safety", "project"] as const) {
        const sort = { field, direction: "asc" } as const;
        const delegated = createItemComparator(sort, collator, "tr");
        for (const a of rows) {
          for (const b of rows) {
            expect(delegated(a, b), `${field} ${a.id}/${b.id}`).toBe(
              compareItems(a, b, sort, collator, "tr"),
            );
          }
        }
      }
    });
  });

  describe("U3 - same-tab scan history notifications", () => {
    it("broadcasts append and clear, and keeps localStorage in sync", () => {
      let changes = 0;
      const listener = () => {
        changes += 1;
      };
      window.addEventListener(SCAN_HISTORY_CHANGED_EVENT, listener);

      appendScanHistory({
        id: "scan-1",
        timestamp: new Date().toISOString(),
        scope: "project",
        rootPath: "C:\\Projects\\app",
        itemCount: 3,
        cleanableBytes: 1024,
        durationMs: 120,
        status: "completed",
      });
      expect(changes).toBe(1);
      expect(getScanHistory()).toHaveLength(1);

      clearScanHistory();
      expect(changes).toBe(2);
      expect(getScanHistory()).toHaveLength(0);

      window.removeEventListener(SCAN_HISTORY_CHANGED_EVENT, listener);
    });
  });

  describe("U2 - Ctrl+F does not escape an open modal", () => {
    let modal: HTMLDivElement;
    let modalInput: HTMLInputElement;
    let backgroundInput: HTMLInputElement;

    beforeEach(() => {
      modal = document.createElement("div");
      modal.setAttribute("aria-modal", "true");
      modalInput = document.createElement("input");
      backgroundInput = document.createElement("input");
      modal.append(modalInput);
      document.body.append(modal, backgroundInput);
    });

    afterEach(() => {
      modal.remove();
      backgroundInput.remove();
    });

    it("ignores the shortcut for a field behind the modal", () => {
      const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true });
      expect(shouldHandleSearchShortcut(event, backgroundInput)).toBe(false);
    });

    it("still handles the shortcut inside the modal and when no modal is open", () => {
      const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true });
      expect(shouldHandleSearchShortcut(event, modalInput)).toBe(true);
      modal.remove();
      expect(shouldHandleSearchShortcut(event, backgroundInput)).toBe(true);
    });

    it("respects an already-consumed shortcut", () => {
      const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, cancelable: true });
      event.preventDefault();
      expect(shouldHandleSearchShortcut(event, modalInput)).toBe(false);
    });
  });

  describe("U13 - documentation body search index", () => {
    it("indexes English article body text, not only titles", () => {
      const index = getDocsBodyIndex("en");
      expect(index.quickstart).toContain("recycle bin");
      expect(index["safety-architecture"]).toContain("toctou");
    });

    it("indexes the Turkish JSX body text", () => {
      const index = getDocsBodyIndex("tr");
      expect(index.quickstart).toContain("donusum");
    });

    it("caches the index per locale", () => {
      expect(getDocsBodyIndex("en")).toBe(getDocsBodyIndex("en"));
      expect(getDocsBodyIndex("en")).not.toBe(getDocsBodyIndex("tr"));
    });
  });
});
