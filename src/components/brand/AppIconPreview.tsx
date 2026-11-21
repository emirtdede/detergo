import React, { useId } from "react";
import {
  contrastRatioRgb,
  DEFAULT_CUSTOM_THEME,
  hexToRgb,
  normalizeHexColor,
  Rgb,
  rgbToHex,
} from "@/lib/theme/custom-theme";
import { AppIconMode, CustomThemeConfig, THEME_MODES } from "@/types";

export const APP_ICON_MATCH_THEME = "match-theme" as const;
export const APP_ICON_CUSTOM = "custom" as const;

const BUILTIN_ICON_SET: ReadonlySet<string> = new Set<string>(THEME_MODES);

export interface AppIconPalette {
  bgTop: string;
  bgMid: string;
  bgBottom: string;
  rim: string;
  glyph: string;
  isLight: boolean;
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    r: Math.round(a.r * (1 - clamped) + b.r * clamped),
    g: Math.round(a.g * (1 - clamped) + b.g * clamped),
    b: Math.round(a.b * (1 - clamped) + b.b * clamped),
  };
}

function darkPalette(
  bgTop: string,
  bgMid: string,
  bgBottom: string,
  glyph: string,
): AppIconPalette {
  const rim = rgbToHex(mixRgb(hexToRgb(glyph), { r: 255, g: 255, b: 255 }, 0.55));
  return { bgTop, bgMid, bgBottom, rim, glyph, isLight: false };
}

function lightPalette(
  bgTop: string,
  bgMid: string,
  bgBottom: string,
  glyph: string,
): AppIconPalette {
  const rim = rgbToHex(mixRgb(hexToRgb(glyph), { r: 15, g: 23, b: 42 }, 0.25));
  return { bgTop, bgMid, bgBottom, rim, glyph, isLight: true };
}

/**
 * Mirrors `src-tauri/src/platform/app_icon.rs::palette_for_icon` so the UI
 * preview matches the rendered Windows Window / Taskbar / System Tray / `.lnk`
 * icon pixel-for-pixel.
 */
const BUILTIN_PALETTES: Record<string, AppIconPalette> = {
  "dark-black": darkPalette("#202026", "#0E0E12", "#050507", "#FFFFFF"),
  "dark-gray": darkPalette("#282A31", "#16171B", "#0C0D10", "#E4E4E7"),
  "dark-blue": darkPalette("#12203B", "#0A1120", "#050913", "#38BDF8"),
  "dark-purple": darkPalette("#221338", "#120A1E", "#090511", "#C084FC"),
  "dark-green": darkPalette("#0F2920", "#081611", "#040C09", "#34D399"),
  "dark-red": darkPalette("#2D1115", "#18090B", "#0D0406", "#F87171"),
  "dark-orange": darkPalette("#2D1A0D", "#180E07", "#0D0703", "#FB923C"),
  "dark-yellow": darkPalette("#2A230D", "#161307", "#0C0A03", "#FACC15"),
  "light-white": lightPalette("#FFFFFF", "#F4F6F9", "#E4E8F0", "#18181B"),
  "light-gray": lightPalette("#F4F5F8", "#E6E8ED", "#D4D8E1", "#27272A"),
  "light-blue": lightPalette("#F5F9FF", "#E5F0FF", "#D0E4FC", "#0369A1"),
  "light-purple": lightPalette("#FCF7FF", "#F3E8FF", "#E4D4FA", "#6D28D9"),
  "light-green": lightPalette("#F4FDF7", "#E2F9EB", "#CBF2DC", "#047857"),
  "light-red": lightPalette("#FFF5F6", "#FFE4E8", "#FDCFD7", "#BE123C"),
  "light-orange": lightPalette("#FFF9F2", "#FFEDD9", "#FDDDBA", "#C2410C"),
  "light-yellow": lightPalette("#FFFDEE", "#FEF6C8", "#FAE99C", "#A16207"),
};

export function resolveAppIconId(iconId: string | undefined, activeTheme: string): string {
  const normalized = iconId?.trim() || APP_ICON_MATCH_THEME;
  if (normalized === APP_ICON_CUSTOM) return APP_ICON_CUSTOM;
  if (BUILTIN_ICON_SET.has(normalized)) return normalized;
  if (activeTheme === APP_ICON_CUSTOM) return APP_ICON_CUSTOM;
  if (BUILTIN_ICON_SET.has(activeTheme)) return activeTheme;
  return "dark-black";
}

export function getAppIconPalette(
  resolvedId: string,
  customTheme?: CustomThemeConfig,
): AppIconPalette {
  if (resolvedId !== APP_ICON_CUSTOM) {
    return BUILTIN_PALETTES[resolvedId] ?? BUILTIN_PALETTES["dark-black"];
  }

  const accentHex = normalizeHexColor(customTheme?.accent) ?? DEFAULT_CUSTOM_THEME.accent;
  const accent = hexToRgb(accentHex);
  const isLight = customTheme?.base === "light";

  if (isLight) {
    const bgTop = mixRgb({ r: 255, g: 255, b: 255 }, accent, 0.05);
    const bgMid = mixRgb({ r: 247, g: 248, b: 252 }, accent, 0.11);
    const bgBottom = mixRgb({ r: 235, g: 239, b: 247 }, accent, 0.18);
    let glyph = accent;
    let factor = 0;
    while (contrastRatioRgb(glyph, bgMid) < 4.5 && factor < 0.92) {
      factor += 0.12;
      glyph = mixRgb(accent, { r: 9, g: 11, b: 18 }, factor);
    }
    return lightPalette(rgbToHex(bgTop), rgbToHex(bgMid), rgbToHex(bgBottom), rgbToHex(glyph));
  }

  const bgTop = mixRgb({ r: 24, g: 25, b: 34 }, accent, 0.18);
  const bgMid = mixRgb({ r: 12, g: 13, b: 20 }, accent, 0.12);
  const bgBottom = mixRgb({ r: 5, g: 6, b: 10 }, accent, 0.08);
  let glyph = accent;
  let factor = 0;
  while (contrastRatioRgb(glyph, bgMid) < 4.5 && factor < 0.92) {
    factor += 0.12;
    glyph = mixRgb(accent, { r: 255, g: 255, b: 255 }, factor);
  }
  return darkPalette(rgbToHex(bgTop), rgbToHex(bgMid), rgbToHex(bgBottom), rgbToHex(glyph));
}

export interface AppIconPreviewProps {
  iconId: AppIconMode | string;
  activeTheme: string;
  customTheme: CustomThemeConfig;
  size?: number;
  className?: string;
}

export const AppIconPreview: React.FC<AppIconPreviewProps> = ({
  iconId,
  activeTheme,
  customTheme,
  size = 34,
  className = "",
}) => {
  const uid = useId().replace(/:/g, "");
  const resolvedId = resolveAppIconId(iconId, activeTheme);
  const palette = getAppIconPalette(resolvedId, customTheme);
  const bgId = `detergo-bg-${uid}`;
  const rimId = `detergo-rim-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={bgId} x1="256" y1="32" x2="256" y2="480" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={palette.bgTop} />
          <stop offset="45%" stopColor={palette.bgMid} />
          <stop offset="100%" stopColor={palette.bgBottom} />
        </linearGradient>
        <linearGradient
          id={rimId}
          x1="256"
          y1="32"
          x2="256"
          y2="480"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor={palette.rim} stopOpacity={palette.isLight ? 0.24 : 0.38} />
          <stop offset="35%" stopColor={palette.rim} stopOpacity={palette.isLight ? 0.16 : 0.09} />
          <stop offset="100%" stopColor={palette.rim} stopOpacity={palette.isLight ? 0.1 : 0.04} />
        </linearGradient>
      </defs>

      <rect x="32" y="32" width="448" height="448" rx="108" fill={`url(#${bgId})`} />
      <rect
        x="34"
        y="34"
        width="444"
        height="444"
        rx="106"
        stroke={`url(#${rimId})`}
        strokeWidth="4"
      />
      <rect
        x="56"
        y="56"
        width="400"
        height="400"
        rx="86"
        stroke={palette.rim}
        strokeOpacity={palette.isLight ? 0.08 : 0.06}
        strokeWidth="2"
      />

      <g>
        <path
          d="M166 172L86 256L166 340"
          stroke={palette.glyph}
          strokeWidth="34"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M346 172L426 256L346 340"
          stroke={palette.glyph}
          strokeWidth="34"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M225.5 336.1L259.6 246.5"
          stroke={palette.glyph}
          strokeWidth="34"
          strokeLinecap="round"
        />
        <path
          d="M283.4 146C283.4 173.8 293.6 184 321.4 184C293.6 184 283.4 194.2 283.4 222C283.4 194.2 273.2 184 245.4 184C273.2 184 283.4 173.8 283.4 146Z"
          fill={palette.glyph}
        />
      </g>
    </svg>
  );
};
