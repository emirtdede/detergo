import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const releaseOutputDir = path.join(rootDir, "release_output");

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const version = pkg.version;

console.log("=================================================");
console.log(`[RELEASE] Dev Cleaner ${version} — Release build`);
console.log("=================================================\n");

// ---------------------------------------------------------
// 0. Build provenance gate
//
// A release artifact is only meaningful if it can be traced back to an exact
// commit. Until 2.0.0 the pipeline stamped nothing, so `release_output/` could
// (and did) contain binaries built from a different revision than the audited
// HEAD. Refuse to build from a dirty tree unless the operator explicitly
// accepts a non-traceable build.
// ---------------------------------------------------------
function git(args) {
  return execFileSync("git", args, { cwd: rootDir, encoding: "utf8" }).trim();
}

let commit = "unknown";
let dirty = "unknown";
let branch = "unknown";
try {
  commit = git(["rev-parse", "HEAD"]);
  branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  dirty = git(["status", "--porcelain"]).length > 0 ? "true" : "false";
} catch {
  console.warn("[WARN] git bilgisi okunamadı; derleme izlenebilirliği garanti edilemez.");
}

const allowDirty = process.argv.includes("--allow-dirty");
console.log(`[GIT] Commit: ${commit}`);
console.log(`[GIT] Branch: ${branch}`);
console.log(`[GIT] Dirty:  ${dirty}`);

if (dirty !== "false" && !allowDirty) {
  console.error(
    "\n[ERROR] Çalışma ağacı temiz değil. Yayın artefaktı yalnızca commit edilmiş bir\n" +
      "   kaynaktan üretilebilir. Değişiklikleri commit edin veya (yalnızca yerel\n" +
      "   test için) `npm run build:release -- --allow-dirty` kullanın.\n",
  );
  process.exit(1);
}
if (dirty !== "false") {
  console.warn("[WARN] --allow-dirty: bu derleme yayınlanamaz, yalnızca yerel test içindir.");
}

console.log("\n[STEP 1/5] Eski çıktılar temizleniyor...");
// Only stop copies that would lock the artefacts we are about to replace: the
// installed app and a previously unpacked portable build. A blanket
// `taskkill /IM node-cleaner.exe` also killed the debug binary that
// `tauri dev` runs, so every release build silently took the dev session down
// with it (cargo reported "exit code: 0xffffffff").
try {
  execSync(
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "` +
      `Get-Process -Name node-cleaner,'Node-Cleaner-${version}-Portable','Dev-Cleaner-${version}-Portable' -ErrorAction SilentlyContinue | ` +
      `Where-Object { $_.Path -and $_.Path -notlike '*node_cleaner_target*' -and $_.Path -notlike '*\\target\\*' } | ` +
      `Stop-Process -Force; exit 0"`,
    { stdio: "ignore" },
  );
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
console.log("[CLEAN] ACL ve derleme önbelleği temizleniyor...");
fs.rmSync(path.join(rootDir, "src-tauri", "gen", "schemas"), { recursive: true, force: true });

// Artifact directory: standard Cargo location unless the caller overrides it
// with CARGO_TARGET_DIR. No developer-specific absolute path is baked in.
const cargoTargetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.join(rootDir, "src-tauri", "target");
console.log(`[TARGET] Cargo target-dir: ${cargoTargetDir}`);

for (const profile of ["release", "debug"]) {
  const buildDir = path.join(cargoTargetDir, profile, "build");
  if (!fs.existsSync(buildDir)) continue;
  for (const entry of fs.readdirSync(buildDir)) {
    if (entry.startsWith("node-cleaner-")) {
      fs.rmSync(path.join(buildDir, entry), { recursive: true, force: true });
    }
  }
}

console.log("\n[STEP 2/5] Sürüm senkronizasyonu ve marka varlıkları kontrol ediliyor...");
execSync("npm run check-version", { cwd: rootDir, stdio: "inherit" });
execSync("npm run check:icons", { cwd: rootDir, stdio: "inherit" });
execSync("npm run check:brand", { cwd: rootDir, stdio: "inherit" });
execSync("npm run check:languages", { cwd: rootDir, stdio: "inherit" });

const startedAt = Date.now();
const buildEnv = {
  ...process.env,
  CARGO_TARGET_DIR: cargoTargetDir,
  NC_BUILD_COMMIT: commit,
  NC_BUILD_DIRTY: dirty,
  NC_BUILD_TIME: String(Math.floor(startedAt / 1000)),
};

console.log("\n[STEP 3/5] Tauri release derlemesi başlatılıyor...");
execSync("npm run tauri build", { cwd: rootDir, stdio: "inherit", env: buildEnv });

const targetDir = path.join(cargoTargetDir, "release");
const binary = path.join(targetDir, "node-cleaner.exe");
if (!fs.existsSync(binary)) {
  console.error(`[ERROR] Derleme çıktısı bulunamadı: ${binary}`);
  process.exit(1);
}
if (fs.statSync(binary).mtimeMs < startedAt - 1000) {
  console.error(
    `[ERROR] Derleme çıktısı bu çalıştırmada üretilmedi (mtime: ${new Date(
      fs.statSync(binary).mtimeMs,
    ).toISOString()}). Eski bir binary paketlenmesin.`,
  );
  process.exit(1);
}

function currentBundle(dir, version, suffix) {
  if (!fs.existsSync(dir)) return null;
  // Tauri leaves bundles from earlier versions in `target`; never let a stale
  // 2.2.1 setup satisfy a 2.2.2 build. The filename is
  // `Dev Cleaner_<version>_<arch><suffix>`.
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`_${escapedVersion}_.*${suffix}$`, "i");
  const matches = fs
    .readdirSync(dir)
    .filter((name) => pattern.test(name))
    .sort();
  return matches.length > 0 ? path.join(dir, matches[0]) : null;
}

const artifacts = [
  {
    src: binary,
    destName: `Dev-Cleaner-${version}-Portable.exe`,
  },
  {
    src: currentBundle(path.join(targetDir, "bundle", "nsis"), version, "-setup\\.exe"),
    destName: `Dev-Cleaner-${version}-x64-Setup.exe`,
  },
  {
    src: currentBundle(path.join(targetDir, "bundle", "msi"), version, "\\.msi"),
    destName: `Dev-Cleaner-${version}-x64.msi`,
  },
];

console.log("\n[STEP 4/5] Paketler release_output klasörüne aktarılıyor...");
const copiedFiles = [];

for (const art of artifacts) {
  if (art.src && fs.existsSync(art.src)) {
    // A bundle from an earlier run must never be mixed with this build.
    if (fs.statSync(art.src).mtimeMs < startedAt - 1000) {
      console.error(`[ERROR] Eski paket atlandı (bu çalıştırmada üretilmedi): ${art.src}`);
      process.exit(1);
    }
    const destPath = path.join(releaseOutputDir, art.destName);
    fs.copyFileSync(art.src, destPath);
    copiedFiles.push(art.destName);
    const sizeMb = (fs.statSync(destPath).size / (1024 * 1024)).toFixed(2);
    console.log(`  [OK] ${art.destName} (${sizeMb} MB)`);
  } else {
    console.warn(`  [WARN] Kaynak bulunamadı: ${art.destName}`);
    process.exit(1);
  }
}

const verifyScript = path.join(rootDir, "scripts", "verify-checksums.bat");
if (fs.existsSync(verifyScript)) {
  fs.copyFileSync(verifyScript, path.join(releaseOutputDir, "verify-checksums.bat"));
}

// Release gate: the built EXEs must actually carry all 15 ICO frames. NSIS and
// the PE resource compiler silently accept a source ICO and then omit frames;
// checking the source file is not enough.
const exeArtifacts = copiedFiles.filter((name) => name.toLowerCase().endsWith(".exe"));
execFileSync(
  process.execPath,
  [
    path.join(rootDir, "scripts", "check-exe-icons.mjs"),
    ...exeArtifacts.map((name) => path.join(releaseOutputDir, name)),
  ],
  { cwd: rootDir, stdio: "inherit" },
);

console.log("\n[STEP 5/5] SHA-256 özetleri hesaplanıyor...");
const checksumLines = [];
for (const fileName of copiedFiles) {
  const filePath = path.join(releaseOutputDir, fileName);
  const hash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex")
    .toUpperCase();
  checksumLines.push(`${hash}  ${fileName}`);
  console.log(`  [HASH] ${fileName} -> ${hash}`);
}
fs.writeFileSync(
  path.join(releaseOutputDir, "SHA256SUMS.txt"),
  checksumLines.join("\n") + "\n",
  "utf8",
);

// Provenance record shipped next to the packages so a download can be matched
// to the source revision without reading the binary.
const buildInfo = {
  product: "Dev Cleaner",
  version,
  commit,
  branch,
  dirty: dirty === "true",
  builtAt: new Date(startedAt).toISOString(),
  buildTimeEpochSecs: Math.floor(startedAt / 1000),
  artifacts: copiedFiles.map((name) => {
    const p = path.join(releaseOutputDir, name);
    return {
      name,
      bytes: fs.statSync(p).size,
      sha256: crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").toUpperCase(),
    };
  }),
};
fs.writeFileSync(
  path.join(releaseOutputDir, "BUILD_INFO.json"),
  JSON.stringify(buildInfo, null, 2) + "\n",
  "utf8",
);

if (dirty !== "false") {
  console.log("\n[WARN] BU UYARI: kaynak ağacı kirliydi; bu paketler yayınlanamaz.");
}

console.log("\n=================================================");
console.log("[SUCCESS] RELEASE DERLEMESİ VE DOĞRULAMA TAMAMLANDI!");
console.log(`[OUTPUT] ${releaseOutputDir}`);
console.log(`[BUILD] ${commit.slice(0, 7)} (${branch})`);
console.log("=================================================\n");
