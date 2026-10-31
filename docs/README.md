# Node Cleaner — Documentation

This folder is the single source of truth for the 2.0 design, security
evidence and release status. Documents are grouped by purpose, not by date.

## Reading order

| # | Document | Purpose |
|---|---|---|
| 1 | [`MASTER_SPEC.md`](MASTER_SPEC.md) | **Normative specification.** Where any other document conflicts, this one wins. |
| 2 | [`architecture/ARCHITECTURE.md`](architecture/ARCHITECTURE.md) | Layer map: scanner, catalog, safety, cleanup, commands, UI. |
| 3 | [`architecture/CLEANUP_CATALOG.md`](architecture/CLEANUP_CATALOG.md) | The 56-rule target catalog and its evidence model. |
| 4 | [`architecture/AGENT_PROVIDERS.md`](architecture/AGENT_PROVIDERS.md) | Codex / Claude Code / Antigravity storage classes and KEEP rules. |
| 5 | [`security/SECURITY_MODEL.md`](security/SECURITY_MODEL.md) | Threat model, guards and the 30-scenario security matrix. |
| 6 | [`security/FINAL_SECURITY_AUDIT.md`](security/FINAL_SECURITY_AUDIT.md) | What was actually executed, findings F-1…F-10, GO/NO-GO decision. |
| 7 | [`release/TEST_MATRIX.md`](release/TEST_MATRIX.md) | Recorded test results and the tests' scope. |
| 8 | [`release/RELEASE_CHECKLIST.md`](release/RELEASE_CHECKLIST.md) | Release gates and the blockers that are still open. |
| 9 | [`release/PRODUCTION_RELEASE_AUDIT_REPORT.md`](release/PRODUCTION_RELEASE_AUDIT_REPORT.md) | Consolidated release report and artifact hashes. |

## Layout

```
docs/
├── README.md                        # this index
├── MASTER_SPEC.md                   # normative 2.0 specification
├── architecture/
│   ├── ARCHITECTURE.md
│   ├── CLEANUP_CATALOG.md
│   └── AGENT_PROVIDERS.md
├── security/
│   ├── SECURITY_MODEL.md
│   └── FINAL_SECURITY_AUDIT.md
├── release/
│   ├── PRODUCTION_RELEASE_AUDIT_REPORT.md
│   ├── RELEASE_CHECKLIST.md
│   └── TEST_MATRIX.md
├── audit/
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

## Current release status

```
Internal / controlled beta: GO
Public production:          NO-GO
```

The blockers are execution gaps, not known code defects: six manual security
scenarios, a real Recycle Bin round-trip, large-scale benchmarks, a Windows 10
smoke test, and unsigned binaries. See
[`release/RELEASE_CHECKLIST.md`](release/RELEASE_CHECKLIST.md).
