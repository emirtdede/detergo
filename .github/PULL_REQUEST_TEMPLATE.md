## Summary

<!-- What changes for the user, and why? Link the issue: "Closes #123". -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor or performance
- [ ] Documentation
- [ ] Build, CI or packaging
- [ ] Localisation

## Safety impact

<!--
Does this touch scanning, classification, path validation, deletion, the MCP
destructive gates, or the audit trail? If yes, state what proves a target is
allowed, and which test would fail if the guard were removed. If no, say "none".
-->

## Verification

<!-- Tick the gates you ran. CI runs the rest. -->

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run check:gates`
- [ ] `npm run check:audit`
- [ ] `npm run check:i18n`
- [ ] `npm run format:check`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- [ ] `npm run test:a11y` (for UI changes)

## Screenshots or CLI output

<!-- Before/after. Redact usernames, paths and webhook URLs. -->

## Checklist

- [ ] I added or updated a regression test for every behavioural change.
- [ ] I updated the documentation and, if needed, `docs/MASTER_SPEC.md`.
- [ ] User-visible strings go through the localisation layer.
- [ ] No secrets, tokens, personal paths or generated build output are included.
