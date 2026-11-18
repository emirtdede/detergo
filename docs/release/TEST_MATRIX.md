# Test Matrix & Recorded Results

**Date:** 2026-11-02
**Environment:** Windows 11 (10.0.26200), x64, 8+ logical cores, Node 24.22.1, Rust 1.99.1
**Note:** commands were run with `TMP`/`TEMP` pointed at the user temp folder
because this shell session inherited a non-existent `D:\tmp` (environment
issue only).

> Every number below was produced by a command in this repository. Where a
> scenario still could not be executed, it is listed as **NOT EXECUTED** and the
> reason is given. Nothing here is estimated.

## 0. 2.2.2 brand rollout (2026-11-10)

Source-level gates executed on Windows 11 x64 with Node 26.13.0 and the pinned
Rust toolchain:

| Suite | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | **PASS** |
| Frontend unit/feature/stress | `npm test` | **237 passed** in 28 files, 0 failed |
| Rust library | `cargo test --manifest-path src-tauri/Cargo.toml` | **230 passed**, 0 failed |
| Rust integration | same command | **21 passed** (crash, git, MCP Ã—9, recycle failure, secrets, webhook Ã—8), 0 failed |
| Accessibility (Playwright + axe) | `npm run test:a11y` | **13 passed** â€” axe on six views Ã— four themes, About/legal, APG tabs, focus traps, table semantics, 320 px reflow |
| Heavy opt-in tests | same command | 5 ignored by design (scale, entries, measure, recycle round-trip) |
| Clippy | `cargo clippy --all-targets -- -D warnings` | **PASS**, 0 warnings |
| rustfmt | `cargo fmt -- --check` | **PASS** |
| Prettier | `npm run format:check` | **PASS** |
| Production frontend build | `npm run build` | **PASS** |
| Icon structure | `npm run check:icons` | **PASS** â€” 15-frame ICO, 8 tray PNGs, 5 BMPs, manifest hashes |
| Brand integrity | `npm run check:brand` | **PASS** - glyph sync, no retired references |
| Installer language coverage | `npm run check:languages` | **PASS** â€” 73 app locales, 73 NSIS languages (21 project packs, 54 message packs), language-neutral copyright |
| Installer language gate strictness | `npm run generate:nsis-languages` then `check:languages` | **PASS** â€” the gate rejects a stale copy in the NSIS toolset's `Contrib` directory, a `.nlf` codepage other than 1200, a surviving English sentinel, a `LANG_ENGLISH` reference in a message pack, a BOM in a message pack, `\"` instead of `$\"`, and an English button word inside a localized sentence. Each was triggered deliberately during development and produced a named failure |
| Audit invariants | `npm run check:audit` | **PASS** â€” 5 rules |
| Version sync | `npm run check-version` | **PASS** â€” 2.2.3 everywhere |

The ICO was inspected with PIL: 15 frames in the required order, 256 stored as
PNG and the rest as 32-bit DIB. `scripts/check-exe-icons.mjs` was also run
against the 2.2.1 binaries and correctly failed with 8 frames, proving the gate
detects the regression it was written for. The visual inspection findings are
recorded in this document; this closes the engineering side of G9, not the
design-board signature.

Still **NOT EXECUTED** for 2.2.2: MSI install (needs an elevated session on a
separate host), Windows 10 22H2, and a repeat of the installer harnesses on a
clean VM. See `docs/release/RELEASE_CHECKLIST.md` G3â€“G8.

### 0.1 Release artifacts (executed)

`npm run build:release` was run from a clean tree. The build compiled the Rust
binary, produced the NSIS and MSI bundles, copied the three deliverables into
`release_output/`, and gated the packaged EXEs on icon frames.

| Check | Command | Result |
|---|---|---|
| Release build | `npm run build:release` | **PASS** â€” 3 artifacts; portable 18,489,856 B and MSI 8,454,144 B are stable, NSIS varies by a few KB. Hashes differ between builds because the binaries embed build metadata, so use the current `BUILD_INFO.json` |
| PE frame gate | inside `build:release` | **PASS** â€” `Dev-Cleaner-2.2.2-Portable.exe` and `Dev-Cleaner-2.2.2-x64-Setup.exe` each 15 frames / 15 `RT_ICON` |
| Raw binary frame gate | `npm run check:exe-icons -- src-tauri/target/release/dev-cleaner.exe` | **PASS** â€” 15 frames |
| Provenance | `npm run check:build-info` | **PASS** â€” version 2.2.2, recorded commit, `dirty: false`, 3 artifacts |

The evidence build is the commit named in `release_output/BUILD_INFO.json`, and
`check:build-info` enforces that it equals `HEAD` on a clean tree. `SHA256SUMS.txt`
holds the hashes of exactly those files. Because each build embeds its own
metadata, re-running `build:release` after any commit replaces those hashes and
invalidates the manifest â€” rebuild and re-run `check:build-info` before
publishing.

### 0.2 Runtime checks against the 2.2.2 packages (executed)

Run on the Windows 11 x64 development host. This host is not a clean VM; the
results prove the packages behave, not that a pristine image is unaffected.

| Check | Command | Result |
|---|---|---|
| CLI/GUI smoke on the portable EXE | `npm run verify:smoke -- -Exe release_output\Dev-Cleaner-2.2.2-Portable.exe` | **10/10 PASS** â€” version, scan, webhook 200/500/unreachable, language switch both ways, settings persistence, GUI liveness, valid settings JSON |
| NSIS install/uninstall | `npm run verify:installer` | **8/8 PASS** â€” silent install, version, installed EXE 15 frames, installed `app.ico` 15 frames and byte-identical, uninstaller 15 frames, silent uninstall, queued folder cleanup, no leftovers |
| Shell surfaces | `npm run verify:shell-icons` | **8/8 PASS** â€” `DisplayIcon` resolves to `app.ico`; desktop and Start menu shortcuts resolve their icon inside `$INSTDIR`; clean uninstall |
| 2.2.1 â†’ 2.2.2 upgrade (NSIS) | `npm run verify:upgrade -- -Kind NSIS` | **8/8 PASS** â€” 2.2.1 installs, upgrades in place, reports 2.2.2, single Apps & Features entry at 2.2.2, upgraded EXE 15 frames, clean removal |
| MSI elevation guard | `npm run verify:msi` (non-elevated) | **Correctly aborts (exit 2)** - refuses to test the per-machine package as a per-user install |
| Installer language table (silent) | `setup.exe /S /LANG=1045` then uninstall | **PASS (2.2.1 run)** â€” silent install/removal worked with a non-English language id. Re-run for 2.2.2 is listed under *Still NOT EXECUTED* below |
| Installer message packs present | `npm run check:languages` + generated `installer.nsi` | **PASS** â€” 54 `customLanguageFiles` entries are passed to makensis; Polish (`pl`) is among them, so the languages that would otherwise fall back to English for Tauri's own messages now have their own strings |
| Installer language picker, remembered language | open the setup with `Installer Language` = 1031 and 1115 | **PASS** â€” the dialog is shown on both runs, its title/info are localized (`YÃ¼kleyici Dili` / `LÃ¼tfen bir dil seÃ§in.` under the Turkish Windows UI language), and it preselects the remembered language under its native name (`Deutsch`, `à·ƒà·’à¶‚à·„à¶½`). The title follows the Windows UI language because MUI resolves the defines before it reads the registry; the stock LangDLL OK/Cancel labels are compiled into the plugin and stay English |
| Generated-language wizard chrome | Sinhala (1115), Tamil (1097), Urdu (1056) wizard captures | **PASS** â€” title, welcome text, directory page, buttons, body sentence and footer localized; `Next >`/`Browse...` no longer leak; Urdu mirrors the header to the left |
| Uninstaller chrome and branding | real 2.2.2 install, Sinhala uninstaller welcome/confirm/finish captures | **PASS** â€” `unheader.bmp` lockup inset beside the title, sidebar finish page lockup with 34 px margins, footer `Â© 2026 Vellium`, and every sentence localized including `Click Uninstall` and `Click Finish` |
| Installed shell surfaces, 100% | manual capture after the same NSIS install | **6/6 PASS** - desktop shortcut, Start menu result, Explorer extra-large icons, running taskbar button, tray overflow and in-app chrome all show the new mark (captures were review artifacts, not committed) |

Two harness defects were found and fixed by these runs: `Get-FileHash` does not
resolve in a Windows PowerShell session with a stripped `PSModulePath`, and the
upgrade script rejected the NSIS "empty folder queued for logon removal" end
state that `verify-installer` already accepted.

Still **NOT EXECUTED** for the 2.2.2 installer-language work: the silent
`/S /LANG=1045` install/uninstall against the 2.2.2 setup, and a click-through of
the install, license and finish pages for a sample of the 21 generated language
tables. The welcome and directory pages are captured for three of them (Sinhala,
Tamil, Urdu) because they cover the chrome that used to leak; the remaining
pages of those tables share the same generated file and were inspected as text.

`npm run check:contrast` **passes for all four themes** since 2.2.3: the semantic
tokens the checker expects are now defined in `src/styles/tokens.css`. The
Playwright accessibility suite is therefore part of the release gate rather than
being skipped.

## 1. Automated results

| Suite | Command | Result |
|---|---|---|
| Rust library + unit tests | `cargo test` | **230 passed, 0 failed** |
| Git-unavailable integration | `cargo test --test git_unavailable` | **1 passed** |
| Recycle Bin round-trip (opt-in) | `npm run verify:trash` | **PASS** â€” real bin, shell-visible, exact bytes |
| Recycle failure â†’ no fallback | `cargo test --test recycle_failure_no_fallback` | **1 passed** |
| Crash during delete â†’ no audit | `cargo test --test crash_during_delete` | **1 passed** |
| Secret persistence (SEC-26) | `cargo test --test secret_persistence` | **1 passed** |
| Benchmarks (opt-in) | `-- --ignored` | **5 PASS** (scale Ã—2, entries, measure, recycle round-trip) |
| Frontend unit/feature/stress | `npm test` | **237 passed, 0 failed** |
| Playwright accessibility | `npx playwright test` | **13 passed, 0 failed** |
| TypeScript | `npm run typecheck` | **PASS** |
| Clippy | `cargo clippy --all-targets` | **0 warnings, 0 errors** |
| Production frontend build | `npm run build` | **PASS** |
| Tauri release (NSIS+MSI+portable) | `npm run build:release` | **PASS**, commit-stamped |
| Packaged app startup | launch portable, observe 15 s | **stayed alive, stopped cleanly** |
| Packaged IPC under CSP | `node scripts/verify-ipc.mjs` | **PASS â€” 15/15** (CSP effects, 5 commands, ACL, plan/URL rejection, commit + cleanliness cross-check) |
| Offline / no telemetry (SEC-27) | `npm run verify:offline` | **PASS** â€” 0 outbound, 0 non-loopback listeners |

## 2. What the Rust tests cover

- Catalog: TOML parsing, duplicate IDs, unknown references, invalid keep/cleanup,
  generic-name rules, wildcard names, embedded catalog validity.
- **Every one of the 56 rules has a positive fixture (all markers/content
  present â†’ expected class) and, where markers exist, a negative fixture
  (no markers â†’ `REVIEW`).**
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
  changed target â†’ `PLAN_CHANGED`, recreated target â†’ identity failure,
  identity unknown â†’ fail-closed block, signed free-space delta,
  partial batch success/failure, read-only target never false-success,
  agent target policy (allowed cache vs unknown provider), no false success on
  active agents.
- Official actions: unknown provider, read-only provider, forged token.
- Settings: v1â†’v2â†’v3 migration, corrupt file preservation, clamping,
  protected-path normalisation/dedupe, relative path anchoring, excluded-name
  normalisation.
- Audit: JSONL round-trip, malformed line tolerance, growth calculation,
  official-action append/list/limit, action history separated from cleanup
  history, `clear_all` idempotency.
- Shell helpers: argument validation rejects blank/quote/newline values.
- End-to-end: scan â†’ summary â†’ plan â†’ permanent delete â†’ verify.

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
- Bulk select: filtered provider rows stay selectable even when
  `autoSelectable` is false, while protected/non-selectable rows are excluded.
- Close guard: `closeAction` defaults to `ask`, remembers `tray`/`quit`, and
  rejects unknown values so the guard can never be disabled by a bad file.
- Cache store: measurement progress keeps accumulating after the Tool Caches
  view unmounts.
- Preferences: 16 themes, legacy aliases, settings update, DOM theme.
- UI store: modals, plans, toasts.
- Stress: 1,000 items filter < 15 ms, sort < 10 ms, total < 5 ms, set < 5 ms.
- i18n dictionary integrity (existing suite).

## 4. Security matrix

See `docs/security/SECURITY_MODEL.md` Â§4 and `docs/security/FINAL_SECURITY_AUDIT.md`.

| Scenario | Status | Evidence |
|---|---|---|
| SEC-17 live browser recording | **EXECUTED (policy + timing)** | `browser_recording_setting_only_blocks_while_recently_active`, `antigravity_brain_is_protected_and_recordings_require_idle` |
| SEC-18 Recycle Bin unavailable | **EXECUTED** | Â§2.2 |
| SEC-19 OneDrive cloud placeholder | **NOT EXECUTED** â€” needs a cloud-only file on a OneDrive account | reparse-point rejection is executed (`is_reparse_point` â†’ hard block), but a real placeholder was not available |
| SEC-26 secret leakage | **EXECUTED** | `scan_and_audit_never_persist_file_contents_or_secrets` |
| SEC-27 no telemetry | **EXECUTED** | `npm run verify:offline` â€” 0 outbound connections |
| SEC-28 crash during delete | **EXECUTED** | `crash_during_permanent_delete_writes_no_audit_record` |

## 5. Performance â€” measured on this machine

All runs: `cargo test --release`, `NC_*` environment variables set as shown.
Fixtures are synthetic trees under `%TEMP%`, deleted after the run.

| Scenario | Command | Candidates | Walked dirs | Scan time | Peak RSS |
|---|---|---|---|---|---|
| 10,000 candidates | `NC_BENCH_CANDIDATES=10000 npm run bench:scale` | 10,000 | 30,001 | **24.5 s** | **69.6 MB** |
| 50,000 candidates | `NC_BENCH_CANDIDATES=50000 npm run bench:scale` | 50,000 | 150,001 | **131.8 s** | **293.9 MB** |
| 1,000,000 directory entries | `NC_ENTRY_BENCH=1000000 npm run bench:entries` | 1 target | 500,005 | **122.0 s** | **7.1 MB** |
| 300,000 recordings | `NC_RECORDINGS=300000 npm run bench:measure` | 1 folder | 300,000 files | **47.7 s** | **5.5 MB** |
| Cancel reaction (20,000 candidates) | `NC_CANCEL_CANDIDATES=20000`, `cargo test --release --test scale_benchmark cancel_latency -- --ignored` | 20,000 | 2,052 at cancel | **4 ms** to return after `cancel()` | â€” |

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
| 1 | Trash a real project folder, confirm it is visible in the Recycle Bin | **PASS** (Â§2.1) |
| 2 | Reported bytes match the payload | **PASS** (Â§2.1, exact 6,144 B) |
| 3 | Trash on a volume without a Recycle Bin â†’ error, no permanent fallback | **PASS** (Â§2.2, API-level) |
| 4 | Claude Code running â†’ its items blocked | **PASS (automated)** â€” provider process probe + `active_agent_blocks_execution_even_when_scan_was_idle` |
| 5 | Antigravity recording â†’ blocked, selectable after idle | **PASS (automated)** â€” 120 s idle window tests |
| 6 | OneDrive cloud-only placeholder â†’ rejected | **NOT EXECUTED** â€” no cloud-only file available; reparse-point hard block is covered by tests |
| 7 | Full session â†’ zero outbound requests | **PASS** (`npm run verify:offline`) |
| 8 | Kill during multi-item permanent delete â†’ no false success/audit | **PASS** (`crash_during_delete`) |
| 9 | Windows 10 clean install smoke test | **NOT EXECUTED** â€” no Windows 10 machine available (audit host is Windows 11 10.0.26200) |
| 10 | 50k-candidate and 1M-entry measurement | **PASS** (Â§5) |
| 11 | Close the window during a scan â†’ guard dialog, process survives | **PASS** â€” packaged build, native `WM_CLOSE` (2026-11-02) |
| 12 | Tray: minimize to tray, restore, and quit from the tray/dialog | **PASS** â€” packaged build (`hide_to_tray` keeps the process alive; "Tamamen Ã§Ä±k" exits) |
| 13 | Restart restores the last scan, with a stale warning before acting | **PASS** â€” packaged build with a seeded `last-scan.json` |
| 14 | Cache measurement continues after leaving Tool Caches | **PASS (automated)** â€” `cache-store` test |
| 15 | Close choice is remembered and reversible from Settings | **PASS** â€” packaged build: dialog checkbox and Settings select both persist `closeAction`; native close then follows it, and `ask` restores the dialog |
| 16 | Layout holds from 640px to 2560px | **PASS** â€” packaged CDP sweep, 11 widths Ã— 8 views: zero horizontal overflow, no header collisions, screenshots reviewed (audit report Â§9) |
| 17 | Settings submenu close mirrors the open animation | **PASS** â€” packaged CDP height sampling, both directions match within 0.002 (audit report Â§8.1) |
