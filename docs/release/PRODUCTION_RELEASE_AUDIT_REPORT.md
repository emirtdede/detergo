# Production Release Audit Report — Node Cleaner 2.0.0

**Application:** Node Cleaner (Windows desktop)
**Version:** 2.0.0
**Source revision:** `283eb6dc131dc65a91c39f69679ecc3a83a65be0` (`feat/2.0-multi-ecosystem-engine`)
**Stack:** Tauri 2 · Rust · React 19 · TypeScript · Vite 6
**Publisher / identifier:** Vellium · `com.vellium.nodecleaner`
**Audit date:** 2026-11-01
**Deployment mode:** DIRECT-LIVE — local Windows desktop; NSIS / MSI / portable
are delivered straight to users. There is no staging, no canary and no rollback
channel.
**Environment:** Windows 11 (10.0.26200) x64, Node 24.22.1, Rust 1.99.1

> This report supersedes the earlier 1.0.0 report that declared `GO`. That
> report predates the multi-ecosystem catalog, AI-agent storage manager,
> backend-owned plans and the 2.0 security work, and its test counts (9 Cargo,
> 18 Vitest) no longer describe this code base. It must not be used as release
> evidence.
>
> It also supersedes the 2026-10-31 pass of this document. That pass shipped a
> defect: the artifacts in `release_output/` were built at 02:42 while the audited
> HEAD was committed at 06:37, so the verified source and the shipped bytes were
> not the same code, and nothing detected it. See §1.1 and finding F-11.

## 1. Decision

```text
Internal / controlled beta:                              GO
Public production, current packages (dirty: true):       NO-GO
Public production, after rebuild from a clean commit:    GO
```

The application is buildable, launches, performs real IPC under its production
CSP, installs and uninstalls through both installer formats, and the destructive
path is guarded by automated tests. Every security scenario except one was
executed, the Recycle Bin round-trip and the large-scale benchmarks are measured,
and the build now carries machine-checkable provenance.

Two things still block an unconditional GO:

1. The packages currently in `release_output/` report `dirty: true` in
   `BUILD_INFO.json`. They were built with `--allow-dirty` to exercise the new
   provenance pipeline while the audit fixes were uncommitted. They must not be
   published; rebuild from a committed tree.
2. F-4 — the Windows 10 clean-install smoke test has not been executed (no
   Windows 10 host available).

No fabricated or estimated result is used in this report.

## 2. Evidence executed for this audit

| Check | Command / method | Result |
|---|---|---|
| Rust library + unit | `cargo test` | **94 passed**, 0 failed |
| Rust integration (default) | `cargo test` | **4 passed** — `git_unavailable`, `crash_during_delete`, `recycle_failure_no_fallback`, `secret_persistence` |
| Opt-in heavy tests | 5 × `--ignored` | Recycle round-trip + 4 benchmarks (incl. cancel latency) — all PASS |
| Frontend | `npm test` | **29 passed**, 0 failed |
| TypeScript | `npm run typecheck` | PASS |
| Lint/static | `cargo clippy --all-targets` | 0 warnings, 0 errors |
| Frontend build | `npm run build` | PASS (1,956 modules) |
| Release packaging | `npm run build:release` | PASS — commit-stamped, `BUILD_INFO.json` written |
| Version sync | `npm run check-version` | 2.0.0 in package.json, tauri.conf.json, Cargo.toml |
| Packaged startup | portable EXE, 15 s | stayed alive, stopped cleanly |
| Packaged IPC + CSP | `node scripts/verify-ipc.mjs` | **14/14 PASS** |
| Offline / telemetry | `npm run verify:offline` | 0 outbound, 0 listeners, no secret persisted |
| Recycle Bin round-trip | `npm run verify:trash` | PASS — shell-visible, 6,144 B exact |
| NSIS install/launch/uninstall | `scripts/verify-installer.ps1 -Kind nsis` | PASS |
| MSI install/launch/uninstall | `scripts/verify-installer.ps1 -Kind msi` | PASS (per-user mode) |
| 10,000 candidates | `bench:scale` | 24.5 s · 69.6 MB |
| 50,000 candidates | `bench:scale` | 131.8 s · 293.9 MB |
| 1,000,000 directory entries | `bench:entries` | 122.0 s · 7.1 MB |
| 300,000 recordings | `bench:measure` | 47.7 s · 5.5 MB |
| Cancel reaction, 20k candidates | `cancel_latency` benchmark | 4 ms to return, `partial=true` |

Full security detail: `docs/security/FINAL_SECURITY_AUDIT.md`.
Test coverage detail: `docs/release/TEST_MATRIX.md`.
Gate checklist: `docs/release/RELEASE_CHECKLIST.md`.
Build provenance: `docs/release/BUILD_PROVENANCE.md`.

### 2.1 What changed in the follow-up pass

The first pass found one confirmed P1 blocker (stale artifacts) plus four median
verification gaps that were recorded as "pending". This pass fixed the former and
executed the latter:

| Item | Resolution |
|---|---|
| Stale artifacts shipped from a different revision (F-11) | Clean-tree gate, commit stamp in the binary, mtime freshness check, `BUILD_INFO.json`, `get_build_info` + About card, IPC cross-check |
| Machine-specific `.cargo/config.toml` (F-12) | Reduced to a machine-independent file; `CARGO_TARGET_DIR` is the supported override |
| Recycle Bin round-trip (F-1) | `npm run verify:trash` — real bin, shell-visible, exact byte accounting |
| Trash failure fallback (F-2) | `recycle_failure_no_fallback` — error surfaced, target untouched |
| Performance budgets (F-3) | All four benchmarks measured, plus a cancel-latency benchmark |
| OneDrive placeholder (SEC-19) | Still not executed; reparse-point hard block is executed and covers the defence |
| Crash during delete (SEC-28) | `crash_during_delete` — mid-delete kill leaves no audit record |
| Secret persistence (SEC-26) | `secret_persistence` — canary never reaches app storage |
| No telemetry (SEC-27) | `verify:offline` — zero outbound connections in a real session |
| Installer coverage | `verify-installer.ps1` — NSIS and MSI round-trip |
| `chunks_exact` clippy warning | Fixed with `as_chunks`; clippy now clean on all targets |

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
- Snapshot identity fails closed when the Windows file id is unavailable, and the
  reported free-space delta is signed so a decrease is never hidden.
- Every registered Tauri command now has a real frontend consumer; the unused
  `get_storage_snapshots` command was removed.
- Custom title-bar controls (minimize / maximize / close) and window dragging
  were verified on the packaged build with real `plugin:window|*` invokes. The
  ACL capability set is guaranteed at build time: `src-tauri/build.rs` fails if
  the generated `capabilities.json` is missing or empty, and the release script
  regenerates `gen/schemas` and the package build-script output before compiling.
- **New:** the compiled revision is embedded in the binary and surfaced in the
  About card, so a support report can be matched to the audited commit.

## 4. Packaging artifacts (2026-11-01, rebuild of `283eb6d`)

| Artifact | Size | SHA-256 |
|---|---|---|
| `Node-Cleaner-2.0.0-Portable.exe` | 11.13 MB | `EC1B2CB3B64EF55A13E95443A0F241D919B8C2AF659AEB5A8E02BFE7DE3340A0` |
| `Node-Cleaner-2.0.0-x64-Setup.exe` | 2.66 MB | `58BEBA484B50F39F0879E891B257C2AE894A2D7EF12E9E1CC5D6679371BA197C` |
| `Node-Cleaner-2.0.0-x64.msi` | 3.82 MB | `2ECB308318AA17BCA888C35E1D322F56E35489C5F47682E6891A094B6C9F9494` |

**These hashes belong to a `dirty: true` build and are recorded for verification
of the pipeline, not for publication.** `release_output/BUILD_INFO.json` says so
explicitly. Publishing step:

```powershell
git status --porcelain        # must print nothing
npm run build:release         # no --allow-dirty
type release_output\BUILD_INFO.json   # dirty must be false
```

Checksums are regenerated into `release_output/SHA256SUMS.txt` by the release
script.

## 5. Residual risk / blockers

| Blocker | Severity | Status |
|---|---|---|
| Artifacts currently `dirty: true` — not publishable | **P1** | Must rebuild from a clean commit |
| Windows 10 clean-install smoke (F-4) | P2 | NOT EXECUTED — no Windows 10 host |
| SEC-19 OneDrive cloud-only placeholder | P2 | NOT EXECUTED — no placeholder; reparse-point block executed |
| Code signing absent (F-6) | P3 | OPEN — external certificate |
| 2.0 screens EN/TR only (F-5) | P3 | Documented limitation |
| Dev-toolchain advisories (F-8) | P3 | OPEN — none ship in the release build |
| Dependency CVE scan | P3 | NOT EXECUTED — no network access to an advisory database |

Executed and closed in this pass: SEC-17, SEC-18, SEC-26, SEC-27, SEC-28, Recycle
Bin round-trip, trash-failure fallback, all four performance benchmarks, NSIS and
MSI installer round-trips.

Non-blocking, documented limitations:

- MSI is generated `perMachine`; a standard user gets error 1925 from a plain
  `/i`. NSIS is the consumer channel; MSI is the elevated / enterprise channel.
- `mask_paths` defaults to `false` (paths visible by default).

## 6. Final statement

No critical or high-severity **deletion** defect was found in the audited code.
The one High finding of the audit (F-11) was a release-integrity defect — the
binary a user would have received was not the reviewed source — and it is now
gated by mechanism (clean-tree gate, embedded commit, freshness check,
`BUILD_INFO.json`, runtime cross-check) instead of by operator discipline.

For a DIRECT-LIVE product the rebuild step is not optional: publish only a package
whose `BUILD_INFO.json` shows `"dirty": false` and the audited commit. With that
done, and with F-4 accepted or executed, public production is **GO**.
