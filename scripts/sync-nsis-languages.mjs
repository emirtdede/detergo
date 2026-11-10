#!/usr/bin/env node
/**
 * Copies the project-supplied NSIS language packs into the NSIS installation
 * that the bundler uses.
 *
 * `MUI_LANGUAGE "X"` resolves to ${NSISDIR}\Contrib\Language files\X.nlf, and
 * NSIS only searches its own directory, so a language file that lives in the
 * repository has to be placed there before the bundle is compiled. The release
 * pipeline runs this automatically; `npm run check:languages` verifies the
 * result.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { PROJECT_LANGUAGE_DIR, projectLanguages } from "./lib/installer-languages.mjs";

const nsisDir = join(
  process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
  "tauri",
  "NSIS",
);
const langDir = join(nsisDir, "Contrib", "Language files");

if (!existsSync(nsisDir)) {
  console.error(
    "[sync-nsis-languages] Tauri's NSIS toolchain is not installed yet.\n" +
      "Run `npx tauri build` once (it downloads NSIS), then re-run this script.",
  );
  process.exit(1);
}

mkdirSync(langDir, { recursive: true });

let copied = 0;
for (const entry of projectLanguages()) {
  for (const extension of [".nlf", ".nsh"]) {
    const source = join(PROJECT_LANGUAGE_DIR, `${entry.name}${extension}`);
    if (!existsSync(source)) {
      console.error(`[sync-nsis-languages] missing ${source}`);
      process.exit(1);
    }
    copyFileSync(source, join(langDir, `${entry.name}${extension}`));
    copied += 1;
  }
}

const present = readdirSync(langDir).filter((file) => file.endsWith(".nlf")).length;
console.log(
  `[sync-nsis-languages] installed ${copied} project files; ${present} .nlf files now available`,
);
