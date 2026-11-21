#!/usr/bin/env node
/**
 * Makes sure the NSIS toolset exists before the release pipeline needs it.
 *
 * The Tauri bundler downloads NSIS lazily, the first time it compiles an NSIS
 * installer. Our installer ships 53 extra languages, and `MUI_LANGUAGE` only
 * reads language files from inside the NSIS installation, so the project packs
 * have to be copied there *before* any bundle is compiled. On a developer
 * machine NSIS is already installed from an earlier build and this script is a
 * no-op; on a fresh CI runner that ordering deadlocks (sync needs NSIS, NSIS is
 * only fetched by the bundler).
 *
 * The warm-up therefore builds one throwaway English-only installer with
 * Tauri's own downloader. The toolset it installs is the exact one the real
 * bundle uses - nothing is pinned or re-implemented here - and the real build
 * then reuses the already-compiled app binary, so the only extra cost is the
 * installer compile.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { nsisToolsetDir } from "./lib/nsis-toolset.mjs";

const require = createRequire(import.meta.url);
const tauriCli = join(require.resolve("@tauri-apps/cli/package.json"), "..", "tauri.js");
const makensis = join(nsisToolsetDir(), "makensis.exe");

function run(args, env) {
  execFileSync(process.execPath, [tauriCli, ...args], {
    stdio: "inherit",
    env: env ?? process.env,
  });
}

if (existsSync(makensis)) {
  console.log(`[ensure-nsis-toolset] already installed: ${nsisToolsetDir()}`);
  process.exit(0);
}

console.log("[ensure-nsis-toolset] NSIS is missing; warming it with a minimal bundle...");

// `tauri bundle` needs a compiled binary, so this also produces the app the
// real build packages a moment later (Cargo skips the second compile).
run(["build", "--no-bundle"]);

const dir = mkdtempSync(join(tmpdir(), "detergo-nsis-"));
const configPath = join(dir, "warmup.json");
writeFileSync(
  configPath,
  JSON.stringify({
    bundle: {
      windows: {
        nsis: {
          // The generated language packs are not on disk yet; a stock English
          // installer is enough to trigger the toolset download.
          languages: ["English"],
          customLanguageFiles: {},
          displayLanguageSelector: false,
        },
      },
    },
  }),
  "utf8",
);

try {
  run(["bundle", "--bundles", "nsis", "--config", configPath]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (!existsSync(makensis)) {
  console.error(`[ensure-nsis-toolset] warm-up finished but ${makensis} is still missing.`);
  process.exit(1);
}
console.log(`[ensure-nsis-toolset] installed: ${nsisToolsetDir()}`);
