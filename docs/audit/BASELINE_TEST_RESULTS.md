# WBS-002 — Baseline Test Results (pre-change)

**Date:** 2026-10-28
**HEAD:** `7571670cef42b76cec017cd9c0d47ca6df656859`

Environment note: the repository `.cargo/config.toml` redirects `target-dir`
to `%TEMP%\\node_cleaner_target`. The shell session initially inherited
`TMP=D:\\tmp` (non-existent), which broke `link.exe`. Commands below were run
with `TMP`/`TEMP` explicitly set to the user temp directory. This is an
environment issue, not a project defect.

## Commands and results

| Command | Result |
|---|---|
| `npm ci` | PASS — 152 packages installed |
| `cargo test` (with TMP fixed) | PASS — **9 tests** (scanner 3, deletion 3, settings 3) |
| `npm test` | PASS — **24 tests** in 4 files |
| `npm run typecheck` | PASS — no diagnostics |
| `npm run build` | PASS |

## Known issues recorded before changes

1. **`reclaimed_bytes` is never populated in production.** `DeletionCoordinator::delete_batch`
   takes `get_size_for_path`, but `delete_node_modules` passes `|_| None`.
2. **Cancellation is reported as failure.** `DiscoveryEngine::discover` returns
   `Err(AppError::ScanCancelled)`, and `run_scan` propagates it; the UI receives
   `ScanEvent::Failed` instead of a partial/cancelled summary.
3. **Per-item IPC.** Each candidate and each measurement is emitted as a single
   event; 10k+ candidates cause a large number of small messages.
4. **Frontend path authority.** Deletion is authorized by path, with the only
   proof being the exact folder name `node_modules`.
5. **No allocated-size measurement.** Logical bytes only; compressed/sparse
   files and hardlinks are not modelled.
6. **Documentation drift.** README/docs describe features that do not exist.

These issues were fixed or superseded in 2.0 (see `docs/MASTER_SPEC.md` and
`docs/security/FINAL_SECURITY_AUDIT.md`).
