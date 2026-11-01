# Release Checklist & Gates

**Version:** 2.0.0
**Date:** 2026-11-01
**Source revision:** `283eb6dc131dc65a91c39f69679ecc3a83a65be0`
**Deployment mode:** DIRECT-LIVE (local Windows desktop; NSIS / MSI / portable go
straight to users; no staging, no canary)

## Gate results

| Gate | Requirement | Result | Evidence |
|---|---|---|---|
| G0 | Baseline verified | **PASS** | `docs/audit/BASELINE.md`, `BASELINE_TEST_RESULTS.md` |
| G1 | Catalog + matcher tests | **PASS** | 56-rule positive/negative test, validation tests |
| G2 | Guard + session tests | **PASS** | path/junction/symlink/git/evidence/session/plan tests |
| G3 | Ecosystem rules | **PASS** | table-driven test across every rule |
| G4 | AI provider safety | **PASS** | provider policy tests, active-use probe, 120 s idle-window tests |
| G5 | Global cache commands | **PASS** | argv whitelist, unknown/read-only/forged-token tests, read-only providers rejected |
| G6 | UI, i18n, migration | **PASS (EN/TR for 2.0 screens)** — legacy header keeps 75 locales; limitation F-5 | `npm run typecheck`, 29 frontend tests, v1→v3 migration test |
| G7 | Windows tests | **PARTIAL** — Windows 11 install/launch/uninstall PASS, Windows 10 not executed (F-4) | `scripts/verify-installer.ps1` NSIS + MSI |
| G8 | Final security audit | **PASS with 2 documented gaps** — 28/30 executed | `docs/security/FINAL_SECURITY_AUDIT.md` |

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

- [x] 28/30 scenarios executed PASS
- [x] SEC-19 (OneDrive cloud-only placeholder) **NOT EXECUTED** — no placeholder
      available; the reparse-point hard block that defends it *is* executed
- [x] No root escape in tests
- [x] Symlink/junction blocked in tests
- [x] No frontend path authority
- [x] Expired sessions rejected
- [x] Active AI agent data blocked by policy
- [x] Unknown targets fail closed
- [x] No file-content reads in scans/logs (`secret_persistence`, `verify:offline`)
- [x] Zero outbound network connections during a real session (`verify:offline`)
- [x] Interrupted multi-item delete leaves no audit record (`crash_during_delete`)
- [x] Recycle failure never falls back to a permanent delete

## Performance checklist

All numbers measured on this machine; commands and fixtures are in
`docs/release/TEST_MATRIX.md` §5.

- [x] Virtualized table (1,000-item micro-benchmarks: filter < 15 ms, sort < 10 ms)
- [x] 10,000 candidates — **24.5 s**, 69.6 MB peak
- [x] 50,000 candidates — **131.8 s**, 293.9 MB peak
- [x] 300,000 recordings — **47.7 s**, 5.5 MB peak
- [x] 1,000,000 directory entries — **122.0 s**, 7.1 MB peak
- [x] Cancel reaction measured on a large tree (`cancel_latency_benchmark`)
- [x] Long path handling implemented (verbatim-prefix normalisation)
- [x] Large files measured without reading content
- [x] Cancel/error/partial states distinct in the model

## Packaging checklist

- [x] Rust tests PASS (94 lib + 4 integration, 5 opt-in heavy tests)
- [x] Frontend tests PASS (29)
- [x] Typecheck PASS
- [x] Clippy PASS (0 warnings, all targets)
- [x] Build provenance present — clean-tree gate, embedded commit, `BUILD_INFO.json`
- [x] Release build PASS (2026-11-01, commit-stamped)
- [x] NSIS install → launch → uninstall PASS
- [x] MSI install → launch → uninstall PASS (per-user mode; see below)
- [x] Portable PASS
- [x] SHA-256 file generated (`release_output/SHA256SUMS.txt`)
- [x] Versions synchronised (2.0.0)
- [x] Package sizes/hashes recorded in `docs/security/FINAL_SECURITY_AUDIT.md` §1.1
- [x] Packaged IPC under production CSP verified — 14/14 checks (`scripts/verify-ipc.mjs`)
- [x] README rewritten
- [ ] Windows 10 install smoke test — **NOT EXECUTED** (F-4; no Windows 10 host)
- [ ] Publishable packages rebuilt from a **clean** commit — current binary set is `dirty: true`
- [x] No known critical/high-severity deletion defect

### MSI scope note

Tauri's WiX template builds the MSI with `InstallScope="perMachine"`. A standard
user gets **error 1925** from a plain `/i`. The consumer channel is the NSIS
setup (per-user, no elevation). The MSI is for elevated / enterprise deployment.
`scripts/verify-installer.ps1 -Kind msi` installs in `ALLUSERS=2
MSIINSTALLPERUSER=1` mode when not elevated, so the payload itself is proven; run
it elevated to exercise the native per-machine path.

## Blockers for public production release

1. **Artifacts must be rebuilt from a clean commit.** The packages currently in
   `release_output/` were produced with `--allow-dirty` to exercise the new
   provenance pipeline, and `BUILD_INFO.json` correctly marks them
   `"dirty": true`. Commit the audit fixes and re-run
   `npm run build:release` (no flag); `BUILD_INFO.json` must show
   `"dirty": false` and commit `283eb6d…` (or the new HEAD).
2. **Windows 10 smoke test** (F-4) — run `scripts/verify-installer.ps1` on a
   Windows 10 host if Windows 10 is a supported target.

Accepted residual risk (needs owner sign-off, does not block the code):

3. **SEC-19** — OneDrive cloud-only placeholder not executed. Mitigated by the
   reparse-point hard block, which is executed.
4. **Code signing** (F-6) — unsigned binaries; SmartScreen warns.
5. **EN/TR only** for 2.0 screens (F-5).
6. **Dev-toolchain advisories** (F-8) — none ship in the release build.

## Decision

- **Internal / controlled beta:** GO.
- **Public production with the current packages:** **NO-GO** — they are marked
  `dirty: true` and must be rebuilt from a committed tree.
- **Public production after step 1 (and step 2 if Windows 10 is supported):**
  **GO**. Every automated gate passes, the destructive path is guarded and
  tested, the previously pending scenarios are executed, and the packaged binary
  was probed under the production CSP.
