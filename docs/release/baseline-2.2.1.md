# Baseline 2.2.1 — Shipped Artifact Record

**Tag:** `baseline-2.2.1`
**Commit:** `b364ecc1173d7275ba4c23fdef333ea51ef95705`
**Version:** 2.2.1
**Recorded:** 2026-11-10
**Source of truth:** `release_output/BUILD_INFO.json` produced by the 2.2.1 build.

This tag marks the exact source revision that produced the published 2.2.1
artifacts. It exists so a rollback can rebuild the previous release instead of
patching a shipped executable.

## Artifact hashes

The artifacts themselves are not committed to git. They remain in the release
share and are identified by the SHA-256 values below.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `Dev-Cleaner-2.2.1-Portable.exe` | 18,157,568 | `5F698D9F27A53DA47BDF984E171E832D3A91E9760866DBB4932820349241216F` |
| `Dev-Cleaner-2.2.1-x64-Setup.exe` | 5,759,697 | `F001B9FDB386E834311AB02078D40E81CAAEB995FE1703F72E6F264BA792F2E8` |
| `Dev-Cleaner-2.2.1-x64.msi` | 7,667,712 | `6B22298435958C25E813E1FE1E3809FAEAD5D4257479F246474262870506C9C9` |

## Installer facts

| Fact | Value | Evidence |
|---|---|---|
| MSI `UpgradeCode` | `40ef2964-2821-54d7-ac14-2894d8e84709` | `src-tauri/target/release/wix/x64/main.wxs:18` |
| MSI install scope | `perMachine` | `main.wxs:28` |
| MSI major upgrade | `Schedule="afterInstallInitialize"`, `AllowDowngrades="yes"` | generated WiX template |
| NSIS install scope | `currentUser` | `tauri.conf.json` |
| NSIS uninstaller pages | `MUI_UNPAGE_CONFIRM` + `MUI_UNPAGE_INSTFILES` | generated `installer.nsi:458,461` |
| Existing app ICO | 8 frames: 16, 24, 32, 48, 64, 96, 128, 256 | PIL inspection of `src-tauri/icons/icon.ico` |

## Rebuilding

```powershell
git switch --detach baseline-2.2.1
npm ci
npm run build:release
```

The rebuilt artifacts must match the hashes above before being offered as a
rollback. If they do not, stop and investigate the toolchain before shipping
anything. Never patch a 2.2.1 executable in place.
