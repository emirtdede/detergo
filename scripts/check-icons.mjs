#!/usr/bin/env node
/**
 * Structural icon checks. Runs on Linux CI: no sharp, no Windows APIs, only
 * bytes. The generator is the only thing allowed to create these files.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseBmp } from "./lib/bmp.mjs";
import { parseIco } from "./lib/ico.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const ICO_SIZES = [16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 128, 256];
const TRAY_SIZES = [16, 20, 24, 28, 32, 36, 40, 48];

function fail(message) {
  errors.push(message);
}

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) {
    fail(`missing: ${relativePath}`);
    return null;
  }
  return fs.readFileSync(absolute);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function pngInfo(buffer, label) {
  if (!buffer || buffer.length < 33) {
    fail(`${label}: PNG is truncated`);
    return null;
  }
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    fail(`${label}: bad PNG signature`);
    return null;
  }
  if (buffer.toString("ascii", 12, 16) !== "IHDR") {
    fail(`${label}: first chunk is not IHDR`);
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
  };
}

const manifestBuffer = read("assets/brand/icon-manifest.json");
let manifest = null;
if (manifestBuffer) {
  try {
    manifest = JSON.parse(manifestBuffer.toString("utf8"));
  } catch (error) {
    fail(`icon-manifest.json is not valid JSON: ${error.message}`);
  }
}

if (manifest) {
  for (const [relativePath, expectedHash] of Object.entries(manifest.outputs ?? {})) {
    const buffer = read(relativePath);
    if (buffer && sha256(buffer) !== expectedHash) {
      fail(`${relativePath}: hash does not match icon-manifest.json`);
    }
  }
  const master = read(manifest.master);
  if (master && sha256(master) !== manifest.masterSha256) {
    fail("master SVG hash does not match icon-manifest.json");
  }
}

// Custom app ICO.
const icoBuffer = read("src-tauri/icons/icon.ico");
if (icoBuffer) {
  if (icoBuffer.length >= 250 * 1024) {
    fail(`icon.ico is ${icoBuffer.length} bytes; keep it below 250 KiB`);
  }
  try {
    const parsed = parseIco(icoBuffer);
    const sizes = parsed.frames.map((frame) => frame.size);
    if (JSON.stringify(sizes) !== JSON.stringify(ICO_SIZES)) {
      fail(`icon.ico sizes are ${sizes.join(",")}; expected ${ICO_SIZES.join(",")}`);
    }
    if (parsed.frames[0]?.size !== 16) fail("icon.ico must start with the 16 px frame");
    for (const frame of parsed.frames) {
      if (frame.bitCount !== 32) fail(`icon.ico frame ${frame.size}: bit count ${frame.bitCount}`);
      if (frame.size === 256) {
        if (frame.format !== "png") fail("icon.ico 256 frame must be PNG");
        const payload = icoBuffer.subarray(frame.offset, frame.offset + frame.bytes);
        const info = pngInfo(payload, "icon.ico:256");
        if (info && (info.width !== 256 || info.height !== 256 || info.colorType !== 6)) {
          fail("icon.ico 256 PNG must be 256x256 RGBA");
        }
      } else {
        if (frame.format !== "dib") fail(`icon.ico frame ${frame.size} must be a DIB`);
        if (frame.dibHeight !== frame.size * 2) {
          fail(`icon.ico frame ${frame.size}: DIB height ${frame.dibHeight} != ${frame.size * 2}`);
        }
      }
    }
    parsed.frames.forEach((frame, index) => {
      const expectedOffset =
        index === 0
          ? 6 + parsed.count * 16
          : parsed.frames[index - 1].offset + parsed.frames[index - 1].bytes;
      if (frame.offset !== expectedOffset) {
        fail(`icon.ico frame ${frame.size}: offset ${frame.offset} is not contiguous`);
      }
    });
  } catch (error) {
    fail(`icon.ico: ${error.message}`);
  }
}

// Tray PNGs.
for (const size of TRAY_SIZES) {
  const relativePath = `src-tauri/icons/tray-${size}.png`;
  const buffer = read(relativePath);
  if (!buffer) continue;
  const info = pngInfo(buffer, relativePath);
  if (info && (info.width !== size || info.height !== size || info.colorType !== 6)) {
    fail(`${relativePath}: expected ${size}x${size} RGBA`);
  }
}

// favicon ICO.
const faviconBuffer = read("public/favicon.ico");
if (faviconBuffer) {
  try {
    const parsed = parseIco(faviconBuffer);
    const sizes = parsed.frames.map((frame) => frame.size);
    if (JSON.stringify(sizes) !== JSON.stringify([16, 32, 48])) {
      fail(`favicon.ico sizes are ${sizes.join(",")}; expected 16,32,48`);
    }
  } catch (error) {
    fail(`favicon.ico: ${error.message}`);
  }
}

// Standard icon dimensions used by tauri.conf.json.
const standardPngs = {
  "src-tauri/icons/32x32.png": 32,
  "src-tauri/icons/128x128.png": 128,
  "src-tauri/icons/128x128@2x.png": 256,
  "src-tauri/icons/icon.png": 512,
  "assets/brand/dev-cleaner-icon-256.png": 256,
  "assets/brand/dev-cleaner-icon-1024.png": 1024,
  "assets/brand/github/avatar-1024.png": 1024,
  "assets/brand/github/social-preview.png": null,
  "public/icons/notification.png": 256,
};
for (const [relativePath, expected] of Object.entries(standardPngs)) {
  const buffer = read(relativePath);
  if (!buffer) continue;
  const info = pngInfo(buffer, relativePath);
  if (!info) continue;
  if (expected !== null && (info.width !== expected || info.height !== expected)) {
    fail(`${relativePath}: expected ${expected}x${expected}, got ${info.width}x${info.height}`);
  }
  if (relativePath.endsWith("social-preview.png") && (info.width !== 1280 || info.height !== 640)) {
    fail(`${relativePath}: expected 1280x640, got ${info.width}x${info.height}`);
  }
}

// Installer bitmaps.
for (const [relativePath, [width, height]] of Object.entries(manifest?.bmpSizes ?? {})) {
  const buffer = read(relativePath);
  if (!buffer) continue;
  try {
    const parsed = parseBmp(buffer);
    if (parsed.width !== width || parsed.height !== height) {
      fail(`${relativePath}: expected ${width}x${height}, got ${parsed.width}x${parsed.height}`);
    }
  } catch (error) {
    fail(`${relativePath}: ${error.message}`);
  }
}

// Platform assets produced by `tauri icon` must exist and be non-empty.
for (const relativePath of [
  "src-tauri/icons/icon.icns",
  "src-tauri/icons/StoreLogo.png",
  "src-tauri/icons/Square150x150Logo.png",
]) {
  const buffer = read(relativePath);
  if (buffer && buffer.length === 0) fail(`${relativePath}: empty file`);
}

// No fallback icon may creep back in.
if (fs.existsSync(path.join(root, "src-tauri/icons/setup.ico"))) {
  fail("src-tauri/icons/setup.ico must not exist; one 15-frame ICO is used everywhere");
}

if (errors.length > 0) {
  console.error(`[check-icons] FAIL (${errors.length})`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(
  `[check-icons] PASS — 15-frame ICO, ${TRAY_SIZES.length} tray PNGs, 5 BMPs, manifest hashes.`,
);
