# Scan History Migration — 2.3 Draft

**Status:** draft only. Not implemented in 2.2.1. See ADR-3 in
`docs/audit/REMEDIATION_PLAN_TR.md`.

## Current state (2.2.1)

Scan history lives in the frontend, in `localStorage`, managed by
`src/features/history/scan-history.ts`:

- Schema-validated records (`LAST_SCAN_SCHEMA_SUPPORTED`).
- Maximum 50 records; anything older than 90 days is pruned on write.
- Corrupt or partial JSON is dropped instead of breaking the list.
- A quota failure is surfaced to the user; nothing is lost silently.

The backend keeps a separate, independent record of executed cleanups
(`audit/history.jsonl`) and only the most recent scan snapshot
(`last_scan.json`). Scan history as such is not persisted in Rust.

## Why the split exists

Scan history is a UI convenience: it stores summaries that the user already saw.
Moving it behind IPC means a schema, migration and retention policy on both
sides, which did not fit the 2.2.1 remediation window.

## Migration plan for 2.3

1. **Backend store.** Add `ScanHistoryRepository` writing
   `<appdata>/dev-cleaner/scan-history.jsonl`, one JSON object per line, with a
   `schemaVersion` envelope.
2. **Command surface.** `get_scan_history(limit)`, `append_scan_history(record)`,
   `clear_scan_history()`.
3. **Dual write.** 2.3 writes to both localStorage and the backend for one
   release. Reads prefer the backend and fall back to localStorage.
4. **One-time import.** On first 2.3 launch, import existing localStorage
   records through `append_scan_history`, then mark the import complete.
5. **Cleanup release (2.4).** Remove the localStorage reader; keep pruning at
   50 records / 90 days server-side.

## Retention

| Rule | Value |
| --- | --- |
| Max records | 50 |
| Max age | 90 days |
| Pruning trigger | On append and on read |
| Fail behaviour | Drop the oldest record and log once |

## Open questions

- Should scan history survive an uninstall? (Current: no.)
- Should the webhook payload reuse these records? (Deferred.)
