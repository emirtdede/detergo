import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// 1. package.json
const pkgPath = path.join(rootDir, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const pkgVersion = pkg.version;

// 2. tauri.conf.json
const tauriPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
const tauriConf = JSON.parse(fs.readFileSync(tauriPath, "utf8"));
const tauriVersion = tauriConf.version;

// 3. Cargo.toml
const cargoPath = path.join(rootDir, "src-tauri", "Cargo.toml");
const cargoContent = fs.readFileSync(cargoPath, "utf8");
const cargoMatch = cargoContent.match(/version\s*=\s*"([^"]+)"/);
const cargoVersion = cargoMatch ? cargoMatch[1] : null;

console.log("--- Version Consistency Check ---");
console.log(`package.json:        ${pkgVersion}`);
console.log(`tauri.conf.json:     ${tauriVersion}`);
console.log(`Cargo.toml:          ${cargoVersion}`);

if (!pkgVersion || !tauriVersion || !cargoVersion) {
  console.error("[ERROR] Error: Could not read version from one or more configuration files.");
  process.exit(1);
}

if (pkgVersion !== tauriVersion || pkgVersion !== cargoVersion) {
  console.error("[ERROR] Error: Version mismatch detected across configuration files!");
  process.exit(1);
}

// 4. CLI / MCP must read the version from build info, never hardcode it.
//    A hardcoded literal here silently reports the previous release.
const rustVersionTargets = [
  path.join(rootDir, "src-tauri", "src", "cli", "mod.rs"),
  path.join(rootDir, "src-tauri", "src", "mcp", "mod.rs"),
];
const semverLiteral = /\b\d+\.\d+\.\d+\b/;
let hardcoded = false;
for (const target of rustVersionTargets) {
  if (!fs.existsSync(target)) continue;
  const source = fs.readFileSync(target, "utf8");
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    // Ignore comments: only executable string literals matter.
    const code = line.replace(/\/\/.*$/, "");
    if (!code.includes('"')) return;
    if (semverLiteral.test(code)) {
      console.error(
        `[ERROR] Hardcoded version literal in ${path.relative(rootDir, target)}:${index + 1}: ${line.trim()}`,
      );
      hardcoded = true;
    }
  });
}
if (hardcoded) {
  console.error("[ERROR] Use build_info / CARGO_PKG_VERSION instead of a literal.");
  process.exit(1);
}

console.log(`[OK] All version declarations are 100% synchronized (${pkgVersion})!`);
process.exit(0);
