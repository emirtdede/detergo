# Contributing to Dev Cleaner

Thanks for taking the time to improve Dev Cleaner. This guide covers the local
setup, the quality gates every change must pass, and the conventions the
codebase follows. If something here is unclear, open a discussion or an issue.

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
Security problems must be reported privately as described in
[SECURITY.md](SECURITY.md), never in a public issue.

## What the project is

Dev Cleaner is a Windows desktop application built with **Tauri 2 (Rust)** and
**React 19 (TypeScript)**. It discovers reproducible developer artifacts (for
example `node_modules`, Python virtual environments, Rust `target` folders, AI
coding-agent storage and package-manager caches), shows their real disk usage,
and deletes the targets you select — by default to the Windows Recycle Bin.

Two rules shape almost every review:

1. **The backend owns truth.** Scanning, measurement, classification and
   deletion run in Rust. The frontend renders backend-issued target IDs and
   never constructs a deletion path itself.
2. **Nothing is deleted that the safety layer did not classify.** Protected
   paths, active processes, reparse points and unverified targets are refused.
   A change that weakens a guard needs a written threat-model argument and a
   regression test.

## Requirements

- **Windows 11 x64** (the supported and verified target).
- **Node.js 22+** and npm.
- **Rust stable** with `rustfmt` and `clippy`
  (`rustup component add rustfmt clippy`).
- **WebView2** runtime (preinstalled on Windows 11).
- Optional, only for installer work: NSIS and WiX Toolset.

## Local setup

```bash
git clone https://github.com/emirtdede/dev-cleaner.git
cd dev-cleaner
npm ci
```

Run the desktop app in development mode:

```bash
npm run tauri dev
```

Build the frontend only:

```bash
npm run build
```

## Quality gates

Run the same gates CI runs before opening a pull request. All of them must be
green. GitHub Actions runs this list on every push and pull request (see
`.github/workflows/ci.yml`); AppVeyor stays as a redundant Windows path (see
`appveyor.yml`).

| Area                   | Command                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| TypeScript             | `npm run typecheck`                                                              |
| Frontend tests         | `npm test`                                                                       |
| Formatting (web)       | `npm run format:check`                                                           |
| Regression gates       | `npm run check:gates`                                                            |
| Safety invariants      | `npm run check:audit`                                                            |
| Localisation           | `npm run check:i18n`                                                             |
| Colour contrast        | `npm run check:contrast`                                                         |
| Version consistency    | `npm run check-version`                                                          |
| Icons and brand assets | `npm run check:icons` / `npm run check:brand`                                    |
| Installer languages    | `npm run check:languages`                                                        |
| Rust formatting        | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`                      |
| Rust lints             | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` |
| Rust tests             | `cargo test --manifest-path src-tauri/Cargo.toml`                                |
| IPC bindings drift     | `npm run check:bindings`                                                         |
| Accessibility          | `npm run test:a11y` (Playwright + axe)                                           |

`npm run format` rewrites web files with Prettier; `cargo fmt` rewrites Rust.
Do not hand-format around them.

## Code layout

```text
src/                  React frontend (features, stores, lib, styles, tests)
src-tauri/src/        Rust backend
  scanner/            discovery, measurement, limits, per-scan session
  catalog/            rule model, matcher, monorepo project resolver
  safety/             path, process, Git and evidence guards
  cleanup/            planner, coordinator, Recycle Bin, permanent delete
  commands/           Tauri IPC handlers (thin; no policy)
  providers/          AI-agent storage and root discovery
  audit/              deletion history and official-action audit trail
  settings/           backend-owned settings and atomic persistence
src-tauri/assets/     embedded cleanup catalog (targets.toml)
docs/                 specification, architecture, security and release evidence
scripts/              build, verification and gate scripts
e2e/                  Playwright accessibility and smoke tests
```

Read [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md)
before changing a layer boundary.

## Making a change

1. **Open or claim an issue** for anything larger than a typo, so the approach
   can be agreed before you spend time on it.
2. **Branch from `main`** using a descriptive name:
   `fix/recycle-bin-retry`, `feat/cli-interactive`, `docs/contributing`.
3. **Keep commits atomic.** We use [Conventional Commits](https://www.conventionalcommits.org/):
   `feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `test:`, `build:`, `ci:`,
   `chore:`. A commit should build and pass the gates on its own.
4. **Add a regression test.** Every behavioural fix needs a test that fails
   before the change and passes after it. For a Rust scanner or safety fix,
   that is a `#[test]` next to the code; for a frontend fix, a Vitest case in
   `src/test/`.
5. **Update documentation** when behaviour, flags, or invariants change.
   `docs/MASTER_SPEC.md` is normative; if your change contradicts it, update the
   specification in the same pull request.
6. **Open a pull request** using the template. Describe the user-visible effect,
   the tests you ran, and any risk you considered.

## Localisation

The UI ships 73 languages. User-visible strings live in `src/locales/` and in
the generated UI-text catalogues; never hard-code English in a component. Add a
key to English and the fallback chain handles the rest, but run
`npm run check:i18n` — it rejects missing keys, orphaned keys, mojibake and
untranslated leaves that are not allowlisted.

Chinese, Japanese, Korean and other non-Latin scripts must not be used as
decoration in code or comments; the script audit checks for that.

## Safety-sensitive changes

Anything under `src-tauri/src/safety/`, `cleanup/`, `scanner/` or the MCP
destructive gates must answer:

- What path can this code delete, and what proves it is inside an allowed root?
- What happens when the path is a junction, symlink or reparse point?
- What happens when the user cancels or the process dies mid-delete?
- Is the action recorded in the audit trail?
- Which existing test would fail if the guard were removed?

`npm run check:audit` enforces five structural invariants (single deletion
chokepoint, mandatory confirmation token, audit-before-report, no raw
`remove_dir_all` outside the cleanup module, and no unprotected IPC delete
command). Read `scripts/check-audit-invariants.mjs` before working around it —
the workaround is almost always the bug.

## Reporting bugs

Use the bug report template and include:

- Dev Cleaner version (`dev-cleaner --version` or the About screen).
- Windows version and architecture.
- Exact steps, expected result and actual result.
- Relevant log lines with personal paths redacted.
- Whether the target was on a network drive, a junction, or a compressed folder.

## License

By contributing you agree that your contribution is licensed under the
[MIT License](LICENSE), the same license as the project.
