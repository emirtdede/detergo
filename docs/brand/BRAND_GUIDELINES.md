# Detergo Brand Guidelines

**Version:** 1.0.0
**Canonical master:** `assets/brand/detergo-icon.svg`
**Status:** shipping identity; earlier identities are superseded and must not be
used.

## 1. The mark

The mark is an obsidian squircle containing a white `</>` and a four-point
spark. The slash and spark form the "clean" gesture; the brackets identify a
developer tool. There is no text, no font, and no third-party artwork inside the
icon.

| Token | Value |
|---|---|
| Obsidian top | `#1C1C21` |
| Obsidian middle | `#0D0D10` |
| Obsidian bottom | `#050507` |
| Mark | `#FFFFFF` |
| Rim highlight | white at 32% to 3% |
| Inner track | white at 4% |

## 2. Files

| File | Purpose |
|---|---|
| `assets/brand/detergo-icon.svg` | Canonical 512x512 master |
| `assets/brand/detergo-glyph.svg` | Transparent, `currentColor` glyph |
| `assets/brand/detergo-icon-256.png` | README, documentation |
| `assets/brand/detergo-icon-1024.png` | Tauri icon source, GitHub |
| `assets/brand/installer/` | NSIS and WiX artwork sources |
| `assets/brand/github/` | Social preview and avatar |
| `assets/brand/icon-manifest.json` | Generator/toolchain metadata and hashes |
| `src-tauri/icons/icon.ico` | 15-frame Windows ICO |
| `src-tauri/icons/tray-*.png` | 8 DPI variants for the notification area |

Never edit a generated PNG, ICO or BMP by hand. Edit the SVG source and run
`npm run generate:icons` on Windows.

## 3. Clear space and minimum size

- Keep at least 8% of the icon edge free of other elements.
- The 16 px and 20 px frames drop the rim and inner track (`data-layer="detail"`).
- The in-app glyph is used at 18 px height and must remain legible on both
  themes. The brackets use `currentColor`.
- Do not place the icon on a busy photograph or a patterned background.

## 4. DPI and icon frames

The ICO contains, in this order:

`16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 128, 256`

All frames are 32-bit; 256 is PNG, the rest are 32-bit DIBs. The extra frames
cover Windows display scaling:

| Scale | Large icon | Small icon |
|---:|---:|---:|
| 100% | 32 | 16 |
| 125% | 40 | 20 |
| 150% | 48 | 24 |
| 175% | 56 | 28 |
| 200% | 64 | 32 |
| 225% | 72 | 36 |
| 250% | 80 | 40 |
| 300% | 96 | 48 |

The tray uses `16 x primary monitor scale`, rounded to the nearest available
size at or above the request: 16, 20, 24, 28, 32, 36, 40, 48.

## 5. Installer artwork

| Surface | Size | Notes |
|---|---:|---|
| NSIS sidebar | 164x314 | Dark, icon at top, faint glyph watermark, scope line `DEVELOPER ARTIFACT CLEANER` |
| NSIS header | 150x57 | Dark rounded tile, icon + wordmark centred; no tagline (it would render at 5.7 px) |
| NSIS uninstaller header | 150x57 | Same, slightly dimmed |
| WiX banner | 493x58 | Light left for native black title text, dark icon panel on the right |
| WiX dialog | 493x312 | Light left for native text, dark icon panel on the right; wordmark only |

The WiX artwork is deliberately light where native WiX text is drawn. Do not
darken it: the stock WixUI text is black and would become unreadable.

### The scope line must name the whole product

Detergo ships 82 evidence-backed rules across 18 ecosystems (`src-tauri/assets/targets.toml`), plus 17 AI coding-agent providers and 27 developer tool cache providers.
Artwork must never describe it as a cleaner for one ecosystem: `NODE_MODULES
CLEANER`, `npm cleaner` and similar lines are wrong even when the type fits. Use
`DEVELOPER ARTIFACT CLEANER`, the same wording as the GitHub social card, and
only where it stays at 7 px or larger. Below that, drop the line rather than
shrink it - a 5 px line is a smear, not a claim.

`npm run check:brand` enforces this: it fails if any SVG in
`assets/brand/installer` mentions `node_modules` or `package.json` outside a
comment, or if `TranslationSchema`/the legacy dictionaries reintroduce a
`tagline` key.

The wizard progress bar is part of the identity too. Windows draws it green by
default and ignores `MUI_INSTFILESPAGE_COLORS` once the control is themed, so
`src-tauri/nsis/hooks.nsh` strips the theme and paints the bar itself: fill
`#3B82F6` (the app accent) on a `#ECEDF2` trough. Keep those two values in sync
with `--accent` in `src/styles/tokens.css` and keep the trough light, because
the same background colour is used for the details log.

## 6. Typography and wordmark

- The icon contains no wordmark.
- README wordmarks are HTML text; no font binary is distributed.
- If a raster lockup needs a wordmark, outline the text before rendering. The
  GitHub social preview is built by `scripts/build-social-preview.mjs`, which
  uses the local Segoe UI font only to produce paths; the committed SVG contains
  paths and no font reference.
- Inter may be used as the UI fallback; an Inter `.ttf`/`.woff2` must never be
  committed.

## 7. GitHub

- Repository avatar: GitHub has no per-repository avatar. Do not replace the
  Vellium organisation avatar with the product icon. If a dedicated product
  account exists, upload `assets/brand/github/avatar-1024.png`.
- Social preview: `assets/brand/github/social-preview.png`, 1280x640, under
  1 MB, safe margin at least 64 px.
- README: use `assets/brand/detergo-icon-256.png`, not a hotlinked SVG.

## 8. Generation and verification

```powershell
npm run generate:icons
npm run check:icons
npm run check:brand
npm run generate:icons:verify   # two consecutive runs, identical manifest
```

`generate-icons.mjs` is Windows-only (Tauri icon + sharp). CI runs only the
structural checks, so a Linux runner never needs to rasterise anything.

The built executables are verified on every release via `scripts/check-exe-icons.mjs`
(all 15 ICO frames embedded). Inspection sheets were review-time outputs only,
not generated shipping assets, and are not part of the repository.

## 9. Archive policy

The retired identity is not kept in the repository. No shipping file may
reference it; the git history and the release changelog preserve the trail.

## 10. Legal

See `docs/brand/TRADEMARK_CLEARANCE.md`. Do not use ® or claim exclusivity for
"Detergo" until counsel signs the clearance record.
