# Detergo - Future Roadmap & Release Checklist

This document tracks the remaining release, distribution, signing, and platform milestones to take Detergo from its verified technical baseline to widespread Windows, Microsoft Store, and cross-platform adoption.

---

## 1. Windows Code Signing (SignPath Foundation)

Eliminate Microsoft Defender SmartScreen warnings across GitHub Releases, WinGet, Scoop, and Microsoft Store (Win32 path) using free open-source Authenticode signing from the **SignPath Foundation**:

- [ ] Commit all current changes, push to public `main`, and verify all 4 CI jobs (`frontend`, `e2e`, `rust`, `rust-unix`) pass on GitHub Actions.
- [ ] Enforce GitHub 2FA/MFA for all maintainers and enable Branch Protection on `main` + Tag Protection on `v*`.
- [ ] Publish an initial public release tag (`v1.0.0`).
- [ ] Apply at [https://signpath.org/open-source](https://signpath.org/open-source) pointing to the public Code Signing Policy in [`docs/SIGNING_AND_DISTRIBUTION.md`](SIGNING_AND_DISTRIBUTION.md#1-code-signing-policy-signpath-foundation).
- [ ] On SignPath approval, configure Project (`detergo`), Artifact Configuration (`<zip-file>` signing `*.exe`, `*.msi`, `*.com`), and Signing Policy (`release-signing` restricted to `refs/tags/v*` on GitHub-hosted `windows-latest`).
- [ ] Add `SIGNPATH_API_TOKEN` (Secret) and `SIGNPATH_ORGANIZATION_ID` (Variable) in GitHub Repository Settings → Secrets and variables → Actions.
- [ ] Push next signed release tag (`v1.0.1` / `v1.1.0`) and verify `.github/workflows/ci.yml` signs all binaries, passes `Get-AuthenticodeSignature`, and recomputes `SHA256SUMS.txt` + `BUILD_INFO.json`.

---

## 2. Microsoft Store Publication

Choose and execute the Microsoft Store submission strategy:

### Option A - Signed Win32 Installer (`.exe` / `.msi`) *(Recommended once SignPath is active)*
- [ ] Verify signed `Detergo-<version>-x64-Setup.exe` / `.msi` passes Authenticode validation (chains to Microsoft Trusted Root Program CA - SignPath Foundation satisfies this).
- [ ] Reserve a unique, conflict-free application name in Microsoft Partner Center (see Section 5 - Brand Finalization).
- [ ] Add an optional `store` Cargo/frontend build flavor (or runtime detection) so the Store build hides external download links in **Settings → Updates** to avoid Store policy friction (Policy 10.2.5 / external self-updater restrictions).
- [ ] Prepare localized Store listing metadata, screenshots (light/dark + RTL), privacy policy URL, and submit via Partner Center (`msstore-publisher`).

### Option B - Native MSIX Package (`.msix`) *(Zero external certificate needed; Microsoft re-signs free)*
- [ ] Add MSIX packaging pipeline (`makeappx` + `AppxManifest.xml`) with:
  - `rescap:runFullTrust` (with justification notes for Store review)
  - `uap10:allowElevation` (for on-demand UAC restart in C: System Cleaner)
  - `desktop6:FileSystemWriteVirtualization="disabled"` and `desktop6:RegistryWriteVirtualization="disabled"` (so real `%TEMP%`, AI tool folders, and package caches are visible outside package VFS)
  - `uap5:AppExecutionAlias` registering `detergo.exe` on `PATH`
- [ ] Test local sideloaded MSIX on clean Windows 11 x64 covering project scan, 17 AI tools, 27 tool caches, C: System Cleaner, Recycle Bin, CLI, and MCP stdio.

---

## 3. Package Manager Distribution (WinGet & Scoop)

- [ ] After publishing the signed GitHub Release, replace SHA-256 placeholders in [`packaging/winget/Vellium.Detergo.installer.yaml`](../packaging/winget/Vellium.Detergo.installer.yaml) from `SHA256SUMS.txt`.
- [ ] Run `winget validate --manifest packaging/winget` and submit a PR to `microsoft/winget-pkgs`.
- [ ] Replace SHA-256 placeholders in [`packaging/scoop/detergo.json`](../packaging/scoop/detergo.json), verify `scoop install packaging/scoop/detergo.json`, and submit to `ScoopInstaller/Extras` (or publish a dedicated `vellium/scoop-bucket`).

---

## 4. Real-Machine Release Smoke Tests & End-to-End CI

- [ ] Run Windows live installation verification scripts against a freshly built release (`npm run verify:smoke`, `npm run verify:installer`, `npm run verify:msi`, `npm run verify:upgrade`, `npm run verify:trash`, `npm run verify:offline`).
- [ ] Wire `testsprite-tests/test_mcp_cli_webhook.py` and `testsprite-tests/test_webhook_automation.py` into `.github/workflows/ci.yml` against the built CLI binary.
- [ ] Publish reproducible community hardware benchmarks across NVMe SSD, SATA SSD, and large real-world monorepos using `npm run bench:scale` and `npm run bench:measure`.

---

## 5. Brand Finalization & Trademark Clearance

- [ ] Decide whether to keep `"Detergo"` (with "by Vellium" lockup) or adopt a distinctive, globally trademarkable Latin-rooted product name before Microsoft Store name reservation and WinGet package ID lock-in.
- [ ] Complete the counsel search and sign-off recorded in [`docs/brand/TRADEMARK_CLEARANCE.md`](brand/TRADEMARK_CLEARANCE.md).

---

## 6. Cross-Platform Native Installers (macOS & Linux)

Core Rust scanning, AI provider discovery, cache actions, CLI, and MCP already compile and pass unit tests on `ubuntu-latest` and `macos-latest` in CI:

- [ ] Add `macos-latest` (`.dmg`, Apple Silicon + Intel universal binary, Developer ID notarization) and `ubuntu-latest` (`.AppImage`, `.deb`, `.rpm`) Tauri release bundle jobs.
- [ ] Publish Homebrew Cask (`brew install --cask ...`) alongside WinGet and Scoop.
- [ ] Conduct native-speaker editorial review passes on priority locales (`de`, `es`, `fr`, `ja`, `ko`, `zh`, `zh-tw`, `ar`, `ru`, `pt`) and invite community translators for long-tail locales.
