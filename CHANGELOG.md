# Changelog

All notable changes to Dev Cleaner are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.1] — 2026-11-10

Remediation release for the pre-deployment audit. Behaviour changes are limited
to the destructive MCP path, which is now gated three times.

### Security

- **MCP destructive gate (ADR-2).** `devcleaner_execute_cleanup` now requires
  three independent conditions: the `--allow-destructive` flag, the
  `mcpAllowDestructive` setting (default `false`, schema v4), and a single-use
  five-minute preview token. Tokens are removed before execution, so a failed
  run cannot be replayed.
- **Path guard rewritten.** System-directory detection is component-aware, so
  `C:\Users\me\AppData\Windows\foo` and nested `ProgramData` paths are rejected
  while `WindowsApps` is still allowed. Drive roots, user-profile roots and
  reparse points stay blocked.
- **Webhook test moved to Rust.** The test call runs through `reqwest` with a
  scheme allowlist (`http`/`https`) instead of a cross-origin `fetch` the CSP
  blocked.

### Added

- `test_webhook` command with blocking HTTP client and URL validation.
- `clear_all_history` command; `clear_cleanup_history` remains as a deprecated
  alias.
- `scripts/check-audit-invariants.mjs` (5 forbidden-pattern rules) and a CI
  workflow with typecheck, Vitest, Rust tests, clippy and rustfmt gates.
- Frontend test harness (`createInvokeMock`, `createFakeScannerApi`).
- Rust integration tests: `tests/webhook.rs`, `tests/mcp_flow.rs`.
- `formatSavedAt` and `describeError` shared helpers.

### Changed

- CLI `--scope` maps `caches` to `GlobalCaches` and `all` to `AllDrives`
  (previously the values were inverted with respect to the real enum).
- CLI exit codes documented and enforced: 0 success, 1 scan failure, 2 cleanup
  failure, 3 argument error, 4 blocked.
- MCP `scan_workspace` returns a `scan_id`; `preview_cleanup` reuses that
  session, measures only the selected targets and can finally resolve the
  target IDs it was given.
- Settings schema bumped to v4 with migration from v3.
- History screen loads only the active tab.
- Documentation navigation is localized, article bodies are English-only with a
  visible notice (ADR-4).
- Prettier and `cargo fmt` are enforced.

### Removed

- Demo/mock API layer is no longer bundled in production builds; it is imported
  dynamically in development only. Concept preview screens are dev-only.
- Non-Windows process-kill branch (ADR-6).
- Uncached `_searchHaystack` field and hardcoded `2.2.0` version literals.
