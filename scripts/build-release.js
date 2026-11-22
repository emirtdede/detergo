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
console.log(`[RELEASE] Detergo ${version} - Release build`);
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
  console.warn("[WARN] Could not read git metadata; build provenance cannot be verified.");
}

const allowDirty = process.argv.includes("--allow-dirty");
console.log(`[GIT] Commit: ${commit}`);
console.log(`[GIT] Branch: ${branch}`);
console.log(`[GIT] Dirty:  ${dirty}`);

if (dirty !== "false" && !allowDirty) {
  console.error(
    "\n[ERROR] Working tree is dirty. Release artifacts must be built from a\n" +
      "   clean committed revision. Commit your changes or (for local testing\n" +
      "   only) pass `npm run build:release -- --allow-dirty`.\n",
  );
  process.exit(1);
}
if (dirty !== "false") {
  console.warn(
    "[WARN] --allow-dirty: this build is for local testing only and must not be published.",
  );
}

console.log("\n[STEP 1/5] Cleaning previous release outputs...");
// Only stop copies that would lock the artefacts we are about to replace: the
// installed app and a previously unpacked portable build. A blanket
// `taskkill /IM detergo.exe` also killed the debug binary that
// `tauri dev` runs, so every release build silently took the dev session down
// with it (cargo reported "exit code: 0xffffffff").
try {
  execSync(
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "` +
      `Get-Process -Name detergo,'Detergo-${version}-Portable' -ErrorAction SilentlyContinue | ` +
      `Where-Object { $_.Path -and $_.Path -notlike '*\\target\\*' } | ` +
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
console.log("[CLEAN] Clearing generated Tauri ACL schemas and build cache...");
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
    if (entry.startsWith("detergo-")) {
      fs.rmSync(path.join(buildDir, entry), { recursive: true, force: true });
    }
  }
}

console.log("\n[STEP 2/5] Checking version sync and brand assets...");
execSync("npm run check-version", { cwd: rootDir, stdio: "inherit" });
execSync("npm run check:icons", { cwd: rootDir, stdio: "inherit" });
execSync("npm run check:brand", { cwd: rootDir, stdio: "inherit" });

const startedAt = Date.now();
const buildEnv = {
  ...process.env,
  CARGO_TARGET_DIR: cargoTargetDir,
  NC_BUILD_COMMIT: commit,
  NC_BUILD_DIRTY: dirty,
  NC_BUILD_TIME: String(Math.floor(startedAt / 1000)),
};

// NSIS only looks for language files inside its own installation, so the
// project-supplied packs have to be copied there before the bundle is compiled.
// A fresh machine (CI) has no NSIS toolset yet, and the bundler only fetches it
// while compiling a bundle - warm it first so the sync has somewhere to copy to.
execSync("npm run ensure:nsis-toolset", { cwd: rootDir, stdio: "inherit", env: buildEnv });
execSync("npm run sync:nsis-languages", { cwd: rootDir, stdio: "inherit" });
execSync("npm run check:languages", { cwd: rootDir, stdio: "inherit" });

console.log("\n[STEP 3/5] Building Tauri release, CLI console companion, and modern Setup.exe...");
execSync("npm run tauri build -- --bundles msi", { cwd: rootDir, stdio: "inherit", env: buildEnv });
// Build the Windows console-subsystem companion (`detergo.com` pattern,
// identical to Visual Studio `devenv.com` / `devenv.exe`) so terminal callers
// get synchronous stdout/stderr and clean exit codes without GUI flash.
execSync("cargo build --release --manifest-path src-tauri/Cargo.toml --bin detergo-cli", {
  cwd: rootDir,
  stdio: "inherit",
  env: buildEnv,
});
// Assemble the standalone frameless 640x420 monochrome Setup & Uninstaller EXE.
execSync("node scripts/build-setup.mjs", {
  cwd: rootDir,
  stdio: "inherit",
  env: buildEnv,
});

const targetDir = path.join(cargoTargetDir, "release");
const binary = path.join(targetDir, "detergo.exe");
const cliCompanion = path.join(targetDir, "detergo-cli.exe");
if (!fs.existsSync(binary)) {
  console.error(`[ERROR] Built binary not found: ${binary}`);
  process.exit(1);
}
if (fs.statSync(binary).mtimeMs < startedAt - 1000) {
  console.error(
    `[ERROR] Binary was not produced during this run (mtime: ${new Date(
      fs.statSync(binary).mtimeMs,
    ).toISOString()}). Refusing to package a stale executable.`,
  );
  process.exit(1);
}

function currentBundle(dir, version, suffix) {
  if (!fs.existsSync(dir)) return null;
  // Tauri leaves bundles from earlier versions in `target`; never let a stale
  // setup satisfy a newer build. The filename is `Detergo_<version>_<arch><suffix>`.
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
    destName: `Detergo-${version}-Portable.exe`,
    channel: "portable",
  },
  {
    src: cliCompanion,
    destName: `detergo.com`,
    channel: "cli",
  },
  {
    src: path.join(releaseOutputDir, `Detergo-${version}-x64-Setup.exe`),
    destName: `Detergo-${version}-x64-Setup.exe`,
    channel: "installer",
  },
  {
    src: currentBundle(path.join(targetDir, "bundle", "msi"), version, "\\.msi"),
    destName: `Detergo-${version}-x64.msi`,
    channel: "msi",
  },
];

console.log("\n[STEP 4/5] Copying release artifacts to release_output/...");
const copiedFiles = [];

for (const art of artifacts) {
  if (art.src && fs.existsSync(art.src)) {
    // A bundle from an earlier run must never be mixed with this build.
    if (fs.statSync(art.src).mtimeMs < startedAt - 1000) {
      console.error(`[ERROR] Stale artifact skipped (not built in this run): ${art.src}`);
      process.exit(1);
    }
    const destPath = path.join(releaseOutputDir, art.destName);
    if (path.resolve(art.src) !== path.resolve(destPath)) {
      fs.copyFileSync(art.src, destPath);
    }
    copiedFiles.push(art.destName);
    const sizeMb = (fs.statSync(destPath).size / (1024 * 1024)).toFixed(2);
    console.log(`  [OK] ${art.destName} (${sizeMb} MB)`);
  } else {
    console.warn(`  [WARN] Source artifact missing: ${art.destName}`);
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

console.log("\n[STEP 5/5] Computing SHA-256 checksums...");
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
const artifactRecords = copiedFiles.map((name) => {
  const p = path.join(releaseOutputDir, name);
  const spec = artifacts.find((a) => a.destName === name);
  return {
    name,
    channel: spec?.channel ?? null,
    bytes: fs.statSync(p).size,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").toUpperCase(),
  };
});

const buildInfo = {
  product: "Detergo",
  version,
  commit,
  branch,
  dirty: dirty === "true",
  builtAt: new Date(startedAt).toISOString(),
  buildTimeEpochSecs: Math.floor(startedAt / 1000),
  artifacts: artifactRecords.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })),
};
fs.writeFileSync(
  path.join(releaseOutputDir, "BUILD_INFO.json"),
  JSON.stringify(buildInfo, null, 2) + "\n",
  "utf8",
);

// The GitHub release body is the changelog entry for this version, not the
// whole file: the page should open with "1.0.0" and its highlights.
let releaseNotesText = "";
const changelogPath = path.join(rootDir, "docs", "CHANGELOG.md");
if (fs.existsSync(changelogPath)) {
  const changelog = fs.readFileSync(changelogPath, "utf8").replace(/\r\n/g, "\n");
  const start = changelog.indexOf(`## [${version}]`);
  const next = start === -1 ? -1 : changelog.indexOf("\n## [", start + 3);
  if (start !== -1) {
    releaseNotesText = changelog.slice(start, next === -1 ? undefined : next).trim();
    fs.writeFileSync(
      path.join(releaseOutputDir, "RELEASE_NOTES.md"),
      releaseNotesText + "\n",
      "utf8",
    );
    console.log(`  [NOTES] RELEASE_NOTES.md (${releaseNotesText.split("\n").length} lines)`);
  } else {
    console.warn(`  [WARN] docs/CHANGELOG.md has no "## [${version}]" section.`);
  }
}

// Static CDN update manifest (`releases/latest/download/latest-release.json`).
// Zero GitHub API rate limit and includes SHA-256 checksums for every channel.
const repoBase = "https://github.com/emirtdede/detergo";
const latestManifest = {
  version,
  releaseName: `Detergo ${version}`,
  releaseUrl: `${repoBase}/releases/tag/v${version}`,
  publishedAt: new Date(startedAt).toISOString(),
  notes: releaseNotesText,
  signed: false,
  assets: artifactRecords.map((art) => ({
    name: art.name,
    channel: art.channel,
    size: art.bytes,
    sha256: art.sha256,
    downloadUrl: `${repoBase}/releases/download/v${version}/${art.name}`,
  })),
};
fs.writeFileSync(
  path.join(releaseOutputDir, "latest-release.json"),
  JSON.stringify(latestManifest, null, 2) + "\n",
  "utf8",
);
console.log("  [MANIFEST] latest-release.json written (zero-rate-limit CDN feed)");

if (dirty !== "false") {
  console.log("\n[WARN] WARNING: source tree was dirty; these artifacts must not be published.");
}

console.log("\n=================================================");
console.log("[SUCCESS] RELEASE BUILD AND VERIFICATION COMPLETE!");
console.log(`[OUTPUT] ${releaseOutputDir}`);
console.log(`[BUILD] ${commit.slice(0, 7)} (${branch})`);
console.log("=================================================\n");
