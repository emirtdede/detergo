#!/usr/bin/env node
/**
 * Build provenance gate (E1-06).
 *
 * `npm run build:release` writes `release_output/BUILD_INFO.json` next to the
 * installers. Before those artifacts are published, the recorded commit must be
 * the current HEAD and the tree must have been clean at build time, otherwise
 * the package cannot be traced back to a source revision.
 *
 * Run with: npm run check:build-info
 * Optional: node scripts/check-build-info.mjs <path-to-BUILD_INFO.json>
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const infoPath = resolve(root, process.argv[2] ?? "release_output/BUILD_INFO.json");

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

if (!existsSync(infoPath)) {
  fail(
    `BUILD_INFO.json not found at ${infoPath}. Run \`npm run build:release\` first; this gate only applies to a real release build.`,
  );
}

const info = JSON.parse(readFileSync(infoPath, "utf8"));
const pkgVersion = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;

const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
}).trim();

if (info.version !== pkgVersion) {
  fail(`BUILD_INFO version ${info.version} != package.json ${pkgVersion}.`);
}
if (info.commit !== head) {
  fail(`BUILD_INFO commit ${info.commit} != HEAD ${head}. Rebuild from the tagged commit.`);
}
if (info.dirty !== false) {
  fail("BUILD_INFO says the tree was dirty at build time; this package cannot be published.");
}
if (dirty) {
  fail("Working tree is dirty now. Commit or stash before publishing the recorded build.");
}

console.log(
  `Build provenance OK: version ${info.version}, commit ${head.slice(0, 7)}, clean tree, ${info.artifacts?.length ?? 0} artifact(s).`,
);
