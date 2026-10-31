# Architecture

## 1. System overview

```
React 19 / TypeScript / Zustand
  Overview · Projects · AI Tools · Tool Caches · History · Settings
                    │
              Tauri IPC (Channel + commands)
                    │
Rust core ──────────────────────────────────────────────
 catalog/      catalog index, evidence matcher, project resolver
 scanner/      discovery, limits, measurement, sessions, orchestration
 safety/       path guard, Git guard, process guard, evidence guard
 cleanup/      plan, coordinator, recycle bin, permanent, official actions
 providers/    root locator, agent specs, growth analysis
 measurement/  Windows metadata (in platform/windows/fs_meta.rs)
 settings/     schema v2 + atomic repository
 audit/        JSONL history + storage snapshots
 commands/     thin Tauri command layer + AppState
                    │
          Windows filesystem / Win32 APIs
```

## 2. Scan flow

1. `start_scan` creates a `ScanSession` with an opaque UUID and the set of
   filesystem roots that may contain targets (one root for project scans; the
   discovered agent roots plus `%USERPROFILE%` for agent scans).
2. Project scans run `DiscoveryEngine` inside `spawn_blocking`:
   - `walkdir`, links not followed, same file system, default/name exclusions
   - name → catalog rules; nested rules allowed only under declared parents
   - project root resolved once per directory, bounded by the scan root
   - evidence collected from project root + workspace root only
   - Git state consulted only for `git_policy = denytracked` rules
   - classification downgrades anything under-evidenced to `review`
   - candidates emitted in batches of 100
3. Measurement runs on a bounded worker pool (2–4) and emits batches.
4. Sizes/status are written back into the session; the summary is stored.
5. Agent scans use fixed provider specs instead of filesystem name matching and
   are metadata-only.

## 3. Deletion flow

```
target IDs ──► build_plan (server-side)
                ├─ dedupe IDs
                ├─ resolve parent/child overlap
                ├─ check KEEP / active / method / measured
                └─ snapshot (exists, size, mtime, Windows file id)
                        │
              plan id + confirmation token (15 min)
                        ▼
execute_cleanup ──► re-measure + identity check
                ├─ PathGuard (roots, reparse, system, protected)
                ├─ evidence revalidation (or agent policy)
                ├─ Git guard (tracked content)
                ├─ active-use guard
                ├─ recycle OR permanent (never both)
                └─ verify path is gone → per-item result
                        ▼
                 audit record (if enabled)
```

Failures are per-item. A recycle error is final for that item; there is no
permanent fallback.

## 4. Key design decisions

| Decision | Rationale |
|---|---|
| Backend-owned target IDs | Removes frontend path authority (TOCTOU / injection) |
| Catalog in TOML, validated at startup | One source of truth, fail-closed on any invalid rule |
| Evidence only from project/workspace root | Prevented a real false positive discovered in tests (a stray `%USERPROFILE%\\package.json`) |
| Separate logical/allocated size | Honest reclaim estimates |
| Batched IPC (100 items) | Avoids O(n) message storms |
| Sessions + plans with TTL | Prevents stale approvals |
| Agent specs as explicit path lists | No name-based matching for sensitive storage |
| Official tool argv whitelist | No arbitrary shell execution |
| JSONL audit | Append-only, crash-tolerant, no database dependency |

## 5. Frontend structure

- `app/App.tsx` — shell: header, nav rail, active view, dialogs, toasts.
- `stores/scan-store.ts` — items keyed by id + ordered id list; measurement
  buffering for out-of-order events.
- `stores/selection-store.ts` — `Set<string>` selection with `prune`.
- `stores/preferences-store.ts` — full v2 settings; persists via IPC.
- `features/items/ItemTable.tsx` — virtualized table (TanStack Virtual),
  search, safety filter, "select safe" (only `autoSelectable`).
- `features/cleanup/*` — plan and result dialogs.
- `lib/ui-text` — EN/TR strings for the new modules; all other languages fall
  back to English for these keys (existing 71-language dictionaries untouched).

## 6. Failure behaviour

| Failure | Behaviour |
|---|---|
| Catalog invalid | Cleanup disabled, `get_catalog` reports the error |
| Settings corrupt | File preserved, defaults used |
| Git unavailable | `REVIEW` classification; rule-based deletion blocked |
| Trash unavailable | Item error, no permanent fallback |
| Partial scan | Explicit `partial` + `stopReason`; unmeasured items blocked |
| Session/plan expired | User must rescan/repreview |
| Agent running | Provider items blocked; cannot be selected |
