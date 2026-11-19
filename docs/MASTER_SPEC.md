# Dev Cleaner 2.0 — Master Specification

**Status:** Normative. Where older documents disagree, this document wins.
**Product:** Dev Cleaner 2.0.0 · Vellium · Windows 11 x64 (Windows 10 unverified)
**Date:** 2026-10-28
**Stack:** Tauri 2 · Rust · React 19 · TypeScript · Zustand

## 1. Product scope

Dev Cleaner detects and safely removes reproducible developer artifacts across
ecosystems and analyses AI coding agent storage. Everything runs locally. There
is no telemetry, account, server, advertisement or cloud dependency, and no
network request starts without a click (an optional webhook, the update check or
opening a link).

### Supported modules

| Module | Status | Notes |
|---|---|---|
| Overview | Implemented | Totals, provider breakdown, largest targets |
| Project Cleaner | Implemented | Catalog-driven, multi-ecosystem |
| AI Agent Storage Manager | Implemented | Codex, Claude Code, Antigravity; metadata only |
| Global Tool Cache Manager | Implemented | npm, pnpm, Yarn, Bun, pip, NuGet, Go; Docker/WSL read-only |
| Cleanup Planner | Implemented | Backend-owned plan + token, TTL, revalidation |
| Cleanup History | Implemented | Local JSONL audit, per-item result |
| Settings | Implemented | Protections, limits, agent policy, privacy |

### Ecosystems

JavaScript/TypeScript and their frameworks, Python, Rust, .NET, Java/Kotlin,
Go, PHP, Dart/Flutter, C/C++ (CMake), Unity, Unreal, Ruby/Elixir/Swift/Godot
(catalog-level). Every rule is validated at startup.

## 2. Safety invariants (non-negotiable)

- **FR-S1** Deletion is authorized only by backend-generated target IDs from a
  live scan session. The frontend never supplies filesystem paths for deletion.
- **FR-S2** A plan is generated server-side, bound to a session, expires after
  15 minutes, and requires a confirmation token.
- **FR-S3** Every target is re-validated immediately before deletion:
  path guard, file identity, measured size, evidence, Git state, active use.
- **FR-S4** Recycle Bin is the default. A recycle failure never falls back to
  permanent deletion.
- **FR-S5** Permanent deletion requires an explicit plan mode plus a separate
  acknowledgement flag.
- **FR-S6** Protected targets (`KEEP`) are not selectable and are rejected by
  the backend even if a manipulated frontend asks for them.
- **FR-S7** AI agent sessions, worktrees, credentials, memory, checkpoints,
  conversations, brain data and SQLite databases are `KEEP`.
- **FR-S8** Provider storage is never auto-selected; AI targets have
  `autoSelectable = false`. Bulk-select operates only on rows explicitly marked
  `selectable` after a user action, never automatically.
- **FR-S9** Unknown or under-evidenced targets are `REVIEW`, never `SAFE`.
- **FR-S10** Git-tracked content is never removed by a generic rule.
- **FR-S11** Report success only after verifying the path is gone; report
  measured bytes only.
- **FR-S12** Trash moves are not reported as freed disk space.

## 3. Safety classes

| Class | Meaning | Default selection | Deletable |
|---|---|---|---|
| `safe` | Proven reproducible cache | Yes (project targets only) | Yes |
| `regenerate` | Reinstall/rebuild required | No | Yes |
| `review` | User data risk, costly rebuild, or weak evidence | No | Yes, manually |
| `keep` | Protected | No | No |

Extra fields on every item: `confidence` (high/medium/low), `activeUse`
(yes/no/unknown), `evidenceCodes`, `warningCodes`, `cleanupMethod`
(trash/permanent/officialTool/none), `regenerateHint`, `protected`,
`selectable`, `autoSelectable`.

## 4. Target model

`CleanupItem` (see `src/types/index.ts` and `scanner/models.rs`):

- identity: `id`, `scanSessionId`, `ruleId`, `provider`
- grouping: `ecosystem`, `category`, `projectId`, `projectName`, `projectRoot`
- display: `displayName`, `displayPath` (display only — not authority)
- size: `logicalBytes`, `allocatedBytes`, `estimatedReclaimBytes` (nullable)
- decision: `safetyClass`, `confidence`, `activeUse`, `evidenceCodes`,
  `warningCodes`, `cleanupMethod`, `regenerateHint`
- state: `protected`, `selectable`, `autoSelectable`, `status`, `parentItemId`

`null` sizes mean **not measured**, and unmeasured targets are blocked at plan
time (`NOT_MEASURED`).

## 5. IPC contract

| Command | Purpose |
|---|---|
| `start_scan(request, onEvent)` | Project or agent scan; batched events |
| `cancel_scan()` | Cooperative cancellation |
| `get_catalog()` | Rule catalog + validation state |
| `get_scan_summary(scanSessionId?)` | Stored summary |
| `get_agent_providers()` | Provider/root discovery |
| `preview_cleanup(scanSessionId, targetIds, mode)` | Server-side plan |
| `execute_cleanup(planId, confirmationToken, permanentAcknowledged)` | Execute |
| `get_global_cache_providers()` | Sizes, versions, official actions |
| `preview_official_action(providerId, actionId)` | Command preview + token |
| `execute_official_action(token)` | Whitelisted argv execution |
| `get_cleanup_history(limit)` | Audit records |
| `get_growth_report()` | Snapshot comparison |
| `get_app_settings()` / `save_app_settings(settings)` | Settings |
| `get_known_locations`, `open_path_in_explorer`, `open_url` | Shell helpers |

Scan events: `started`, `candidates[]` (batches of 100), `measured[]`
(batches of 100), `progress`, `warning`, `completed`, `cancelled`, `failed`.

## 6. Scan behaviour

- Default limits: depth 32, 50,000 candidates, 15 minutes. Configurable.
- Cancellation produces a **partial** result with `stopReason = cancelled`;
  it is not an error.
- Candidate/depth/time limits produce `partial = true` and an explicit reason.
- Nested targets are linked by `parentItemId`; selecting parent and child does
  not double-count (child becomes `COVERED_BY_PARENT`).
- `node_modules` children are not traversed; known child rules (`.next/cache`,
  `.yarn/cache`, `.nx/cache`) are traversed only through declared parents.
- Project evidence is bounded by the scan root. Evidence from ancestors above
  the scan root is never accepted.

## 7. Measurement

- Logical size: sum of file lengths.
- Allocated size: `GetCompressedFileSizeW`; falls back to logical if unknown.
- Identity: `GetFileInformationByHandle` (volume serial + file index).
- Hardlinked files (link count > 1) are counted once per measurement.
- If any file cannot be inspected, `allocatedBytes = null` (logical only).
- Cross-target hardlink deduplication is **not** aggregated; estimates may be
  conservative for exotic layouts (documented limitation).

## 8. Cleanup lifecycle

`DISCOVER → CLASSIFY → MEASURE → PREVIEW → VALIDATE → USER CONFIRMATION →
REVALIDATE → EXECUTE → VERIFY → AUDIT`

Any failure stops that item; it never silently upgrades the method.

## 9. Global tool caches

Only fixed executable + argv, never a shell command assembled from user input:

```
npm cache clean --force
pnpm store prune
yarn cache clean
bun pm cache rm
pip cache purge
dotnet nuget locals all --clear
go clean -modcache
```

Unknown tool, missing executable or read-only provider → no execution.
Docker volumes/images and WSL VHDX files are never deleted by Dev Cleaner.

## 10. Settings (schema v2)

Theme, language, reduce motion, favorites, recents, sort; plus protected paths,
excluded names, scan profile, limits, minimum size, path masking, history
toggle, agent policy. v1 files migrate without data loss. Corrupt files are
copied to `config.corrupt.<timestamp>.json` before defaults are used.

## 11. Performance budget

| Metric | Target |
|---|---|
| Idle CPU | < 0.5 % |
| Idle disk I/O | 0 |
| Idle memory | preferably < 120 MB |
| First window | preferably < 1.5 s |
| Cancel reaction | ~250 ms |
| UI update rate | ≤ 10 Hz |
| Table | 10,000+ rows, virtualized |

Benchmarks on large synthetic trees are listed in `docs/release/TEST_MATRIX.md` with
their actual execution status.

## 12. Limits and honest reporting

- Unmeasured data is never shown as measured.
- Trash bytes are reported as moved, not freed.
- Estimated and verified reclaim are separate values.
- Partial scans display their stop reason.
- A capability that cannot be verified is disabled and documented.
