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

/**
 * A recorded build belongs to one commit. Right before publishing that commit is
 * HEAD, so the check is exact. Afterwards documentation and test commits keep
 * arriving, and demanding HEAD equality would leave the gate red forever — so a
 * build commit that is tagged and still an ancestor of HEAD is accepted too. The
 * provenance claim is unchanged: the artifacts trace back to that exact, clean,
 * tagged revision.
 */
function tagOfCommit(commit) {
  try {
    return execFileSync("git", ["tag", "--points-at", commit], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

function isAncestor(commit) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, head], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

if (info.version !== pkgVersion) {
  fail(`BUILD_INFO version ${info.version} != package.json ${pkgVersion}.`);
}
const exactHead = info.commit === head;
const releasedTag = exactHead ? "" : tagOfCommit(info.commit);
if (!exactHead && !(releasedTag && isAncestor(info.commit))) {
  fail(
    `BUILD_INFO commit ${info.commit} is neither HEAD (${head}) nor a tagged ancestor of it. Rebuild from the tagged commit.`,
  );
}
if (info.dirty !== false) {
  fail("BUILD_INFO says the tree was dirty at build time; this package cannot be published.");
}
if (dirty) {
  fail("Working tree is dirty now. Commit or stash before publishing the recorded build.");
}

const provenance = exactHead
  ? `commit ${head.slice(0, 7)}`
  : `commit ${info.commit.slice(0, 7)} (published as ${releasedTag.split("\n").join(", ")}, HEAD has moved on)`;

console.log(
  `Build provenance OK: version ${info.version}, ${provenance}, clean tree, ${info.artifacts?.length ?? 0} artifact(s).`,
);
