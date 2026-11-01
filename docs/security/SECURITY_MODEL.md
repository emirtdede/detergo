# Security Model

## 1. Assets protected

1. User source code and uncommitted work.
2. Credentials and configuration (`.env`, `auth.json`, `config.toml`, settings).
3. AI agent conversations, checkpoints, memory, plans, worktrees and databases.
4. Project reproducibility (manifests, lockfiles, vendored dependencies).
5. User trust in what was deleted and how much space was actually reclaimed.

## 2. Threat model

| Threat | Example | Control |
|---|---|---|
| Frontend compromise / bug | Crafted `delete` with arbitrary path | Backend target IDs + session binding |
| Path traversal | `..\\..\\Windows` | Canonicalisation + component-aware containment |
| Reparse escape | Junction swapped after scan | Reparse/symlink rejection, file identity, re-validation |
| Evidence drift | `package.json` removed between scan and delete | Evidence snapshot re-check |
| Git data loss | Tracked `dist` committed | Git guard → `REVIEW` + hard block |
| False positive | Folder named `build` in an unrelated place | Marker + generic-name rules, scan-root-bounded evidence |
| Active use | Claude writing `tasks/*.output` | Provider process check + recent-write check |
| Stale approval | Plan created before files changed | 15-min TTL, token, size/identity check |
| Trash failure | Network path / disabled bin | Error reported; **no permanent fallback** |
| Secret leakage | Chat transcripts in logs | Metadata-only scans; no content reads in audit |
| Silent telemetry | Hidden upload | No network client in dependencies; offline by design |
| Unclear success | Delete partially fails | Per-item results + existence verification |

## 3. Defence layers

1. **Catalog validation** — strict schema; any invalid rule disables cleanup.
2. **Classification** — evidence, generic names, Git, confidence; unknown → `REVIEW`.
3. **Session/plan** — opaque IDs, TTL, confirmation token, snapshot.
4. **PathGuard** — root containment, system paths, profile root, reparse points,
   UNC/network, protected names/components, user protection list. Discovery also
   prunes every reparse point, so junction content outside the scan root never
   becomes a candidate.
5. **EvidenceGuard** — rule/name/project marker/content re-check.
6. **GitGuard** — tracked content blocked; Git unavailable → block for
   `denytracked` rules.
7. **ProcessGuard** — provider process or sharing violation blocks deletion.
8. **Execution** — Recycle Bin default; permanent needs separate ack; verify
   the path is gone before reporting success.
9. **Audit separation** — per-target cleanup history (`history.jsonl`) and
   official tool actions (`actions.jsonl`) are distinct records; a failed audit
   write is surfaced as `auditError` instead of being silently ignored.

## 4. Security test matrix (30 scenarios)

Status legend:
- **A** — automated test executed in this repository
- **R** — verified by code review; execution requires hardware/environment not
  available in this session (listed in §6)
- **P** — pass

| ID | Scenario | Status | Evidence |
|---|---|---|---|
| SEC-01 | Drive/scan root deletion | A/P | `path_guard_rejects_scan_root_and_protected_names` |
| SEC-02 | Windows directory | A/P | `system_roots_are_rejected_by_path_analysis` |
| SEC-03 | Program Files | A/P | same test |
| SEC-04 | Path traversal | A/P | `path_guard_rejects_targets_outside_the_scan_root`, `containment_is_component_aware` |
| SEC-05 | Junction target | A/P | `path_guard_rejects_directory_junctions` |
| SEC-06 | Symlink directory | A/P | `path_guard_rejects_symlinked_directories` |
| SEC-07 | Reparse/identity swap after scan | A/P | `recreated_target_fails_identity_check`, `changed_target_invalidates_the_plan` |
| SEC-08 | Random/foreign target ID | A/P | `unknown_target_ids_are_rejected` |
| SEC-09 | Expired session | A/P | `expired_sessions_are_rejected` |
| SEC-10 | Evidence change | A/P | `evidence_revalidation_fails_when_marker_disappears` |
| SEC-11 | Git-tracked build output | A/P | `git_guard_detects_tracked_and_untracked_content`, `tracked_git_content_is_never_safe` |
| SEC-12 | Git unavailable | A/P | `tests/git_unavailable.rs` (separate process, PATH cleared) |
| SEC-13 | Codex worktree root | A/P | `codex_targets_are_all_protected` |
| SEC-14 | Claude `file-history` | A/P | `claude_checkpoints_and_settings_are_protected` |
| SEC-15 | Codex SQLite/WAL | A/P | codex spec test (all targets protected) |
| SEC-16 | Antigravity `brain` | A/P | `antigravity_brain_is_protected_and_recordings_require_idle` |
| SEC-17 | Active browser recording | A/P | `browser_recording_setting_only_blocks_while_recently_active`, `antigravity_brain_is_protected_and_recordings_require_idle` |
| SEC-18 | Recycle Bin unavailable | A/P | `recycle_failure_reports_error_and_never_deletes_permanently` (a sharing violation forces the same error path) |
| SEC-19 | OneDrive cloud placeholder | R/P | reparse-point rejection is executed (`discovery_does_not_descend_into_junctions`); a real cloud-only placeholder was not available |
| SEC-20 | Read-only / permission error | A/P | `read_only_target_never_reports_false_success` |
| SEC-21 | Partial batch failure | A/P | `partial_batch_reports_success_and_failure_separately` |
| SEC-22 | Frontend asks for a KEEP target | A/P | `protected_targets_cannot_be_planned`, `agent_cache_target…`, `unknown_provider_targets_are_blocked` |
| SEC-23 | Duplicate target IDs | A/P | `duplicate_target_ids_are_processed_once` |
| SEC-24 | Nested parent/child | A/P | `parent_and_child_targets_are_not_double_counted` |
| SEC-25 | Hardlink accounting | A/P | `hardlinked_files_are_counted_once_for_allocated_size` |
| SEC-26 | Secret leakage | A/P | `tests/secret_persistence.rs` — canary never reaches app storage; `npm run verify:offline` |
| SEC-27 | No telemetry | A/P | `npm run verify:offline` — 0 outbound connections, 0 non-loopback listeners |
| SEC-28 | Crash during deletion | A/P | `tests/crash_during_delete.rs` — mid-delete kill leaves no audit record and unfinished targets on disk |
| SEC-29 | Settings migration | A/P | `test_v1_settings_migrate_without_data_loss`, corrupt-file preservation test |
| SEC-30 | Safe default selection | A/P | `autoSelectable` is false for every provider target; header checkbox selects `autoSelectable` only; `keeps blocked items visible but non-selectable` |

**Result: 29 automated / P; 1 scenario (SEC-19) review-verified / P with a
manual gap — the reparse-point block that defends it is executed, but a real
cloud-only placeholder was not available.**

Evidence for this result, including the packaged-app CSP/IPC probe, the offline
run, the crash-during-delete injection and the real Recycle Bin round-trip, is
recorded in `docs/security/FINAL_SECURITY_AUDIT.md`.

## 5. Known limitations (explicit)

1. Trash execution is opt-in rather than part of `cargo test`: `npm run
   verify:trash` creates its own throwaway folder, validates it with the
   production guard, moves it to the real Recycle Bin, confirms shell
   visibility and byte accounting, and removes only that probe item. It never
   empties the user's bin.
2. Hardlink deduplication is per target. Cross-target hardlinks can make the
   sum of estimates conservative (never understated for the selected set).
3. Agent recency detection uses a 2-minute write window; a paused recording
   older than that is treated as idle. Provider process detection is the
   primary gate.
4. OneDrive placeholder handling relies on reparse-point rejection and
   metadata-only reads; no cloud content is downloaded.
5. Official tool commands depend on the installed tool's flags; unsupported
   versions fail with a non-zero exit code that is shown to the user.
6. Docker and WSL are read-only by design.
7. Claude `purge` is not executed automatically: capability detection for
   third-party CLI flags cannot be verified offline, so the app never runs it.

## 6. Manual verification still required

Only one security scenario remains unexecuted:

1. **SEC-19** — target a OneDrive cloud-only placeholder and confirm it is
   rejected without downloading content. The reparse-point hard block that
   implements this is executed (`discovery_does_not_descend_into_junctions`); a
   real placeholder was not present on the audit machine.

Also outstanding, and outside the security matrix:

- Windows 10 clean-install smoke test (F-4) — no Windows 10 host was available.
  Run `scripts/verify-installer.ps1` there if Windows 10 is supported.
- Publishing step: publish only an artifact set whose
  `release_output/BUILD_INFO.json` shows `"dirty": false` and a commit equal to
  the audited `HEAD`. The current set satisfies both.

Everything else in §4 is executed; see `docs/release/TEST_MATRIX.md` for the
commands and results.
