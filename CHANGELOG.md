# Changelog

All notable changes to Dev Cleaner are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.3] - 2026-11-17

Scan-experience and documentation release. No change to what is deleted or how
the safety classifier decides.

### Added

- `--scope combined` is documented and selectable in the in-app CLI builder:
  one action scans project dependencies, AI agent storage and measures package
  caches, matching the command bar's "Scan everything" button.
- Documentation now describes the scan-coverage model: `Information`,
  `Warning` and `Error` notices, `Skipped` / `Failed` / `Incomplete` sections
  and the `stop_reason` of a partial scan.
- Webhook events are canonicalised in the backend: camelCase keys from the
  desktop app are renamed to the documented snake_case fields, `status` is
  derived from `cancelled`/`partial`, and `total_human` is always present when
  `total_bytes` is. Legacy `scan_completed` / `cleanup_completed` names are
  rewritten to `scan` / `clean` before delivery.
- `src-tauri/src/format.rs` is the single byte-formatting implementation used
  by the CLI, the MCP server and the webhook payload.

### Fixed

- Codex MCP setup showed a JSON body for `%USERPROFILE%\.codex\config.toml`.
  It now shows the TOML the file actually needs.
- The Turkish documentation search index contained JSX source fragments
  (`activeTopicId === …`, `setCliPath(e.target.value)`) instead of prose, which
  silently broke body search. The generator now strips expressions and tags
  with a brace-aware scanner and is covered by regression tests.
- The webhook schema page documented `event: "cleanup_completed"` and a
  `cleaned_human` field the backend never sent.
- Third-party notices were stale: `@tauri-apps/plugin-notification` and
  `tauri-plugin-notification` were missing, and the Rust list had drifted from
  the shipped dependency graph (292 → 336 crates). `license-data.ts` was
  regenerated from `cargo metadata` and the installed npm tree.
- Documentation and legal revision strings read the version from
  `package.json` instead of hardcoding the previous release.
- **Pre-deployment QA audit (v3).** All findings B-1…B-4, P-1…P-4, T-1…T-4,
  V-1…V-4 and R-1…R-5 are closed; see
  `docs/audit/2026-11-17-pre-deployment-qa-audit-v3.md` §8 and
  `docs/release/2026-11-18-remediation-wbs-risk-test-matrix.md`. User-visible
  fixes: a corrupt `scan-history.json` now shows a warning banner instead of a
  silently empty History view; webhook deliveries retry 429/5xx with backoff and
  an `Idempotency-Key`; the cleanup dialog no longer closes when a drag starts
  inside the panel; and "reset" during the startup restore no longer lets the
  restored scan reappear.
- The accessibility gate now actually runs: `check:contrast` passes on all four
  themes, the distribution bar has an accessible name, every overview grid
  shrinks to 320 px without horizontal overflow, and the Playwright APG,
  focus-trap and table-semantics tests target the current navigation model.
- Backend diagnostics go to a rotated, path-masked log file
  (`%LOCALAPPDATA%\dev-cleaner\dev-cleaner.log`) instead of stderr, which a
  windowed build discards; a corrupt audit SQLite database is archived as
  `*.sqlite3.corrupt.<timestamp>` and recreated instead of crashing startup.
- **Second independent audit round (S2-1…S2-8).** Resource-growth and race
  fixes: the MCP server now bounds pending preview grants (TTL + 16-entry cap)
  instead of retaining every cleanup plan and scan session for the process
  lifetime; history reads are clamped inside the repository, so a client-supplied
  `limit` can no longer turn into a negative SQLite `LIMIT` that dumped the whole
  table; the scan event queue is bounded (256 events) and the producer awaits it,
  so a suspended WebView applies backpressure instead of accumulating a second
  copy of the result set; `last-scan.json` is read with the same 64 MiB cap it is
  written with; the History summary no longer builds a combined array and spreads
  every record into `Math.max`; a recovered drive's disk-pressure cooldown is now
  pruned even while another drive is silenced by its cooldown; the scan header
  cancels its known-locations fetch when it unmounts; and the unused,
  case-sensitive `process_running_under` helper is removed instead of remaining
  exported as a false-negative path probe.
- **CLI usability.** `dev-cleaner scan` now prints a size-ranked table of the
  discovered targets instead of only counts; `--top <N>` and `--all` control the
  list, `-i` / `--interactive` numbers the selectable targets and reads
  `1,3-5 / all / none` before moving them to the Recycle Bin, and
  `dev-cleaner scan --help` prints the manual instead of treating the flag as a
  path. Full reference: `docs/CLI.md`.
- Open-source community files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, issue and pull-request templates, Dependabot and editor
  standards. The release workflow now attaches the installers and the
  provenance manifest to the tagged GitHub Release.

### Changed

- The project is MIT licensed (the `LICENSE` file always was); the README's
  "Proprietary" badge and section were wrong and are corrected.
- README modernised for the 2.2 catalogue, the CLI and the open-source
  contribution path; the 2.0-era `node_modules`-only wording was removed.

### Legal

- The privacy policy now states how to request the data controller's
  identification and postal address for formal notices.
- Revision date moved to 17 November 2026.

### Verified

- `npm run typecheck`, `npm test` (237 tests), `npm run format:check`,
  `npm run check:gates`, `npm run check:audit`, `npm run check:i18n`,
  `npm run check:contrast` (4/4 themes), `npx playwright test` (13 tests),
  `cargo test` (230 lib + 21 integration) and `cargo clippy --all-targets`.

## [2.2.2] - 2026-11-10

Brand identity release. Scanner, cleanup, safety and IPC behaviour are
unchanged from 2.2.1.

### Changed

- Renamed every user-visible technical identifier: the installed binary is now
  `dev-cleaner.exe` (was `node-cleaner.exe`, visible in Task Manager and in the
  shortcut target), the Cargo package is `dev-cleaner` (was `node-cleaner`), the
  Rust library is `dev_cleaner_lib`, and the npm package is `dev-cleaner`. The
  NSIS template removes the old binary on upgrade through its
  `MainBinaryName` registry value; the 2.2.1 data directory
  (`%APPDATA%\node-cleaner`) is still migrated on first launch and a legacy
  process is still detected so it cannot hold the instance lock.
- Removed the last stale references to the pre-rename identity: the privacy text
  no longer names `%APPDATA%/com.vellium.nodecleaner`, the offline canary probe
  now watches `%APPDATA%\dev-cleaner` (it silently watched the old path and
  could not have caught a leak), and the IPC/offline scripts locate the newest
  release artifact instead of a hard-coded `Node-Cleaner-2.0.0` file.
- Replaced the previous blue app identity with the canonical `</>` + spark mark:
  dark obsidian squircle, white glyph, no text and no font dependency.
- The mark uses the supplied original geometry unscaled, so the brackets keep a
  clear margin from the squircle edge at every size.
- The NSIS setup wizard now speaks all 73 app languages, not just the 52 for
  which NSIS ships a translation file. English stays first so an unknown system
  language falls back to English, Turkish second, the rest alphabetical. The 21
  missing language tables (`.nlf` + `.nsh`) and the 54 missing Tauri
  custom-message packs ("app is running", "already installed", maintenance
  options) are generated from the English templates by
  `npm run generate:nsis-languages` and committed, so a release build needs no
  network. See `docs/release/INSTALLER_LANGUAGES.md`.
- The language picker is shown on every setup run, even when a language was
  remembered (`MUI_LANGDLL_ALWAYSSHOW`), preselects that language, and lists each
  language under its native name. Its window title and info line are generated
  for all 73 languages (`languages/picker.nsh`) instead of being English-only.
  Registry cache lives at `HKCU\Software\Vellium\Dev Cleaner\Installer Language`.
  LangDLL's own OK/Cancel labels are compiled into the plugin and cannot be
  translated; the title follows the Windows UI language while the list
  preselects the remembered one (MUI resolves the defines before it reads the
  registry). See `docs/release/INSTALLER_LANGUAGES.md`.
- Setup/uninstall artwork was redrawn as a DEV CLEANER icon + wordmark lockup
  (sidebar, header, uninstaller header, WiX banner and dialog). The header image
  is right-aligned (`MUI_HEADERIMAGE_RIGHT`); the stray chevron and the cropped
  watermark are gone.
- Sentences that name a button ("Click Next to continue.", "Click Install to
  start the installation.", "click I Agree", "Click Finish to close Setup")
  used to keep that word in Latin script after translation. Each English button
  label is now replaced with the localized one across the `.nlf`, `.nsh` and
  Tauri message files of the language, so the sentence quotes the button the
  user actually sees. For the 33 languages NSIS translates itself, the
  generator reads NSIS's own button labels.
- The wizard footer uses the language-neutral `© 2026 Vellium` instead of the
  English sentence `All rights reserved.`, because NSIS renders one
  `BrandingText` for all languages.
- Removed the dead `settings.platform` key ("Tauri v2 + React 18 + Rust") from
  all 73 dictionaries; no component read it, and it was the last value that was
  English in every language.
- `npm run check:languages` now verifies 73 config entries, project `.nlf`/`.nsh`
  pairs (language id, codepage 1200, no surviving English sentinels, no English
  button word inside a translated sentence), Tauri
  message packs (right `LANG_*` constant, no `LANG_ENGLISH`, no BOM, `$\"` not
  `\"`), `picker.nsh` (title/info for every language, no English sentinel outside
  English, wired into `hooks.nsh`), `customLanguageFiles` paths and the
  language-neutral copyright.
  `npm run check:i18n` now also audits the legacy `src/locales/langs` dictionaries
  that previously escaped the untranslated-value gate.
- `npm run sync:nsis-languages` copies the project packs into the Tauri NSIS
  `Contrib\Language files` directory before bundling, because makensis only
  resolves language files from inside its own installation.
- Every Windows surface now uses one 15-frame ICO
  (`16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 128, 256`): app window,
  taskbar, Explorer, shortcuts, NSIS setup/uninstaller and the portable EXE.
  There is no lower-resolution `setup.ico` fallback.
- Tray icon selects one of eight PNGs (`16–48`) from the primary monitor scale,
  so 175% and 225% displays no longer upscale a 32 px bitmap.
- NSIS sidebar/header and WiX banner/dialog artwork are generated from the brand
  sources; WiX keeps a light left side for the native black text.
- NSIS shell refresh now waits with `SHCNF_FLUSH` and targets the installed EXE
  and both shortcuts with `SHCNE_UPDATEITEM`.
- README logo, project tree, artifact names and release notes describe 2.2.2.
- The in-app logo is a glyph-only SVG that inherits `currentColor`; the retired
  blue gradients are gone.

### Added

- Deterministic brand pipeline: `npm run generate:icons` (Windows) writes the
  ICO, tray PNGs, installer BMPs, favicons, notification icon, Tauri icon set
  and GitHub art from `assets/brand/dev-cleaner-icon.svg`.
- Gates: `npm run check:icons`, `npm run check:brand`,
  `npm run check:exe-icons` and `npm run generate:icons:verify`. CI runs the
  structural checks on Linux; the PE frame gate runs during `build:release`.
- Installer harnesses split by scope: `verify:installer` (NSIS per-user),
  `verify:msi` (elevated per-machine), `verify:upgrade` (2.2.1 → 2.2.2) and
  `verify:shell-icons` (shortcuts, `DisplayIcon`, embedded icons).
- Brand documentation: `docs/brand/BRAND_GUIDELINES.md`,
  `docs/brand/TRADEMARK_CLEARANCE.md` and `docs/brand/preview.html`.
- Visual QA record `docs/brand/QA_2.2.2.md` with the ICO frame, tray, installer
  art and 100–300% inspection sheets under `docs/brand/qa/`.
- `docs/release/baseline-2.2.1.md` records the shipped 2.2.1 hashes and the
  rebuild procedure.

### Removed

- The previous logo assets moved to `docs/archive/brand-v1/`; they are kept for
  history and are not referenced by any shipping surface.
- Mobile icon sets (`ios/`, `android/`); this is a Windows desktop product.

### Verified

- Clean-tree `npm run build:release`: portable, NSIS and MSI produced; the PE
  gate found 15 frames / 15 `RT_ICON` in each EXE; `check:build-info` reported a
  clean tree and the recorded commit.
- `verify:smoke` 10/10 on the portable EXE; `verify:installer` and
  `verify:shell-icons` 8/8 each; `verify:upgrade -Kind NSIS` 8/8 from 2.2.1.
- Details and the still-open gates are in `docs/release/TEST_MATRIX.md` and
  `docs/release/RELEASE_CHECKLIST.md`.

## [2.2.1] - 2026-11-10

Remediation release for the pre-deployment audit. Behaviour changes are limited
to the destructive MCP path, which is now gated three times.

### Security

- **MCP destructive gate (ADR-2).** `devcleaner_execute_cleanup` now requires
  three independent conditions: the `--allow-destructive` flag, the
  `mcpAllowDestructive` setting (default `false`, schema v4), and a single-use
  five-minute preview token. Tokens are removed before execution, so a failed
  run cannot be replayed.
- **Path guard rewritten.** System-directory detection is component-aware, so
  `C:\Users\me\AppData\Windows\foo` and nested `ProgramData` paths are rejected
  while `WindowsApps` is still allowed. Drive roots, user-profile roots and
  reparse points stay blocked.
- **Webhook test moved to Rust.** The test call runs through `reqwest` with a
  scheme allowlist (`http`/`https`) instead of a cross-origin `fetch` the CSP
  blocked.

### Added

- `test_webhook` command with blocking HTTP client and URL validation.
- `clear_all_history` command; `clear_cleanup_history` remains as a deprecated
  alias.
- `scripts/check-audit-invariants.mjs` (5 forbidden-pattern rules) and a CI
  workflow with typecheck, Vitest, Rust tests, clippy and rustfmt gates.
- Frontend test harness (`createInvokeMock`, `createFakeScannerApi`).
- Rust integration tests: `tests/webhook.rs`, `tests/mcp_flow.rs`.
- `formatSavedAt` and `describeError` shared helpers.

### Changed

- CLI `--scope` maps `caches` to `GlobalCaches` and `all` to `AllDrives`
  (previously the values were inverted with respect to the real enum).
- CLI exit codes documented and enforced: 0 success, 1 scan failure, 2 cleanup
  failure, 3 argument error, 4 blocked.
- MCP `scan_workspace` returns a `scan_id`; `preview_cleanup` reuses that
  session, measures only the selected targets and can finally resolve the
  target IDs it was given.
- Settings schema bumped to v4 with migration from v3.
- History screen loads only the active tab.
- Documentation navigation is localized, article bodies are English-only with a
  visible notice (ADR-4).
- Prettier and `cargo fmt` are enforced.

### Removed

- Demo/mock API layer is no longer bundled in production builds; it is imported
  dynamically in development only. Concept preview screens are dev-only.
- Non-Windows process-kill branch (ADR-6).
- Uncached `_searchHaystack` field and hardcoded `2.2.0` version literals.
