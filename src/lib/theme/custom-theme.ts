import type { CustomThemeConfig } from "@/types";

export const CUSTOM_THEME_ID = "custom" as const;

export const DEFAULT_CUSTOM_THEME: CustomThemeConfig = {
  base: "dark",
  accent: "#3B82F6",
};

export const CUSTOM_THEME_PRESETS: ReadonlyArray<{ hex: string; label: string }> = [
  { hex: "#3B82F6", label: "Cobalt" },
  { hex: "#06B6D4", label: "Cyan" },
  { hex: "#10B981", label: "Emerald" },
  { hex: "#8B5CF6", label: "Violet" },
  { hex: "#EC4899", label: "Magenta" },
  { hex: "#F43F5E", label: "Crimson" },
  { hex: "#F59E0B", label: "Amber" },
  { hex: "#14B8A6", label: "Teal" },
];

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface CustomThemePalette {
  tokens: Record<string, string>;
  resolvedAccent: string;
  onAccentContrast: number;
  accentForegroundContrast: number;
  accentSurfaceContrast: number;
}

/**
 * Validates and normalizes `#RGB`, `RGB`, `#RRGGBB`, or `RRGGBB` to `#RRGGBB`.
 * Returns `null` when the input is not a valid hex color.
 */
export function normalizeHexColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    const expanded = cleaned
      .split("")
      .map((ch) => ch + ch)
      .join("")
      .toUpperCase();
    return `#${expanded}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `#${cleaned.toUpperCase()}`;
  }
  return null;
}

export function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHexColor(hex) ?? DEFAULT_CUSTOM_THEME.accent;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    "#" +
    [clamp(r), clamp(g), clamp(b)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

function mixRgb(a: Rgb, b: Rgb, weightB: number): Rgb {
  const t = Math.max(0, Math.min(1, weightB));
  return {
    r: a.r * (1 - t) + b.r * t,
    g: a.g * (1 - t) + b.g * t,
    b: a.b * (1 - t) + b.b * t,
  };
}

function linearChannel(value: number): number {
  const n = value / 255;
  return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * linearChannel(rgb.r) + 0.7152 * linearChannel(rgb.g) + 0.0722 * linearChannel(rgb.b)
  );
}

export function contrastRatioRgb(fg: Rgb, bg: Rgb): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function contrastRatio(hexA: string, hexB: string): number {
  return contrastRatioRgb(hexToRgb(hexA), hexToRgb(hexB));
}

function compositeOver(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return {
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
  };
}

/**
 * Nudges `color` toward `target` only as far as needed to satisfy `minRatio`
 * against every surface in `surfaces`. Leaves already-compliant colors untouched.
 */
function ensureContrastAgainst(color: Rgb, surfaces: Rgb[], target: Rgb, minRatio: number): Rgb {
  const passes = (candidate: Rgb) =>
    surfaces.every((bg) => contrastRatioRgb(candidate, bg) >= minRatio);
  if (passes(color)) return color;
  let low = 0;
  let high = 1;
  let best = target;
  for (let i = 0; i < 16; i += 1) {
    const mid = (low + high) / 2;
    const probe = mixRgb(color, target, mid);
    if (passes(probe)) {
      best = probe;
      high = mid;
    } else {
      low = mid;
    }
  }
  return best;
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/**
 * Derives a visible hover shade from `accentRgb` while strictly preserving both
 * >= 4.6:1 text contrast with `onAccentRgb` and >= 3.0:1 UI contrast against
 * `surfaces`. Never drops `onAccentContrast` below WCAG 2.2 AA (4.5:1) even
 * for extreme inputs such as `#000000` or `#FFFFFF`.
 */
function deriveCompliantHover(
  accentRgb: Rgb,
  onAccentRgb: Rgb,
  surfaces: Rgb[],
  preferredDirection: Rgb,
  step: number,
): Rgb {
  const isValid = (candidate: Rgb) =>
    contrastRatioRgb(onAccentRgb, candidate) >= 4.6 &&
    surfaces.every((bg) => contrastRatioRgb(candidate, bg) >= 3.0);

  const primary = mixRgb(accentRgb, preferredDirection, step);
  if (isValid(primary)) return primary;

  // Binary-search the largest visible shift in `preferredDirection` that stays
  // WCAG AA compliant on both foreground text and surrounding surfaces.
  let low = 0;
  let high = step;
  let best: Rgb | null = null;
  for (let i = 0; i < 14; i += 1) {
    const mid = (low + high) / 2;
    const probe = mixRgb(accentRgb, preferredDirection, mid);
    if (isValid(probe)) {
      best = probe;
      low = mid;
    } else {
      high = mid;
    }
  }
  if (best && low >= 0.03) return best;

  // Otherwise shift toward the opposite pole (which strictly increases
  // contrast with `onAccentRgb` while we still keep >= 3.0:1 against surfaces).
  const opposite = preferredDirection === WHITE ? BLACK : WHITE;
  const alt = mixRgb(accentRgb, opposite, step);
  if (isValid(alt)) return alt;

  low = 0;
  high = step;
  best = accentRgb;
  for (let i = 0; i < 14; i += 1) {
    const mid = (low + high) / 2;
    const probe = mixRgb(accentRgb, opposite, mid);
    if (isValid(probe)) {
      best = probe;
      low = mid;
    } else {
      high = mid;
    }
  }
  return best;
}

/**
 * Generates a complete WCAG 2.2 AA compliant CSS token palette from any user
 * hex color + dark/light base.
 */
export function buildCustomThemeTokens(config: CustomThemeConfig): CustomThemePalette {
  const base = config.base === "light" ? "light" : "dark";
  const rawAccent = hexToRgb(normalizeHexColor(config.accent) ?? DEFAULT_CUSTOM_THEME.accent);

  if (base === "light") {
    const appBg = mixRgb({ r: 248, g: 250, b: 252 }, rawAccent, 0.045);
    const surface: Rgb = { r: 255, g: 255, b: 255 };
    const surfaceStrong = mixRgb({ r: 241, g: 245, b: 249 }, rawAccent, 0.08);
    const surfaceHover = mixRgb({ r: 241, g: 245, b: 249 }, rawAccent, 0.05);
    const surfaceActive = mixRgb({ r: 226, g: 232, b: 240 }, rawAccent, 0.12);
    const surfaceAlt = mixRgb({ r: 248, g: 250, b: 252 }, rawAccent, 0.06);

    // Guarantee >= 3.2:1 UI contrast on light surfaces so primary buttons and
    // checkboxes stay unmistakable even if the user enters pale yellow or white.
    const accentRgb = ensureContrastAgainst(rawAccent, [surface, appBg], BLACK, 3.2);

    // Pure white vs pure black mathematically guarantees >= 4.58:1 for every
    // color in sRGB.
    const whiteContrast = contrastRatioRgb(WHITE, accentRgb);
    const blackContrast = contrastRatioRgb(BLACK, accentRgb);
    const onAccentRgb = whiteContrast >= blackContrast ? WHITE : BLACK;

    const accentHoverRgb = deriveCompliantHover(
      accentRgb,
      onAccentRgb,
      [surface, appBg],
      BLACK,
      0.14,
    );
    const accentActiveRgb = deriveCompliantHover(
      accentRgb,
      onAccentRgb,
      [surface, appBg],
      BLACK,
      0.24,
    );

    const accentSubtleBg = compositeOver(accentRgb, 0.12, surface);
    const accentSubtleAlt = compositeOver(accentRgb, 0.12, surfaceAlt);
    const accentSubtleStrong = compositeOver(accentRgb, 0.16, surfaceStrong);
    const accentFgRgb = ensureContrastAgainst(
      accentRgb,
      [
        surface,
        appBg,
        surfaceAlt,
        surfaceStrong,
        accentSubtleBg,
        accentSubtleAlt,
        accentSubtleStrong,
      ],
      BLACK,
      5.2,
    );
    const focusRingRgb = ensureContrastAgainst(accentRgb, [surface, appBg], BLACK, 3.5);
    const borderControlRgb = ensureContrastAgainst(
      mixRgb({ r: 100, g: 116, b: 139 }, accentRgb, 0.35),
      [surface, surfaceAlt, surfaceStrong, surfaceHover, appBg],
      BLACK,
      3.2,
    );

    const accentHex = rgbToHex(accentRgb);
    const onAccentHex = rgbToHex(onAccentRgb);
    const accentFgHex = rgbToHex(accentFgRgb);

    return {
      resolvedAccent: accentHex,
      onAccentContrast: Math.min(
        contrastRatioRgb(onAccentRgb, accentRgb),
        contrastRatioRgb(onAccentRgb, accentHoverRgb),
      ),
      accentForegroundContrast: contrastRatioRgb(accentFgRgb, accentSubtleBg),
      accentSurfaceContrast: contrastRatioRgb(accentRgb, surface),
      tokens: {
        "--app-bg": rgbToHex(appBg),
        "--surface": rgbToHex(surface),
        "--surface-strong": rgbToHex(surfaceStrong),
        "--surface-hover": rgbToHex(surfaceHover),
        "--surface-active": rgbToHex(surfaceActive),
        "--surface-alt": rgbToHex(surfaceAlt),
        "--text-primary": "#0F172A",
        "--text-secondary": "#334155",
        "--text-muted": "#475569",
        "--text-disabled": "#94A3B8",
        "--border": `rgba(${Math.round(accentRgb.r)}, ${Math.round(accentRgb.g)}, ${Math.round(accentRgb.b)}, 0.16)`,
        "--border-strong": `rgba(${Math.round(accentRgb.r)}, ${Math.round(accentRgb.g)}, ${Math.round(accentRgb.b)}, 0.30)`,
        "--separator": "rgba(15, 23, 42, 0.08)",
        "--border-control": rgbToHex(borderControlRgb),
        "--success": "#047857",
        "--success-hover": "#065F46",
        "--success-text": "#065F46",
        "--warning": "#B45309",
        "--warning-text": "#92400E",
        "--danger-foreground": "#991B1B",
        "--accent": accentHex,
        "--accent-hover": rgbToHex(accentHoverRgb),
        "--accent-active": rgbToHex(accentActiveRgb),
        "--accent-subtle": `rgba(${Math.round(accentRgb.r)}, ${Math.round(accentRgb.g)}, ${Math.round(accentRgb.b)}, 0.12)`,
        "--accent-text": onAccentHex,
        "--on-accent": onAccentHex,
        "--accent-foreground": accentFgHex,
        "--focus-ring": rgbToHex(focusRingRgb),
        "--shadow-sm": "0 1px 3px rgba(0, 0, 0, 0.06)",
        "--shadow-md": "0 4px 12px rgba(0, 0, 0, 0.10)",
        "--shadow-lg": "0 12px 28px rgba(0, 0, 0, 0.14)",
        "--glass-bg": rgbToHex(surface),
        "--glass-bg-strong": rgbToHex(surfaceAlt),
        "--glass-border": `rgba(${Math.round(accentRgb.r)}, ${Math.round(accentRgb.g)}, ${Math.round(accentRgb.b)}, 0.16)`,
        "--glass-inner-highlight": "transparent",
      },
    };
  }

  // Dark base: subtle ambient tint derived from the chosen hex while keeping
  // text contrast strictly >= 4.5:1 across all surfaces.
  const appBg = mixRgb({ r: 10, g: 11, b: 15 }, rawAccent, 0.055);
  const surface = mixRgb({ r: 18, g: 20, b: 26 }, rawAccent, 0.075);
  const surfaceStrong = mixRgb({ r: 27, g: 30, b: 39 }, rawAccent, 0.1);
  const surfaceHover = mixRgb({ r: 34, g: 38, b: 49 }, rawAccent, 0.12);
  const surfaceActive = mixRgb({ r: 44, g: 49, b: 64 }, rawAccent, 0.15);
  const surfaceAlt = mixRgb({ r: 14, g: 16, b: 21 }, rawAccent, 0.065);

  // Guarantee >= 3.2:1 UI contrast on dark surfaces even if the user enters
  // black or very dark navy.
  const accentRgb = ensureContrastAgainst(rawAccent, [surface, appBg], WHITE, 3.2);

  const whiteContrast = contrastRatioRgb(WHITE, accentRgb);
  const blackContrast = contrastRatioRgb(BLACK, accentRgb);
  const onAccentRgb = whiteContrast >= blackContrast ? WHITE : BLACK;

  const accentHoverRgb = deriveCompliantHover(
    accentRgb,
    onAccentRgb,
    [surface, appBg],
    WHITE,
    0.16,
  );
  const accentActiveRgb = deriveCompliantHover(
    accentRgb,
    onAccentRgb,
    [surface, appBg],
    BLACK,
    0.14,
  );

  const accentSubtleBg = compositeOver(accentRgb, 0.16, surface);
  const accentSubtleAlt = compositeOver(accentRgb, 0.16, surfaceAlt);
  const accentSubtleStrong = compositeOver(accentRgb, 0.2, surfaceHover);
  const accentFgRgb = ensureContrastAgainst(
    accentRgb,
    [
      surface,
      appBg,
      surfaceAlt,
      surfaceStrong,
      accentSubtleBg,
      accentSubtleAlt,
      accentSubtleStrong,
    ],
    WHITE,
    5.2,
  );
  const focusRingRgb = ensureContrastAgainst(accentRgb, [surface, appBg], WHITE, 3.8);
  const borderControlRgb = ensureContrastAgainst(
    mixRgb({ r: 120, g: 132, b: 150 }, accentRgb, 0.35),
    [surface, surfaceAlt, surfaceStrong, surfaceHover, appBg],
    WHITE,
    3.2,
  );

  const accentHex = rgbToHex(accentRgb);
  const onAccentHex = rgbToHex(onAccentRgb);
  const accentFgHex = rgbToHex(accentFgRgb);

  return {
    resolvedAccent: accentHex,
    onAccentContrast: Math.min(
      contrastRatioRgb(onAccentRgb, accentRgb),
      contrastRatioRgb(onAccentRgb, accentHoverRgb),
    ),
    accentForegroundContrast: contrastRatioRgb(accentFgRgb, accentSubtleBg),
    accentSurfaceContrast: contrastRatioRgb(accentRgb, surface),
    tokens: {
      "--app-bg": rgbToHex(appBg),
      "--surface": rgbToHex(surface),
      "--surface-strong": rgbToHex(surfaceStrong),
      "--surface-hover": rgbToHex(surfaceHover),
      "--surface-active": rgbToHex(surfaceActive),
      "--surface-alt": rgbToHex(surfaceAlt),
      "--text-primary": "#F8FAFC",
      "--text-secondary": "#CBD5E1",
      "--text-muted": "#94A3B8",
      "--text-disabled": "#64748B",
      "--border": `rgba(${Math.round(accentRgb.r)}, ${Math.round(accentRgb.g)}, ${Math.round(accentRgb.b)}, 0.18)`,
      "--border-strong": `rgba(${Math.round(accentRgb.r)}, ${Math.round(accentRgb.g)}, ${Math.round(accentRgb.b)}, 0.34)`,
      "--separator": "rgba(255, 255, 255, 0.08)",
      "--border-control": rgbToHex(borderControlRgb),
      "--danger-foreground": "#FECACA",
      "--success-text": "#A7F3D0",
      "--warning-text": "#FDE68A",
      "--accent": accentHex,
      "--accent-hover": rgbToHex(accentHoverRgb),
      "--accent-active": rgbToHex(accentActiveRgb),
      "--accent-subtle": `rgba(${Math.round(accentRgb.r)}, ${Math.round(accentRgb.g)}, ${Math.round(accentRgb.b)}, 0.16)`,
      "--accent-text": onAccentHex,
      "--on-accent": onAccentHex,
      "--accent-foreground": accentFgHex,
      "--focus-ring": rgbToHex(focusRingRgb),
      "--shadow-sm": "0 1px 3px rgba(0, 0, 0, 0.4)",
      "--shadow-md": "0 4px 16px rgba(0, 0, 0, 0.5)",
      "--shadow-lg": "0 16px 40px rgba(0, 0, 0, 0.6)",
      "--glass-bg": rgbToHex(surface),
      "--glass-bg-strong": rgbToHex(surfaceStrong),
      "--glass-border": `rgba(${Math.round(accentRgb.r)}, ${Math.round(accentRgb.g)}, ${Math.round(accentRgb.b)}, 0.18)`,
      "--glass-inner-highlight": "transparent",
    },
  };
}

const CUSTOM_TOKEN_KEYS = Object.keys(buildCustomThemeTokens(DEFAULT_CUSTOM_THEME).tokens);

export function applyCustomThemeTokens(root: HTMLElement, config: CustomThemeConfig): void {
  const palette = buildCustomThemeTokens(config);
  root.setAttribute("data-theme-base", config.base === "light" ? "light" : "dark");
  for (const [key, value] of Object.entries(palette.tokens)) {
    root.style.setProperty(key, value);
  }
}

export function clearCustomThemeTokens(root: HTMLElement): void {
  root.removeAttribute("data-theme-base");
  for (const key of CUSTOM_TOKEN_KEYS) {
    root.style.removeProperty(key);
  }
}
