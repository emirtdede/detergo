# Release Checklist & Gates

**Version:** 2.0.0
**Date:** 2026-10-31

## Gate results

| Gate | Requirement | Result | Evidence |
|---|---|---|---|
| G0 | Baseline verified | **PASS** | `docs/audit/BASELINE.md`, `BASELINE_TEST_RESULTS.md` |
| G1 | Catalog + matcher tests | **PASS** | 56-rule positive/negative test, validation tests |
| G2 | Guard + session tests | **PASS** | path/junction/symlink/git/evidence/session/plan tests |
| G3 | Ecosystem rules | **PASS** | table-driven test across every rule |
| G4 | AI provider safety | **PASS (automated policy)** — live provider run pending | provider spec tests, agent policy test, active-use code |
| G5 | Global cache commands | **PASS (design + token tests)** — real command execution pending | argv whitelist, unknown/read-only/forged-token tests |
| G6 | UI, i18n, migration | **PASS (EN/TR for 2.0 screens)** — legacy header keeps 75 locales; see limitation F-5 | typecheck, 26 frontend tests, v1 migration test |
| G7 | Windows tests | **PARTIAL** — Windows 11 smoke PASS, Windows 10 not executed | packaged app launched and stayed alive |
| G8 | Final security audit | **PASS with documented manual items** — 24/30 automated, 6 pending | `docs/audit/FINAL_SECURITY_AUDIT.md` |

## Functional checklist

- [x] Previous `node_modules` cleaning works (end-to-end test)
- [x] Catalog-based multi-ecosystem scanning (56 rules)
- [x] Project and monorepo grouping
- [x] Nested targets are not double counted
- [x] Git protection (tracked → REVIEW + execution block)
- [x] SAFE / REGENERATE / REVIEW / KEEP enforced
- [x] Codex, Claude Code, Antigravity detected
- [x] Codex sessions/worktrees shown separately and protected
- [x] Claude `file-history` protected
- [x] Antigravity recordings analysed with idle requirement
- [x] Global cache commands use fixed official argv
- [x] No deletion without user selection and plan confirmation
- [x] Recycle Bin default, permanent requires separate ack
- [x] Local audit/history and growth snapshots

## Security checklist

- [x] 24/30 scenarios automated PASS
- [x] 6/30 review-verified PASS with manual execution pending
- [x] No root escape in tests
- [x] Symlink/junction blocked in tests
- [x] No frontend path authority
- [x] Expired sessions rejected
- [x] Active AI agent data blocked by policy
- [x] Unknown targets fail closed
- [x] No file-content reads in scans/logs

## Performance checklist

- [x] Virtualized table (1,000-item micro-benchmarks)
- [ ] 10,000 / 50,000 candidate benchmark — **NOT EXECUTED**
- [ ] 300,000 recordings — **NOT EXECUTED**
- [ ] 1,000,000 directory entries — **NOT EXECUTED**
- [ ] Cancel reaction measured on large tree — **NOT EXECUTED**
- [x] Long path handling implemented (verbatim-prefix normalisation)
- [x] Large files measured without reading content
- [x] Cancel/error/partial states distinct in the model

## Packaging checklist

- [x] Rust tests PASS (86 lib + 1 integration)
- [x] Frontend tests PASS (26)
- [x] Typecheck PASS
- [x] Clippy PASS (0 warnings)
- [x] Release build PASS (2026-10-31)
- [x] NSIS PASS (`Node-Cleaner-2.0.0-x64-Setup.exe`)
- [x] MSI PASS (`Node-Cleaner-2.0.0-x64.msi`; Tauri also emits `en-US`)
- [x] Portable PASS (`Node-Cleaner-2.0.0-Portable.exe`)
- [x] SHA-256 file generated (`release_output/SHA256SUMS.txt`)
- [x] Versions synchronised (2.0.0)
- [x] Package sizes/hashes recorded in `docs/audit/FINAL_SECURITY_AUDIT.md`
- [x] Packaged IPC under production CSP verified via WebView2 probe
- [x] README rewritten
- [ ] Windows 10 smoke test — **NOT EXECUTED**
- [x] No known critical/high-severity deletion defect

## Blockers for public production release

1. Six manual security scenarios (see `docs/SECURITY_MODEL.md` §4 R-rows).
2. Large-scale performance measurements.
3. Windows 10 smoke test.
4. Trash round-trip on a real machine (Recycle Bin visibility + byte accounting).
5. 2.0 screens are localized in EN/TR only; full 75-locale coverage is not
   claimed for them (legacy header still uses the full dictionary).

## Decision

- **Internal / controlled beta:** GO.
- **Public production:** NO-GO until the blockers above are executed and
  recorded. The destructive capabilities shipped here are guarded and tested;
  the remaining work is verification breadth, not known defects.
