#!/usr/bin/env node
/**
 * Run the Windows generator twice and prove that every deterministic output
 * (including the ICO, tray PNGs, BMPs and GitHub art) is byte-identical.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generator = path.join(root, "scripts", "generate-icons.mjs");
const manifestPath = path.join(root, "assets", "brand", "icon-manifest.json");

if (process.platform !== "win32") {
  console.error("[verify-icon-determinism] Windows is required.");
  process.exit(1);
}

execFileSync(process.execPath, [generator], { cwd: root, stdio: "inherit" });
const first = fs.readFileSync(manifestPath, "utf8");

execFileSync(process.execPath, [generator], { cwd: root, stdio: "inherit" });
const second = fs.readFileSync(manifestPath, "utf8");

if (first !== second) {
  console.error(
    "[verify-icon-determinism] FAIL — two generator runs produced different manifests.",
  );
  process.exit(1);
}
console.log("[verify-icon-determinism] PASS — two consecutive runs are byte-identical.");
