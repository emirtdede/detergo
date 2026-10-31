# Final Security Audit — Node Cleaner 2.0.0

**Date:** 2026-10-31
**Version audited:** 2.0.0
**Environment:** Windows 11 (10.0.26200), x64, Node 24.22.1, Rust 1.99.1
**Method:** source review, automated tests, and packaged-app runtime probe

This document records what was actually executed for the 2.0.0 code base. It
does **not** claim capabilities that were only reviewed or that require
hardware/environment not available during the audit. Where a scenario is still
manual, it is marked **PENDING** and blocks public production release.

---

## 1. Build and automated evidence

| Check | Command | Result |
|---|---|---|
| Rust unit + integration | `cargo test --manifest-path src-tauri/Cargo.toml` | **86 passed, 0 failed** + **1 integration passed** |
| Frontend tests | `npm test` | **26 passed, 0 failed** |
| TypeScript | `npm run typecheck` | **PASS** |
| Clippy | `cargo clippy --all-targets` | **0 warnings, 0 errors** |
| Production build | `npm run build` | **PASS** (1,953 modules) |
| Release packages | `npm run build:release` | **PASS** — NSIS, MSI, portable, SHA-256 |
| Packaged app launch | portable EXE, 8 s | **stayed alive, stopped cleanly** |
| Packaged IPC under CSP | WebView2 DevTools probe (see §3) | **PASS** — real `invoke` calls returned data |

Packages produced on 2026-11-01:

| Artifact | Size | SHA-256 |
|---|---|---|
| `Node-Cleaner-2.0.0-Portable.exe` | 10.83 MB | `7E3D4B5789E51976888E90C3D40C0FCA6408DCDE433C2F224EA3C8087F17E833` |
| `Node-Cleaner-2.0.0-x64-Setup.exe` | 2.60 MB | `912826580285C78D134E0AEBCDA761DF26A43578A14E14EB946D49E2D023F617` |
| `Node-Cleaner-2.0.0-x64.msi` | 3.74 MB | `B21422F23139EC2BD9F372BFCA1C1CE5ABE716C79D20239271D9FCB117993DFE` |

`release_output/SHA256SUMS.txt` is generated from these files by
`scripts/build-release.js`.

## 2. Safety-critical controls re-verified in this audit

| Control | Implementation | Test evidence |
|---|---|---|
| Deletion only by backend target IDs | `preview_cleanup` resolves IDs against the live scan session | `unknown_target_ids_are_rejected` |
| Session binding and expiry | `ScanRegistry`, 30-minute session TTL | `session_registry_rejects_unknown_and_dedupes_ids`, `expired_sessions_are_rejected` |
| Plan single use | `consume_plan` removes the plan atomically | `plans_are_consumed_exactly_once` |
| Confirmation token | 15-minute TTL, one-time token | `changed_target_invalidates_the_plan`, wrong-token tests |
| Revalidation before deletion | path guard, identity, measured size, evidence, Git, active use | `changed_target_invalidates_the_plan`, `recreated_target_fails_identity_check`, `snapshot_identity_fails_closed_when_file_id_is_unknown` |
| Volume accounting honesty | signed free-space delta; decreases surface as negative | `volume_free_delta_is_signed` |
| Trash-first, no silent permanent fallback | `trash` crate error is surfaced; permanent only in permanent mode | code review + `permanent_mode_requires_explicit_acknowledgement` |
| Permanent requires separate ack | mode + `acknowledged` flag | `permanent_mode_requires_explicit_acknowledgement` |
| KEEP never selectable | `protected`, `selectable`, `autoSelectable=false` | `protected_targets_cannot_be_planned`, `unknown_provider_targets_are_blocked` |
| Unknown targets fail closed | catalog validation, `REVIEW` downgrade | catalog negative fixtures |
| Reparse points never scanned | discovery prunes every reparse point | `discovery_does_not_descend_into_junctions` |
| Path escape | component-aware containment, system roots, user-protected list | `path_guard_*`, `system_roots_are_rejected_by_path_analysis` |
| Scan cancellation token identity | `CancellationToken::id`/`same`, `release_scan_token` | `finishing_scan_only_clears_its_own_token` |
| Measurement partial results | deadline/cancel returns `None`, scan marked partial | `cancelled_measurement_is_not_reported_as_complete`, `expired_deadline_is_not_reported_as_complete` |
| Active use | live process names + sharing violation, fail-closed on unknown | `active_agent_blocks_execution_even_when_scan_was_idle` |
| Audit separation | cleanup history vs. `actions.jsonl` official-action audit | `action_history_is_separate_from_cleanup_history` |
| Audit write failure surfaces | `audit_error` on `CleanupReport` / `OfficialActionResult` | code paths exercised by unit tests for repository |
| Settings atomicity | `MoveFileExW` replace | settings persistence tests |
| Shell argument safety | rejects blank/quotes/newlines, absolute path required | `shell_arguments_reject_line_breaks_and_quotes` |

## 3. CSP / IPC runtime verification

`src-tauri/tauri.conf.json` sets:

```
default-src 'self'; connect-src 'self' ipc: http://ipc.localhost;
img-src 'self' data: asset: http://asset.localhost;
style-src 'self' 'unsafe-inline'; script-src 'self'
```

The packaged portable build was launched with a WebView2 remote-debugging port
and real Tauri commands were invoked from the running page:

| Invoke | Result |
|---|---|
| `get_catalog` | `{ ok: true, rules: 56, valid: true }` |
| `get_app_settings` | `{ ok: true, theme: "dark-black", schemaVersion: 2 }` |
| `get_known_locations` | `{ ok: true, count: 2 }` |
| `get_agent_providers` | `{ ok: true, providers: 3 }` |

Window functionality was verified on the same packaged process by invoking the
core window commands directly and by replaying the drag-region matcher:

| Invoke / interaction | Result |
|---|---|
| `plugin:window|is_maximized` | `{ ok: true }`, flips false → true → false around `toggle_maximize` |
| `plugin:window|minimize` | `{ ok: true }`, `is_minimized` then returns `true` |
| `plugin:window|internal_toggle_maximize` (double-click path) | `{ ok: true }` |
| `plugin:window|close` | `{ ok: true }`, process exits |
| `plugin:window|start_dragging` | `{ ok: true }` |
| `mousedown` on the title bar / center bar / actions gap | drag starts (`defaultPrevented: true`) |
| `mousedown` on brand, settings, location pill, window-control buttons | not treated as drag (click reaches the control) |

These checks cover what the earlier packages got wrong: a stale build-script
output left the compiled runtime authority empty, so every `plugin:window|*`
call was rejected with `not allowed by ACL`. `src-tauri/build.rs` now fails the
build if `capabilities.json` / `acl-manifests.json` are missing or the
capability set is empty, and `scripts/build-release.js` regenerates
`src-tauri/gen/schemas` and the package build-script output before every
release build.

This proves the production CSP does not block Tauri IPC, rather than only
assuming it from configuration.

## 4. 30-scenario security matrix

See `docs/security/SECURITY_MODEL.md` §4 for the full table. Current status:

- **24 scenarios:** automated PASS.
- **6 scenarios:** review-verified, execution **PENDING** because they need a
  live recording, an unsupported volume, a cloud-only placeholder, a full
  network capture, a crash injection, or a clean Windows 10 machine:
  SEC-17, SEC-18, SEC-19, SEC-26, SEC-27, SEC-28.

No scenario is claimed as executed when it was not.

## 5. Findings and residual risk

| ID | Severity | Finding | Status |
|---|---|---|---|
| F-1 | Medium | Recycle Bin round-trip on a real volume (visibility + byte accounting) not executed | OPEN — manual |
| F-2 | Medium | Trash on a volume without a Recycle Bin not executed end-to-end | OPEN — manual |
| F-3 | Medium | Large-scale performance budgets (10k/50k candidates, 1M entries, 300k recordings) not measured | OPEN — benchmark |
| F-4 | Medium | Windows 10 clean-install smoke test not executed (audit machine is Windows 11) | OPEN — environment |
| F-5 | Low | 2.0 screens use the `ui-text` EN/TR dictionary; the legacy header uses the 75-locale dictionary. New screens therefore fall back to English/Turkish only | OPEN — documented limitation |
| F-6 | Low | Binaries are not code-signed; SmartScreen will warn until an external certificate is applied | OPEN — external |
| F-7 | Info | `mask_paths` defaults to `false`; paths are shown by default | Accepted (matches current UX) |
| F-8 | Low (dev-only) | `npm audit --omit=dev` reports 0 vulnerabilities, but the dev toolchain (Vite 6 / Vitest 3 / tinypool) has advisories that require a major upgrade; none ship in the release build | OPEN — toolchain upgrade |
| F-9 | Info | Snapshot identity now fails closed when the Windows file id cannot be read, so an unverifiable target is blocked rather than assumed unchanged | FIXED — `snapshot_identity_fails_closed_when_file_id_is_unknown` |
| F-10 | Info | `get_storage_snapshots` was registered but never called by the UI; removed so every registered command has a real frontend consumer | FIXED — command list re-verified |

No critical or high-severity deletion defect was found in the audited code.

## 6. Decision

```
Internal / controlled beta: GO
Public production:          NO-GO
```

Reason: all automated gates pass and the destructive path is guarded and tested,
but the six manual security scenarios, the real Recycle Bin round-trip, the
large-scale benchmarks and the Windows 10 smoke test remain unexecuted. Until
those are recorded, public production must not be declared.
