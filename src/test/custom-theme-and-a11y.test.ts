import { describe, expect, it, vi } from "vitest";
import { buildCustomThemeTokens, contrastRatio, normalizeHexColor } from "@/lib/theme/custom-theme";
import { getAppIconPalette, resolveAppIconId } from "@/components/brand/AppIconPreview";
import {
  normalizeAppIcon,
  normalizeTheme,
  normalizeUiScale,
  usePreferencesStore,
} from "@/stores/preferences-store";
import { scannerApi } from "@/lib/tauri/scanner-api";

describe("Custom hex theme engine (WCAG 2.2 AA guarantee)", () => {
  const EXTREME_COLORS = [
    "#000000",
    "#FFFFFF",
    "#FFFF00",
    "#00FF00",
    "#FF00FF",
    "#00FFFF",
    "#FF0000",
    "#0000FF",
    "#3B82F6",
    "#10B981",
    "#F59E0B",
    "#EC4899",
    "#808080",
    "#121212",
    "#F8FAFC",
  ];

  it("normalizes 3-digit, 6-digit, and hashless hex strings", () => {
    expect(normalizeHexColor("#0f8")).toBe("#00FF88");
    expect(normalizeHexColor("3b82f6")).toBe("#3B82F6");
    expect(normalizeHexColor("  #abcdef ")).toBe("#ABCDEF");
    expect(normalizeHexColor("not-hex")).toBeNull();
    expect(normalizeHexColor("#12345")).toBeNull();
  });

  it("guarantees >= 4.5:1 text contrast and >= 3.0:1 UI contrast across extreme hex inputs", () => {
    for (const base of ["dark", "light"] as const) {
      for (const hex of EXTREME_COLORS) {
        const palette = buildCustomThemeTokens({ base, accent: hex });
        expect(palette.onAccentContrast, `${base} ${hex} on-accent`).toBeGreaterThanOrEqual(4.5);
        expect(
          palette.accentForegroundContrast,
          `${base} ${hex} accent-foreground`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          palette.accentSurfaceContrast,
          `${base} ${hex} accent on surface`,
        ).toBeGreaterThanOrEqual(3.0);
        expect(
          contrastRatio(palette.tokens["--text-primary"], palette.tokens["--surface"]),
        ).toBeGreaterThanOrEqual(7.0);
        expect(
          contrastRatio(palette.tokens["--text-secondary"], palette.tokens["--surface"]),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("Accessibility zoom, high contrast, and onboarding preferences", () => {
  it("clamps uiScale between 80 and 150 and accepts custom theme id", () => {
    expect(normalizeUiScale(50)).toBe(80);
    expect(normalizeUiScale(100)).toBe(100);
    expect(normalizeUiScale(125)).toBe(125);
    expect(normalizeUiScale(300)).toBe(150);
    expect(normalizeTheme("custom")).toBe("custom");
  });

  it("applies custom theme tokens, zoom, and high contrast to the DOM", () => {
    const store = usePreferencesStore.getState();
    store.setCustomTheme({ base: "light", accent: "#8B5CF6" });
    expect(document.documentElement.getAttribute("data-theme")).toBe("custom");
    expect(document.documentElement.getAttribute("data-theme-base")).toBe("light");
    expect(document.documentElement.style.getPropertyValue("--accent")).toMatch(/^#[0-9A-F]{6}$/);

    store.setUiScale(125);
    expect(document.documentElement.getAttribute("data-ui-scale")).toBe("125");
    expect(document.documentElement.style.zoom).toBe("125%");

    store.setHighContrast(true);
    expect(document.documentElement.getAttribute("data-high-contrast")).toBe("true");

    // Switching back to a built-in theme clears custom inline CSS vars cleanly.
    store.setTheme("dark-black");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark-black");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("");
    store.setUiScale(100);
    store.setHighContrast(false);
  });
});

describe("Dynamic Detergo application icon selector", () => {
  it("normalizes and resolves match-theme, custom, and built-in icon ids", () => {
    expect(normalizeAppIcon("match-theme")).toBe("match-theme");
    expect(normalizeAppIcon("custom")).toBe("custom");
    expect(normalizeAppIcon("dark-blue")).toBe("dark-blue");
    expect(normalizeAppIcon("unknown-icon")).toBe("match-theme");

    expect(resolveAppIconId("match-theme", "dark-green")).toBe("dark-green");
    expect(resolveAppIconId("match-theme", "custom")).toBe("custom");
    expect(resolveAppIconId("light-purple", "dark-blue")).toBe("light-purple");
  });

  it("guarantees WCAG AA glyph contrast for custom app icon palettes", () => {
    for (const [base, accent] of [
      ["dark", "#0A0A0A"],
      ["dark", "#10B981"],
      ["light", "#FEF08A"],
      ["light", "#EC4899"],
    ] as const) {
      const palette = getAppIconPalette("custom", { base, accent });
      expect(contrastRatio(palette.glyph, palette.bgMid)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("applies selected icon to DOM attribute and invokes backend shell updater", () => {
    const spy = vi.spyOn(scannerApi, "applyAppIcon").mockResolvedValue({
      resolvedId: "dark-green",
      windowUpdated: true,
      trayUpdated: true,
      shortcutsUpdated: 2,
      iconPath: "C:\\Users\\demo\\AppData\\Roaming\\detergo\\icons\\detergo-dark-green.ico",
    });
    const store = usePreferencesStore.getState();
    store.setAppIcon("dark-green");
    expect(document.documentElement.getAttribute("data-app-icon")).toBe("dark-green");
    expect(spy).toHaveBeenCalledWith(
      "dark-green",
      usePreferencesStore.getState().theme,
      usePreferencesStore.getState().customTheme,
    );
    store.setAppIcon("match-theme");
    spy.mockRestore();
  });
});
