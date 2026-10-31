# Test Matrix & Recorded Results

**Date:** 2026-10-31
**Environment:** Windows 11 (10.0.26200), x64, Node 24.22.1, Rust 1.99.1
**Note:** commands were run with `TMP`/`TEMP` pointed at the user temp folder
because this shell session inherited a non-existent `D:\\tmp` (environment
issue only).

## 1. Automated results

| Suite | Command | Result |
|---|---|---|
| Rust library + unit tests | `cargo test` | **86 passed, 0 failed** |
| Git-unavailable integration | `cargo test --test git_unavailable` | **1 passed** |
| Frontend unit/feature/stress | `npm test` | **26 passed, 0 failed** |
| TypeScript | `npm run typecheck` | **PASS** |
| Clippy | `cargo clippy --all-targets` | **0 warnings, 0 errors** |
| Production frontend build | `npm run build` | **PASS** |
| Tauri release (NSIS+MSI+portable) | `npm run build:release` | **PASS** |
| Packaged app startup | launch portable, wait 8 s | **stayed alive, exit 0 on stop** |
| Packaged IPC under CSP | WebView2 DevTools probe | **PASS** (`get_catalog`, `get_app_settings`, `get_known_locations`) |

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
- Settings: v1→v2 migration, corrupt file preservation, clamping,
  protected-path normalisation/dedupe, relative path anchoring, excluded-name
  normalisation.
- Audit: JSONL round-trip, malformed line tolerance, growth calculation,
  official-action append/list/limit, action history separated from cleanup
  history, `clear_all` idempotency.
- Shell helpers: argument validation rejects blank/quote/newline values.
- End-to-end: scan → summary → plan → permanent delete → verify.

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

See `docs/SECURITY_MODEL.md` §4 and `docs/audit/FINAL_SECURITY_AUDIT.md`.
Result: 24 automated PASS, 6 verified by code review with manual execution
pending (live recording, unsupported volume for trash, OneDrive placeholder,
secret audit, no-telemetry audit, crash injection).

## 5. Performance — actual status

| Scenario | Status |
|---|---|
| 10,000 / 50,000 candidates | **NOT EXECUTED** (no fabricated numbers) |
| 1,000,000 directory entries | **NOT EXECUTED** |
| 300,000 browser recordings | **NOT EXECUTED** |
| 100 GB sparse file | **NOT EXECUTED** |
| 10,000 hardlinks | Partially covered (one hardlink pair automated) |
| Cancel during scan | Automated at discovery level |
| Antivirus-induced latency | **NOT EXECUTED** |
| Access denied / partial results | Automated via warnings/errors paths |

The implementation has bounded queues, batched IPC, virtualized tables and
configurable limits, but the large-scale budgets in the master specification
remain unverified. Public release requires running these on a reference
machine and attaching the measurements.

## 6. Manual checklist still required before public release

1. Trash a real project folder and confirm it appears in the Windows Recycle Bin.
2. Empty the bin and confirm reported bytes match Explorer.
3. Trash on a volume without a Recycle Bin → error, no permanent fallback.
4. Claude Code running → its items are blocked; after exit, they become
   selectable.
5. Antigravity actively recording → `browser_recordings` blocked; after 2 idle
   minutes, selectable.
6. OneDrive cloud-only placeholder target → rejected, no download.
7. Network capture during a full session → zero outbound requests.
8. Kill the process during a multi-item permanent delete → no false success in
   UI; restart shows no audit record for the incomplete run.
9. Windows 10 clean install smoke test (NSIS, MSI, portable).
10. 50,000-candidate scan and 1M-entry tree with memory/CPU measurement.
