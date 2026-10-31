import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const releaseOutputDir = path.join(rootDir, "release_output");

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const version = pkg.version;

console.log("=================================================");
console.log(`🚀 Node Cleaner ${version} — Release build`);
console.log("=================================================\n");

console.log("🧹 0. Eski çıktılar temizleniyor...");
try {
  execSync(`taskkill /F /IM node-cleaner.exe /IM Node-Cleaner-${version}-Portable.exe 2>nul`, {
    stdio: "ignore",
  });
} catch {}

if (fs.existsSync(releaseOutputDir)) {
  for (const f of fs.readdirSync(releaseOutputDir)) {
    try {
      fs.unlinkSync(path.join(releaseOutputDir, f));
    } catch {}
  }
} else {
  fs.mkdirSync(releaseOutputDir, { recursive: true });
}

// A stale or partial build-script output previously produced a binary whose
// runtime ACL authority was empty, so every window control and drag command was
// rejected ("not allowed by ACL"). Regenerate the capability set on every
// release build.
console.log("🧹 ACL ve derleme önbelleği temizleniyor...");
fs.rmSync(path.join(rootDir, "src-tauri", "gen", "schemas"), { recursive: true, force: true });

let cargoTargetDir = path.join(rootDir, "src-tauri", "target");
try {
  const match = fs
    .readFileSync(path.join(rootDir, ".cargo", "config.toml"), "utf8")
    .match(/^target-dir\s*=\s*"(.+)"$/m);
  if (match) cargoTargetDir = match[1].replace(/\\\\/g, "\\");
} catch {}
for (const profile of ["release", "debug"]) {
  const buildDir = path.join(cargoTargetDir, profile, "build");
  if (!fs.existsSync(buildDir)) continue;
  for (const entry of fs.readdirSync(buildDir)) {
    if (entry.startsWith("node-cleaner-")) {
      fs.rmSync(path.join(buildDir, entry), { recursive: true, force: true });
    }
  }
}

console.log("\n📦 1. Sürüm senkronizasyonu kontrol ediliyor...");
execSync("npm run check-version", { cwd: rootDir, stdio: "inherit" });

console.log("\n🔨 2. Tauri release derlemesi başlatılıyor...");
execSync("npm run tauri build", { cwd: rootDir, stdio: "inherit" });

const candidates = [
  "C:\\Users\\emir\\AppData\\Local\\Temp\\node_cleaner_target\\release",
  path.join(rootDir, "src-tauri", "target", "release"),
];
const targetDir = candidates.find((dir) =>
  fs.existsSync(path.join(dir, "node-cleaner.exe"))
);
if (!targetDir) {
  console.error("❌ Derleme çıktısı (node-cleaner.exe) bulunamadı!");
  process.exit(1);
}

function firstMatch(dir, pattern) {
  if (!fs.existsSync(dir)) return null;
  const found = fs.readdirSync(dir).find((name) => pattern.test(name));
  return found ? path.join(dir, found) : null;
}

const artifacts = [
  {
    src: path.join(targetDir, "node-cleaner.exe"),
    destName: `Node-Cleaner-${version}-Portable.exe`,
  },
  {
    src: firstMatch(path.join(targetDir, "bundle", "nsis"), /-setup\.exe$/i),
    destName: `Node-Cleaner-${version}-x64-Setup.exe`,
  },
  {
    src: firstMatch(path.join(targetDir, "bundle", "msi"), /\.msi$/i),
    destName: `Node-Cleaner-${version}-x64.msi`,
  },
];

console.log("\n📂 3. Paketler release_output klasörüne aktarılıyor...");
const copiedFiles = [];

for (const art of artifacts) {
  if (art.src && fs.existsSync(art.src)) {
    const destPath = path.join(releaseOutputDir, art.destName);
    fs.copyFileSync(art.src, destPath);
    copiedFiles.push(art.destName);
    const sizeMb = (fs.statSync(destPath).size / (1024 * 1024)).toFixed(2);
    console.log(`  ✓ ${art.destName} (${sizeMb} MB)`);
  } else {
    console.warn(`  ⚠️ Kaynak bulunamadı: ${art.destName}`);
  }
}

const verifyScript = path.join(rootDir, "scripts", "verify-checksums.bat");
if (fs.existsSync(verifyScript)) {
  fs.copyFileSync(verifyScript, path.join(releaseOutputDir, "verify-checksums.bat"));
}

console.log("\n🔐 4. SHA-256 özetleri hesaplanıyor...");
const checksumLines = [];
for (const fileName of copiedFiles) {
  const filePath = path.join(releaseOutputDir, fileName);
  const hash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").toUpperCase();
  checksumLines.push(`${hash}  ${fileName}`);
  console.log(`  🔑 ${fileName} -> ${hash}`);
}
fs.writeFileSync(path.join(releaseOutputDir, "SHA256SUMS.txt"), checksumLines.join("\n") + "\n", "utf8");

console.log("\n=================================================");
console.log("🎉 RELEASE DERLEMESİ VE DOĞRULAMA TAMAMLANDI!");
console.log(`📁 ${releaseOutputDir}`);
console.log("=================================================\n");
