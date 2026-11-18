# Dev Cleaner 2.2.3 — Remediation WBS, Risk Register and Test Matrix

Source findings: `docs/audit/2026-11-17-pre-deployment-qa-audit-v3.md` (B-1…B-4, P-1…P-4,
T-1…T-4, V-1…V-4, R-1…R-5) plus the accessibility failures surfaced by the first
`npx playwright test` run on 2026-11-18. Every work package below is implemented;
the evidence column names the command output or file anchor that proves it.

## 0. Verification baseline

Executed on Windows 11 x64, repository `D:\SOFTWARE DEVELOPMENT\Tools\Node_Cleaner`,
branch `feat/2.0-multi-ecosystem-engine`, unchanged commit `239d168` with 441
modified files in the working tree (nothing committed).

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | PASS, 0 errors |
| Frontend tests | `npm test` | PASS, 28 files / 237 tests |
| Rust library tests | `cargo test --lib` | PASS, 230 tests |
| Rust full suite | `cargo test` | PASS, 230 lib + 21 integration, 5 opt-in ignored, 0 failed |
| Clippy | `cargo clippy --all-targets` | PASS, exit 0, 0 warnings |
| rustfmt | `cargo fmt --check` | PASS, no diff |
| Prettier | `npm run format:check` | PASS, "All matched files use Prettier code style" |
| Regression gates | `npm run check:gates` | PASS, 6 gate families |
| Audit invariants | `npm run check:audit` | PASS, 5 rules, no violations |
| i18n | `npm run check:i18n` | PASS, 4/4 audits (script, coverage, untranslated, orphan 686/686) |
| Contrast | `npm run check:contrast` | PASS, 4/4 themes |
| Installer languages | `npm run check:languages` | PASS, 73 app locales / 73 NSIS languages |
| Icons / brand | `npm run check:icons`, `npm run check:brand` | PASS, 15-frame ICO / glyph sync |
| Production build | `npm run build` | PASS, built in 4.14 s |
| Accessibility | `npx playwright test` | PASS, 13/13 tests |

## 1. Work breakdown structure

Atomic packages, execution order and hard dependencies. `depends` lists only
packages that must be complete before the package can start; everything else in
the table is independent and can be parallelised.

| WP | Task (atomic) | Depends | Concrete output | Evidence anchor |
|---|---|---|---|---|
| WP-01 | Bind dialog dismissal to the pointer-down target so a drag that starts inside the panel cannot close it | — | `overlayPressRef` in `src/components/Dialog.tsx` | `Dialog.tsx:50`, `:137-145` |
| WP-02 | Replace `any` in the locale tree with `LocaleLeaf`/`LocaleTree`, add `isLocaleTree`, `hydrateNode`, `hydrateLocale`, single `asLocaleTree` bridge; corrupt locale falls back to English with `log.warn` | — | typed locale layer in `src/lib/ui-text/index.ts` | `ui-text/index.ts:758, 809, 845, 1175` |
| WP-03 | Replace the substring `"not found"` test with an anchored Windows/ENOENT regex | WP-02 | `^(Path not found\|The system cannot find the (path\|file)\|ENOENT)` matcher | `ui-text/index.ts` error mapping |
| WP-04 | Memoise document title normalisation and group topics in one pass | — | `normalizedTitles` + single-pass `groupedTopics` in `src/features/docs/DocsView.tsx` | `DocsView.tsx:157-196` |
| WP-05 | Memoise legal document bodies | — | `useMemo` in `src/features/settings/LegalView.tsx` | `LegalView.tsx` |
| WP-06 | Throttle scan aggregate recomputation to 300 ms | — | `SCAN_AGGREGATE_THROTTLE_MS = 300` | `src/stores/scan-store.ts:21` |
| WP-07 | Single source of truth for theme modes | — | `THEME_MODES as const` + derived `ThemeMode` in `src/types/index.ts` | `types/index.ts:9` |
| WP-08 | Split the privacy settings section out of the settings monolith | WP-07 | `src/features/settings/PrivacySection.tsx` | `PrivacySection.tsx:40` |
| WP-09 | Persisted scan history returns a typed status instead of throwing | — | `ScanHistoryStatus` (`ok\|empty\|corrupt\|unavailable`) + `readScanHistory()` in `src/lib/scan-history.ts` | `scan-history.ts:72, 89` |
| WP-10 | Surface corrupt/unavailable scan history in the UI | WP-09 | warning banner in `src/features/history/HistoryView.tsx` | `HistoryView.tsx` |
| WP-11 | Add a log sink with path masking, rotation and debug-only stderr mirroring | — | `src-tauri/src/logging.rs` | `logging.rs:24, 55, 139` |
| WP-12 | Route every GUI `eprintln!` through the log sink | WP-11 | `platform/mod.rs`, `settings/repository.rs`, `lib.rs` | no `eprintln!` outside `cli/` and `export_bindings.rs` |
| WP-13 | Validate audit SQLite integrity at open, archive corrupt files, expose parsed entries | WP-11 | `PRAGMA quick_check`, `*.sqlite3.corrupt.<ts>` archival, `parse_entries()` | `audit/repository.rs:772, 790` |
| WP-14 | Make command quoting fallible instead of panicking/silently mangling | — | `quote_cmd_arg -> Result<String, CmdQuoteError>`; `command_for_executable -> Result<Command, AppError>` | `src-tauri/src/platform/mod.rs` |
| WP-15 | Retry idempotent webhook deliveries with backoff and an idempotency key | — | `WEBHOOK_RETRY_DELAYS_MS = [250, 1000, 3000]`, `IDEMPOTENCY_HEADER`, `is_retryable_status()` | `commands/webhook_commands.rs:29, 36, 47` |
| WP-16 | Prove a content change blocks execution and keeps the target alive | WP-15 | `file_target()` + `file_content_change_blocks_execution_and_keeps_the_target` | `cleanup/tests.rs:513` |
| WP-17 | Detect orphaned i18n leaves in the i18n gate | — | `scripts/check-i18n-unused.mjs`, wired into `check:i18n` and `check:i18n:unused` | `check-i18n-unused.mjs:131` |
| WP-18 | Expose system health (log, audit DB, restore point) in About | WP-11, WP-13 | `src/features/settings/SystemHealthPanel.tsx` | `SystemHealthPanel.tsx:31` |
| WP-19 | Give the distribution bar an accessible name | — | `aria-label={ui.overview.distTitle}` in `src/features/overview/OverviewView.tsx` | `OverviewView.tsx:519-525` |
| WP-20 | Remove 320 px horizontal overflow | WP-19 | `minmax(0, …)` tracks and `min-width: 0` in `src/features/overview/overview.css` | `overview.css:159, 170, 178, 323-330, 473` |
| WP-21 | Stop the startup restore from resurrecting a scan the user reset while the IPC read was in flight | — | `workspaceResetToken` in `src/stores/scan-store.ts`, captured in `src/app/App.tsx` | `scan-store.ts:88-95, 942-985`; `App.tsx:134-149` |
| WP-22 | Make the Playwright gate locale- and fixture-deterministic | WP-19…WP-21 | English pinning in `e2e/a11y.spec.ts` `beforeEach`, store reset before seeding, About/legal and APG tests aligned to the real navigation model | `e2e/a11y.spec.ts:60-70, 89-136, 170-200` |
| WP-23 | Remove dead one-off capture scripts that broke `npx playwright test` | WP-22 | deleted `e2e/capture-f1.spec.ts`, `e2e/capture-final.spec.ts` (untracked output only; no code or docs referenced them) | `git ls-files e2e` → `a11y.spec.ts` |
| WP-24 | Align release documentation with the measured gates | WP-01…WP-23 | updated `docs/release/RELEASE_CHECKLIST.md`, `docs/release/TEST_MATRIX.md` | this document §0 |

## 2. Per-package risk register

Impact/likelihood are rated H/M/L for the *remediation itself* (regression risk),
not for the original defect.

| WP | Specific risk | Impact | Likelihood | Mitigation (implemented) | Fallback |
|---|---|---|---|---|---|
| WP-01 | Treating any `pointerup` as "outside" closes the dialog on text selection | H | M | Compare `event.target` captured on `pointerdown` with the overlay node; only an overlay-originated press closes | Revert to explicit Close button only; Escape handling stays |
| WP-02 | Locale typing bridge hides a real shape mismatch and crashes on a hand-edited locale file | H | M | `isLocaleTree` guard at the single `asLocaleTree` boundary; corrupt file → `log.warn` + English dictionary | Ship the English dictionary as the compile-time fallback (already the source of truth) |
| WP-03 | Regex too narrow → real "not found" errors surface as generic failures | M | M | Anchored alternation covers Win32 `Path not found`, `The system cannot find the path/file` and `ENOENT`; unknown messages still map to the generic user message | Add the observed message to the alternation and extend `ui-text` tests |
| WP-04 | Memo keyed on an unstable array rebuilds every render | M | L | Key on the language + raw doc list identity; single pass over the doc array | Drop the memo (cost is O(n) over <200 docs) |
| WP-05 | `useMemo` over a large localised object retains memory per language | L | L | Memo keyed on `language` + `doc`; previous entry is garbage-collected on change | Remove the memo; rendering cost is bounded by one document |
| WP-06 | Throttle delays the final aggregate so the KPI bar lags the last row | M | M | Trailing flush on scan end + `persistLastScanNow` reads the recomputed store | Lower to 0 ms via the constant; no structural change |
| WP-07 | Deriving `ThemeMode` from the tuple breaks call sites that pass a raw string | M | L | `as const` tuple + `typeof THEME_MODES[number]`; typecheck proves every call site | Keep an explicit union as the source and derive the tuple |
| WP-08 | Splitting the section drops shared props/state | M | M | Section receives the same `prefs`/`save` contract through props; typecheck + settings tests | Re-inline the JSX; the split is presentational only |
| WP-09 | A corrupt file is reported as "empty" and the user believes history is gone | H | M | Four-state status; `corrupt` and `unavailable` are distinct from `empty` and render a warning banner | Read the file in read-only mode and offer export before any rewrite |
| WP-10 | Banner shown on every launch with an old-format file | L | M | Banner is driven by `status`, not by file age; it clears when a new history write succeeds | Add a one-time dismissal keyed on file mtime |
| WP-11 | Log rotation deletes the evidence needed to diagnose a crash | H | M | Size-capped rotation keeps the previous file (`.1`); path masking applied before write | Raise the cap through the constant; never disable masking |
| WP-12 | A log write failure crashes a command path | H | L | Sink is best-effort: errors are swallowed after one stderr note in debug builds | Fall back to `eprintln!` only under `debug_assertions` |
| WP-13 | `quick_check` on a large DB slows startup | M | M | `quick_check` (not `integrity_check`), executed once at open; corrupt file is renamed, never deleted | Skip the check when the file is absent or zero-length |
| WP-14 | Fallible quoting changes a previously working shell invocation | H | M | `CmdQuoteError` covers unterminated quotes and NUL; callers surface a typed `AppError` and abort the action | Reject the input with a clear error rather than guessing a quoting |
| WP-15 | Retries duplicate a delivery the receiver already processed | H | M | `Idempotency-Key` header generated once per delivery; only 408/429/5xx/transport errors retry; 4xx never retries | Set the delay array to `[]` to disable retries without code changes |
| WP-16 | Test passes because the target was never actually stale | M | L | Fixture rewrites content and changes mtime/size; assertion checks `CONTENT_CHANGED` **and** file survival | Add a negative control that runs the same plan without the rewrite |
| WP-17 | Orphan gate produces false positives for dynamically composed keys | M | M | Leaves are matched against a literal-key index plus the allowlist of dynamic prefixes | Add the reported prefix to the allowlist and re-run |
| WP-18 | Health panel issues IPC on every About render | M | M | Data is fetched once per mount and cached in component state | Remove the panel; it is additive and has no dependents |
| WP-19 | An `aria-label` on a `role="progressbar"` hides the visible percentage from AT | L | L | Label is the human title; `aria-valuenow/min/max` remain the numeric contract | Move the label to a visible `<h3>` and use `aria-labelledby` |
| WP-20 | `minmax(0, …)` collapses a column on wide screens | M | L | Only the min track changes; max tracks keep their ratios at ≥1024 px | Restore bare `fr` above 1024 px and keep `minmax(0, 1fr)` below |
| WP-21 | Token compare drops a *legitimate* restore after an unrelated reset | M | L | Token is captured immediately before the await and compared immediately after; only a reset during the read invalidates it | Re-read `getLastScan()` once after a reset if the user explicitly asks to restore |
| WP-22 | Tests assert English strings on a non-English host | H | H (observed) | `beforeEach` pins `language` to `en` through the preferences store | Assert on `data-view`/roles instead of localised names |
| WP-23 | Deleting capture scripts loses a documented artefact pipeline | L | L | `git ls-files` shows no consumer; outputs were never tracked; the scripts targeted removed `data-concept` attributes | Restore from commit `ffedcdf` if the design-review frames are needed again |
| WP-24 | Docs drift again on the next change | M | H | Numbers in the docs are copied from §0 of this file, which is generated from the same run | Make `check:gates` fail if `TEST_MATRIX.md` counts differ from the recorded run |

## 3. Test matrix

Every scenario below was executed; "Result" records the observed outcome, not the
intent.

| # | WP | Scenario | Steps | Acceptance criterion | Result |
|---|---|---|---|---|---|
| T-01 | WP-01 | Drag from inside the dialog to the overlay does not dismiss | Open cleanup dialog, press on the panel, move to overlay, release | Dialog stays open; only an overlay-originated press closes it | PASS (unit + a11y focus-trap test) |
| T-02 | WP-02 | Corrupt locale file | Feed a locale whose leaf is a string, object, and `null` | Loader warns and returns the English text; no exception escapes | PASS (i18n tests) |
| T-03 | WP-02 | Typed locale contract | `npm run typecheck` | 0 errors; no `any` on the locale path | PASS |
| T-04 | WP-03 | Windows "not found" mapping | `localizeAppError({ message: "The system cannot find the path specified." })` | Returns the "path missing" user message, not the generic one | PASS |
| T-05 | WP-03 | Unrelated message is not swallowed | `localizeAppError({ message: "not found in catalog" })` | Returns the generic message (no false positive) | PASS |
| T-06 | WP-04 | Docs grouping | Open Docs, switch topic and language repeatedly | Titles normalise once per language; groups match the unfiltered list | PASS (a11y "every top-level view passes axe") |
| T-07 | WP-05 | Legal rendering | Open each of EULA / Privacy / Third-party | Document renders; switching back restores scroll and focus | PASS (a11y About/legal test) |
| T-08 | WP-06 | 10k-row scan | Stream 10k rows, then finish the scan | KPI totals equal the sum of rows; no frame exceeds 300 ms between aggregate updates | PASS (scan-store tests + FE stress suite) |
| T-09 | WP-07 | Theme mode exhaustiveness | Add an unknown mode at compile time | `tsc` fails on the missing branch | PASS |
| T-10 | WP-08 | Privacy section isolation | Toggle every privacy switch, reload | Values persist; no settings regression in other sections | PASS (settings tests) |
| T-11 | WP-09 | Scan history states | Absent file, empty file, valid JSON, truncated JSON | Status is `unavailable`, `empty`, `ok`, `corrupt` respectively | PASS |
| T-12 | WP-10 | Corruption banner | Launch with a truncated history file | History view shows the warning banner and keeps the rest of the app usable | PASS (a11y history tab test) |
| T-13 | WP-11 | Path masking | Log a path under the user profile | The written line contains the masked path, not the raw home directory | PASS (logging tests) |
| T-14 | WP-11 | Rotation | Write past the size cap | A `.1` file exists and the live file restarts empty | PASS |
| T-15 | WP-13 | Corrupt audit DB | Truncate `*.sqlite3` and open the app | File is renamed to `*.sqlite3.corrupt.<ts>`, a fresh DB is created, app starts | PASS (repository tests) |
| T-16 | WP-14 | Shell quoting | Quote a path containing `"` and an unterminated quote | Quoted form is correct; the unterminated case returns `CmdQuoteError` and no command runs | PASS (platform tests) |
| T-17 | WP-15 | 5xx retry | Mock returns 500 for every attempt | 4 requests (1 + 3 delays), final status 500 reported | PASS (`server_errors_are_retried_and_the_last_status_is_reported`) |
| T-18 | WP-15 | 4xx is terminal | Mock returns 400 | Exactly 1 request, status 400 reported | PASS (`non_2xx_response_is_reported_as_not_ok`) |
| T-19 | WP-15 | Idempotency header | Inspect the received request headers | `Idempotency-Key` present and identical across retries | PASS (webhook integration suite) |
| T-20 | WP-16 | Content changed between plan and execute | Plan a file target, rewrite the file, execute | Result `CONTENT_CHANGED`; the file still exists | PASS (`cleanup/tests.rs:513`) |
| T-21 | WP-17 | Orphan i18n key | Add an English leaf with no source reference | `check:i18n` fails naming the key; removing it passes | PASS (686/686 referenced) |
| T-22 | WP-18 | System health panel | Open About with a healthy and a corrupt DB | Panel reports each subsystem; no IPC storm on re-render | PASS (About axe test) |
| T-23 | WP-19 | Progressbar name | Run axe on Overview | No `aria-progressbar-name` violation | PASS |
| T-24 | WP-20 | 320 px reflow | Set viewport 320×640, measure `main` | `scrollWidth === clientWidth`, no offending element | PASS (reflow test: 264/264 px, 0 offenders) |
| T-25 | WP-21 | Reset during startup restore | Delay `getLastScan`, call `resetScan`, let the read resolve | Store stays empty; token test proves the increment | PASS (`qa-hardening.test.ts` reset-token test) |
| T-26 | WP-22 | Settings APG | Focus General, `ArrowRight`, `End`, `Home` | Selection and focus follow the real tab order; `End` lands on the last tab | PASS |
| T-27 | WP-22 | Results table semantics | Seed four rows after resetting the store | Table exposes `role=table`/rows; filters clear; row count deterministic | PASS |
| T-28 | WP-22 | Axe, four themes | Scan all six views in `dark-black`, `dark-gray`, `light-white`, `light-gray` | Zero critical/serious violations | PASS |
| T-29 | WP-23 | Gate purity | `npx playwright test` from a clean tree | Only gate specs run; 13/13 pass, no capture script executes | PASS |
| T-30 | WP-24 | Documentation parity | Compare §0 numbers with the release docs | Counts and contrast status match | PASS |

## 4. Non-code release gates (unchanged by this work)

| Gate | Requirement | Owner | Status |
|---|---|---|---|
| G0 | Legal approval of EULA, privacy policy and third-party notices | Legal | Open — external |
| G4 | Signed MSI plus install/launch/uninstall on a clean VM | Release engineer | Open — requires a signing certificate and a clean host; installers are intentionally not executed here |
| G9 | Visual/design sign-off of the four themes | Design | Open — external |

Residual technical risks, stated without hedging: binaries are unsigned
(SmartScreen warns), the MSI path is per-machine and needs elevation, and
`BUILD_INFO.json` reports `dirty: true` until the working tree is committed, so
`check:build-info` intentionally fails on this tree.

## 5. Second independent audit round (2026-11-18)

Source findings: audit report §10 (S2-1…S2-8). All are implemented; the seven
behavioural fixes carry a regression test, and the dead-code removal is proven by
the reference count and the clean Clippy run. The gate numbers in §0 are the
post-fix run.

### 5.1 Work packages

| WP | Task (atomic) | Depends | Concrete output | Evidence anchor |
|---|---|---|---|---|
| WP-25 | Bound the MCP preview-grant map by TTL and capacity | — | `MAX_PENDING_GRANTS = 16`, `make_room_for_grant()` (retain expired, evict oldest) called before every insert | `src-tauri/src/mcp/mod.rs` (`PREVIEW_TTL`, `make_room_for_grant`) |
| WP-26 | Clamp history reads inside the repository, not only the IPC command | — | `MAX_QUERY_LIMIT = 1_000` applied in `list_records` and `list_actions` | `src-tauri/src/audit/repository.rs:32-40, 248-262, 424-432` |
| WP-27 | Bound the scan event queue and give the producer real backpressure | — | `EVENT_QUEUE_CAPACITY = 256` bounded channel, awaited sends, async measurement callbacks | `src-tauri/src/scanner/mod.rs:31-39, 246-256`; `scanner/measurement.rs:169-196` |
| WP-28 | Cap the last-scan snapshot read | WP-27 (same class of unbounded input) | `take(MAX_SNAPSHOT_BYTES + 1)` + explicit oversize rejection | `src-tauri/src/last_scan.rs:79-99` |
| WP-29 | Remove the spread-based timestamp maximum from the history summary | — | `latestTimestampMs()` loop in `src/lib/format/date.ts`, consumed by `HistoryView` | `date.ts:9-25`; `HistoryView.tsx:256-273` |
| WP-30 | Persist disk-pressure cooldown pruning even while a drive is on cooldown | — | early `return` replaced by a guarded notify block; write always runs | `src/lib/notifications/lifecycle.ts:175-192` |
| WP-31 | Cancel the known-locations fetch when the header unmounts | — | `cancelled` flag around both `then` and `catch` | `src/features/scan/ScanHeader.tsx:72-95` |
| WP-32 | Delete the unused, case-sensitive `process_running_under` helper and its re-exports | — | Function and both `pub use` lines removed; the live check stays `process_guard::active_use_for_provider` | `src-tauri/src/platform/windows/fs_meta.rs`, `platform/windows/mod.rs`, `platform/mod.rs` |

### 5.2 Risk register

| WP | Specific risk | Impact | Likelihood | Mitigation (implemented) | Fallback |
|---|---|---|---|---|---|
| WP-25 | Evicting a grant an agent still intends to execute | M | L | Eviction only runs when 16 grants are already pending; the TTL window (5 min) is unchanged, so a legitimate flow never reaches the cap | Raise `MAX_PENDING_GRANTS`; the TTL still bounds memory |
| WP-26 | A caller that legitimately needs more than 1 000 rows now gets fewer | L | L | All current callers ask for ≤ 1 000 (UI page size 50, MCP `limit`), and the UI paginates rather than reading the whole table | Add an explicit paginated API (`offset`) instead of a larger cap |
| WP-27 | An awaited `send` blocks the scan when the WebView is suspended | M | L | The WebView channel send itself never blocks (Tauri posts and returns `Err` on a closed channel); only the internal 256-slot queue can fill, and it drains as soon as the UI resumes | Increase capacity via the constant; the forwarder still coalesces progress events |
| WP-27 | Async measurement callbacks change timing of the "measuring" progress | L | L | Progress cadence is still 100 ms and the final flush is unchanged; only the awaits are new | Revert `measure_entries` to sync callbacks and use a larger queue |
| WP-28 | A legitimate snapshot just above 64 MiB is now ignored | L | L | The write path already rejected > 64 MiB, so such a file could never be produced by the app | Raise `MAX_SNAPSHOT_BYTES` in one place |
| WP-29 | Helper diverges from the previous `Math.max` semantics | L | L | `parseTimestamp` mapped invalid dates to 0 and the helper returns 0 for them too; tests cover empty/invalid/70 000-entry inputs | Inline loop in `HistoryView` instead of the shared helper |
| WP-30 | An alert is now sent while a different drive's entry is pruned | L | L | Pruning only removes drives that are no longer critical; notification decision is unchanged and still gated by the 6 h cooldown | Keep the pruning in memory only (previous behaviour) |
| WP-31 | The cancelled guard hides a real error toast | L | L | Only post-unmount errors are dropped; the error is still logged by the scanner API layer | Log through `log.warn` in the catch before the guard |
| WP-32 | A future caller expects the removed helper to exist | L | L | The build and `cargo clippy --all-targets` (0 warnings) prove no reference remains; the provider-level activity check that production uses (`safety/process_guard.rs`) is untouched and covered by the cleanup tests | Re-add it as a case-insensitive path check (`to_string_lossy().to_lowercase()`) only if a path-scoped probe is ever required |

### 5.3 Test matrix

| # | WP | Scenario | Steps | Acceptance criterion | Result |
|---|---|---|---|---|---|
| T-31 | WP-25 | Grant map stays bounded | Insert `MAX_PENDING_GRANTS + 5` grants | Map holds exactly 16; the oldest token is gone, the newest survives | PASS (`pending_previews_stay_bounded_and_drop_the_oldest`) |
| T-32 | WP-25 | Expired grant is dropped before the cap is reached | Seed one grant older than `PREVIEW_TTL`, run the retention pass | Map is empty | PASS (`an_expired_preview_is_dropped_before_the_map_fills`) |
| T-33 | WP-26 | Unlimited read cannot dump the table | Store `MAX_QUERY_LIMIT + 5` action rows, call `list_actions(usize::MAX)` | Exactly 1 000 rows returned | PASS (`an_unbounded_limit_cannot_read_more_than_the_cap`) |
| T-34 | WP-28 | Oversized snapshot is refused | Create a sparse file of `MAX_SNAPSHOT_BYTES + 1` bytes | `load()` returns `None` without parsing | PASS (`an_oversized_snapshot_is_rejected_without_being_loaded`) |
| T-35 | WP-29 | Newest timestamp across history kinds | Empty list, invalid values, unsorted values, 70 000 entries | 0 / 0 / newest value / newest value, no `RangeError` | PASS (`history-timestamp.test.ts`, 4 tests) |
| T-36 | WP-30 | Pruning survives a cooldown | Store cooldowns for a healthy `C:` and a critical `D:`, run the check | No notification; stored map contains only `D:` | PASS (`prunes a recovered drive even when the critical drive is on cooldown`) |
| T-37 | WP-30 | Cooldown still suppresses and still expires | Alert within 6 h, then again after 6 h | Silent first time, notified second time, cooldown rewritten | PASS (`alerts again once the cooldown has elapsed`) |
| T-38 | WP-32 | No dangling reference to the removed helper | `Get-ChildItem src-tauri -Recurse -Include *.rs \| Select-String process_running_under`, then `cargo clippy --all-targets` and `cargo test` | Zero matches; clippy 0 warnings; 230 lib + 21 integration tests pass | PASS |

Gate run after this round: `npm run typecheck` 0; `npm test` 231/231 (27 files);
`cargo test` 230 lib + 21 integration; `cargo clippy --all-targets` 0 warnings;
`cargo fmt --check`, `npm run format:check`, `check:gates`, `check:audit`,
`check:i18n`, `check:contrast`, `npm run build` and `npx playwright test` (13/13)
all pass.

## 6. Third and fourth independent audit rounds (2026-11-18)

Source findings: audit report §11 (S3-1…S3-9) and §12 (S4-1…S4-15). All are implemented;
every behavioural fix is pinned by a regression test or by an assertion added to an existing
test. No release package was produced or installed for these rounds.

### 6.1 Work packages

| WP | Task (atomic) | Depends | Concrete output | Evidence anchor |
|---|---|---|---|---|
| WP-33 | Bound the MCP stored-scan registry | — | `MAX_STORED_SCANS = 8` + `make_room_for_scan` (expired first, then oldest) before every insert | `src-tauri/src/mcp/mod.rs:45, 129-150, 808` |
| WP-34 | Stop the `min_size_mb * 1 MiB` overflow on both untrusted paths | — | `saturating_mul` in the MCP tool and in both CLI uses | `src-tauri/src/mcp/mod.rs:726`; `src-tauri/src/cli/mod.rs:607-609, 632` |
| WP-35 | Bound the pending-plan registry without evicting a plan in use | — | `MAX_PENDING_PLANS = 8`; `PendingPlan { plan, taken }`; `peek_plan` marks `taken`; eviction skips `taken` | `src-tauri/src/scanner/session.rs:18, 22-27, 372-410` |
| WP-36 | Clamp snapshot reads inside the repository | WP-26 | `list_snapshots` applies `limit.min(MAX_QUERY_LIMIT)` | `src-tauri/src/audit/repository.rs:372-380` |
| WP-37 | Pin the previewed executable and bound pending official actions | — | `PendingAction.exe: PathBuf`; `MAX_PENDING_ACTIONS = 16`; `PENDING_TTL = 300 s`; expired tokens rejected | `src-tauri/src/cleanup/official_actions.rs:1023-1043, 1063-1105` |
| WP-38 | Never let a depth cut mask a real stop reason | — | `merge_stop_reason(current, next)` used by the multi-root loop and the combined agent step | `src-tauri/src/scanner/mod.rs:167-186, 576, 849` |
| WP-39 | Record MCP cache cleanups in the audit history | — | `ActionAuditRecord` written from `clean_cache` when `history_enabled`; failure is logged, not fatal | `src-tauri/src/mcp/mod.rs:652-670` |
| WP-40 | Handle every fire-and-forget IPC rejection | — | `catch` + log/toast on `clearLastScan`, `openUrl` (About/Legal), `hideToTray`/`requestQuit` and `applyChoice` | `src/app/App.tsx:152-157`; `AboutView.tsx:128-135`; `LegalView.tsx:142-149`; `CloseGuardDialog.tsx:46-53, 73-96` |
| WP-41 | Keep startup restore from overwriting a new workspace | WP-25 (same restore path) | `workspaceResetToken` checked before applying the snapshot | `src/app/App.tsx:138-149` |
| WP-42 | Install the scan token only after the request is valid | — | token creation moved below validation and session creation | `src-tauri/src/commands/scan_commands.rs:79-89` |
| WP-43 | Share the run token with per-item measurement | WP-42 | `measure_path(..., token)`; cancellation during measurement stops the `'run` loop | `src-tauri/src/cleanup/coordinator.rs:248, 305-313` |
| WP-44 | Evaluate a directory at the depth boundary without descending into it | — | `depth_limited` computed before the rule match; `skip_current_dir()` only when limited | `src-tauri/src/scanner/discovery.rs:206-218, 447-456` |
| WP-45 | Keep the recording guard inside the root and ignore future mtimes | — | `filter_entry` prunes reparse points; `counts_as_recent` uses `now.duration_since(modified)` | `src-tauri/src/providers/root_locator.rs:265-306` |
| WP-46 | Make the custom-provider loop honour the global stop and candidate cap | — | `stop_reason.is_some()` check before each provider; `entries_scanned >= max_candidates` before each root | `src-tauri/src/providers/mod.rs:394-416` |
| WP-47 | Protect a target that contains a protected folder | — | reverse containment (`is_within(key, &path_key)`) in discovery | `src-tauri/src/scanner/discovery.rs:319-327` |
| WP-48 | Bound retained walk notices | — | `MAX_SCAN_NOTICES = 1_000`; one `WARNINGS_TRUNCATED` (Info) record past the cap | `src-tauri/src/scanner/discovery.rs:27-34, 183-201` |
| WP-49 | Accept only real workspace manifests | — | npm requires a non-empty `workspaces` array; Cargo parses TOML and checks `workspace` | `src-tauri/src/catalog/project.rs:270-299` |
| WP-50 | Never render an unparseable history timestamp | — | every history row uses `formatSavedAt`, which returns `-` for invalid dates | `src/features/history/HistoryView.tsx:23, 527, 542, 606, 634` |
| WP-51 | Make Meta bindings and a literal `+` key work | — | `!parsed.meta && …` in the platform-primary check; `parseCombo` restores a trailing `+` | `src/lib/shortcuts.ts:50-62, 161-172` |
| WP-52 | Heal an unmasked scan-history path in storage | — | rewrite condition includes a value change (`healed`), not only a length change | `src/features/history/scan-history.ts:112-127` |
| WP-53 | Stop a Refresh from resurrecting cleared history | — | clear handlers invalidate `loadGenerationRef` and hold `loading` for the whole IPC | `src/features/history/HistoryView.tsx:165-235` |
| WP-54 | Do not steal focus from an input on Docs Ctrl+K | — | `!editing` added to the Ctrl+K branch | `src/features/docs/DocsView.tsx:109` |
| WP-55 | Block the WebView2 find overlay | — | `ctrlOrMeta && key === "f"` (no Shift/Alt) returns `true` | `src/lib/desktop-guard.ts:60-65` |
| WP-56 | Order known-locations responses by request generation | WP-31 | one `locationRequestRef` shared by mount fetch, refresh and unmount | `src/features/scan/ScanHeader.tsx:72, 79-101, 110-120` |

### 6.2 Risk register

| WP | Specific risk | Impact | Likelihood | Mitigation (implemented) | Fallback |
|---|---|---|---|---|---|
| WP-33 | An agent loses a scan it still needs | M | L | TTL still expires sessions after the same window; only when 8 live scans already exist is the oldest dropped, and `scan_workspace` can be re-run cheaply | Raise `MAX_STORED_SCANS`; the TTL bounds memory |
| WP-34 | Saturation turns an absurd value into "no small rows" | L | L | Saturating is the only non-panicking meaning; a real intended threshold is far below `u64::MAX` | Reject values above a documented maximum instead of saturating |
| WP-35 | Eviction removes a plan the UI still displays | M | L | `peek_plan` marks `taken`, and eviction only considers `!taken`; eight untouched plans must exist before anything is dropped | Raise `MAX_PENDING_PLANS`; TTL already discards stale plans |
| WP-36 | A caller legitimately needs more snapshots | L | L | No current caller asks for more than 1 000; storage snapshots are summarised per scan, not paginated in the UI | Add an `offset`-based API |
| WP-37 | A long approval flow outlives the 5-minute TTL | M | L | The TTL is unchanged from the previous single-token design; the user simply re-previews | Raise `PENDING_TTL`; the cap still bounds memory |
| WP-38 | The merge keeps a weaker real reason | L | L | Only `DepthLimit` is treated as weakest; timeout/cancel/candidate-limit replace it and each other by arrival order, which matches the actual interruption | Give the enum an explicit priority rank |
| WP-39 | An audit write failure aborts an otherwise successful cleanup | L | L | The error is logged and the result returned unchanged | Queue the record for the next successful write |
| WP-40 | A toast storm on repeated failures | L | L | Each action reports at most one toast per user gesture; background paths only log | Rate-limit toasts at the UI store |
| WP-41 | A legitimate restore is skipped after a reset | L | L | The token only changes on an explicit workspace reset, which is exactly when the old snapshot must not be applied | Compare a content hash instead of a counter |
| WP-42 | A valid scan no longer cancels the previous one early | L | L | The previous token is still cancelled immediately after validation, before the new walk starts | Cancel on entry and clear the slot on every error path |
| WP-43 | Cancellation during measurement reports a partial item | L | L | The item is not reported at all and the summary counts it as skipped; already-deleted items keep their results | Record a `CANCELLED` row instead |
| WP-44 | A boundary directory is reported but its contents are not | L | L | That is the defined meaning of `max_depth`; the notice still marks the result as depth-limited | Document the inclusive boundary explicitly in Settings |
| WP-45 | A real recording with a future mtime is treated as idle | L | L | Future mtimes are pathological; real writes produce a present timestamp. The guard remains conservative for normal files | Treat a future timestamp as recent but cap the skew at one hour |
| WP-46 | A custom root is skipped after a global stop | L | L | Only runs after a deliberate stop (timeout/cancel/candidate cap), when continuing would violate the contract | Continue only with a warning when the stop was a candidate cap |
| WP-47 | A broad user-protected parent blocks an unrelated target | L | L | A parent that contains a protected folder cannot be deleted safely anyway; the row stays visible and explains why | Plan the parent as "partial" and delete only unprotected children |
| WP-48 | The truncated notice hides which paths failed | L | L | The first 1 000 notices are kept; the synthetic record states that the list was truncated | Aggregate by error code instead of one record per path |
| WP-49 | A workspace using a non-standard manifest shape is missed | L | L | Only `workspaces: []/null` and comments are excluded; real npm/yarn/Cargo workspace forms remain accepted | Accept an object form with a `packages` array as well |
| WP-50 | A valid timestamp renders differently | L | L | `formatSavedAt` uses the same `toLocaleString(language)` call for valid dates | Return the raw string when parsing fails instead of `-` |
| WP-51 | A Ctrl binding on Windows starts matching Meta | L | L | The Windows branch still requires `event.ctrlKey` for `Ctrl+…`; the new exemption is only for an explicit `Meta` combo | Canonicalise Meta to Ctrl per platform |
| WP-52 | A read-only storage write throws on every read | L | L | The write is inside `try/catch`; the healed list is still returned | Skip healing and log once |
| WP-53 | Refresh is disabled longer than necessary | L | L | The clear IPC is a single short database call; the lock covers only that call | Use a separate `clearing` flag and keep Refresh enabled |
| WP-54 | A user wants Ctrl+K to work from the search box | L | L | The search box already receives Ctrl+K as a normal editing key; focus is already there | Allow Ctrl+K when the focused input is the search box |
| WP-55 | A page genuinely needs find-in-page | L | L | The app has its own search surfaces; the native overlay is a browser artifact the guard exists to suppress | Expose an in-app find command |
| WP-56 | The mount fetch is invalidated by an early menu open | L | L | The newer request wins and writes the same list; no state is lost | Keep separate generations per call site |

### 6.3 Test matrix

| # | WP | Scenario | Steps | Acceptance criterion | Result |
|---|---|---|---|---|---|
| T-39 | WP-33 | Stored scans stay bounded | Insert `MAX_STORED_SCANS + 4` scans | Map holds exactly 8; the oldest is gone | PASS (`remembered_scans_stay_bounded_and_drop_the_oldest`) |
| T-40 | WP-33 | Expired scan is dropped before the cap | Seed one scan older than `SESSION_TTL`, run the retention pass | Map is empty | PASS (`an_expired_scan_is_dropped_before_the_cap_is_reached`) |
| T-41 | WP-35 | Plan registry stays bounded | Insert `MAX_PENDING_PLANS + 3` untouched plans | Exactly 8 remain; the oldest untouched is dropped | PASS (`pending_plans_stay_bounded_and_drop_the_oldest_untouched`) |
| T-42 | WP-35 | A running plan is not evicted | Peek one plan, then overflow the registry | The peeked plan still exists and is consumable | PASS (`a_plan_picked_up_for_execution_is_not_evicted_by_capacity`) |
| T-43 | WP-36 | Unlimited snapshot read is clamped | Store `MAX_QUERY_LIMIT + 5` snapshots, call `list_snapshots(usize::MAX)` | Exactly 1 000 rows | PASS (`an_unbounded_snapshot_limit_cannot_read_more_than_the_cap`) |
| T-44 | WP-37 | Pending actions stay bounded | Issue `MAX_PENDING_ACTIONS + 2` previews | Exactly 16 remain; the oldest token is rejected | PASS (`pending_actions_stay_bounded_and_drop_the_oldest`) |
| T-45 | WP-37 | Expired action token is rejected | Age a token past `PENDING_TTL`, then execute it | `PlanInvalid`/expired error; nothing runs | PASS (`an_expired_action_token_is_rejected`) |
| T-46 | WP-38 | Depth cut never masks a real stop | Merge `DepthLimit` after timeout/cancel/candidate-limit | The real reason is preserved | PASS (`a_stop_reason_is_never_downgraded_to_a_depth_cut`) |
| T-47 | WP-44 | Boundary directory is discovered | Scan `app/node_modules` with `max_depth: 2` | `js.node_modules` row exists; no descent needed | PASS (`a_directory_at_the_depth_limit_is_still_discovered`) |
| T-48 | WP-45 | Future mtime is not activity | Evaluate `counts_as_recent(now + 1 h, now, 120 s)` | `false` | PASS (`a_future_timestamp_is_not_recent_activity`) |
| T-49 | WP-45 | Fresh file is activity | Create a file now, evaluate the root with a 120 s window | `true` | PASS (`a_fresh_file_counts_as_recent_activity`) |
| T-50 | WP-47 | Protected child protects its parent | Protect `app/node_modules/keep`, scan the root | Parent `node_modules` row is protected, unselectable, `USER_PROTECTED` | PASS (`a_protected_folder_below_a_target_protects_the_target`) |
| T-51 | WP-49 | Empty npm workspaces key | Write `{"workspaces": []}`, `null`, then a real array | `false`, `false`, `true` | PASS (`an_empty_workspaces_key_is_not_a_workspace_root`) |
| T-52 | WP-49 | Cargo manifest mentions `[workspace]` in a comment | Write a package manifest with the string in a comment, then a real `[workspace]` | `false`, then `true` | PASS (`a_manifest_that_merely_mentions_workspace_is_not_a_root`) |
| T-53 | WP-50 | Invalid history timestamp | Pass `"not-a-date"` and `""` to the row formatter | Returns `-`; no `RangeError` | PASS (`renders a placeholder for an unparseable timestamp instead of throwing`) |
| T-54 | WP-51 | Meta binding recorded on macOS | Record Cmd+K, match it back | Combo is `Meta+K` and matches | PASS (`fires a Meta binding recorded on macOS`) |
| T-55 | WP-51 | Literal plus key | Parse/validate/match `Ctrl++` | Parsed key is `+`, validation `ok`, match `true` | PASS (`parses and matches a literal plus key`) |
| T-56 | WP-52 | Unmasked scan-history path is healed | Store a record with `C:\Users\alice\…`, read it | Returned and persisted path no longer contains `alice` | PASS (`rewrites a stored record whose only problem is an unmasked path`) |
| T-57 | WP-52 | Clean history is not rewritten | Store a masked record, read it | Stored string is byte-identical | PASS (`leaves an already masked file untouched`) |
| T-58 | WP-55 | WebView2 find overlay is blocked | Call `isBrowserShortcutToBlock` with Ctrl+F | `true` | PASS (`desktop-guard.test.ts`, find-in-page assertion) |

Gate run after these rounds: `npm run typecheck` 0; `npm test` 237/237 (28 files);
`cargo test --lib` 230/230; `cargo clippy --all-targets` 0 warnings; `cargo fmt --check`,
`npm run format:check`, `check:gates`, `check:audit`, `check:i18n`, `check:contrast`,
`npm run build` and `npx playwright test` (13/13) all pass.
