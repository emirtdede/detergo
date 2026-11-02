# Production Release Audit Report — Node Cleaner 2.0.0

**Application:** Node Cleaner (Windows desktop)
**Version:** 2.0.0
**Source revision:** the commit recorded in `release_output/BUILD_INFO.json`, which
must equal `git rev-parse HEAD` at build time (`feat/2.0-multi-ecosystem-engine`)
**Stack:** Tauri 2 · Rust · React 19 · TypeScript · Vite 6
**Publisher / identifier:** Vellium · `com.vellium.nodecleaner`
**Audit date:** 2026-11-01
**Deployment mode:** DIRECT-LIVE — local Windows desktop; NSIS / MSI / portable
are delivered straight to users. There is no staging, no canary and no rollback
channel.
**Environment:** Windows 11 (10.0.26200) x64, Node 24.22.1, Rust 1.99.1

> This report supersedes the earlier 1.0.0 report that declared `GO`. That
> report predates the multi-ecosystem catalog, AI-agent storage manager,
> backend-owned plans and the 2.0 security work, and its test counts (9 Cargo,
> 18 Vitest) no longer describe this code base. It must not be used as release
> evidence.
>
> It also supersedes the 2026-10-31 pass of this document. That pass shipped a
> defect: the artifacts in `release_output/` were built at 02:42 while the audited
> HEAD was committed at 06:37, so the verified source and the shipped bytes were
> not the same code, and nothing detected it. See §1.1 and finding F-11.

## 1. Decision

```text
Internal / controlled beta:   GO
Public production (DIRECT-LIVE, clean commit-stamped packages):  GO
```

The application is buildable, launches, performs real IPC under its production
CSP, installs and uninstalls through both installer formats, and the destructive
path is guarded by automated tests. Every security scenario except one was
executed, the Recycle Bin round-trip and the large-scale benchmarks are measured,
and the shipped packages were built from a clean tree with a commit stamp the
runtime reports and the harness cross-checks.

One environmental item remains, and it is not a code blocker: **F-4**, the
Windows 10 clean-install smoke test (no Windows 10 host available; the audit host
is Windows 11 10.0.26200). Run `scripts/verify-installer.ps1` there once if
Windows 10 is a supported target.

No fabricated or estimated result is used in this report.

## 2. Evidence executed for this audit

| Check | Command / method | Result |
|---|---|---|
| Rust library + unit | `cargo test` | **97 passed**, 0 failed |
| Rust integration (default) | `cargo test` | **4 passed** — `git_unavailable`, `crash_during_delete`, `recycle_failure_no_fallback`, `secret_persistence` |
| Opt-in heavy tests | 5 × `--ignored` | Recycle round-trip + 4 benchmarks (incl. cancel latency) — all PASS |
| Frontend | `npm test` | **32 passed**, 0 failed |
| TypeScript | `npm run typecheck` | PASS |
| Lint/static | `cargo clippy --all-targets` | 0 warnings, 0 errors |
| Frontend build | `npm run build` | PASS (1,956 modules) |
| Release packaging | `npm run build:release` | PASS — commit-stamped, `BUILD_INFO.json` written |
| Version sync | `npm run check-version` | 2.0.0 in package.json, tauri.conf.json, Cargo.toml |
| Packaged startup | portable EXE, 15 s | stayed alive, stopped cleanly |
| Packaged IPC + CSP | `node scripts/verify-ipc.mjs` | **15/15 PASS** |
| Offline / telemetry | `npm run verify:offline` | 0 outbound, 0 listeners, no secret persisted |
| Recycle Bin round-trip | `npm run verify:trash` | PASS — shell-visible, 6,144 B exact |
| NSIS install/launch/uninstall | `scripts/verify-installer.ps1 -Kind nsis` | PASS |
| MSI install/launch/uninstall | `scripts/verify-installer.ps1 -Kind msi` | PASS (per-user mode) |
| 10,000 candidates | `bench:scale` | 24.5 s · 69.6 MB |
| 50,000 candidates | `bench:scale` | 131.8 s · 293.9 MB |
| 1,000,000 directory entries | `bench:entries` | 122.0 s · 7.1 MB |
| 300,000 recordings | `bench:measure` | 47.7 s · 5.5 MB |
| Cancel reaction, 20k candidates | `cancel_latency` benchmark | 4 ms to return, `partial=true` |

Full security detail: `docs/security/FINAL_SECURITY_AUDIT.md`.
Test coverage detail: `docs/release/TEST_MATRIX.md`.
Gate checklist: `docs/release/RELEASE_CHECKLIST.md`.
Build provenance: `docs/release/BUILD_PROVENANCE.md`.

### 2.1 What changed in the follow-up pass

The first pass found one confirmed P1 blocker (stale artifacts) plus four median
verification gaps that were recorded as "pending". This pass fixed the former and
executed the latter:

| Item | Resolution |
|---|---|
| Stale artifacts shipped from a different revision (F-11) | Clean-tree gate, commit stamp in the binary, mtime freshness check, `BUILD_INFO.json`, `get_build_info` + About card, IPC cross-check |
| Machine-specific `.cargo/config.toml` (F-12) | Reduced to a machine-independent file; `CARGO_TARGET_DIR` is the supported override |
| Recycle Bin round-trip (F-1) | `npm run verify:trash` — real bin, shell-visible, exact byte accounting |
| Trash failure fallback (F-2) | `recycle_failure_no_fallback` — error surfaced, target untouched |
| Performance budgets (F-3) | All four benchmarks measured, plus a cancel-latency benchmark |
| OneDrive placeholder (SEC-19) | Still not executed; reparse-point hard block is executed and covers the defence |
| Crash during delete (SEC-28) | `crash_during_delete` — mid-delete kill leaves no audit record |
| Secret persistence (SEC-26) | `secret_persistence` — canary never reaches app storage |
| No telemetry (SEC-27) | `verify:offline` — zero outbound connections in a real session |
| Installer coverage | `verify-installer.ps1` — NSIS and MSI round-trip |
| `chunks_exact` clippy warning | Fixed with `as_chunks`; clippy now clean on all targets |

## 3. What changed in 2.0 that this audit covers

- Catalog-driven, multi-ecosystem scanning with per-rule positive/negative
  fixtures and startup validation.
- AI agent storage analysis (Codex, Claude Code, Antigravity) with sessions,
  worktrees, checkpoints, memory, brain data and SQLite/WAL held as `KEEP`.
- Backend-owned target IDs, session binding, 15-minute plans, one-time
  confirmation tokens and revalidation before every delete.
- Recycle Bin default with no silent permanent fallback; permanent deletion
  requires a separate acknowledgement.
- Copied content is never read for scanning; measurement is metadata-only.
- Cleanup history and official-tool action audits are separate JSONL files.
- Official tool commands run fixed argv with timeouts and process-tree
  termination; failures surface an exit code and an audit error.
- Scan deadline/cancellation never report a partial measurement as complete.
- Discovery refuses reparse points and junctions, so content outside the scan
  root cannot become a target.
- Settings normalise protected paths (absolute, deduped) and enforce limits,
  exclusions and agent-cache/browser-recording policy server-side.
- Snapshot identity fails closed when the Windows file id is unavailable, and the
  reported free-space delta is signed so a decrease is never hidden.
- Every registered Tauri command now has a real frontend consumer; the unused
  `get_storage_snapshots` command was removed.
- Custom title-bar controls (minimize / maximize / close) and window dragging
  were verified on the packaged build with real `plugin:window|*` invokes. The
  ACL capability set is guaranteed at build time: `src-tauri/build.rs` fails if
  the generated `capabilities.json` is missing or empty, and the release script
  regenerates `gen/schemas` and the package build-script output before compiling.
- **New:** the compiled revision is embedded in the binary and surfaced in the
  About card, so a support report can be matched to the audited commit.

## 4. Packaging artifacts (2026-11-01, clean build)

The authoritative record is **`release_output/BUILD_INFO.json`**, written by
`scripts/build-release.js` on every build. It contains the commit, branch, dirty
flag, build time and the size + SHA-256 of each artifact. `SHA256SUMS.txt` holds
the same hashes in checksum-file form.

Those files are git-ignored by design: hardcoding a hash into a tracked document
makes it stale as soon as the next build runs, which is the stale-evidence failure
mode this pass exists to eliminate. To confirm a download:

```powershell
type release_output\BUILD_INFO.json     # "dirty": false, commit = HEAD
certutil -hashfile release_output\Node-Cleaner-2.0.0-Portable.exe SHA256
```

Current build facts (commit `b4f4a71`, clean tree):

| Artifact | Size | Verified |
|---|---|---|
| `Node-Cleaner-2.0.0-Portable.exe` | 11.64 MB | launched, IPC 15/15, legal/About/EN probes PASS, submenu curve PASS (§8.1) |
| `Node-Cleaner-2.0.0-x64-Setup.exe` | 2.78 MB | install → launch → uninstall PASS |
| `Node-Cleaner-2.0.0-x64.msi` | 3.99 MB | install → launch → uninstall PASS (per-user) |

`dirty` is `false` and the embedded commit matches the manifest.

## 5. Residual risk / blockers

| Blocker | Severity | Status |
|---|---|---|
| Windows 10 clean-install smoke (F-4) | P2 | NOT EXECUTED — no Windows 10 host |
| SEC-19 OneDrive cloud-only placeholder | P2 | NOT EXECUTED — no placeholder; reparse-point block executed |
| Code signing absent (F-6) | P3 | OPEN — external certificate |
| 2.0 screens EN/TR only (F-5) | P3 | Documented limitation |
| Dev-toolchain advisories (F-8) | P3 | OPEN — none ship in the release build |
| Dependency CVE scan | P3 | NOT EXECUTED — no network access to an advisory database |

No P0 or P1 blocker remains: the stale-artifact defect (F-11) is fixed and the
shipped packages are a clean, commit-stamped build.

Executed and closed in this pass: SEC-17, SEC-18, SEC-26, SEC-27, SEC-28, Recycle
Bin round-trip, trash-failure fallback, the four performance benchmarks plus a
cancel-latency measurement, and NSIS and MSI installer round-trips.

Non-blocking, documented limitations:

- MSI is generated `perMachine`; a standard user gets error 1925 from a plain
  `/i`. NSIS is the consumer channel; MSI is the elevated / enterprise channel.
- `mask_paths` defaults to `false` (paths visible by default).

## 6. Final statement

No critical or high-severity **deletion** defect was found in the audited code.
The one High finding of the audit (F-11) was a release-integrity defect — the
binary a user would have received was not the reviewed source — and it is now
gated by mechanism (clean-tree gate, embedded commit, freshness check,
`BUILD_INFO.json`, runtime cross-check) instead of by operator discipline.

For a DIRECT-LIVE product the rebuild step is not optional: publish only a package
whose `BUILD_INFO.json` shows `"dirty": false` and a commit equal to the audited
`HEAD`. The current set satisfies both. With F-4 executed or explicitly accepted,
public production is **GO**.

## 7. Post-audit UX/safety batch (2026-11-02)

Nine user-reported defects were fixed on top of the audited HEAD and verified on
the packaged build. No deletion-path, catalog, plan or permission logic changed:
the batch is UI behaviour plus one new read-mostly local snapshot file.

| Report | Fix | Evidence |
|---|---|---|
| Closing the window killed a running scan with no warning | Rust intercepts `CloseRequested`, emits `close-requested`, and the UI asks: minimize to tray (default) / quit / cancel | Native `WM_CLOSE` keeps the process alive and shows the three-choice dialog; "Vazgeç" dismisses it, a second close reopens it, "Tamamen çık" exits (packaged build) |
| No tray presence | Tray icon with Göster/Çıkış, left-click restores, single-instance launch restores | `hide_to_tray` hides the window and the process stays alive (packaged CDP probe) |
| Method/reclaim columns carried little value | Both columns and their sort fields removed; stored settings holding the old fields are normalized | Header renders six cells: checkbox, target, project/category, safety, size, actions |
| "Tümünü seç" did nothing after filtering | Bulk select targets every `selectable && !protected` row, not only `autoSelectable`; provider targets keep `autoSelectable = false` and are never pre-selected | Filtering to a single row leaves the button enabled and selects exactly that row; `bulk selection covers manually selectable rows…` unit test; SEC-30 / FR-S8 amended |
| Garbled characters next to "Ölçülüyor…" | One `formatSignedBytes` helper using U+2212; literal `Â·` replaced with `·` | Repo-wide mojibake grep returns nothing; dev build renders `·` |
| Cache measurement stopped when leaving the page | Measurement state and events moved to a global `cache-store` | `keeps cache measurement progress outside the caches view` unit test; store keeps accumulating after the view unmounts |
| Settings submenu snapped open and never animated closed | `max-height` transition driven by a measured `--nav-submenu-height` (ResizeObserver + one rAF), `ease-in-out`, delayed `visibility`; leaving Settings now collapses it | The previous fix used `grid-template-rows: 1fr`, which Chromium resolves to 0 for this flex item: the closing half never played, and an expansion measured 0 → 0px. Now the same panel measures 202px closed→open and open→closed symmetrically (dev probe; packaged verification in §8) |
| Results vanished on restart | Single `%APPDATA%\node-cleaner\last-scan.json` (schema v1, 64 MiB cap, `MoveFileExW` atomic replace); restored at startup; deleted rows are never persisted | Packaged build with a seeded snapshot: banner + 140 MB / 3 targets restored, `save_last_scan` replaces it, `clear_last_scan` removes it |
| Acting on old numbers felt unsafe | Stale banner on restored data, a warning before a cleanup plan with "rescan first", and a previous-scan comparison | Packaged probe: banner present; dev probe: the plan dialog shows the warning, "Yine de devam et" acknowledges it |
| Overview/Settings looked plain | Hero surface, stat cards, comparison strip, settings tab strip and card treatment | Rendered at 1180×760 with no horizontal overflow on any page |
| The close guard asked on every close | "Remember my choice" stores `closeAction` (`tray`/`quit`) in settings; new Settings → General row switches between ask/tray/quit; the three dialog buttons share one width | Packaged build: dialog checkbox + tray choice persists `closeAction: "tray"` and the next native close hides without a dialog; Settings select does the same; restoring `ask` brings the dialog back; unit test covers unknown-value fallback |

Verification for this batch: `npm run typecheck`, `npm test` (32 tests),
`cargo test --lib` (97 tests), `cargo clippy --all-targets -D warnings`,
`npm run build`, `npm run build:release` from a clean tree, plus the packaged
close-guard, tray and last-scan probes. The tree was clean at build time, so
`BUILD_INFO.json` carries the batch commit.

## 8. Legal pages, About rebuild and submenu fix (2026-11-02)

| Change | Implementation | Evidence |
|---|---|---|
| No in-app legal pages | New `legal` settings section with three documents (EULA, Privacy Policy, Third-Party Licenses) embedded in `src/features/legal/legal-content.ts` in Turkish and English; other UI languages fall back to English, as the documents state | `npm test` → `legal.test.ts` (11 tests): every document exists in both languages, the EULA/privacy policy carry ≥10 clauses, no empty or duplicate clause, Vellium + contact channel appear in every document, non-Turkish languages resolve to English |
| Third-party notices were hand-written and stale (React 18.3.1, Tauri 2.2.0) | `scripts/generate-license-data.mjs` walks `cargo metadata` (Windows target, from the workspace root) and the installed npm tree, then writes `src/features/legal/license-data.ts`: 285 Rust crates, 10 npm packages, 21 direct dependencies | The page renders 285 crates in 21 SPDX groups and the npm packages in 4 groups; a group expands to its full component list; unit tests assert the group sums equal the component counts and that every direct dependency sits in its own license group |
| Attribution obligations were not documented | Notices page names the MIT/ISC/BSD/Apache-2.0 notice duty, the MPL-2.0 source-availability duty (cssparser, selectors, dtoa-short, option-ext), the Unicode-3.0 notice and the Apache NOTICE clause; unit test fails if a scan ever drops MPL-2.0 or Unicode-3.0 | `carries the licenses that require attribution` test; the MPL/Unicode components are listed under their groups on the page |
| Privacy policy could have contradicted the code | Every claim was checked against the source: `%APPDATA%\node-cleaner\config.json`, `history.jsonl`, `snapshots.jsonl`, `actions.jsonl` and `last-scan.json` (single snapshot, 64 MiB cap) exist with those names; masking is display-only; no network calls (SEC-27) | File names read from `settings/repository.rs`, `audit/repository.rs`, `last_scan.rs`; `npm run verify:offline` still reports zero outbound |
| About page was a plain key/value card | Rebuilt as a brand hero (Vellium mark + `vellium.dev` link), build provenance, catalog counters and three legal entry points that deep-link into the Legal section | Dev probe: hero 980×188, two 484px cards plus a full-width legal card, `About → Privacy` opens the Legal section on the Privacy document; 980px max width leaves no horizontal overflow (body scrollWidth = clientWidth) |
| Settings submenu animated open but snapped closed | Root cause: `grid-template-rows: 1fr` resolves to 0 for this flex item, so the closing half never played. Replaced with a `max-height` transition driven by `--nav-submenu-height`, measured with `ResizeObserver` plus one `requestAnimationFrame` and re-measured before each toggle | Packaged CDP probe samples the panel height on both directions (§8.1) |

### 8.1 Packaged probes (release_output, commit b4f4a71)

Run against `Node-Cleaner-2.0.0-Portable.exe` with `APPDATA` pointed at a
throwaway folder and the WebView2 remote-debugging port enabled; no real user
data was touched.

**Submenu curve.** `--nav-submenu-height` measured 236px. Sampling
`document.querySelector('.nav-submenu').getBoundingClientRect().height` every
20 ms after a warm-up open/close pair gives, as a fraction of full height:

| t (ms) | 20 | 41 | 62 | 83 | 104 | 124 | 145 | 166 | 187 | 208 | 229 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| open | 0.019 | 0.096 | 0.265 | 0.496 | 0.680 | 0.802 | 0.883 | 0.936 | 0.971 | 0.991 | 1.000 |
| close (mirrored) | 0.019 | 0.095 | 0.266 | 0.496 | 0.680 | 0.803 | 0.883 | 0.936 | 0.970 | 0.990 | 0.999 |

The two directions agree within 0.002 at every sample and both settle in about
240 ms, so closing is the reverse of opening rather than a snap. The dev
preview tab cannot be used for this measurement: its
`document.timeline.currentTime` stays at 0, so CSS transitions never advance
there (a plain `width: 0 → 200px` probe div freezes at 0 as well).

**Legal page.** EULA renders 13 clauses (5 bullet items), Privacy Policy 12
clauses, Third-Party Notices 4 clauses plus the generated data: 285 Rust crates /
10 npm packages / 21 direct dependencies, a 21-row table, 25 SPDX groups; the
largest group ("MIT OR Apache-2.0", 144 components) expands from 38px to 988px
with 144 list items. Footer offers `vellium.dev` and contact. Body
`scrollWidth − clientWidth = 0` on every document.

**About page.** Hero 916×186 with the Vellium mark and `vellium.dev` link, two
452×204 cards (version/build `b4f4a71`, profile `release`, built at 2 Nov 2026
07:14; catalog 56 rules / 14 ecosystems / 6 categories) and a full-width
916×145 legal card. "Hakkında → Üçüncü Taraf" deep-links to the Legal section
with the Third-Party document and its 25 groups. Switching the UI to English
translates every label and both document sets (`© 2026 Vellium. All rights
reserved.`), with no horizontal overflow.

**Link wiring.** In the browser fallback the About link and both legal footer
links hand exactly `https://vellium.dev`, `https://vellium.dev` and
`https://vellium.dev/contact` to `openUrl`. The packaged build routes that
through the `open_url` command, whose scheme validation is covered by
`verify-ipc.mjs` (15/15).

## 9. Full responsive pass (2026-11-02)

Goal: the whole UI stays premium and readable at every window width, not just
at the 1180×760 default. Measured with the same packaged CDP probe
(`Emulation.setDeviceMetricsOverride`) at 640/700/820/980/1024/1180/1280/1440/
1680/1920/2560px, every view plus all seven settings tabs.

| Breakpoint | Fix | Evidence |
|---|---|---|
| ≤ 900px | `top-command-bar` becomes a three-track grid (`auto / 1fr / auto`) instead of absolutely centering the location pill, which used to slide under the Scan/Settings/window-control cluster | `headerOverlapCenterActions` was `true` at 700px and 640px before the fix, `false` everywhere after |
| ≤ 900px | The nav rail folds to its 56px icon track automatically (matchMedia, not a persisted preference) so content keeps its width; the manual expand control is hidden while narrow | 640px screenshots show the icon rail with full-width content |
| ≤ 900px | Item table and results grids get tighter gutters; the path pill caps at `clamp(110px, 22vw, 240px)` and ellipsizes | `bad` (out-of-viewport) list empty for Projects |
| ≤ 720px | Item table drops the project/category column (its filter stays in the toolbar); `plan-summary` goes 4 → 2 columns; `location-dropdown-menu` caps at `calc(100vw − 40px)`; view gutters drop to `space-4` | 640px Projects screenshot: Target / Safety / Size only, no clipping |
| ≤ 600px | Scan CTA collapses to its icon (label stays in the DOM for screen readers) | 640px header screenshot |
| Ultra-wide | `overview-page`, `page-view`, `items-view` cap at 1240px and `settings-page` at 1080px, all centered with `margin-inline: auto` | At 2560px the overview column stays 1240px centered instead of stretching to 2304px at the left edge |
| Short windows | `@media (max-height: 720px)` trims the About and Settings hero padding/mark so content reaches the fold sooner | 980×640 About screenshot: legal card visible after one scroll instead of three |
| Window floor | `minWidth` 980 → 760, `minHeight` 640 → 560 in `tauri.conf.json` so the responsive rules are actually reachable | `tauri.conf.json` |

Verification: all 88 probes (11 widths × 8 views) report
`body.scrollWidth − viewport = 0`; the only out-of-viewport boxes are the
decorative `overview-hero-glow` / `about-hero-glow` blurs, which are clipped by
`overflow: hidden` on their card. Submenu curve unchanged (235.9px; both
directions reach 99% height at ~230 ms and mirror each other within 0.002).
`npm run typecheck`, `npm test` (43) and `cargo test --lib` (97) pass;
`build:release` from clean tree `9a53eae` and `verify-ipc.mjs` 15/15.


