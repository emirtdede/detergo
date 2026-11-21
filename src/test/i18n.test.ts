import { describe, it, expect } from "vitest";
import { LANGUAGES_LIST, detectSystemLanguage, isRtlLanguage } from "../locales/languages";
import {
  getUIText,
  loadUIText,
  localizeCategory,
  localizeBackendNote,
  localizeActionDescription,
  localizeUnavailableReason,
  localizeWarningCode,
  localizeAppError,
} from "../lib/ui-text";
import { usePreferencesStore } from "../stores/preferences-store";

describe("73-Language i18n Engine & Localization Tests", () => {
  it("ships exactly one UI dictionary module for each of the 73 languages", () => {
    const modules = import.meta.glob("../lib/ui-text/locales/*.json", {
      eager: true,
      import: "default",
    }) as Record<string, Record<string, unknown>>;
    const ids = new Set([
      ...Object.keys(modules).map((path) =>
        path
          .split("/")
          .pop()!
          .replace(/\.json$/, ""),
      ),
      "en",
      "tr",
    ]);
    expect(LANGUAGES_LIST).toHaveLength(73);
    expect(ids.size).toBe(73);
    for (const meta of LANGUAGES_LIST) {
      expect(ids.has(meta.id), `${meta.id} dictionary`).toBe(true);
    }
  });

  it("detects system language or defaults gracefully", () => {
    const detected = detectSystemLanguage();
    expect(detected).toBeDefined();
    expect(LANGUAGES_LIST.some((l) => l.id === detected)).toBe(true);
  });

  it("detects RTL languages correctly (Arabic, Hebrew, Persian, Urdu)", () => {
    expect(isRtlLanguage("ar")).toBe(true);
    expect(isRtlLanguage("he")).toBe(true);
    expect(isRtlLanguage("fa")).toBe(true);
    expect(isRtlLanguage("ur")).toBe(true);

    expect(isRtlLanguage("tr")).toBe(false);
    expect(isRtlLanguage("en")).toBe(false);
    expect(isRtlLanguage("de")).toBe(false);
    expect(isRtlLanguage("ja")).toBe(false);
  });

  it("provides complete and valid UI dictionaries for all 73 languages", async () => {
    for (const meta of LANGUAGES_LIST) {
      await loadUIText(meta.id);
      const dict = getUIText(meta.id);
      expect(dict, `${meta.id}`).toBeDefined();
      expect(dict.nav.overview, `${meta.id} nav.overview`).toBeTruthy();
      expect(dict.common.scan, `${meta.id} common.scan`).toBeTruthy();
      expect(dict.table.project, `${meta.id} table.project`).toBeTruthy();
      expect(dict.settings.shortcutsTitle, `${meta.id} settings.shortcutsTitle`).toBeTruthy();
      expect(dict.legal.docTabsLabel, `${meta.id} legal.docTabsLabel`).toBeTruthy();
    }
  });

  it("supports all 73 UI languages and clamps completely invalid locales to English", async () => {
    const store = usePreferencesStore.getState();

    // Valid 73 languages are fully recognized and supported
    store.setLanguage("de");
    expect(usePreferencesStore.getState().language).toBe("de");
    await loadUIText("de");
    expect(getUIText("de").common.scan).toBe("Scannen");

    store.setLanguage("ja");
    expect(usePreferencesStore.getState().language).toBe("ja");
    await loadUIText("ja");
    expect(getUIText("ja").common.scan).toBeTruthy();

    store.setLanguage("tr");
    expect(usePreferencesStore.getState().language).toBe("tr");
    expect(getUIText("tr").common.scan).toBe("Tara");

    store.setLanguage("en");
    expect(usePreferencesStore.getState().language).toBe("en");
    expect(getUIText("en").common.scan).toBe("Scan");

    // Completely unknown/invalid language strings clamp safely to English
    store.setLanguage("unknown-xyz" as any);
    expect(usePreferencesStore.getState().language).toBe("en");
  });

  it("provides localized legal UI copy and legal documents without leaking English", async () => {
    const uiTr = getUIText("tr");
    expect(uiTr.legal.docTabsLabel).toBe("Yasal belgeler");
    expect(uiTr.legal.rights).toBe("Tüm hakları saklıdır.");

    const uiEn = getUIText("en");
    expect(uiEn.legal.docTabsLabel).toBe("Legal documents");
    expect(uiEn.legal.rights).toBe("All rights reserved.");

    // Localizations without an in-memory English fallback must serve real
    // translated documents from legal-locales; the UI's `legal` block above is
    // only chrome (tabs, column headers, counters).
    const { getLegalDocument, loadLegalLocale } = await import("@/features/legal/legal-content");
    await loadLegalLocale("de");
    expect(getLegalDocument("de", "eula").title).not.toBe("End User License Agreement");
  });
  it("guarantees 100% complete UIText coverage across all 73 languages with zero missing keys", async () => {
    for (const meta of LANGUAGES_LIST) {
      // Locale files load lazily now; the test must wait for the chunk before
      // asserting, exactly like `useUIText` does.
      await loadUIText(meta.id);
      const ui = getUIText(meta.id);
      expect(ui).toBeDefined();
      expect(ui.nav.primary).toBeTruthy();
      expect(ui.nav.overview).toBeTruthy();
      expect(ui.nav.projects).toBeTruthy();
      expect(ui.nav.agents).toBeTruthy();
      expect(ui.nav.caches).toBeTruthy();
      expect(ui.nav.docs).toBeTruthy();
      expect(ui.nav.history).toBeTruthy();
      expect(ui.nav.settings).toBeTruthy();
      expect(ui.nav.about).toBeTruthy();

      expect(ui.common.scan).toBeTruthy();
      expect(ui.common.scanning).toBeTruthy();
      expect(ui.common.cancel).toBeTruthy();
      expect(ui.common.items(5)).toContain("5");

      expect(ui.overview.kpiCleanable).toBeTruthy();
      expect(ui.overview.kpiSafeReclaim).toBeTruthy();

      expect(ui.table.selectAll).toBeTruthy();
      expect(ui.table.project).toBeTruthy();

      expect(ui.settings.shortcutsTitle).toBeTruthy();
      expect(ui.notifications.cleanDoneBody(3, "test_dest", "100 MB")).toContain("3");
      expect(ui.errors.blocked).toBeTruthy();
      expect(ui.warnings.userProtected).toBeTruthy();
    }
  });

  it("keeps placeholder tokens and their order identical to English in every locale", async () => {
    const modules = import.meta.glob("../lib/ui-text/locales/*.json", {
      eager: true,
      import: "default",
    }) as Record<string, Record<string, unknown>>;

    const tokensOf = (value: string) =>
      Array.from(value.matchAll(/\{(\w+)\}/g), (match) => match[1]);
    const english = getUIText("en") as unknown as Record<string, Record<string, unknown>>;

    for (const [path, dict] of Object.entries(modules)) {
      const locale = path
        .split("/")
        .pop()!
        .replace(/\.json$/, "");
      for (const [category, keys] of Object.entries(dict)) {
        for (const [key, value] of Object.entries(keys as Record<string, unknown>)) {
          if (typeof value !== "string") continue;
          const englishValue = english[category]?.[key];
          if (typeof englishValue !== "string") continue;
          // `hydrateLocale` derives its parameter list from the template, so a
          // reordered or renamed token would silently swap the interpolated
          // arguments at runtime.
          expect(tokensOf(value), `${locale}.${category}.${key}`).toEqual(tokensOf(englishValue));
        }
      }
    }
  });

  it("masks the home directory when path masking is enabled", () => {
    const previous = usePreferencesStore.getState().maskPaths;
    usePreferencesStore.setState({ maskPaths: true });
    try {
      const uiEn = getUIText("en");
      const localized = localizeAppError(
        {
          code: "RecycleBinFailed",
          message: "C:\\Users\\emir\\AppData\\Local\\Temp\\node_modules",
        },
        uiEn,
      );
      expect(localized).not.toContain("emir");
      expect(localized).toContain("•••");
    } finally {
      usePreferencesStore.setState({ maskPaths: previous });
    }
  });

  it("ships every UI key in every locale JSON file without relying on the English fallback", async () => {
    const modules = import.meta.glob("../lib/ui-text/locales/*.json", {
      eager: true,
      import: "default",
    }) as Record<string, Record<string, unknown>>;

    const flatten = (node: unknown, prefix = "", acc: Record<string, unknown> = {}) => {
      if (node && typeof node === "object" && !Array.isArray(node)) {
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          flatten(value, prefix ? `${prefix}.${key}` : key, acc);
        }
      } else {
        acc[prefix] = node;
      }
      return acc;
    };

    const englishKeys = Object.keys(flatten(getUIText("en")));
    expect(englishKeys.length).toBeGreaterThan(500);

    for (const [path, dict] of Object.entries(modules)) {
      const locale = path
        .split("/")
        .pop()!
        .replace(/\.json$/, "");
      const flat = flatten(dict);
      const missing = englishKeys.filter(
        (key) => typeof flat[key] !== "string" || (flat[key] as string).trim() === "",
      );
      expect(missing, `${locale} missing keys: ${missing.join(", ")}`).toEqual([]);
    }
  });

  it("localizes categories across languages with zero raw keys leaked", () => {
    expect(localizeCategory("build", "tr")).toBe("Derleme");
    expect(localizeCategory("build", "en")).toBe("Build");
    expect(localizeCategory("cache", "tr")).toBe("Önbellek");
    expect(localizeCategory("cache", "en")).toBe("Cache");
    expect(localizeCategory("dependencies", "tr")).toBe("Bağımlılıklar");
    expect(localizeCategory("dependencies", "en")).toBe("Dependencies");
    // Fallback scanner slugs must resolve to translated canonical categories.
    expect(localizeCategory("build-output", "tr")).toBe("Derleme");
    expect(localizeCategory("build-output", "en")).toBe("Build");
    expect(localizeCategory("environments", "tr")).toBe("Bağımlılıklar");
    expect(localizeCategory("environments", "en")).toBe("Dependencies");
  });

  it("localizes backend notes, action descriptions, and unavailable reasons", () => {
    usePreferencesStore.getState().setLanguage("tr");
    expect(
      localizeBackendNote(
        "Browser recordings can grow large; can only be cleaned when recording has stopped.",
      ),
    ).toBe("Tarayıcı kayıtları büyüyebilir; yalnızca kayıt durdurulduğunda temizlenebilir.");
    expect(localizeActionDescription("Cleans npm cache via the official command.")).toBe(
      "Resmi komut ile npm önbelleğini temizler.",
    );
    expect(localizeUnavailableReason("'node' was not found on the system PATH.")).toBe(
      "'node' PATH sistem yolunda bulunamadı.",
    );

    usePreferencesStore.getState().setLanguage("en");
    expect(
      localizeBackendNote(
        "Browser recordings can grow large; can only be cleaned when recording has stopped.",
      ),
    ).toBe("Browser recordings can grow large; can only be cleaned when recording has stopped.");
  });

  it("localizes warning and blocked codes properly instead of raw codes", () => {
    const uiTr = getUIText("tr");
    expect(localizeWarningCode("GIT_GUARD", uiTr)).toBe(uiTr.warnings.protectedTarget);
    expect(localizeWarningCode("USER_PROTECTED", uiTr)).toBe(uiTr.warnings.userProtected);
    expect(localizeWarningCode("TARGET_ACTIVE", uiTr)).toBe(uiTr.warnings.targetActive);
    expect(localizeWarningCode("AGENT_POLICY", uiTr)).toBe(uiTr.warnings.agentCacheDisabled);

    expect(localizeAppError("GIT_GUARD", uiTr)).toBe(uiTr.warnings.protectedTarget);
    expect(localizeAppError("IN_USE", uiTr)).toBe(uiTr.warnings.targetActive);
  });

  it("localizes errors and implicit lookups against the persisted language", () => {
    const previous = usePreferencesStore.getState().language;
    usePreferencesStore.setState({ language: "tr" });
    try {
      const uiTr = getUIText("tr");
      // Stores and event handlers call the localizers without an explicit UI.
      // They must not silently fall back to English.
      expect(getUIText().common.scan).toBe(uiTr.common.scan);
      expect(localizeAppError({ code: "AccessDenied", message: "Access denied" })).toBe(
        uiTr.errors.accessDenied,
      );
      expect(localizeWarningCode("GIT_GUARD")).toBe(uiTr.warnings.protectedTarget);
    } finally {
      usePreferencesStore.setState({ language: previous });
    }
  });

  it("preserves machine-readable Recycle Bin context without leaking English", () => {
    const uiTr = getUIText("tr");
    const localized = localizeAppError(
      {
        code: "RecycleBinComFailed",
        message: "C:\\Temp\\node_modules (HRESULT 0x80070005)",
      },
      uiTr,
    );
    expect(localized).toBe(`${uiTr.errors.recycleBinComFailed} (HRESULT 0x80070005)`);
    expect(localized).not.toContain("Could not");
    // The full path must never be echoed verbatim; only opaque machine tokens
    // survive, so a home directory cannot leak through an error toast.
    expect(localized).not.toContain("C:\\Temp");
    // A legacy English payload must never be appended to the localized text.
    expect(
      localizeAppError(
        { code: "RecycleBinFailed", message: "Recycle bin operation failed: unknown" },
        uiTr,
      ),
    ).toBe(uiTr.errors.recycleBinFailed);
    // A bare code has no technical payload, so nothing extra is appended.
    expect(localizeAppError("RECYCLE_FAILED", uiTr)).toBe(uiTr.errors.recycleBinFailed);
  });

  it("keeps navigation labels in sync with page titles in every locale", async () => {
    for (const meta of LANGUAGES_LIST) {
      await loadUIText(meta.id);
      const ui = getUIText(meta.id);
      expect(ui.nav.overview, `${meta.id} nav.overview`).toBe(ui.overview.pageTitle);
      // Nav labels stay short while the page heading is descriptive, so only
      // require that the label is present and actually localized.
      expect(ui.nav.history.trim(), `${meta.id} nav.history`).not.toBe("");
      if (meta.id !== "en") {
        expect(ui.nav.history, `${meta.id} nav.history`).not.toBe("History");
      }
    }
  });

  it("never leaks translation artifacts into any locale", async () => {
    for (const meta of LANGUAGES_LIST) {
      await loadUIText(meta.id);
      const ui = getUIText(meta.id);
      const stack: unknown[] = [ui.nav, ui.common, ui.overview, ui.table, ui.history, ui.settings];
      const seen = new Set<unknown>();
      const visit = (value: unknown) => {
        if (typeof value === "string") {
          expect(value, `${meta.id}: ${JSON.stringify(value)}`).not.toMatch(/\\n\[|\n\[/);
        } else if (value && typeof value === "object" && !seen.has(value)) {
          seen.add(value);
          for (const child of Object.values(value as Record<string, unknown>)) visit(child);
        }
      };
      for (const root of stack) visit(root);
    }
  });

  it("ships localized documentation, legal and backend dictionaries for every locale", async () => {
    const { translateDocs, hasDocsLocale, loadDocsLocale } = await import(
      "@/features/docs/docs-i18n"
    );
    const { getLegalDocument, getLegalDocMeta, isLegalTranslation, loadLegalLocale } = await import(
      "@/features/legal/legal-content"
    );
    const { translateBackendText, loadBackendLocale } = await import("@/lib/ui-text/backend-i18n");

    const sample = "Welcome to Detergo";

    await Promise.all(
      LANGUAGES_LIST.filter((meta) => meta.id !== "en" && meta.id !== "tr").map(async (meta) => {
        await Promise.all([
          loadDocsLocale(meta.id),
          loadLegalLocale(meta.id),
          loadBackendLocale(meta.id),
        ]);

        expect(hasDocsLocale(meta.id), `${meta.id} docs locale`).toBe(true);
        const docsText = translateDocs(meta.id, sample);
        expect(docsText.length, `${meta.id} docs sample`).toBeGreaterThan(0);
        expect(docsText, `${meta.id} docs translated`).not.toBe(sample);

        const title = getLegalDocument(meta.id, "eula").title;
        expect(title.length, `${meta.id} legal title`).toBeGreaterThan(5);
        expect(title, `${meta.id} legal title translated`).not.toBe("End User License Agreement");
        expect(isLegalTranslation(meta.id)).toBe(true);
        expect(getLegalDocMeta(meta.id)[0].label.length).toBeGreaterThan(2);

        const note = translateBackendText(
          "Browser recordings can grow large; can only be cleaned when recording has stopped.",
          meta.id,
        );
        expect(note.length, `${meta.id} backend note`).toBeGreaterThan(0);
        expect(note, `${meta.id} backend note translated`).not.toBe(
          "Browser recordings can grow large; can only be cleaned when recording has stopped.",
        );
      }),
    );
  }, 20_000);
});
