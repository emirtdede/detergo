# Changelog

All notable changes to Detergo are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The versions before `1.0.0` were internal pre-release iterations of the same
codebase (the 2.x line). Their work is folded into the first release below; the
commit history keeps the detailed trail.

## [Unreleased]

### Performance & Engine Architecture

- **Win32 batch directory measurement (`GetFileInformationByHandleEx(FileIdBothDirectoryInfo)`)** - replaced per-file `WalkDir` + `CreateFileW` measurement with 64 KiB buffered batch enumeration, exact 64-bit NTFS `FileId` hardlink deduplication across 16 lock-sharded sets, and bounded parallel subdirectory workers (`platform/windows/fast_walk.rs`), with transparent `WalkDir` fallback on non-NTFS volumes.
- **Parallel work-stealing discovery (`FindFirstFileExW`)** - replaced single-threaded `WalkDir` discovery with 2-8 worker threads using `FindExInfoBasic` + `FIND_FIRST_EX_LARGE_FETCH`, per-worker `ProjectResolver` / Git caches, and atomic candidate budgets (`scanner/discovery.rs`).
- **Warm STA COM `RecycleBinSession`** - eliminated per-target STA thread creation and `CoInitializeEx` churn during Recycle Bin batches (`cleanup/recycle_bin.rs`), and added real macOS (`osascript` Finder) and Linux (`gio trash`) trash implementations.
- **Parallel handle-verified permanent delete** - parallelized leaf-file unlinking (`>= 64` files → up to 8 workers) with bottom-up directory removal (`cleanup/permanent.rs`).
- **Eliminated redundant pre-delete directory re-walk** - `cleanup/coordinator.rs` verifies directory targets via O(1) NTFS `FileId` `TargetSnapshot` instead of synchronously re-walking the entire directory before deletion.
- **Release optimization profile** - added `[profile.release]` (`opt-level = 3`, `lto = "thin"`, `codegen-units = 1`, `strip = "symbols"`) to `src-tauri/Cargo.toml`.

### Security & Reliability

- **Real Win32 lock detection (`is_in_use`)** - fixed `CreateFileW` access mask from `0` to `DELETE.0` with `FILE_SHARE_MODE(0)` plus bounded child-file probing (up to 48 files / depth 2) in `platform/windows/fs_meta.rs`, and implemented real Unix metadata/identity/in-use probes.
- **Scoped `PathGuard` system-folder blocking** - kept `Windows`, `Boot`, and `Recovery` blocked at drive root (plus `AppData\Windows`) without false-blocking legitimate developer subdirectories such as `flutter-app/windows/build`, `spring-app/boot/target`, or `recovery/node_modules`; added Unix system root guards.
- **Real Git tracking check in `evaluate_path`** - wired `git_guard::fast_git_state` for `GitPolicy::DenyTracked` rules during single-path inspection (`detergo_inspect_target`).
- **Atomic schedule config replacement** - unified atomic `MoveFileExW` / `fs::rename` via `platform::atomic_replace_file` across both settings and `system_cleaner/schedule.rs`.
- **Self-hosted LAN webhook opt-in (`allowPrivateWebhooks`)** - permits loopback/RFC1918/ULA endpoints (e.g. local n8n at `http://localhost:5678`) when explicitly enabled in Settings → Automation, while permanently blocking cloud metadata (`169.254.0.0/16`, `fe80::/10`, `metadata.google.internal`), `0.0.0.0`, `::`, and redirects.

### Coverage, UX & Maintainability

- **Expanded catalog to 82 rules across 18 ecosystems** - added 22 new rules covering DevOps/IaC (`.terraform`, `.terragrunt-cache`, `cdk.out`, `.aws-sam`, `.serverless`), Haskell (`.stack-work`, `dist-newstyle`), JS/Web/Mobile (`.expo`, `.wrangler`, `.open-next`, `.docusaurus`, `playwright-report`, `test-results`), Swift/Apple (`Pods`, `Carthage`), Android (`.cxx`), Python (`*.egg-info`, `.ipynb_checkpoints`, `.hypothesis`), C/C++ (`.vs`, `vcpkg_installed`), and Godot (`.import`), plus Ruby and Zig.
- **Expanded tool caches to 27 providers (26 cleanable + WSL inspection)** - added **Poetry**, **VS Code**, **JetBrains IDEs** (excluding Toolbox), **Android SDK Cache**, **Homebrew**, **Ollama**, and **Docker `container prune`**; expanded **Cargo** cleanup to `registry/src` + `git/checkouts`; protected opt-in LLM caches (`ollama`, `huggingface`) during `c all`; fixed Windows `.cmd`/`.bat` execution hardening, sparse WSL `ext4.vhdx` allocated-byte measurement, and cross-platform cache paths on macOS/Linux.
- **Expanded AI coding-agent storage to 17 built-in providers** - added **Claude Desktop**, **GitHub Copilot**, **Cline**, **Roo Code**, **Aider**, **Continue**, **Zed**, and **LM Studio** alongside Antigravity, Claude Code, Codex, Cursor, Windsurf, OpenCode, T3 Code, Trae, and Kiro; fixed `antigravity.skills` (`keep`), Cursor/Windsurf `User/workspaceStorage` + VSIX/GPU caches, aggregated per-scan storage snapshots, and minimum 60 s growth-rate windows.
- **73 fully translated languages & genuine i18n gates** - translated all remaining UI, documentation, MIT-consistent legal, and CLI strings across all 71 non-EN/TR locales, repaired severe mistranslations (`common.cancel`, `overview.kpiLifetime`, `nav.history`), re-aligned all 72 CLI `--help` locales, removed all `Awaiting translation` bypasses from `check-i18n-untranslated.mjs`, fixed `check-i18n-unused.mjs` self-matching, and pruned 36 dead UI keys.
- **WCAG 2.2 AA across all 16 themes** - expanded automated contrast verification to all 16 themes, tuned all 12 colored themes to pass WCAG 2.2 AA, restored WCAG 1.4.4 viewport zoom (`Ctrl +/-/0`, `Ctrl+Wheel`), and added Docs + RTL (`ar`) Playwright/axe E2E coverage.
- **CLI console companion & MCP 2025-11-25** - added `detergo.com` console companion binary (`detergo-cli`), `--flag=value` & `--` CLI parsing, MCP protocol negotiation (`2024-11-05`..`2025-11-25`), cursor pagination (`cursor`/`limit`/`nextCursor`), and concurrent `notifications/cancelled` cancellation.
- **Cross-platform CI & package manager manifests** - added `ubuntu-latest` / `macos-latest` Rust checks and Playwright E2E to `.github/workflows/ci.yml`, plus WinGet 1.9 (`packaging/winget/`) and Scoop (`packaging/scoop/`) manifests and [`docs/SIGNING_AND_DISTRIBUTION.md`](SIGNING_AND_DISTRIBUTION.md).
- **Staleness / age filtering everywhere** - added `-o` / `--older <AGE>` (`7d`, `30d`, `2w`, `3m`, `1y`) to CLI, `older_than_days` to MCP `detergo_scan_workspace`, and an Age filter dropdown (`>7d`, `>30d`, `>90d`, `>180d`) to the GUI `ItemTable`.
- **Interactive Disk Space Treemap** - added a proportional squarified 2D treemap (`src/features/overview/DiskTreemap.tsx`) on the Overview page with real `ResizeObserver` aspect-ratio measurement and a `"+N Other"` roll-up bucket.
- **Frontend UX hardening** - fixed background cleanup dismissal (`hideModal` before `await`), virtualized `CleanupPlanDialog` via `@tanstack/react-virtual`, isolated Projects/Agents search state, added Shift+Click range selection, unified reclaimable byte totals, added History search + masked JSON export, and ensured `maskPaths` covers System Cleaner and Caches command logs.
- **License & documentation alignment** - rewrote EULA and Third-Party Licenses across all 73 languages to be 100% MIT-consistent, added [`docs/SYSTEM_CLEANER.md`](SYSTEM_CLEANER.md), and updated `README.md`, `docs/ARCHITECTURE.md`, and `docs/CLI.md`.

## [1.0.0] - 2026-11-19

First open-source release. MIT licensed, Windows 11 x64.

### Added

- **Cleanup catalog** - 56 evidence-backed rules across JavaScript/TypeScript,
  Python, Rust, .NET, Java/Kotlin, Go, PHP, Dart, package-manager caches and AI
  coding-agent storage. Every rule carries a safety class (`safe`,
  `regenerate`, `review`) and a regeneration hint.
- **AI agent storage analysis** - Codex, Claude Code, Antigravity, OpenCode and
  T3 Code roots are measured by metadata only; file contents are never read.
- **Built-in MCP server** - agents discover and preview cleanups over the Model
  Context Protocol behind a mandatory preview → token → execute gate, with
  bounded grant TTLs and a 16-entry cap.
- **Interactive CLI** - `detergo scan .` prints a size-ranked table, `-i` /
  `--interactive` turns it into a numbered picker (`1,3-5` / `all` / `none`),
  `--json` feeds CI, `--webhook` reports to n8n/Slack/Discord. Full reference:
  [`CLI.md`](CLI.md).
- **73 languages**, including RTL layouts and a localized NSIS installer.
- **Reversible deletion** - targets move to the Windows Recycle Bin and every
  run is recorded in the local audit history.
- **Build provenance** - `release_output/BUILD_INFO.json` records the source
  commit, the clean-tree flag and a SHA-256 per artifact; `npm run
  check:build-info` verifies it.
- **Open-source infrastructure** - `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, issue and pull-request templates, Dependabot, `.editorconfig`
  and `.gitattributes`.

- **C: drive cleaner** - a new side-menu tab that clears Windows temp
  folders, Prefetch data, Windows Update leftovers, Windows error reports and
  the Recycle Bin, and drives Disk Cleanup and component-store (DISM) cleanup
  without the user typing a command. Every action is measured first, nothing is
  deleted before an explicit confirmation, and a Windows scheduled task can run
  the quick or standard profile daily or weekly. Elevation is on demand: the app
  restarts itself as administrator only when a selected action needs it. Guide:
  [`SYSTEM_CLEANER.md`](SYSTEM_CLEANER.md).
- **Catalog explorer** - every ecosystem card on the About page is now a button
  that opens the rules behind it: the folder names each rule matches, its
  category, its safety class, its regeneration command and the catalog's own
  note. The data comes from the live catalog, so the panel can never describe
  rules the scanner does not apply. Dark, light, 320 px reflow and axe (WCAG
  2.2 AA) all pass with the panel open.
- **Update check** - *Settings > About > Software updates* asks the public
  GitHub Releases API for the newest tag, compares it with the running version
  and shows the release notes. The request happens only after you press the
  button: nothing contacts the network at startup, nothing is downloaded and
  nothing installs itself. The check is free to run and needs no server.
- **Local error log** - uncaught errors, rejected promises and failed backend
  commands are recorded in a 20-entry ring buffer in `localStorage`, with user
  paths and webhook credentials masked before they are written. The About page
  lists them, copies them to the clipboard and can pre-fill a GitHub issue. The
  log is never uploaded: it only leaves the device if you paste it somewhere.
- `npm run generate:mock-catalog` regenerates the browser-preview catalog from
  `src-tauri/assets/targets.toml`, and `npm run check:gates` fails when the two
  drift apart.

### Security

- The safety layer refuses protected system paths, junctions and other reparse
  points, targets held open by a running process, and any target whose type or
  contents changed between scan and delete.
- Webhook URLs are validated (scheme, host, no redirects) and the request body
  is built from backend-owned fields.
- `open_url` rejects malformed URLs, including `https://`, `https:\\evil` and
  user-info tricks.
- The bounded MCP registry, clamped history queries, bounded scan event queue
  and the 64 MiB cap on `last-scan.json` prevent memory and SQLite abuse from a
  misbehaving client.
- A recovered drive's disk-pressure cooldown is pruned while another drive is
  silenced; history timestamps are normalised and a corrupt database is moved
  aside instead of crashing startup.

### Changed

- The project is MIT licensed. The README, `package.json` and `Cargo.toml` now
  agree with `LICENSE` (Copyright © 2026 Vellium).
- README rewritten for the 1.0 feature set, the CLI and the open-source
  contribution path.
- Documentation consolidated under `docs/`; superseded audit and planning
  documents removed.

### Fixed

- **About layout** - the diagnostics panel used to leave the bottom-right half
  of the two-column grid empty. The update check, the health panel and the error
  log now share one row, collapsing to two columns and then to one.
- **Rule counts in the browser preview** - the preview shipped three
  hand-written rules, so About reported "3 rules / 3 ecosystems" while the
  packaged app reported 56 / 14. The preview now renders the generated catalog.
- **Privacy and licence text** - the "no network request" paragraphs now name
  the update check as the one request you can start yourself, in both the
  English original and the Turkish translation.

- **Settings & About layout** - both Settings and About now share the same
  full-bleed second side menu as Documentation, keeping navigation consistent
  and eliminating duplicated section headers, misaligned update controls and
  uneven gaps.
- **Scan engine accuracy & speed** - fixed Windows reparse-tag inspection so
  transparent WOF/Dedup/hydrated cloud folders are never skipped while symlinks,
  junctions and unhydrated stubs stay blocked; stopped pruning subtrees beneath
  unverified generic directories so nested `node_modules` are always found;
  scoped drive-root OS exclusions to actual drive roots; filtered false
  positives inside source subtrees (`src/`, `wwwroot/`, `public/`) and
  mismatched ecosystems; and cached Git root lookups once per winning target.
- **Scan profiles** - added the `Full` scan profile alongside `Fast`,
  `Balanced` (default), `Thorough`, `Deep` and `Maximum` in both the profile
  picker dialog and the Settings > Scan limits selector.
- **Support mail draft** - added Thunderbird CLI and Windows Simple MAPI
  (`MAPISendMailW`) draft composition after Outlook COM, plus automatic
  clipboard copy of the ZIP path on `mailto:` fallback.
- **Scan header** - the "Scan all" description wraps cleanly without truncation
  and provides a full hover tooltip.
- **AI Tools empty state** - the unscanned state fills the viewport height like
  Projects, and combined scans (`--scope combined`) now update AI Tools status.
- **Documentation** - every individual command across Quickstart, CLI Guide,
  MCP and C: Drive Cleaner (including Windows CMD reference commands) has its
  own one-click copy button, and the interactive CLI Command Builder copy button
  is wired up in both English and Turkish docs.

### Known limitations

- Installers are not code-signed, so SmartScreen may warn.
- The elevated MSI path still needs a clean-VM verification run.
- Update checks and support bundles are user-initiated; there is no automatic
  updater.
- Windows 10 is not verified and is not advertised as supported.
