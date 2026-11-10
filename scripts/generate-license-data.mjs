/**
 * Regenerates src/features/legal/license-data.ts from the real dependency
 * graph. Run this whenever a dependency changes:
 *
 *   node scripts/generate-license-data.mjs
 *
 * Rust: `cargo metadata` filtered to the Windows target, then the crate graph
 * is walked from the workspace root so only crates that actually end up in the
 * shipped binary are listed.
 *
 * Frontend: package.json dependencies resolved against node_modules, walking up
 * from each package so hoisted and nested copies are both found.
 *
 * The output is committed because the notices page must work offline.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(rootDir, "src", "features", "legal", "license-data.ts");

/** A UTF-8 BOM from PowerShell breaks JSON.parse without this. */
const parseJson = (text) => JSON.parse(text.replace(/^\uFEFF/, ""));

function readRustPackages() {
  const raw = execFileSync(
    "cargo",
    [
      "metadata",
      "--manifest-path",
      path.join(rootDir, "src-tauri", "Cargo.toml"),
      "--format-version",
      "1",
      "--filter-platform",
      "x86_64-pc-windows-msvc",
    ],
    { cwd: rootDir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const metadata = parseJson(raw);
  const rootPackage = metadata.packages.find((pkg) => pkg.name === "node-cleaner");
  if (!rootPackage) throw new Error("node-cleaner package not found in cargo metadata");

  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));

  const directIds = new Set();
  for (const dependency of nodes.get(rootPackage.id).deps) {
    const kinds = dependency.dep_kinds.map((kind) => kind.kind ?? "normal");
    if (kinds.includes("normal") || kinds.includes("build")) directIds.add(dependency.pkg);
  }

  const reachable = new Set();
  const walk = (id) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const dependency of nodes.get(id)?.deps ?? []) walk(dependency.pkg);
  };
  for (const id of directIds) walk(id);

  const normalize = (license) =>
    (license || "UNKNOWN").replace(/[()]/g, "").replace(/\s+/g, " ").trim();

  return [...reachable]
    .map((id) => packages.get(id))
    .filter(Boolean)
    .map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      license: normalize(pkg.license),
      direct: directIds.has(pkg.id),
    }));
}

function readNpmPackages() {
  const pkg = parseJson(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const resolvePackage = (name, from) => {
    let dir = from;
    for (;;) {
      const candidate = path.join(dir, "node_modules", name);
      if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  };

  const resolved = new Map();
  const queue = Object.keys(pkg.dependencies ?? {}).map((name) => ({
    name,
    from: rootDir,
    direct: true,
  }));

  while (queue.length > 0) {
    const { name, from, direct } = queue.shift();
    if (resolved.has(name)) {
      if (direct) resolved.get(name).direct = true;
      continue;
    }
    const dir = resolvePackage(name, from);
    if (!dir) {
      resolved.set(name, { name, version: "unknown", license: "UNKNOWN", direct });
      continue;
    }
    const manifest = parseJson(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const license =
      typeof manifest.license === "string"
        ? manifest.license
        : (manifest.license?.type ??
          (Array.isArray(manifest.licenses)
            ? manifest.licenses.map((entry) => entry.type).join(" OR ")
            : "UNKNOWN"));
    resolved.set(name, { name, version: manifest.version, license, direct });

    for (const child of Object.keys({
      ...(manifest.dependencies ?? {}),
      ...(manifest.optionalDependencies ?? {}),
    })) {
      if (!resolved.has(child)) queue.push({ name: child, from: dir, direct: false });
    }
  }

  return [...resolved.values()];
}

function groupByLicense(components) {
  const groups = new Map();
  for (const component of components) {
    if (!groups.has(component.license)) groups.set(component.license, []);
    groups.get(component.license).push({ name: component.name, version: component.version });
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([license, entries]) => ({
      license,
      components: entries.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

const rust = readRustPackages();
const npm = readNpmPackages();
const direct = [
  ...rust
    .filter((pkg) => pkg.direct)
    .map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      ecosystem: "rust",
    })),
  ...npm
    .filter((pkg) => pkg.direct)
    .map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      ecosystem: "npm",
    })),
].sort((a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.name.localeCompare(b.name));

const json = (value) => JSON.stringify(value, null, 2);
const source = `// Generated by \`node scripts/generate-license-data.mjs\` from \`cargo metadata\`
// and the installed npm tree. Do not edit by hand: the third-party notices page
// reads this file, so it must reflect the dependency graph of the release.

export type LicenseEcosystem = "rust" | "npm";

export interface LicenseComponent {
  name: string;
  version: string;
}

export interface LicenseGroup {
  license: string;
  components: LicenseComponent[];
}

export interface DirectDependency extends LicenseComponent {
  license: string;
  ecosystem: LicenseEcosystem;
}

/** Direct dependencies: what this project actually asks for, by name. */
export const DIRECT_DEPENDENCIES: DirectDependency[] = ${json(direct)};

/** Every Rust crate compiled into the binary, grouped by SPDX expression. */
export const RUST_LICENSE_GROUPS: LicenseGroup[] = ${json(groupByLicense(rust))};

/** Every JavaScript package bundled into the frontend, grouped by license. */
export const NPM_LICENSE_GROUPS: LicenseGroup[] = ${json(groupByLicense(npm))};

export const RUST_COMPONENT_COUNT = ${rust.length};
export const NPM_COMPONENT_COUNT = ${npm.length};
`;

fs.writeFileSync(outputPath, source, "utf8");
console.log(`Wrote ${path.relative(rootDir, outputPath)}`);
console.log(
  `  Rust crates: ${rust.length} (${direct.filter((pkg) => pkg.ecosystem === "rust").length} direct)`,
);
console.log(
  `  npm packages: ${npm.length} (${direct.filter((pkg) => pkg.ecosystem === "npm").length} direct)`,
);
