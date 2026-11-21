#!/usr/bin/env node
/**
 * Build the GitHub social preview source (1280x640) with the wordmark outlined
 * from local Windows fonts. The generated SVG contains paths only, so rendering
 * it never needs the font file and no font is redistributed with the product.
 *
 * Run: node scripts/build-social-preview.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import opentype from "opentype.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "assets", "brand", "github");
const boldFontPath = "C:\\Windows\\Fonts\\segoeuib.ttf";
const regularFontPath = "C:\\Windows\\Fonts\\segoeui.ttf";

if (process.platform !== "win32") {
  console.error("[build-social-preview] Windows is required to read the Segoe UI outlines.");
  process.exit(1);
}
for (const fontPath of [boldFontPath, regularFontPath]) {
  if (!fs.existsSync(fontPath)) {
    console.error(`[build-social-preview] Missing font: ${fontPath}`);
    process.exit(1);
  }
}

const bold = opentype.loadSync(boldFontPath);
const regular = opentype.loadSync(regularFontPath);

function outline(font, text, x, y, size, maxWidth) {
  const width = font.getAdvanceWidth(text, size);
  const scale = maxWidth && width > maxWidth ? maxWidth / width : 1;
  const fontSize = size * scale;
  const pathData = font.getPath(text, x, y, fontSize).toPathData(2);
  return { pathData, width: width * scale, fontSize };
}

const wordmark = outline(bold, "Detergo", 420, 300, 96, 760);
const tagline = outline(bold, "DEVELOPER ARTIFACT CLEANER", 424, 352, 21, 760);
const line1 = outline(
  regular,
  "Safe, offline cleanup for Node.js, Python, Rust,",
  424,
  414,
  23,
  760,
);
const line2 = outline(regular, "Go, Java, .NET and AI agent storage.", 424, 448, 23, 760);
const domain = outline(bold, "VELLIUM.DEV", 424, 552, 16, 300);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640" fill="none">
    <title>Detergo by Vellium</title>
    <defs>
        <linearGradient id="sp-bg" x1="0" y1="0" x2="1280" y2="640" gradientUnits="userSpaceOnUse">
            <stop stop-color="#101015"/>
            <stop offset="0.55" stop-color="#08080B"/>
            <stop offset="1" stop-color="#040405"/>
        </linearGradient>
        <radialGradient id="sp-glow" cx="0" cy="0" r="1" gradientTransform="translate(236 322) rotate(90) scale(330)" gradientUnits="userSpaceOnUse">
            <stop stop-color="#FFFFFF" stop-opacity="0.07"/>
            <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="sp-bg-icon" x1="256" y1="32" x2="256" y2="480" gradientUnits="userSpaceOnUse">
            <stop stop-color="#1C1C21"/>
            <stop offset="0.45" stop-color="#0D0D10"/>
            <stop offset="1" stop-color="#050507"/>
        </linearGradient>
        <linearGradient id="sp-rim" x1="256" y1="32" x2="256" y2="480" gradientUnits="userSpaceOnUse">
            <stop stop-color="#FFFFFF" stop-opacity="0.32"/>
            <stop offset="0.35" stop-color="#FFFFFF" stop-opacity="0.08"/>
            <stop offset="1" stop-color="#FFFFFF" stop-opacity="0.03"/>
        </linearGradient>
        <pattern id="sp-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M32 0H0V32" stroke="#FFFFFF" stroke-opacity="0.035" stroke-width="1"/>
        </pattern>
    </defs>

    <rect width="1280" height="640" fill="url(#sp-bg)"/>
    <rect width="1280" height="640" fill="url(#sp-glow)"/>
    <rect width="1280" height="640" fill="url(#sp-grid)"/>

    <g transform="translate(104 194) scale(0.492)">
        <rect x="32" y="32" width="448" height="448" rx="108" fill="url(#sp-bg-icon)"/>
        <rect x="34" y="34" width="444" height="444" rx="106" stroke="url(#sp-rim)" stroke-width="4"/>
        <g>
            <path d="M166 172L86 256L166 340" stroke="#FFFFFF" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M346 172L426 256L346 340" stroke="#FFFFFF" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M225.5 336.1L259.6 246.5" stroke="#FFFFFF" stroke-width="34" stroke-linecap="round"/>
            <path d="M283.4 146C283.4 173.8 293.6 184 321.4 184C293.6 184 283.4 194.2 283.4 222C283.4 194.2 273.2 184 245.4 184C273.2 184 283.4 173.8 283.4 146Z" fill="#FFFFFF"/>
        </g>
    </g>

    <path d="${wordmark.pathData}" fill="#FFFFFF"/>
    <path d="${tagline.pathData}" fill="#A1A1AA"/>
    <path d="${line1.pathData}" fill="#8B8B94"/>
    <path d="${line2.pathData}" fill="#8B8B94"/>

    <rect x="424" y="492" width="700" height="1" fill="#FFFFFF" fill-opacity="0.12"/>
    <path d="${domain.pathData}" fill="#6B6B74"/>
</svg>
`;

fs.mkdirSync(outDir, { recursive: true });
const target = path.join(outDir, "social-preview.svg");
fs.writeFileSync(target, svg, "utf8");
console.log(`[build-social-preview] wrote ${path.relative(root, target)}`);
