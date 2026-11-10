#!/usr/bin/env node
/**
 * WCAG 2.2 contrast gate for the four verified themes.
 *
 * The palette lives in src/styles/tokens.css. This script parses that file
 * instead of duplicating the colours, so a token change is audited by the same
 * commit that introduces it. Run with: npm run check:contrast
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cssPath = resolve(root, "src/styles/tokens.css");
const css = readFileSync(cssPath, "utf8");

const THEMES = ["dark-black", "dark-gray", "light-white", "light-gray"];

function readBlock(marker) {
  const markerIndex = css.indexOf(marker);
  if (markerIndex === -1) throw new Error(`Token block not found: ${marker}`);
  // The selector list may contain legacy aliases; the declaration block starts
  // at the first opening brace after the verified theme marker.
  const open = css.indexOf("{", markerIndex);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);
  const tokens = {};
  for (const match of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

// Root tokens are the dark default (status colours, radii, spacing); every
// theme inherits them and overrides only what its surface needs. Measuring the
// theme block alone silently skipped inherited text/UI pairs.
function readTheme(theme) {
  return { ...readBlock(":root"), ...readBlock(`[data-theme="${theme}"]`) };
}

function parseColor(value) {
  const hex = value.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      digits = digits
        .split("")
        .map((digit) => digit + digit)
        .join("");
    }
    const r = parseInt(digits.slice(0, 2), 16);
    const g = parseInt(digits.slice(2, 4), 16);
    const b = parseInt(digits.slice(4, 6), 16);
    const a = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  const rgb = value.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i,
  );
  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] === undefined ? 1 : Number(rgb[4]),
    };
  }

  throw new Error(`Unsupported colour value: ${value}`);
}

function composite(foreground, background) {
  if (foreground.a >= 1) return foreground;
  const alpha = foreground.a;
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
    a: 1,
  };
}

function channel(value) {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function luminance(color) {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/**
 * Resolves a possibly translucent background over the surface it is painted
 * on (e.g. --accent-subtle over --surface) before measuring text on top.
 */
function contrast(foreground, background, base) {
  const bg = background.a < 1 && base ? composite(background, base) : background;
  const fg = composite(foreground, bg);
  const lighter = Math.max(luminance(fg), luminance(bg));
  const darker = Math.min(luminance(fg), luminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

const TEXT_PAIRS = [
  ["text-primary", "app-bg"],
  ["text-primary", "surface"],
  ["text-primary", "surface-strong"],
  ["text-primary", "surface-alt"],
  ["text-primary", "surface-hover"],
  ["text-secondary", "app-bg"],
  ["text-secondary", "surface"],
  ["text-secondary", "surface-strong"],
  ["text-secondary", "surface-alt"],
  ["text-secondary", "surface-hover"],
  ["text-muted", "app-bg"],
  ["text-muted", "surface"],
  ["text-muted", "surface-strong"],
  ["text-muted", "surface-alt"],
  ["text-muted", "surface-hover"],
  ["on-accent", "accent"],
  ["on-accent", "accent-hover"],
  ["accent-foreground", "surface"],
  ["accent-foreground", "accent-subtle", "surface"],
  ["warning-text", "surface"],
  ["warning-text", "surface-alt"],
  ["warning-text", "warning-subtle", "surface"],
  ["success-text", "surface"],
  ["success-text", "surface-alt"],
  ["success-text", "success-subtle", "surface"],
  ["danger-foreground", "surface"],
  ["danger-foreground", "surface-alt"],
  ["danger-text", "danger"],
  ["danger-text", "danger-hover"],
  ["danger-text", "danger-active"],
];

const UI_PAIRS = [
  ["border-control", "surface", 3],
  ["border-control", "surface-alt", 3],
  ["border-control", "surface-strong", 3],
  ["border-control", "surface-hover", 3],
  ["border-control", "app-bg", 3],
  ["focus-ring", "surface", 3],
  ["focus-ring", "app-bg", 3],
  ["accent", "surface", 3],
  ["accent", "app-bg", 3],
  ["success", "surface", 3],
  ["success", "surface-alt", 3],
  ["danger", "surface", 3],
  ["danger", "surface-alt", 3],
  ["warning", "surface", 3],
  ["warning", "surface-alt", 3],
];

let failures = 0;

for (const theme of THEMES) {
  const tokens = readTheme(theme);
  const colours = {};
  for (const [name, value] of Object.entries(tokens)) {
    try {
      colours[name] = parseColor(value);
    } catch {
      // Non-colour tokens (shadows, sizes) are ignored.
    }
  }

  const rows = [];
  const missing = [];
  for (const [fgName, bgName, baseName] of TEXT_PAIRS) {
    if (!colours[fgName] || !colours[bgName] || (baseName && !colours[baseName])) {
      missing.push(`${fgName} on ${bgName}${baseName ? ` over ${baseName}` : ""}`);
      continue;
    }
    const ratio = contrast(
      colours[fgName],
      colours[bgName],
      baseName ? colours[baseName] : undefined,
    );
    rows.push({
      pair: `${fgName} on ${bgName}${baseName ? ` over ${baseName}` : ""}`,
      ratio,
      minimum: 4.5,
    });
  }
  for (const [fgName, bgName, minimum] of UI_PAIRS) {
    if (!colours[fgName] || !colours[bgName]) {
      missing.push(`${fgName} on ${bgName}`);
      continue;
    }
    const ratio = contrast(colours[fgName], colours[bgName]);
    rows.push({ pair: `${fgName} on ${bgName}`, ratio, minimum });
  }

  // A renamed or deleted token must fail loudly: silently skipping its pair is
  // how the inherited danger/success/warning text pairs went unaudited before.
  if (missing.length > 0) {
    throw new Error(`${theme}: missing colour token(s) for ${missing.join(", ")}`);
  }

  const themeFailures = rows.filter((row) => row.ratio + 0.005 < row.minimum);
  failures += themeFailures.length;

  const status = themeFailures.length === 0 ? "PASS" : "FAIL";
  console.log(`\n${theme}: ${status}`);
  for (const row of rows) {
    const verdict = row.ratio + 0.005 < row.minimum ? "FAIL" : "ok";
    console.log(
      `  ${verdict.padEnd(4)} ${row.ratio.toFixed(2).padStart(5)}:1  ` +
        `(min ${row.minimum.toFixed(1)})  ${row.pair}`,
    );
  }
}

if (failures > 0) {
  console.error(`\nContrast audit failed: ${failures} pair(s) below WCAG 2.2 AA.`);
  process.exit(1);
}

console.log("\nContrast audit passed for all four themes.");
