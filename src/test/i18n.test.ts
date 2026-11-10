import { describe, it, expect } from "vitest";
import { LANGUAGES_LIST, detectSystemLanguage, isRtlLanguage, getTranslation } from "../lib/i18n";
import {
  getUIText,
  localizeCategory,
  localizeBackendNote,
  localizeActionDescription,
  localizeUnavailableReason,
  localizeWarningCode,
  localizeAppError,
} from "../lib/ui-text";
import { DICTIONARIES } from "../locales/dictionaries";
import { usePreferencesStore } from "../stores/preferences-store";

describe("73-Language i18n Engine & Localization Tests", () => {
  it("contains exactly 73 supported languages", () => {
    expect(LANGUAGES_LIST).toHaveLength(73);
    expect(Object.keys(DICTIONARIES)).toHaveLength(73);
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

  it("provides complete and valid translation dictionaries for all 73 languages", () => {
    for (const meta of LANGUAGES_LIST) {
      const dict = DICTIONARIES[meta.id];
      expect(dict).toBeDefined();
      expect(dict.app.title).toBe("Dev Cleaner");
      expect(dict.header.scan).toBeTruthy();
      expect(dict.header.settings).toBeTruthy();
      expect(dict.scan.idleTitle).toBeTruthy();
      expect(dict.table.project).toBeTruthy();
      expect(dict.dialog.cancel).toBeTruthy();
      expect(dict.dialog.confirm).toBeTruthy();
      expect(dict.settings.title).toBeTruthy();
    }
  });

  it("supports all 73 UI languages and clamps completely invalid locales to English", () => {
    const store = usePreferencesStore.getState();

    // Valid 73 languages are fully recognized and supported
    store.setLanguage("de");
    expect(usePreferencesStore.getState().language).toBe("de");
    expect(getUIText("de").common.scan).toBe("Scannen");

    store.setLanguage("ja");
    expect(usePreferencesStore.getState().language).toBe("ja");
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

  it("provides comprehensive legal and Vellium company translations without leaking English", () => {
    const tTr = getTranslation("tr");
    expect(tTr.legal).toBeDefined();
    expect(tTr.legal!.sectionTitle).toBe("Yasal Bilgiler & Kurumsal");
    expect(tTr.legal!.velliumItemTitle).toBe("Vellium Hakkında");
    expect(tTr.legal!.velliumManifesto).toHaveLength(5);
    expect(tTr.legal!.privacySections).toHaveLength(4);
    expect(tTr.legal!.termsSections).toHaveLength(4);
    expect(tTr.legal!.securitySections).toHaveLength(4);
    expect(tTr.legal!.licensesList.length).toBeGreaterThan(5);

    const tEn = getTranslation("en");
    expect(tEn.legal).toBeDefined();
    expect(tEn.legal!.sectionTitle).toBe("Legal Information & Corporate");
    expect(tEn.legal!.velliumItemTitle).toBe("About Vellium");
    expect(tEn.legal!.velliumManifesto[0]).toContain("Vellium builds enduring software systems");

    // Localizations without a translated in-memory legal block must not serve
    // the English legal text; the Legal view reads from legal-locales instead.
    const tDe = getTranslation("de");
    expect(tDe.legal).toBeUndefined();
  });
  it("guarantees 100% complete UIText coverage across all 73 languages with zero missing keys", () => {
    for (const meta of LANGUAGES_LIST) {
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
    expect(localized).toBe(
      `${uiTr.errors.recycleBinComFailed} (C:\\Temp\\node_modules (HRESULT 0x80070005))`,
    );
    expect(localized).not.toContain("Could not");
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

  it("keeps navigation labels in sync with page titles in every locale", () => {
    for (const meta of LANGUAGES_LIST) {
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

  it("never leaks translation artifacts into any locale", () => {
    for (const meta of LANGUAGES_LIST) {
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
    const { translateDocs, hasDocsLocale } = await import("@/features/docs/docs-i18n");
    const { getLegalDocument, getLegalDocMeta, isLegalTranslation } = await import(
      "@/features/legal/legal-content"
    );
    const { translateBackendText } = await import("@/lib/ui-text/backend-i18n");

    const sample = "Welcome to Dev Cleaner";

    for (const meta of LANGUAGES_LIST) {
      if (meta.id === "en" || meta.id === "tr") continue;

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
    }
  });
});
