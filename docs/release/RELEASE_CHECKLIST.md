# Release Checklist & Gates

**Version:** 1.0.0
**Date:** 2026-11-18
**Source revision:** the commit recorded in `release_output/BUILD_INFO.json`,
which must equal `git rev-parse HEAD` at build time
**Deployment mode:** DIRECT-LIVE (local Windows desktop; NSIS / MSI / portable
go straight to users; no staging, no canary)
**CI:** AppVeyor (`appveyor.yml`). GitHub Actions is not used.

> **1.0.0 status.** First open-source release. Source gates (`G1` code gates and
> `G2` brand gates) pass on the release commit, and `G6` reports a clean tree
> with three artifacts. The installer, shell-icon and upgrade evidence in
> `G3`/`G5`/`G7` below was produced on the development Windows 11 host and
> should be repeated on a pristine VM.

## Gate results

| Gate | Requirement | Result | Evidence |
|---|---|---|---|
| G0 | Trademark clearance signed | **PENDING** | `docs/brand/TRADEMARK_CLEARANCE.md` (counsel decision and signature) |
| G1 | Code gates | **PASS** | `npm run typecheck`, `npm test` (237), `cargo test` (230 lib + 21 integration, 5 opt-in ignored), `cargo clippy -D warnings`, `cargo fmt --check`, `npm run build`, `npm run test:a11y` (13 Playwright tests) |
| G2 | Brand asset gates | **PASS** | `npm run check:icons`, `npm run check:brand`, `npm run format:check` |
| G3 | NSIS installer + shell surfaces | **PASS (dev host)** | `npm run verify:installer` 8/8 and `npm run verify:shell-icons` 8/8 on the development Windows 11 host; clean-VM repeat still advisable |
| G4 | MSI per-machine | **PENDING** | `npm run verify:msi` refuses a non-elevated session (verified); needs an elevated run on a separate host |
| G5 | Previous release → this release upgrade | **PARTIAL** | `npm run verify:upgrade -Kind NSIS` PASS on the dev host; `-Kind MSI` still pending |
| G6 | Clean release build + provenance | **PASS** | `npm run build:release` from a clean tree, then `npm run check:build-info` â†’ clean tree, 3 artifacts |
| G7 | Exe icon frame gate | **PASS** | 15 frames / 15 `RT_ICON` in the portable EXE, setup EXE and raw release binary |
| G8 | Windows 10 support claim | **PASS (claim removed)** | No 22H2 host was available, so the untested "1809+" claim was removed from README and `MASTER_SPEC.md`; Windows 11 x64 is the verified target |
| G9 | Design-board visual approval | **PENDING** | 15-frame set recorded in `docs/release/TEST_MATRIX.md`; signature still missing |

Historical pre-1.0 evidence is no longer part of the repository; the git history
keeps it. Do not reuse an older installer as a 1.0.0 deliverable and never patch
a shipped executable in place.

## Brand rollout checklist

- [x] Canonical master at `assets/brand/dev-cleaner-icon.svg` (512Ã—512, no text)
- [x] Transparent `currentColor` glyph at `assets/brand/dev-cleaner-glyph.svg`
- [x] 15-frame `src-tauri/icons/icon.ico`; 256 PNG, other frames 32-bit DIB, 16-first
- [x] Eight tray PNGs (`16â€“48`) and runtime DPI selection; `image-png` enabled
- [x] NSIS sidebar, header and uninstaller header BMPs
- [x] WiX banner and dialog BMPs (light left side for native black text)
- [x] Favicon SVG/ICO and notification PNG
- [x] Tauri icon set regenerated; mobile icon directories removed
- [x] `Logo.tsx` glyph-only; retired blue tokens removed
- [x] NSIS `SHChangeNotify` uses `SHCNF_FLUSH`; no `FLUSHNOWAIT`, no cache utility
- [x] WiX `UpgradeCode` pinned to `40ef2964-2821-54d7-ac14-2894d8e84709`
- [x] `bundle.icon`, NSIS and WiX artwork paths point at generated files
- [x] README logo, artifact names, tree and installer note updated
- [x] GitHub social preview (1280Ã—640) and circle-safe avatar
- [x] Old identity retired; no shipping file references it
- [x] Brand scan fails on retired asset names and shell-cache shortcuts
- [x] CI runs `check:icons` and `check:brand`; `build:release` runs the PE gate
- [x] Visual QA record in `docs/release/TEST_MATRIX.md`
- [x] NSIS install, shell-surface and previous-release upgrade checks (dev host)
- [x] Real shell captures at 100% scaling (desktop, Start, Explorer, taskbar, tray, in-app)
- [ ] Shell captures at 125â€“300% scaling (needs sign-out at each scale on a test image)
- [ ] Legal counsel sign-off (G0)
- [ ] Design-board visual approval (G9)
- [ ] MSI per-machine run from an elevated session on a separate host (G4)
- [ ] Clean-VM repeat of the NSIS harnesses (G3)
- [x] Windows 10 support claim removed (no 22H2 host available)

## Verification commands

```powershell
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
npm run check:icons
npm run check:brand
npm run format:check
npm run build

# After committing everything (clean tree required):
npm run build:release
npm run check:build-info

# Installer harnesses, each on a clean machine:
npm run verify:installer        # NSIS per-user
npm run verify:shell-icons      # NSIS + Explorer/shortcut checks
npm run verify:msi              # elevated, per-machine
npm run verify:upgrade -Kind NSIS
npm run verify:upgrade -Kind MSI   # elevated
```

`verify:upgrade` expects the previous release's artifacts in
`release_output/baseline/`:

```powershell
New-Item -ItemType Directory release_output\baseline
Copy-Item <path>\Dev-Cleaner-<previous>-x64-Setup.exe release_output\baseline\
Copy-Item <path>\Dev-Cleaner-<previous>-x64.msi        release_output\baseline\
```

## Packaging checklist

- [x] Rust tests PASS (230 lib + 21 integration; 5 opt-in heavy tests ignored)
- [x] Frontend tests PASS (237 in 28 files)
- [x] Playwright accessibility gate PASS (13 tests: axe on all views and four themes, APG tabs, focus traps, table semantics, 320 px reflow)
- [x] Typecheck PASS
- [x] Clippy PASS (0 warnings, all targets)
- [x] rustfmt PASS
- [x] Prettier PASS
- [x] Brand and icon structure PASS
- [x] Production frontend build PASS
- [x] Clean-tree release build PASS (1.0.0)
- [x] NSIS install â†’ launch â†’ icons â†’ uninstall PASS
- [ ] MSI install â†’ launch â†’ uninstall PASS (elevated, per-machine)
- [x] Previous release upgrade PASS (NSIS; MSI pending)
- [x] Shell shortcuts and `DisplayIcon` PASS
- [x] Portable PASS (smoke 10/10)
- [x] `SHA256SUMS.txt` and `BUILD_INFO.json` generated
- [x] `check:build-info` reports `dirty: false` and the audited commit
- [x] Windows 10 support claim removed from README and the spec

### MSI scope note

Tauri's WiX template builds the MSI with `InstallScope="perMachine"`. A
non-elevated `/i` fails with error 1925. The MSI is for elevated / enterprise
deployment; the consumer channel is the per-user NSIS setup.

`scripts/verify-msi.ps1` refuses to run without elevation and checks the product
registration under `HKLM`. Do not install the NSIS and MSI builds on the same
machine: they intentionally produce separate Apps & Features entries and use
different install scopes.

## Known pre-existing issues

These were present in the pre-1.0 iterations and are recorded so they are not
mistaken for new breakage.

1. **`npm run check:contrast` (resolved).** An earlier baseline failed on all
   four themes because the checker expected semantic tokens that
   `src/styles/tokens.css` did not define. The current tokens cover the full
   vocabulary; the gate reports **PASS for all four themes** and is part of
   `npm run test:a11y`, so the Playwright suite runs in CI instead of being
   skipped.
2. **`npm run check:build-info`** passes against the 1.0.0 build. Re-run it after
   any further source change, because the gate requires the recorded commit to
   equal `HEAD`.
3. **Code signing (F-6).** Binaries are unsigned; SmartScreen warns.
4. **Windows 10 (F-4).** No 22H2 host has been available, so Windows 10 is not
   advertised; the claim was removed from README and `MASTER_SPEC.md`.
   Re-introduce it only with a 22H2 smoke run.
5. **Clean-VM repeat (G3).** The NSIS harnesses passed on the development host.
   A pristine Windows 11 image should still be used once before publication, so
   the evidence covers a machine that never had a prior installation.

## Blockers for public production release

1. **Legal (G0).** Counsel must fill and sign the decision in
   `docs/brand/TRADEMARK_CLEARANCE.md`. A `rename` decision starts a separate
   work item; do not use Â® or claim exclusivity before registration.
2. **MSI evidence (G4).** `verify:msi` must run from an elevated session on a
   host that does not also carry the NSIS build. The non-elevated guard is
   already verified.
3. **Clean-VM repeat (G3, G5).** Re-run `verify:installer`,
   `verify:shell-icons` and `verify:upgrade -Kind NSIS` on a pristine image, and
   keep the console output with the release evidence.
4. **Design approval (G9).** The recorded QA sheets must be signed off before
   the packages are published.

## Decision

- **Internal / controlled beta:** GO. The clean build, provenance, NSIS install,
  shell surfaces, NSIS upgrade path, portable smoke and brand gates are recorded
  in `docs/release/TEST_MATRIX.md`. G4, the clean-VM repeat and G9 remain open.
- **Public production (DIRECT-LIVE):** **NO-GO** until G0, G4, the clean-VM
  repeat and G9 are PASS.
