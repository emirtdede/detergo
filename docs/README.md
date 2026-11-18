# Dev Cleaner (formerly Node Cleaner) - Documentation

This folder is the single source of truth for the 2.0 design, security
evidence and release status. Documents are grouped by purpose, not by date.

## Reading order

| # | Document | Purpose |
|---|---|---|
| 1 | [`MASTER_SPEC.md`](MASTER_SPEC.md) | **Normative specification.** Where any other document conflicts, this one wins. |
| 2 | [`architecture/ARCHITECTURE.md`](architecture/ARCHITECTURE.md) | Layer map: scanner, catalog, safety, cleanup, commands, UI. |
| 3 | [`architecture/CLEANUP_CATALOG.md`](architecture/CLEANUP_CATALOG.md) | The 56-rule target catalog and its evidence model. |
| 4 | [`architecture/AGENT_PROVIDERS.md`](architecture/AGENT_PROVIDERS.md) | Codex / Claude Code / Antigravity storage classes and KEEP rules. |
| 5 | [`architecture/MCP.md`](architecture/MCP.md) | MCP tool surface, preview→execute flow and the three destructive gates. |
| 6 | [`architecture/SCAN_HISTORY_MIGRATION.md`](architecture/SCAN_HISTORY_MIGRATION.md) | Why scan history lives in localStorage for 2.2.1, and the 2.3 plan. |
| 7 | [`architecture/NOTIFICATIONS.md`](architecture/NOTIFICATIONS.md) | Why WebView2 web notifications do not surface, and the 2.2.1 fallback. |
| 8 | [`audit/PRE_DEPLOYMENT_QA_AUDIT_TR.md`](audit/PRE_DEPLOYMENT_QA_AUDIT_TR.md) | Pre-deployment audit: 42 findings (Turkish). |
| 9 | [`audit/REMEDIATION_PLAN_TR.md`](audit/REMEDIATION_PLAN_TR.md) | Remediation plan and work packages P0–E1 (Turkish). |
| 10 | [`audit/baseline/SECURITY_MATRIX_2.2.1_TR.md`](audit/baseline/SECURITY_MATRIX_2.2.1_TR.md) | 12 path + 9 MCP security scenarios with their tests. |
| 11 | [`audit/baseline/PRODUCTION_GATE_2.2.1_TR.md`](audit/baseline/PRODUCTION_GATE_2.2.1_TR.md) | The 18-item 2.2.1 production gate and its status. |
| 12 | [`brand/BRAND_GUIDELINES.md`](brand/BRAND_GUIDELINES.md) | Canonical mark, DPI frames, installer art and the generation pipeline. |
| 13 | [`brand/QA_2.2.2.md`](brand/QA_2.2.2.md) | Recorded visual inspection of the 15 frames, tray sizes and installer art. |
| 14 | [`brand/TRADEMARK_CLEARANCE.md`](brand/TRADEMARK_CLEARANCE.md) | Pending counsel record for the "Dev Cleaner" mark. |
| 15 | [`release/baseline-2.2.1.md`](release/baseline-2.2.1.md) | Shipped 2.2.1 hashes and the rebuild procedure. |
| 16 | [`release/BRAND_ROLLOUT_PLAN_V3.1_TR.md`](release/BRAND_ROLLOUT_PLAN_V3.1_TR.md) | Approved 2.2.2 brand rollout plan (Turkish). |
| 17 | [`CLI.md`](CLI.md) | Terminal reference: commands, exit codes, JSON, webhooks and npkill migration. |
| 18 | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Local setup, quality gates and contribution workflow. |
| 19 | [`../SECURITY.md`](../SECURITY.md) | Private vulnerability reporting and the security scope. |

## Layout

```
docs/
├── README.md                        # this index
├── CLI.md                           # terminal reference
├── MASTER_SPEC.md                   # normative 2.0 specification
├── architecture/
│   ├── ARCHITECTURE.md
│   ├── CLEANUP_CATALOG.md
│   ├── AGENT_PROVIDERS.md
│   ├── MCP.md
│   ├── NOTIFICATIONS.md
│   └── SCAN_HISTORY_MIGRATION.md
├── audit/
│   ├── PRE_DEPLOYMENT_QA_AUDIT_TR.md
│   ├── REMEDIATION_PLAN_TR.md
│   ├── baseline/
│   │   ├── BASELINE_2.2.0_TR.md
│   │   ├── PERFORMANCE_2.2.1_TR.md
│   │   ├── SECURITY_MATRIX_2.2.1_TR.md
│   │   ├── PRODUCTION_GATE_2.2.1_TR.md
│   │   ├── MANUAL_SMOKE_CHECKLIST_2.2.1_TR.md
│   │   ├── INSTALLER_REPORT_2.2.1_TR.md
│   │   └── ROLLBACK_DRILL_2.2.1_TR.md
│   ├── BASELINE.md                  # pre-change inventory (WBS-001)
│   └── BASELINE_TEST_RESULTS.md     # pre-change test run (WBS-002)
├── brand/
│   ├── BRAND_GUIDELINES.md          # canonical mark, frames, installer art
│   ├── QA_2.2.2.md                  # recorded visual inspection (G9 evidence)
│   ├── qa/                          # inspection sheets referenced by the record
│   ├── TRADEMARK_CLEARANCE.md       # counsel record (pending signature)
│   └── preview.html                 # local visual preview
├── release/
│   ├── RELEASE_CHECKLIST.md         # current gates (2.2.2)
│   ├── TEST_MATRIX.md               # recorded results
│   ├── baseline-2.2.1.md            # shipped 2.2.1 hashes
│   └── BRAND_ROLLOUT_PLAN_V3.1_TR.md
└── archive/                         # historical input, not current truth
    ├── brand-v1/                    # retired identity; never shipped
    ├── node-cleaner-urun-gelistirme-ana-dokumani.md
    ├── GELISTIRME_RAPORU-Gelistirici-Artiklari.md
    └── NODE-CLEANER-NIHAI-PLAN.txt
```

## Rules for this folder

1. **`archive/` is history.** Anything there describes the plan or research that
   led to 2.0. It is never used to justify a current claim.
2. **No unverified claims.** A capability is described as implemented only when
   code and a recorded test exist. Otherwise it is marked *manual*, *pending* or
   *not executed*.
3. **`MASTER_SPEC.md` is normative.** If an architecture or release document
   disagrees with it, the specification is correct and the other document needs
   fixing.
4. **Relative links only.** Documents link to each other with relative paths so
   the folder can be moved or read offline.

## Current release status (2.2.3)

```
Code gates:            14/14 PASS (237 frontend tests, 230 Rust lib + 21 integration, clippy, rustfmt, build, 13/13 a11y)
Brand gates:           3/3 PASS (check:icons, check:brand, format:check)
Release build:         2.2.3 — commit 7c9d5f3, clean tree, 3 artifacts, published on GitHub Releases
Runtime checks:        2.2.2 evidence below; the 2.2.3 installer harnesses were not re-run
Release gates:         PENDING — signed MSI (G4), clean-VM repeat, legal (G0), design (G9)
Source availability:   PUBLIC — MIT licensed, contributions welcome
```

2.2.3 is a scan-experience and documentation patch: `--scope combined`, the
scan-coverage notice model, canonical webhook payloads, corrected Codex TOML,
regenerated third-party notices and a repaired Turkish docs index. It changes
nothing about what is deleted or how the safety classifier decides.

Source gates executed on 2026-11-17:

- `npm run typecheck`, `npm test` (237), `npm run format:check`,
  `npm run check:gates`, `npm run check:audit`, `npm run check:i18n`,
  `npm run check:contrast` — PASS.
- `cargo test --lib` (230) and `cargo fmt` — PASS.

The 2.2.3 packages attached to the GitHub Release were rebuilt from the clean
commit `7c9d5f3`, so `release_output/BUILD_INFO.json` reports `"dirty": false`
and `npm run check:build-info` passes. Any later package must be rebuilt from a
clean tree so the manifest stays tied to a commit.

### 2.2.2 brand release evidence

The 2.2.2 change set is a brand identity rollout; scanner and cleanup behaviour
is unchanged. Source gates executed on 2026-11-10:

- `npm run typecheck`, `npm test` (105), `npm run build` — PASS.
- `cargo test` (127 lib + 18 integration), `cargo clippy -D warnings`,
  `cargo fmt --check` — PASS.
- `npm run check:icons`, `npm run check:brand`, `npm run check:audit`,
  `npm run format:check`, `npm run check-version` — PASS.

Release build and runtime evidence:

- `npm run build:release` from a clean tree produced the portable, NSIS and MSI
  packages; the PE gate confirmed 15 frames / 15 `RT_ICON` in the portable and
  setup EXEs, and `npm run check:build-info` reported a clean tree.
- `npm run verify:smoke` passed 10/10 against the portable EXE.
- `npm run verify:installer` and `npm run verify:shell-icons` passed 8/8 each on
  the development Windows 11 host.
- `npm run verify:upgrade -Kind NSIS` passed 8/8 (2.2.1 → 2.2.2, single Apps &
  Features entry, upgraded version, 15-frame EXE, clean removal).

The installer harnesses are split by scope:

- `npm run verify:installer` — NSIS per-user install → launch → 15-frame icons →
  uninstall → leftover check.
- `npm run verify:msi` — elevated per-machine MSI; refuses a non-elevated
  session (guard verified) instead of silently testing a per-user configuration.
- `npm run verify:upgrade` — 2.2.1 → 2.2.2 in-place upgrade for NSIS or MSI.
- `npm run verify:shell-icons` — desktop/Start menu shortcut icon sources,
  `DisplayIcon`, installed `app.ico` and PE frames.

Still open: the MSI run, a repeat of the NSIS harnesses on a pristine VM, the
design-board signature (G9) and counsel (G0). Because no Windows 10 22H2 host was
available, 2.2.2 no longer advertises Windows 10; Windows 11 x64 is the verified
target (G8 closed by removing the claim).
`npm run check:contrast` has a pre-existing token-vocabulary failure documented
in the release checklist; it is not caused by the brand work.
See [`release/RELEASE_CHECKLIST.md`](release/RELEASE_CHECKLIST.md),
[`release/TEST_MATRIX.md`](release/TEST_MATRIX.md) and
[`release/baseline-2.2.1.md`](release/baseline-2.2.1.md).
