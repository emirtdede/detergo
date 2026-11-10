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
| 7 | [`audit/PRE_DEPLOYMENT_QA_AUDIT_TR.md`](audit/PRE_DEPLOYMENT_QA_AUDIT_TR.md) | Pre-deployment audit: 42 findings (Turkish). |
| 8 | [`audit/REMEDIATION_PLAN_TR.md`](audit/REMEDIATION_PLAN_TR.md) | Remediation plan and work packages P0–E1 (Turkish). |
| 9 | [`audit/baseline/SECURITY_MATRIX_2.2.1_TR.md`](audit/baseline/SECURITY_MATRIX_2.2.1_TR.md) | 12 path + 9 MCP security scenarios with their tests. |
| 10 | [`audit/baseline/PRODUCTION_GATE_2.2.1_TR.md`](audit/baseline/PRODUCTION_GATE_2.2.1_TR.md) | The 18-item production gate and its current status. |

## Layout

```
docs/
├── README.md                        # this index
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
└── archive/                         # historical input, not current truth
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

## Current release status (2.2.1)

```
Code gates:            14/14 PASS
Release gates:         4/4 PASS (E1-03…E1-06 automated)
Public production:     GO — all 18 gate items pass
```

All 18 gate items pass. The four operational gates that used to be
"manual sign-off" are now executable evidence:

- `npm run verify:smoke` — 10 checks against the real release binary
  (webhook 200/500/unreachable, language switching, settings persistence,
  GUI liveness); notification routing, scan/cleanup cancellation and
  recycle-bin restore are covered by `npm test` and `npm run verify:trash`.
- `npm run verify:installer` — 8 checks: NSIS + MSI silent install, version,
  uninstall and leftover check. This run found and fixed a real NSIS defect
  (empty install folder left behind); see the installer report.
- Rollback drill for PR-2 and PR-4 was performed on real release builds
  (app boots, scan works, sources restored).
- `npm run build:release` from a clean tree, followed by
  `npm run check:build-info` → `Build provenance OK`.

`npm run check:build-info` also rejects the stale 2.2.0 / `"dirty": true`
artefacts that used to sit in `release_output/`.
See [`audit/baseline/PRODUCTION_GATE_2.2.1_TR.md`](audit/baseline/PRODUCTION_GATE_2.2.1_TR.md).
