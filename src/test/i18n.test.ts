import { describe, it, expect } from "vitest";
import { LANGUAGES_LIST, detectSystemLanguage, isRtlLanguage, getTranslation } from "../lib/i18n";
import { getUIText } from "../lib/ui-text";
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

  it("provides comprehensive legal and Vellium company translations with fallback", () => {
    const tTr = getTranslation("tr");
    expect(tTr.legal.sectionTitle).toBe("Yasal Bilgiler & Kurumsal");
    expect(tTr.legal.velliumItemTitle).toBe("Vellium Hakkında");
    expect(tTr.legal.velliumManifesto).toHaveLength(5);
    expect(tTr.legal.privacySections).toHaveLength(4);
    expect(tTr.legal.termsSections).toHaveLength(4);
    expect(tTr.legal.securitySections).toHaveLength(4);
    expect(tTr.legal.licensesList.length).toBeGreaterThan(5);

    const tEn = getTranslation("en");
    expect(tEn.legal.sectionTitle).toBe("Legal Information & Corporate");
    expect(tEn.legal.velliumItemTitle).toBe("About Vellium");
    expect(tEn.legal.velliumManifesto[0]).toContain("Vellium builds enduring software systems");

    // Test fallback on other languages (e.g. "de")
    const tDe = getTranslation("de");
    expect(tDe.legal).toBeDefined();
    expect(tDe.legal.velliumItemTitle).toBeTruthy();
    expect(tDe.legal.privacySections.length).toBeGreaterThan(0);
  });
});

