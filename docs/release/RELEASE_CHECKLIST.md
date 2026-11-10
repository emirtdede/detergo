# Release Checklist & Gates

**Version:** 2.2.2
**Date:** 2026-11-10
**Source revision:** the commit recorded in `release_output/BUILD_INFO.json`,
which must equal `git rev-parse HEAD` at build time
**Deployment mode:** DIRECT-LIVE (local Windows desktop; NSIS / MSI / portable
go straight to users; no staging, no canary)

## Gate results

| Gate | Requirement | Result | Evidence |
|---|---|---|---|
| G0 | Trademark clearance signed | **PENDING** | `docs/brand/TRADEMARK_CLEARANCE.md` (counsel decision and signature) |
| G1 | Code gates | **PASS** | `npm run typecheck`, `npm test` (105), `cargo test` (127 lib + 18 integration), `cargo clippy -D warnings`, `cargo fmt --check`, `npm run build` |
| G2 | Brand asset gates | **PASS** | `npm run check:icons`, `npm run check:brand`, `npm run format:check` |
| G3 | NSIS installer + shell surfaces | **PENDING** | `npm run verify:installer`, `npm run verify:shell-icons` on a clean Windows 11 VM |
| G4 | MSI per-machine | **PENDING** | `npm run verify:msi` from an elevated session on a separate clean VM |
| G5 | 2.2.1 → 2.2.2 upgrade | **PENDING** | `npm run verify:upgrade -Kind NSIS` and `-Kind MSI` with the baseline artifacts in `release_output/baseline-2.2.1/` |
| G6 | Clean release build + provenance | **PENDING** | commit all changes, then `npm run build:release` and `npm run check:build-info` |
| G7 | Exe icon frame gate | **PENDING** | `npm run check:exe-icons` output inside `build:release` (15/15 frames for portable and setup) |
| G8 | Windows 10 22H2 support claim | **PENDING** | VM availability; if unavailable, remove the untested "1809+" claim from README and the spec |
| G9 | Design-board visual approval | **PENDING** | `docs/brand/QA_2.2.2.md` + `docs/brand/qa/` (recorded); signature still missing |

Historical 2.2.1 evidence remains in
`docs/audit/baseline/PRODUCTION_GATE_2.2.1_TR.md` and
`docs/release/baseline-2.2.1.md`. Do not reuse a 2.2.1 installer as a 2.2.2
deliverable and never patch a shipped executable in place.

## Brand rollout checklist

- [x] Canonical master at `assets/brand/dev-cleaner-icon.svg` (512×512, no text)
- [x] Transparent `currentColor` glyph at `assets/brand/dev-cleaner-glyph.svg`
- [x] 15-frame `src-tauri/icons/icon.ico`; 256 PNG, other frames 32-bit DIB, 16-first
- [x] Eight tray PNGs (`16–48`) and runtime DPI selection; `image-png` enabled
- [x] NSIS sidebar, header and uninstaller header BMPs
- [x] WiX banner and dialog BMPs (light left side for native black text)
- [x] Favicon SVG/ICO and notification PNG
- [x] Tauri icon set regenerated; mobile icon directories removed
- [x] `Logo.tsx` glyph-only; retired blue tokens removed
- [x] NSIS `SHChangeNotify` uses `SHCNF_FLUSH`; no `FLUSHNOWAIT`, no cache utility
- [x] WiX `UpgradeCode` pinned to `40ef2964-2821-54d7-ac14-2894d8e84709`
- [x] `bundle.icon`, NSIS and WiX artwork paths point at generated files
- [x] README logo, artifact names, tree and installer note updated
- [x] GitHub social preview (1280×640) and circle-safe avatar
- [x] Old identity archived in `docs/archive/brand-v1/`, not deleted
- [x] Brand scan fails on retired asset names and shell-cache shortcuts
- [x] CI runs `check:icons` and `check:brand`; `build:release` runs the PE gate
- [x] Visual QA record and sheets in `docs/brand/QA_2.2.2.md` and `docs/brand/qa/`
- [ ] Legal counsel sign-off (G0)
- [ ] Design-board visual approval (G9)
- [ ] Installer, upgrade and shell checks on clean VMs (G3–G5)
- [ ] Windows 10 22H2 verification or support-claim removal (G8)

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

`verify:upgrade` expects the 2.2.1 artifacts in
`release_output/baseline-2.2.1/`:

```powershell
New-Item -ItemType Directory release_output\baseline-2.2.1
Copy-Item <share>\Dev-Cleaner-2.2.1-x64-Setup.exe release_output\baseline-2.2.1\
Copy-Item <share>\Dev-Cleaner-2.2.1-x64.msi        release_output\baseline-2.2.1\
```

## Packaging checklist

- [x] Rust tests PASS (127 lib + 18 integration; 5 opt-in heavy tests ignored)
- [x] Frontend tests PASS (105)
- [x] Typecheck PASS
- [x] Clippy PASS (0 warnings, all targets)
- [x] rustfmt PASS
- [x] Prettier PASS
- [x] Brand and icon structure PASS
- [x] Production frontend build PASS
- [ ] Clean-tree release build PASS (2.2.2)
- [ ] NSIS install → launch → icons → uninstall PASS
- [ ] MSI install → launch → uninstall PASS (elevated, per-machine)
- [ ] 2.2.1 → 2.2.2 upgrade PASS (NSIS and MSI)
- [ ] Shell shortcuts and `DisplayIcon` PASS
- [ ] Portable PASS
- [ ] `SHA256SUMS.txt` and `BUILD_INFO.json` generated
- [ ] `check:build-info` reports `dirty: false` and the audited commit
- [ ] Windows 10 22H2 smoke test or support claim removed

### MSI scope note

Tauri's WiX template builds the MSI with `InstallScope="perMachine"`. A
non-elevated `/i` fails with error 1925. The MSI is for elevated / enterprise
deployment; the consumer channel is the per-user NSIS setup.

`scripts/verify-msi.ps1` refuses to run without elevation and checks the product
registration under `HKLM`. Do not install the NSIS and MSI builds on the same
machine: they intentionally produce separate Apps & Features entries and use
different install scopes.

## Known pre-existing issues

These are not brand regressions. They were present in the 2.2.1 baseline and are
recorded so they are not mistaken for 2.2.2 breakage.

1. **`npm run check:contrast` fails on all four themes.** The checker expects
   semantic tokens (`--on-accent`, `--accent-foreground`, `--warning-text`,
   `--success-text`, `--danger-foreground`, `--focus-ring`) that
   `src/styles/tokens.css` does not define, although several are used by CSS.
   This predates the brand rollout (`234140a`). It is not part of `build:release`
   or CI, but it blocks `npm run test:a11y` until the token vocabulary is
   reconciled.
2. **`npm run check:build-info` fails against the stale 2.2.1**
   `release_output/BUILD_INFO.json`. This is expected until the clean 2.2.2
   build replaces it.
3. **Code signing (F-6).** Binaries are unsigned; SmartScreen warns.
4. **Windows 10 (F-4).** No 22H2 host has been available. Either verify it or
   remove the untested support claim.

## Blockers for public production release

1. **Legal (G0).** Counsel must fill and sign the decision in
   `docs/brand/TRADEMARK_CLEARANCE.md`. A `rename` decision starts a separate
   work item; do not use ® or claim exclusivity before registration.
2. **Installer evidence (G3–G5, G7).** The scripts are ready but have not been
   run against a 2.2.2 build. Run each on a clean VM and keep the console output
   with the release evidence.
3. **Clean commit (G6).** `build:release` refuses a dirty tree. Commit the brand
   rollout first, then build from that exact commit.
4. **Design approval (G9).** The visual QA sheets must be signed off before the
   packages are published.

## Decision

- **Internal / controlled beta:** GO once G3–G7 and G9 are recorded; G0 may run
  in parallel but must close before any public download.
- **Public production (DIRECT-LIVE):** **NO-GO** until G0, G3–G7 and G9 are
  PASS. If Windows 10 remains advertised, G8 is also required.
