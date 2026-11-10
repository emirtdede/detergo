#!/usr/bin/env node
/**
 * Verify that the executable(s) actually embedded the 15-frame brand ICO.
 *
 * Usage:
 *   node scripts/check-exe-icons.mjs <exe> [exe...]
 */
import fs from "node:fs";
import path from "node:path";

import { parsePeIcons } from "./lib/pe-icons.mjs";

const expectedFrames = 15;
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("[check-exe-icons] pass at least one executable path");
  process.exit(1);
}

let failed = false;
for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error(`[check-exe-icons] missing: ${file}`);
    failed = true;
    continue;
  }
  try {
    const parsed = parsePeIcons(fs.readFileSync(file));
    const counts = parsed.groupIcons.map((group) => group.frames.length);
    if (counts.length === 0) {
      console.error(`[check-exe-icons] ${path.basename(file)}: no group icons`);
      failed = true;
      continue;
    }
    if (counts.some((count) => count !== expectedFrames)) {
      console.error(
        `[check-exe-icons] ${path.basename(file)}: group icon frame counts [${counts.join(", ")}], expected ${expectedFrames}`,
      );
      failed = true;
      continue;
    }
    if (parsed.iconResourceCount < expectedFrames) {
      console.error(
        `[check-exe-icons] ${path.basename(file)}: only ${parsed.iconResourceCount} RT_ICON resources`,
      );
      failed = true;
      continue;
    }
    console.log(
      `[check-exe-icons] PASS ${path.basename(file)}: ${counts.length} group icon(s), ${counts.join("/")} frames, ${parsed.iconResourceCount} RT_ICON resources`,
    );
  } catch (error) {
    console.error(`[check-exe-icons] ${path.basename(file)}: ${error.message}`);
    failed = true;
  }
}

if (failed) process.exit(1);
