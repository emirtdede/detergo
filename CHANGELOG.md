# Changelog

All notable changes to Dev Cleaner are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.2] - 2026-11-10

Brand identity release. Scanner, cleanup, safety and IPC behaviour are
unchanged from 2.2.1.

### Changed

- Replaced the previous blue app identity with the canonical `</>` + spark mark:
  dark obsidian squircle, white glyph, no text and no font dependency.
- The mark uses the supplied original geometry unscaled, so the brackets keep a
  clear margin from the squircle edge at every size.
- The NSIS setup wizard now speaks 52 languages instead of Turkish and English:
  every app language for which NSIS ships a real translation file. English stays
  first so an unknown system language falls back to English, Turkish second.
  The 21 app languages without an NSIS translation keep the English wizard.
  `npm run check:languages` keeps the config, the mapping and the app locales in
  sync.
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
