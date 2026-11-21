#!/usr/bin/env node
/**
 * Deterministic brand asset generator.
 *
 * Windows-only: it invokes the Tauri icon generator and uses sharp, which is
 * pinned to an exact version. CI runs the structural checks only; it never
 * regenerates binaries.
 *
 * Usage:
 *   npm run generate:icons
 *   node scripts/generate-icons.mjs --allow-nonwindows   # preview only
 */
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { encodeBmp24 } from "./lib/bmp.mjs";
import { encodeDib, encodeIco } from "./lib/ico.mjs";
import { innerSvg, stripDataLayer } from "./lib/svg.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowNonWindows = process.argv.includes("--allow-nonwindows");
const skipTauriIcons = process.argv.includes("--skip-tauri-icons");

if (process.platform !== "win32" && !allowNonWindows) {
  console.error("[generate-icons] Windows is required. Use --allow-nonwindows only for previews.");
  process.exit(1);
}

const masterPath = path.join(root, "assets", "brand", "detergo-icon.svg");
const glyphPath = path.join(root, "assets", "brand", "detergo-glyph.svg");
const socialPath = path.join(root, "assets", "brand", "github", "social-preview.svg");
const installerDir = path.join(root, "assets", "brand", "installer");
const iconsDir = path.join(root, "src-tauri", "icons");
const pngOptions = { compressionLevel: 9, adaptiveFiltering: false, palette: false };

const ICO_SIZES = [16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 128, 256];
const TRAY_SIZES = [16, 20, 24, 28, 32, 36, 40, 48];
const DIB_SIZES = ICO_SIZES.filter((size) => size !== 256);

const masterSvg = read(masterPath);
const simpleSvg = stripDataLayer(masterSvg, "detail");
const glyphSvg = read(glyphPath);

const outputs = {};

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function write(relativePath, data) {
  const absolute = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, data);
  outputs[relativePath.replaceAll("\\", "/")] = sha256(data);
}

async function renderBase(svg, density = 288) {
  return sharp(Buffer.from(svg), { density }).png(pngOptions).toBuffer();
}

async function resizePng(base, size) {
  return sharp(base)
    .resize(size, size, { kernel: "lanczos3", fit: "fill" })
    .png(pngOptions)
    .toBuffer();
}

async function resizeRgba(base, size) {
  return sharp(base)
    .resize(size, size, { kernel: "lanczos3", fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();
}

async function renderBmp(svgPath, width, height, relativePath) {
  const svg = fs.readFileSync(svgPath);
  const rendered = await sharp(svg, { density: 288 })
    .resize(width, height, { fit: "fill" })
    .flatten({ background: "#FFFFFF" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (rendered.info.channels !== 3) {
    throw new Error(`Unexpected BMP render channels: ${rendered.info.channels}`);
  }
  write(relativePath, encodeBmp24(rendered.data, width, height, 3));
}

function requireFile(file) {
  if (!fs.existsSync(file))
    throw new Error(`Missing required source: ${path.relative(root, file)}`);
}

for (const file of [
  masterPath,
  glyphPath,
  socialPath,
  path.join(installerDir, "sidebar.svg"),
  path.join(installerDir, "header.svg"),
  path.join(installerDir, "unheader.svg"),
  path.join(installerDir, "wix-banner.svg"),
  path.join(installerDir, "wix-dialog.svg"),
]) {
  requireFile(file);
}

console.log("[generate-icons] Rendering master at 4x ...");
const masterBase = await renderBase(masterSvg);
const simpleBase = await renderBase(simpleSvg);

// 1024 master for tauri icon and GitHub.
const icon1024 = await resizePng(masterBase, 1024);
write("assets/brand/detergo-icon-1024.png", icon1024);
write("assets/brand/detergo-icon-256.png", await resizePng(masterBase, 256));
write("docs/brand/detergo-icon.png", await resizePng(masterBase, 512));

// Standard Tauri set. Wipe the directory so no legacy identity can survive.
if (!skipTauriIcons) {
  if (process.platform === "win32") {
    console.log("[generate-icons] Regenerating the standard Tauri icon set ...");
    fs.rmSync(iconsDir, { recursive: true, force: true });
    fs.mkdirSync(iconsDir, { recursive: true });
    execSync(
      `npx tauri icon "${path.join(root, "assets", "brand", "detergo-icon-1024.png")}" --output "${iconsDir}"`,
      { cwd: root, stdio: "inherit" },
    );
    // Desktop-only product: drop the mobile sets tauri icon creates.
    for (const mobile of ["ios", "android"]) {
      fs.rmSync(path.join(iconsDir, mobile), { recursive: true, force: true });
    }
  } else {
    console.log("[generate-icons] Skipping tauri icon on non-Windows.");
  }
}

write("src-tauri/icons/32x32.png", await resizePng(masterBase, 32));
write("src-tauri/icons/128x128.png", await resizePng(masterBase, 128));
write("src-tauri/icons/128x128@2x.png", await resizePng(masterBase, 256));
write("src-tauri/icons/icon.png", await resizePng(masterBase, 512));

// Custom 15-frame ICO: 16-first, DIB below 256, PNG for 256.
const icoFrames = [];
for (const size of DIB_SIZES) {
  const base = size < 32 ? simpleBase : masterBase;
  icoFrames.push({ size, rgba: await resizeRgba(base, size) });
}
icoFrames.push({ size: 256, png: await resizePng(masterBase, 256) });
write("src-tauri/icons/icon.ico", encodeIco(icoFrames));

// Tray PNGs. Below 32 px the rim/track layer is removed.
for (const size of TRAY_SIZES) {
  const base = size < 32 ? simpleBase : masterBase;
  write(`src-tauri/icons/tray-${size}.png`, await resizePng(base, size));
}

// favicon.ico 16/32/48, plus an SVG that mirrors the simplified master.
const faviconFrames = [];
for (const size of [16, 32, 48]) {
  faviconFrames.push({ size, rgba: await resizeRgba(size < 32 ? simpleBase : masterBase, size) });
}
write("public/favicon.ico", encodeIco(faviconFrames));
write("public/favicon.svg", simpleSvg);
write("public/icons/notification.png", await resizePng(masterBase, 256));

// Installer bitmaps.
await renderBmp(path.join(installerDir, "sidebar.svg"), 164, 314, "src-tauri/nsis/sidebar.bmp");
await renderBmp(path.join(installerDir, "header.svg"), 150, 57, "src-tauri/nsis/header.bmp");
await renderBmp(path.join(installerDir, "unheader.svg"), 150, 57, "src-tauri/nsis/unheader.bmp");
await renderBmp(path.join(installerDir, "wix-banner.svg"), 493, 58, "src-tauri/wix/banner.bmp");
await renderBmp(path.join(installerDir, "wix-dialog.svg"), 493, 312, "src-tauri/wix/dialog.bmp");

// GitHub art. The avatar keeps the icon inside a circle-safe 1024 canvas.
const avatarSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <rect width="1024" height="1024" fill="#07070A"/>
    <g transform="translate(92 92) scale(1.640625)">${innerSvg(masterSvg)}</g>
</svg>`;
write("assets/brand/github/avatar-1024.png", await resizePng(await renderBase(avatarSvg), 1024));
const socialBase = await renderBase(read(socialPath), 144);
const socialPng = await sharp(socialBase)
  .resize(1280, 640, { kernel: "lanczos3", fit: "fill" })
  .png(pngOptions)
  .toBuffer();
write("assets/brand/github/social-preview.png", socialPng);

// Manifest: only deterministic outputs, no timestamps.
const manifest = {
  generatedBy: "scripts/generate-icons.mjs",
  sharp: sharp.versions.sharp,
  libvips: sharp.versions.vips,
  platform: process.platform,
  arch: process.arch,
  master: "assets/brand/detergo-icon.svg",
  masterSha256: sha256(masterSvg),
  icoSizes: ICO_SIZES,
  traySizes: TRAY_SIZES,
  bmpSizes: {
    "src-tauri/nsis/sidebar.bmp": [164, 314],
    "src-tauri/nsis/header.bmp": [150, 57],
    "src-tauri/nsis/unheader.bmp": [150, 57],
    "src-tauri/wix/banner.bmp": [493, 58],
    "src-tauri/wix/dialog.bmp": [493, 312],
  },
  outputs: Object.fromEntries(Object.entries(outputs).sort(([a], [b]) => a.localeCompare(b))),
};
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
fs.writeFileSync(path.join(root, "assets", "brand", "icon-manifest.json"), manifestText, "utf8");

console.log(`[generate-icons] Wrote ${Object.keys(outputs).length} deterministic outputs.`);
console.log(`[generate-icons] sharp ${sharp.versions.sharp}, libvips ${sharp.versions.vips}.`);
