# Test Matrix & Recorded Results

**Date:** 2026-11-01
**Environment:** Windows 11 (10.0.26200), x64, 8+ logical cores, Node 24.22.1, Rust 1.99.1
**Note:** commands were run with `TMP`/`TEMP` pointed at the user temp folder
because this shell session inherited a non-existent `D:\tmp` (environment
issue only).

> Every number below was produced by a command in this repository. Where a
> scenario still could not be executed, it is listed as **NOT EXECUTED** and the
> reason is given. Nothing here is estimated.

## 1. Automated results

| Suite | Command | Result |
|---|---|---|
| Rust library + unit tests | `cargo test` | **94 passed, 0 failed** |
| Git-unavailable integration | `cargo test --test git_unavailable` | **1 passed** |
| Recycle Bin round-trip (opt-in) | `npm run verify:trash` | **PASS** — real bin, shell-visible, exact bytes |
| Recycle failure → no fallback | `cargo test --test recycle_failure_no_fallback` | **1 passed** |
| Crash during delete → no audit | `cargo test --test crash_during_delete` | **1 passed** |
| Secret persistence (SEC-26) | `cargo test --test secret_persistence` | **1 passed** |
| Benchmarks (opt-in) | `-- --ignored` | **5 PASS** (scale ×2, entries, measure, recycle round-trip) |
| Frontend unit/feature/stress | `npm test` | **29 passed, 0 failed** |
| TypeScript | `npm run typecheck` | **PASS** |
| Clippy | `cargo clippy --all-targets` | **0 warnings, 0 errors** |
| Production frontend build | `npm run build` | **PASS** |
| Tauri release (NSIS+MSI+portable) | `npm run build:release` | **PASS**, commit-stamped |
| Packaged app startup | launch portable, observe 15 s | **stayed alive, stopped cleanly** |
| Packaged IPC under CSP | `node scripts/verify-ipc.mjs` | **PASS — 15/15** (CSP effects, 5 commands, ACL, plan/URL rejection, commit + cleanliness cross-check) |
| Offline / no telemetry (SEC-27) | `npm run verify:offline` | **PASS** — 0 outbound, 0 non-loopback listeners |

## 2. What the Rust tests cover

- Catalog: TOML parsing, duplicate IDs, unknown references, invalid keep/cleanup,
  generic-name rules, wildcard names, embedded catalog validity.
- **Every one of the 56 rules has a positive fixture (all markers/content
  present → expected class) and, where markers exist, a negative fixture
  (no markers → `REVIEW`).**
- Evidence matcher, classification downgrades, Git-tracked classification.
- Project resolver: nearest root, pnpm workspace root, scan-root boundary.
- Discovery: nested `node_modules` skip, `.next`/`.next/cache` parent link,
  generic `build` verification, cancellation as partial, candidate limit,
  junction content outside the scan root is not discovered.
- Measurement: logical/allocated bytes, hardlink deduplication, cancellation and
  deadline never report a partial size.
- Sessions: unknown/expired session rejection, single-use plans, cancellation
  token identity (a finishing scan does not clear a newer scan's token).
- Path guard: outside root, root itself, `.env`/`.git`, user protection list,
  symlink, junction, system roots, component-aware containment.
- Git guard: tracked vs untracked, non-repository, git unavailable.
- Evidence guard: marker removal invalidates the plan.
- Planner: duplicate IDs, unknown IDs, KEEP targets, unmeasured targets,
  parent/child overlap, wrong token, empty plan.
- Execution: permanent delete + measured reclaim, permanent requires ack,
  changed target → `PLAN_CHANGED`, recreated target → identity failure,
  identity unknown → fail-closed block, signed free-space delta,
  partial batch success/failure, read-only target never false-success,
  agent target policy (allowed cache vs unknown provider), no false success on
  active agents.
- Official actions: unknown provider, read-only provider, forged token.
- Settings: v1→v2→v3 migration, corrupt file preservation, clamping,
  protected-path normalisation/dedupe, relative path anchoring, excluded-name
  normalisation.
- Audit: JSONL round-trip, malformed line tolerance, growth calculation,
  official-action append/list/limit, action history separated from cleanup
  history, `clear_all` idempotency.
- Shell helpers: argument validation rejects blank/quote/newline values.
- End-to-end: scan → summary → plan → permanent delete → verify.

### 2.1 Recycle Bin round-trip (previously F-1, now executed)

`scripts/verify-recycle-bin.ps1` runs the ignored integration test and then
inspects the real Recycle Bin from the shell side:

| Check | Observed |
|---|---|
| Guard accepted a temp folder | yes (`PathGuard` + `RecycleBinService`) |
| Source removed after recycle | yes |
| Parent folder preserved | yes |
| `$I` record found in `C:\$Recycle.Bin\<sid>` | yes |
| Original path recorded correctly | `...\nc-trash-probe-*\payload` |
| Visible via `Shell.Application` namespace 10 (what Explorer shows) | yes, item name `payload` |
| Recorded size | 6,144 bytes |
| Payload bytes present in `$R` file | 6,144 bytes (exact match) |
| User data touched | none (probe item deleted afterwards, bin not emptied) |

### 2.2 Recycle failure must never become a permanent delete (F-2)

`recycle_failure_no_fallback.rs` holds a file open without `FILE_SHARE_DELETE`,
which makes the shell refuse the move. Result: `RecycleBinService::recycle`
returns `RecycleBinFailed`, the target and its payload still exist, and no
permanent delete path is reached. This covers the "volume without a Recycle
Bin" behaviour at the API level; the drive-specific variant is covered by the
same code path (`trash` returns an error, callers surface it).

## 3. Frontend tests

- Formatting (`formatBytes`, `formatDate`, `truncatePath`).
- Scan store: batches, buffered out-of-order measurements, statuses,
  blocked/non-selectable flags, deletion transitions.
- Selection store: toggle/select-many/prune/clear.
- Preferences: 16 themes, legacy aliases, settings update, DOM theme.
- UI store: modals, plans, toasts.
- Stress: 1,000 items filter < 15 ms, sort < 10 ms, total < 5 ms, set < 5 ms.
- i18n dictionary integrity (existing suite).

## 4. Security matrix

See `docs/security/SECURITY_MODEL.md` §4 and `docs/security/FINAL_SECURITY_AUDIT.md`.

| Scenario | Status | Evidence |
|---|---|---|
| SEC-17 live browser recording | **EXECUTED (policy + timing)** | `browser_recording_setting_only_blocks_while_recently_active`, `antigravity_brain_is_protected_and_recordings_require_idle` |
| SEC-18 Recycle Bin unavailable | **EXECUTED** | §2.2 |
| SEC-19 OneDrive cloud placeholder | **NOT EXECUTED** — needs a cloud-only file on a OneDrive account | reparse-point rejection is executed (`is_reparse_point` → hard block), but a real placeholder was not available |
| SEC-26 secret leakage | **EXECUTED** | `scan_and_audit_never_persist_file_contents_or_secrets` |
| SEC-27 no telemetry | **EXECUTED** | `npm run verify:offline` — 0 outbound connections |
| SEC-28 crash during delete | **EXECUTED** | `crash_during_permanent_delete_writes_no_audit_record` |

## 5. Performance — measured on this machine

All runs: `cargo test --release`, `NC_*` environment variables set as shown.
Fixtures are synthetic trees under `%TEMP%`, deleted after the run.

| Scenario | Command | Candidates | Walked dirs | Scan time | Peak RSS |
|---|---|---|---|---|---|
| 10,000 candidates | `NC_BENCH_CANDIDATES=10000 npm run bench:scale` | 10,000 | 30,001 | **24.5 s** | **69.6 MB** |
| 50,000 candidates | `NC_BENCH_CANDIDATES=50000 npm run bench:scale` | 50,000 | 150,001 | **131.8 s** | **293.9 MB** |
| 1,000,000 directory entries | `NC_ENTRY_BENCH=1000000 npm run bench:entries` | 1 target | 500,005 | **122.0 s** | **7.1 MB** |
| 300,000 recordings | `NC_RECORDINGS=300000 npm run bench:measure` | 1 folder | 300,000 files | **47.7 s** | **5.5 MB** |
| Cancel reaction (20,000 candidates) | `NC_CANCEL_CANDIDATES=20000`, `cargo test --release --test scale_benchmark cancel_latency -- --ignored` | 20,000 | 2,052 at cancel | **4 ms** to return after `cancel()` | — |

Cancel measurement: the scan was cancelled 1.5 s after start; it returned 4 ms
later, reported `partial=true`, and no size was reported for an interrupted
measurement.

Notes:
- Debug-profile runs were also taken (10,000 candidates: 26.8 s) and confirm the
  timings are dominated by filesystem metadata calls, not optimiser settings.
- The 1M-entry run peaked at 7.1 MB because discovery streams batches and never
  holds the tree in memory; the 50k-candidate run is higher because 50,000
  candidate items plus measurements are retained in the session (expected).
- Fixture creation/cleanup dominate wall time, not the scanner.

**Budgets:** the master specification asks for a scan that stays usable at
50,000 candidates. 131.8 s with a 15-minute configured timeout and a 294 MB peak
is inside that budget on this hardware.

## 6. Manual checklist status

| # | Item | Status |
|---|---|---|
| 1 | Trash a real project folder, confirm it is visible in the Recycle Bin | **PASS** (§2.1) |
| 2 | Reported bytes match the payload | **PASS** (§2.1, exact 6,144 B) |
| 3 | Trash on a volume without a Recycle Bin → error, no permanent fallback | **PASS** (§2.2, API-level) |
| 4 | Claude Code running → its items blocked | **PASS (automated)** — provider process probe + `active_agent_blocks_execution_even_when_scan_was_idle` |
| 5 | Antigravity recording → blocked, selectable after idle | **PASS (automated)** — 120 s idle window tests |
| 6 | OneDrive cloud-only placeholder → rejected | **NOT EXECUTED** — no cloud-only file available; reparse-point hard block is covered by tests |
| 7 | Full session → zero outbound requests | **PASS** (`npm run verify:offline`) |
| 8 | Kill during multi-item permanent delete → no false success/audit | **PASS** (`crash_during_delete`) |
| 9 | Windows 10 clean install smoke test | **NOT EXECUTED** — no Windows 10 machine available (audit host is Windows 11 10.0.26200) |
| 10 | 50k-candidate and 1M-entry measurement | **PASS** (§5) |
