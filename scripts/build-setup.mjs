#!/usr/bin/env node
/**
 * Builds the standalone frameless monochrome `Detergo-<version>-x64-Setup.exe`:
 *   1. Builds the setup frontend (`vite.setup.config.ts` -> `dist-setup/`).
 *   2. Compiles `setup-tauri` (`detergo-setup.exe`, carrying the 15-frame ICO).
 *   3. Packages `{ detergo.exe, detergo.com, app.ico }` into a deflate ZIP
 *      archive and appends it + 24-byte `DTGSFX01` trailer to `detergo-setup.exe`.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const version = pkg.version;

const cargoTargetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.join(rootDir, "src-tauri", "target");

const setupTargetDir = path.join(rootDir, "setup-tauri", "target");
const mainReleaseDir = path.join(cargoTargetDir, "release");
const outDir = path.join(rootDir, "release_output");

const mainExe = path.join(mainReleaseDir, "detergo.exe");
const cliExe = path.join(mainReleaseDir, "detergo-cli.exe");
const iconIco = path.join(rootDir, "src-tauri", "icons", "icon.ico");

for (const required of [mainExe, cliExe, iconIco]) {
  if (!fs.existsSync(required)) {
    console.error(`[build-setup] missing required payload file: ${required}`);
    process.exit(1);
  }
}

console.log("[SETUP 1/3] Building frameless monochrome setup UI (dist-setup/)...");
execSync("npx vite build --config vite.setup.config.ts", { cwd: rootDir, stdio: "inherit" });

console.log("[SETUP 2/3] Compiling detergo-setup.exe (Tauri 2 frameless stub)...");
execSync("cargo build --release --manifest-path setup-tauri/Cargo.toml", {
  cwd: rootDir,
  stdio: "inherit",
});

const stubExe = path.join(setupTargetDir, "release", "detergo-setup.exe");
if (!fs.existsSync(stubExe)) {
  console.error(`[build-setup] compiled stub missing: ${stubExe}`);
  process.exit(1);
}

console.log("[SETUP 3/3] Creating compressed SFX payload and assembling Setup.exe...");

/** Minimal zero-dependency CRC32 + Deflate ZIP writer compatible with Rust `zip::ZipArchive`. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const raw = entry.data;
    const compressed = zlib.deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8); // Deflate
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localParts.push(localHeader, compressed);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

const zipBuffer = buildZipBuffer([
  { name: "detergo.exe", data: fs.readFileSync(mainExe) },
  { name: "detergo.com", data: fs.readFileSync(cliExe) },
  { name: "app.ico", data: fs.readFileSync(iconIco) },
]);

const stubBuffer = fs.readFileSync(stubExe);
const footer = Buffer.alloc(24);
footer.write("DTGSFX01", 0, 8, "ascii");
footer.writeBigUInt64LE(BigInt(stubBuffer.length), 8);
footer.writeBigUInt64LE(BigInt(zipBuffer.length), 16);

fs.mkdirSync(outDir, { recursive: true });
const outSetupPath = path.join(outDir, `Detergo-${version}-x64-Setup.exe`);
fs.writeFileSync(outSetupPath, Buffer.concat([stubBuffer, zipBuffer, footer]));

const mb = (fs.statSync(outSetupPath).size / (1024 * 1024)).toFixed(2);
console.log(`[SETUP OK] ${outSetupPath} (${mb} MB)`);
