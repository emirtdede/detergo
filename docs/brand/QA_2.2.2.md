# 2.2.2 Visual QA Record

**Date:** 2026-11-10
**Scope:** generated brand assets and installer artwork for the 2.2.2 identity
rollout
**Environment:** Windows 11 x64 (10.0.26200), Node 26.13.0, `sharp` 0.35.5
(libvips 8.18.7), Python 3.14 + Pillow for inspection only
**Gate:** G9 (design-board approval) — evidence package, **not yet signed off**

This record covers what was inspected, how, and what was observed. It is not a
substitute for viewing the installed application on real displays; those checks
are listed under [Still pending](#still-pending).

## Artifacts inspected

| Sheet | Source | What it proves |
|---|---|---|
| [`qa/ico-frames.png`](qa/ico-frames.png) | `src-tauri/icons/icon.ico` | All 15 frames decode, in order, with the glyph intact |
| [`qa/tray-zoom.png`](qa/tray-zoom.png) | `src-tauri/icons/tray-16…48.png` | Every tray size reads on dark and light notification areas |
| [`qa/installer-art.png`](qa/installer-art.png) | `src-tauri/nsis/*.bmp`, `src-tauri/wix/*.bmp` | NSIS sidebar/header/unheader and WiX banner/dialog layout |
| [`qa/scales.png`](qa/scales.png) | `assets/brand/dev-cleaner-icon-256.png` | 100/150/200/300% resampling has no halo or fuzzy edge |
| [`qa/shell/`](qa/shell/) | installed 2.2.2 on Windows 11 at 100% | Desktop, Start menu, Explorer, taskbar, tray and in-app chrome render the new mark |
| `assets/brand/github/social-preview.png` | generated | 1280×640 GitHub social card, no old mark |
| `assets/brand/github/avatar-1024.png` | generated | Circle-safe 1024 avatar on a dark canvas |

## Method

- The ICO was opened with Pillow and every frame extracted at its native size,
  then enlarged with nearest-neighbour for inspection. The sheet labels each
  frame with its pixel size and magnification.
- The eight tray PNGs were composited at 8× on a `#202024` panel and on a
  `#f4f4f6` strip, with a transparency checker behind each tile.
- The five BMPs were opened and laid out at native size: NSIS sidebar (164×314),
  header (150×57), unheader (150×57), WiX banner (493×58) and dialog (493×312).
- The 256 px master PNG was resampled with Lanczos to 256, 384, 512 and 768 px
  to represent 100, 150, 200 and 300% display scaling.
- The GitHub art was reviewed at native size; the avatar was checked against the
  inscribed circle GitHub uses for organisation avatars.

## Results

| # | Check | Result | Observation |
|---|---|---|---|
| V-01 | 15 ICO frames present, 16-first | **PASS** | `16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 128, 256` |
| V-02 | ICO 256 frame | **PASS** | PNG-compressed RGBA; crisp edge, no matte |
| V-03 | ICO 32-bit DIB frames | **PASS** | Straight alpha; no black fringe on the checker |
| V-04 | Glyph legibility, 256–48 px | **PASS** | `</>` and four-point spark distinct |
| V-05 | Glyph legibility, 40–24 px | **PASS** | Spark arms remain separate; stroke stays uniform |
| V-06 | Glyph legibility, 20–16 px | **PASS with note** | At 16 px the spark collapses to a single accent dot; `</>` still identifies the mark at taskbar size. This is the expected optical limit, not a broken frame. |
| V-07 | Squircle edge and inner border | **PASS** | Dark obsidian tile with a subtle inner rim; no banding at any size |
| V-08 | Tray 16–48 px, dark panel | **PASS** | White glyph contrasts; tile silhouette visible |
| V-09 | Tray 16–48 px, light panel | **PASS** | Dark tile separates from the light strip; no white-on-white tile |
| V-10 | Tray 16 px | **PASS with note** | Same spark simplification as V-06; the tile remains a recognisable 16 px target |
| V-11 | NSIS sidebar | **PASS** | Mark, wordmark and ghost glyph on the dark grid; no stretched pixels |
| V-12 | NSIS header / unheader | **PASS** | Mark sits on the right dark block; text area stays clear |
| V-13 | WiX banner / dialog | **PASS** | Light left side preserved for native black text; mark on the right dark block |
| V-14 | Installer art dimensions | **PASS** | Exact 164×314, 150×57, 493×58 and 493×312 bitmaps |
| V-15 | 100/150/200/300% resampling | **PASS** | Vector-derived edges stay clean; no halo, fringe or visible resample blur |
| V-16 | GitHub social preview | **PASS** | 1280×640; title, tagline, mark and `vellium.dev` inside the safe area |
| V-17 | GitHub avatar | **PASS** | Subject centred inside the inscribed circle; dark canvas hides the square edge |
| V-18 | Retired identity | **PASS** | No blue gradient, old glyph, `setup.ico`, wordmark-in-icon or baked text in any inspected asset |
| V-18b | Glyph inset matches the supplied original | **PASS** | The mark uses the original geometry with no scale transform; brackets keep visible margin inside the squircle at 16–256 px (frame sheet reviewed at 4× nearest-neighbour) |

### Installed shell surfaces, 100% scaling (2026-11-10)

Captured from a real NSIS per-user install of `Dev-Cleaner-2.2.2-x64-Setup.exe`
on the Windows 11 development host at 1920×1080 / 96 DPI. The desktop
wallpaper was temporarily replaced with a neutral gradient so personal files
would not appear in the evidence; the original wallpaper and icon settings were
restored afterwards. Crops are labelled `*-100.png` and live in
[`qa/shell/`](qa/shell/).

These crops predate V-18b: the glyph in them still carries the retired 1.15
scale, so the brackets sit closer to the tile edge than in the shipping build.
Every other property they evidence (tile, colour, shortcut arrow, tray
behaviour, `DisplayIcon`) is unchanged, and the corrected inset is verified at
frame level by V-18b.

| # | Check | Result | Observation |
|---|---|---|---|
| V-19 | Desktop shortcut | **PASS** | `Dev Cleaner` shortcut carries the 15-frame tile with the shortcut arrow; no old logo |
| V-20 | Start menu search result | **PASS** | `</>` tile in the result list and the detail panel; name reads `Dev Cleaner` |
| V-21 | Explorer extra-large icons | **PASS** | `app.ico`, `node-cleaner.exe` and `uninstall.exe` all render the same squircle and spark at 256 px |
| V-22 | Running taskbar button | **PASS** | The active taskbar button shows the dark tile with the white glyph at 32 px |
| V-23 | Notification-area overflow | **PASS** | Tray icon appears in the overflow flyout at 16 px; the tile stays legible next to light and dark app icons |
| V-24 | In-app chrome | **PASS** | The title bar and sidebar render the glyph-only mark in `currentColor`; no version label in the sidebar |

## Notes for the design board

1. The mark intentionally carries no text; the lockup lives in the README and
   installer art, not in the icon.
2. The spark is dropped at 16 px in practice. If the board wants a visible spark
   at 16 px, the only honest option is a dedicated 16 px optical frame with a
   larger spark and thinner brackets; that is a scope change, not a regeneration.
3. WiX keeps a light left panel because the native MSI text is black. A fully
   dark WiX dialog would require restyling the native controls and is out of
   scope for this release.
4. The avatar is not the Vellium organisation avatar; it is the Dev Cleaner
   product avatar for use only if a dedicated account or repository avatar is
   wanted. The organisation avatar stays unchanged (decision D2).

## Still pending

- Real taskbar, Start menu, Explorer and notification-area captures at 125%,
  150%, 175%, 200%, 225%, 250% and 300% scaling. The 100% pass is recorded above
  (V-19…V-24); other scales need separate DPI sessions on a test image, because
  Windows only re-renders shell surfaces after a sign-out at the new scale.
- Design-board signature below.
- Windows 10 22H2 inspection, if that support claim is reintroduced.

## Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Prepared by | Engineering | Evidence complete | 2026-11-10 |
| Design review |  |  |  |
| Release owner |  |  |  |

A signature here closes G9 only. G0 (trademark counsel), G3–G7 (installer,
upgrade and clean build) remain separate gates in
[`../release/RELEASE_CHECKLIST.md`](../release/RELEASE_CHECKLIST.md).
