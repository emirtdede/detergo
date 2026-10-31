# WBS-001 — Baseline Audit

**Date:** 2026-10-28
**Repository HEAD:** `7571670cef42b76cec017cd9c0d47ca6df656859`
**Working tree at audit start:** documents moved from repository root into `docs/` (deletions + untracked `docs/`), otherwise clean.

## Verified technology versions

| Component | Version (verified from manifests / toolchain) |
|---|---|
| Rust toolchain | 1.99.1 (2026-10-13) |
| Cargo | 1.99.1 |
| Tauri (crate) | 2.11.5 resolved in `Cargo.lock` |
| tauri-build | 2.6.3 |
| React | 19.x (`@types/react` 19.0.10) |
| TypeScript | 5.7.3 |
| Vite | 6.4.3 installed (manifest `^6.2.0`) |
| Vitest | 3.2.7 installed (`^3.0.7`) |
| Zustand | 5.x |
| Node.js | v24.22.1 |
| npm | 11.19.1 |
| Product version at baseline | 1.0.0 |

The old documents claimed a broader product scope than the code implemented. They were treated as historical input only; every claim below comes from source or real command output.

## Actual pre-change module inventory

### Rust (`src-tauri/src`)

| Module | Reality at baseline |
|---|---|
| `scanner::discovery` | Hard-coded `node_modules` detection with `walkdir`; skipped nested `node_modules`; no catalog |
| `scanner::metadata` | `package.json` / lockfile detection, 4-level monorepo search |
| `scanner::size` | Logical `metadata.len()` summation only; no allocated size, no hardlink identity |
| `scanner::models` | `NodeModuleEntry`, per-item `Candidate`/`Measured` events |
| `deletion::guard` | Basename must be `node_modules`; root/system checks; **no session binding, no evidence, no Git check** |
| `deletion::recycle_bin` | `trash` crate; no post-condition verification |
| `deletion::permanent` | `remove_dir_all`; no re-validation beyond basename |
| `deletion::coordinator` | Batch over caller-supplied **paths**; `reclaimed_bytes` read from an optional callback that the UI never supplied |
| `commands::deletion_commands` | `delete_node_modules(paths: Vec<String>)` — frontend held path authority |
| `settings` | Schema v1: theme, favorites, recents, sort, language |
| `platform::windows` | Known dev folders only |

### Frontend (`src`)

| Area | Reality |
|---|---|
| Screens | Single screen: scan hero + `node_modules` table + settings modal |
| Stores | scan/selection/preferences/ui |
| i18n | 71 language dictionaries, shared `TranslationSchema` |
| Themes | 16 flat themes + legacy aliases |
| Tests | 24 Vitest tests |

## Gaps between documents and code

1. No catalog, providers, planner, sessions, history, or global cache manager existed.
2. `reclaimed_bytes` was structurally always 0 in real use (no size provider wired from commands).
3. Cancellation surfaced as a scan error (`Err(ScanCancelled)`) instead of a partial result.
4. Deletion accepted arbitrary frontend paths; the only proof was the folder name.
5. No allocated-size / hardlink-aware measurement.
6. No AI agent awareness at all.
7. README described the 1.0 single-purpose product only.

## Conclusion

Baseline was trusted only where verified by source and by the baseline test run
(`docs/audit/BASELINE_TEST_RESULTS.md`). The 2.0 implementation extends the
existing scanner rather than creating a second parallel scanner.
