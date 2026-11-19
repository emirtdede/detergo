# Changelog

All notable changes to Dev Cleaner are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The versions before `1.0.0` were internal pre-release iterations of the same
codebase (the 2.x line). Their work is folded into the first release below; the
commit history keeps the detailed trail.

## [1.0.1] — 2026-11-19

Follow-up to the first open-source release: the About page now answers the
questions a reviewer actually asks, and the app can tell you when a newer
release exists.

### Added

- **Catalog explorer** — every ecosystem card on the About page is now a button
  that opens the rules behind it: the folder names each rule matches, its
  category, its safety class, its regeneration command and the catalog's own
  note. The data comes from the live catalog, so the panel can never describe
  rules the scanner does not apply. Dark, light, 320 px reflow and axe (WCAG
  2.2 AA) all pass with the panel open.
- **Update check** — *Settings > About > Software updates* asks the public
  GitHub Releases API for the newest tag, compares it with the running version
  and shows the release notes. The request happens only after you press the
  button: nothing contacts the network at startup, nothing is downloaded and
  nothing installs itself. The check is free to run and needs no server.
- **Local error log** — uncaught errors, rejected promises and failed backend
  commands are recorded in a 20-entry ring buffer in `localStorage`, with user
  paths and webhook credentials masked before they are written. The About page
  lists them, copies them to the clipboard and can pre-fill a GitHub issue. The
  log is never uploaded: it only leaves the device if you paste it somewhere.
- `npm run generate:mock-catalog` regenerates the browser-preview catalog from
  `src-tauri/assets/targets.toml`, and `npm run check:gates` fails when the two
  drift apart.

### Fixed

- **About layout** — the diagnostics panel used to leave the bottom-right half
  of the two-column grid empty. The update check, the health panel and the error
  log now share one row, collapsing to two columns and then to one.
- **Rule counts in the browser preview** — the preview shipped three
  hand-written rules, so About reported "3 rules / 3 ecosystems" while the
  packaged app reported 56 / 14. The preview now renders the generated catalog.
- **Privacy and licence text** — the "no network request" paragraphs now name
  the update check as the one request you can start yourself, in both the
  English original and the Turkish translation.

## [1.0.0] — 2026-11-18

First open-source release. MIT licensed, Windows 11 x64.

### Added

- **Cleanup catalog** — 56 evidence-backed rules across JavaScript/TypeScript,
  Python, Rust, .NET, Java/Kotlin, Go, PHP, Dart, package-manager caches and AI
  coding-agent storage. Every rule carries a safety class (`safe`,
  `regenerate`, `review`) and a regeneration hint.
- **AI agent storage analysis** — Codex, Claude Code, Antigravity, OpenCode and
  T3 Code roots are measured by metadata only; file contents are never read.
- **Built-in MCP server** — agents discover and preview cleanups over the Model
  Context Protocol behind a mandatory preview → token → execute gate, with
  bounded grant TTLs and a 16-entry cap.
- **Interactive CLI** — `dev-cleaner scan .` prints a size-ranked table, `-i` /
  `--interactive` turns it into a numbered picker (`1,3-5` / `all` / `none`),
  `--json` feeds CI, `--webhook` reports to n8n/Slack/Discord. Full reference:
  [`CLI.md`](CLI.md).
- **73 languages**, including RTL layouts and a localized NSIS installer.
- **Reversible deletion** — targets move to the Windows Recycle Bin and every
  run is recorded in the local audit history.
- **Build provenance** — `release_output/BUILD_INFO.json` records the source
  commit, the clean-tree flag and a SHA-256 per artifact; `npm run
  check:build-info` verifies it.
- **Open-source infrastructure** — `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, issue and pull-request templates, Dependabot, `.editorconfig`
  and `.gitattributes`.

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

### Known limitations

- Installers are not code-signed, so SmartScreen may warn.
- The elevated MSI path still needs a clean-VM verification run.
- There is no in-app update check yet; new versions are downloaded manually
  from the releases page.
- Windows 10 is not verified and is not advertised as supported.
