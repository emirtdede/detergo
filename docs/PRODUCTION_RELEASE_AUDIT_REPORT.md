# Production Release Audit Report — Node Cleaner 2.0.0

**Application:** Node Cleaner (Windows desktop)
**Version:** 2.0.0
**Stack:** Tauri 2 · Rust · React 19 · TypeScript · Vite 6
**Publisher / identifier:** Vellium · `com.vellium.nodecleaner`
**Audit date:** 2026-10-31
**Environment:** Windows 11 (10.0.26200) x64, Node 24.22.1, Rust 1.99.1

> This report supersedes the earlier 1.0.0 report that declared `GO`. That
> report predates the multi-ecosystem catalog, AI-agent storage manager,
> backend-owned plans and the 2.0 security work, and its test counts (9 Cargo,
> 18 Vitest) no longer describe this code base. It must not be used as release
> evidence.

## 1. Decision

```text
Internal / controlled beta: GO
Public production:          NO-GO
```

The application is buildable, launches, performs real IPC under its production
CSP, and the destructive path is guarded by automated tests. Public production
is blocked because six security scenarios, the real Recycle Bin round-trip, the
large-scale performance measurements and the Windows 10 smoke test have not
been executed. No fabricated results are used in this report.

## 2. Evidence executed for this audit

| Check | Command / method | Result |
|---|---|---|
| Rust unit + integration | `cargo test` | 86 passed + 1 integration, 0 failed |
| Frontend | `npm test` | 26 passed, 0 failed |
| TypeScript | `npm run typecheck` | PASS |
| Lint/static | `cargo clippy --all-targets` | 0 warnings, 0 errors |
| Frontend build | `npm run build` | PASS (1,953 modules) |
| Release packaging | `npm run build:release` | PASS — NSIS, MSI, portable, SHA-256 |
| Version sync | `npm run check-version` | 2.0.0 in package.json, tauri.conf.json, Cargo.toml |
| Packaged startup | portable EXE, 8 s | stayed alive, stopped cleanly |
| Packaged IPC + CSP | WebView2 DevTools probe | `get_catalog` → 56 rules, `get_app_settings` → OK, `get_known_locations` → 2 |

Full security detail: `docs/audit/FINAL_SECURITY_AUDIT.md`.
Test coverage detail: `docs/TEST_MATRIX.md`.
Gate checklist: `docs/RELEASE_CHECKLIST.md`.

## 3. What changed in 2.0 that this audit covers

- Catalog-driven, multi-ecosystem scanning with per-rule positive/negative
  fixtures and startup validation.
- AI agent storage analysis (Codex, Claude Code, Antigravity) with sessions,
  worktrees, checkpoints, memory, brain data and SQLite/WAL held as `KEEP`.
- Backend-owned target IDs, session binding, 15-minute plans, one-time
  confirmation tokens and revalidation before every delete.
- Recycle Bin default with no silent permanent fallback; permanent deletion
  requires a separate acknowledgement.
- Copied content is never read for scanning; measurement is metadata-only.
- Cleanup history and official-tool action audits are separate JSONL files.
- Official tool commands run fixed argv with timeouts and process-tree
  termination; failures surface an exit code and an audit error.
- Scan deadline/cancellation never report a partial measurement as complete.
- Discovery refuses reparse points and junctions, so content outside the scan
  root cannot become a target.
- Settings normalise protected paths (absolute, deduped) and enforce limits,
  exclusions and agent-cache/browser-recording policy server-side.
- Snapshot identity fails closed when the Windows file id is unavailable, and
  the reported free-space delta is signed so a decrease is never hidden.
- Every registered Tauri command now has a real frontend consumer; the unused
  `get_storage_snapshots` command was removed.

## 4. Packaging artifacts (2026-10-31)

| Artifact | Size | SHA-256 |
|---|---|---|
| `Node-Cleaner-2.0.0-Portable.exe` | 9.93 MB | `FB42E761ED9603C4E5037EBD024F51787E88AB292B5C4B99E39BE280BA81552C` |
| `Node-Cleaner-2.0.0-x64-Setup.exe` | 2.52 MB | `4D9EE6489951128DB471F67015EC34BC008318C3B3DD099B7CC6B7B97D765FA8` |
| `Node-Cleaner-2.0.0-x64.msi` | 3.63 MB | `6FE5BC5F5225B90F03F479C06DE1D9831736A98DAE6BFF0A9311D1126DE9F94D` |

Checksums are regenerated into `release_output/SHA256SUMS.txt` by the release
script; the values above match the files produced in this audit run.

## 5. Residual risk / blockers

| Blocker | Status |
|---|---|
| SEC-17 live browser recording | PENDING — needs an active recording |
| SEC-18 Recycle Bin unavailable | PENDING — needs an unsupported volume |
| SEC-19 OneDrive cloud placeholder | PENDING — needs a cloud-only file |
| SEC-26 secret leakage audit | PENDING — review-verified, execution pending |
| SEC-27 no-telemetry audit | PENDING — review-verified, network capture pending |
| SEC-28 crash during deletion | PENDING — crash injection pending |
| Trash round-trip + byte accounting | PENDING — real Recycle Bin |
| 10k/50k candidates, 1M entries, 300k recordings | NOT EXECUTED |
| Windows 10 clean-install smoke | NOT EXECUTED (audit host is Windows 11) |

Non-blocking, documented limitations:

- 2.0 screens are localized in EN/TR; the legacy header retains the 75-locale
  dictionary. Full coverage of new screens is not claimed.
- Binaries are unsigned; SmartScreen will warn until an external code-signing
  certificate is applied.
- `mask_paths` defaults to `false` (paths visible by default).

## 6. Final statement

No critical or high-severity deletion defect was found in the audited code.
The remaining work is verification breadth and environment coverage, not a
known defect. Until the blockers above are executed and recorded, public
production remains **NO-GO**; internal/controlled beta is **GO**.
