# Dev Cleaner — Documentation

This folder is the single source of truth for the design, security evidence and
release status of Dev Cleaner 1.0.0. Documents are grouped by purpose, not by
date.

## Reading order

| # | Document | Purpose |
|---|---|---|
| 1 | [`MASTER_SPEC.md`](MASTER_SPEC.md) | **Normative specification.** Where any other document conflicts, this one wins. |
| 2 | [`architecture/ARCHITECTURE.md`](architecture/ARCHITECTURE.md) | Layer map: scanner, catalog, safety, cleanup, commands, UI. |
| 3 | [`architecture/CLEANUP_CATALOG.md`](architecture/CLEANUP_CATALOG.md) | The 56-rule target catalog and its evidence model. |
| 4 | [`architecture/AGENT_PROVIDERS.md`](architecture/AGENT_PROVIDERS.md) | Codex / Claude Code / Antigravity storage classes and KEEP rules. |
| 5 | [`architecture/MCP.md`](architecture/MCP.md) | MCP tool surface, preview→execute flow and the three destructive gates. |
| 6 | [`security/SECURITY_MODEL.md`](security/SECURITY_MODEL.md) | Trust boundaries, protected paths and the deletion contract. |
| 7 | [`security/FINAL_SECURITY_AUDIT.md`](security/FINAL_SECURITY_AUDIT.md) | Executed security evidence (path, MCP and webhook scenarios). |
| 8 | [`CLI.md`](CLI.md) | Terminal reference: commands, exit codes, JSON, webhooks and npkill migration. |
| 9 | [`architecture/SCAN_HISTORY_MIGRATION.md`](architecture/SCAN_HISTORY_MIGRATION.md) | Where scan history lives and the migration path. |
| 10 | [`architecture/NOTIFICATIONS.md`](architecture/NOTIFICATIONS.md) | How notifications surface and what the fallback is. |
| 11 | [`audit/2026-11-17-pre-deployment-qa-audit-v3.md`](audit/2026-11-17-pre-deployment-qa-audit-v3.md) | Final pre-deployment audit: findings, fixes and the re-run evidence. |
| 12 | [`release/TEST_MATRIX.md`](release/TEST_MATRIX.md) | Recorded test and runtime results. |
| 13 | [`release/RELEASE_CHECKLIST.md`](release/RELEASE_CHECKLIST.md) | Release gates and the items that still need a human sign-off. |
| 14 | [`release/BUILD_PROVENANCE.md`](release/BUILD_PROVENANCE.md) | How a binary is tied to a commit and a hash. |
| 15 | [`release/INSTALLER_LANGUAGES.md`](release/INSTALLER_LANGUAGES.md) | Installer language catalog and how it is generated. |
| 16 | [`CHANGELOG.md`](CHANGELOG.md) | Release history. |
| 17 | [`brand/BRAND_GUIDELINES.md`](brand/BRAND_GUIDELINES.md) | Canonical mark, DPI frames, installer art and the generation pipeline. |
| 18 | [`brand/TRADEMARK_CLEARANCE.md`](brand/TRADEMARK_CLEARANCE.md) | Counsel record for the "Dev Cleaner" mark. |
| 19 | [`../.github/CONTRIBUTING.md`](../.github/CONTRIBUTING.md) | Local setup, quality gates and contribution workflow. |
| 20 | [`../.github/SECURITY.md`](../.github/SECURITY.md) | Private vulnerability reporting and the security scope. |

## Layout

```
docs/
├── README.md                        # this index
├── CHANGELOG.md                     # release history
├── CLI.md                           # terminal reference
├── MASTER_SPEC.md                   # normative specification
├── architecture/
│   ├── ARCHITECTURE.md
│   ├── CLEANUP_CATALOG.md
│   ├── AGENT_PROVIDERS.md
│   ├── MCP.md
│   ├── NOTIFICATIONS.md
│   └── SCAN_HISTORY_MIGRATION.md
├── audit/
│   └── 2026-11-17-pre-deployment-qa-audit-v3.md
├── brand/
│   ├── BRAND_GUIDELINES.md
│   ├── TRADEMARK_CLEARANCE.md
│   ├── dev-cleaner-icon.png
│   ├── dev-cleaner-icon.html
│   └── preview.html
├── release/
│   ├── BUILD_PROVENANCE.md
│   ├── INSTALLER_LANGUAGES.md
│   ├── RELEASE_CHECKLIST.md
│   └── TEST_MATRIX.md
└── security/
    ├── FINAL_SECURITY_AUDIT.md
    └── SECURITY_MODEL.md
```

## Rules for this folder

1. **One document per purpose.** A new audit, plan or report replaces the
   previous one instead of accumulating dated copies.
2. **No unverified claims.** A capability is described as implemented only when
   code and a recorded test exist. Otherwise it is marked *manual*, *pending* or
   *not executed*.
3. **`MASTER_SPEC.md` is normative.** If an architecture or release document
   disagrees with it, the specification is correct and the other document needs
   fixing.
4. **Relative links only.** Documents link to each other with relative paths so
   the folder can be moved or read offline.
5. **Nothing outside this folder.** Product documentation lives under `docs/`.
   The repository root keeps only `README.md` and `LICENSE`, which GitHub
   requires; community files live in `.github/`.

## Current release status (1.0.0)

```
Code gates:            14/14 PASS (256 frontend tests, 238 Rust lib + integration suites, clippy, rustfmt, build, 16/16 a11y)
Brand gates:           3/3 PASS (check:icons, check:brand, format:check)
Release build:         1.0.0 — clean tree, 3 artifacts, provenance manifest verified
Runtime checks:        2.2.2 evidence in release/TEST_MATRIX.md; the 1.0.0 installer harnesses were not re-run
Release gates:         PENDING — signed installers (G4), clean-VM repeat, legal (G0), design (G9)
Source availability:   PUBLIC — MIT licensed, contributions welcome
```

Source gates run on every push and pull request in GitHub Actions (see
`.github/workflows/ci.yml`; AppVeyor stays as a redundant Windows path) and the
results are recorded in `docs/release/TEST_MATRIX.md`. Any package must be built from a clean tree so
`release_output/BUILD_INFO.json` reports `"dirty": false` and
`npm run check:build-info` passes.

Still open: code-signing the installers, a repeat of the installer harnesses on a
pristine VM, the design-board signature (G9) and legal clearance (G0). Windows 10
is not verified and is not advertised as supported; Windows 11 x64 is the target.
See [`release/RELEASE_CHECKLIST.md`](release/RELEASE_CHECKLIST.md).
