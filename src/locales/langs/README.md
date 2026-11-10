# Legacy dictionaries (`src/locales/langs`)

These TypeScript dictionaries back the deprecated `t`/`tr` proxy exported by
`src/lib/i18n/index.ts`. They are kept for backward compatibility with older
components and must stay in sync with `src/locales/types.ts`
(`TranslationSchema`).

## Why there is no `legal.*` section

Legal documents live in `src/features/legal/legal-locales/*.json` and
`src/features/legal/legal-content.ts`, which own the authoritative English and
Turkish texts plus the per-locale overlay. `LegalView` reads those files
directly, so duplicating `legal.*` here would create a second, drifting source
of truth. The absence of `legal.*` in these files is intentional and is not an
i18n coverage gap.

## Where new strings belong

- New UI strings: `src/lib/ui-text/en.ts` + `src/lib/ui-text/locales/*.json`.
- Backend/catalog strings: `src/lib/ui-text/backend-locales/*.json`.
- Documentation: `src/features/docs/docs-locales/*.json` (and
  `DocsContentTr.tsx` for the hand-written Turkish docs).
- Legal: `src/features/legal/legal-locales/*.json`.

Only add keys here when an older component still imports the `tr` proxy.
