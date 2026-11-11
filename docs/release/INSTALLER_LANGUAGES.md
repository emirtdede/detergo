# Installer languages

Dev Cleaner ships 73 app languages. The NSIS setup wizard speaks all of them;
before 2.2.2 it could only speak the 52 for which NSIS ships a language file, so
21 languages opened an English wizard over a localized app. That gap is closed by
generating the missing language tables in the repository, not by dropping
languages from the picker.

## What is generated

| Artifact | Count | Source | Written by |
|---|---|---|---|
| `.nlf` core language table | 21 | `src-tauri/nsis/languages/_template/English.nlf` | `npm run generate:nsis-languages` |
| `.nsh` MUI string table | 21 | `src-tauri/nsis/languages/_template/English.nsh` | same |
| Tauri installer messages (`tauri/<locale>.nsh`) | 54 | `_template/tauri-English.nsh` | same |
| Picker title/info (`languages/picker.nsh`) | 73 | English constants in the generator | same |

The 19 languages Tauri itself ships messages for (English, Arabic, Bulgarian,
Dutch, French, German, Italian, Japanese, Korean, Norwegian, Portuguese,
Russian, Simplified/Traditional Chinese, Spanish, Swedish, Turkish, Ukrainian,
Vietnamese) keep Tauri's hand-written strings.

Farsi and Hebrew are deliberately *not* in that list: Tauri ships `.nlf`
files for them but no `LANG_FARSI` / `LANG_HEBREW` message file, so their
bundler log warns "Custom tauri messages … are not translated". The catalogue
therefore marks them `tauri: "project"` and the generator supplies their
messages.

`scripts/lib/installer-languages.mjs` is the single source of truth: locale,
NSIS language name, whether NSIS or this project supplies the table
(`source`), the LCID, whether Tauri supplies the messages (`tauri`), RTL, and
the native autonym shown in the picker.

## How the wizard loads them

makensis only resolves language files from inside its own installation
(`%LOCALAPPDATA%\tauri\NSIS\Contrib\Language files`). The repository copy is
therefore useless until it is copied in, so `npm run sync:nsis-languages` runs
before bundling — both in `build:release` and manually when iterating.

The 54 message packs are different: they are passed to makensis through
`bundle.windows.nsis.customLanguageFiles` in `tauri.conf.json`, with paths
resolved relative to `src-tauri` (`nsis/languages/tauri/<locale>.nsh`).

## The language picker

The language list itself is MUI's `MUI_LANGDLL_DISPLAY`, kept because it is the
only mechanism that applies a language *before* NSIS builds the wizard pages.
(A custom page cannot: NSIS resolves every `LangString` table at GUI creation, so
assigning `$LANGUAGE` from a combo box never re-renders `$(...)` text — verified
with standalone probes.) `MUI_LANGDLL_ALWAYSSHOW` makes it appear on every run;
the previously chosen language is still preselected from
`HKCU\Software\Vellium\Dev Cleaner\Installer Language`.

LangDLL takes its window title and info line from `MUI_LANGDLL_WINDOWTITLE` and
`MUI_LANGDLL_INFO`. Both now point at generated `LangString`s in
`languages/picker.nsh` (`DcPickerTitle`, `DcPickerInfo`), so the dialog is
localized in all 73 languages instead of being hard-coded English.

Two limits come from the plugin and are accepted:

- **The OK/Cancel labels are compiled into `LangDLL.dll`.** They are UTF-16
  English at fixed offsets and no define changes them. They are the same stock
  buttons Windows shows for the plugin, not text Dev Cleaner controls.
- **The title/info follow the OS language, not the remembered one.** MUI evaluates
  `MUI_LANGDLL_WINDOWTITLE`/`MUI_LANGDLL_INFO` in `.onInit` *before* `MUI_LANGDLL_DISPLAY`
  reads the registry, so the title is in the Windows UI language while the combo
  correctly preselects the saved language. Once the user confirms, the entire
  wizard switches to the chosen language.

## Rules that are easy to get wrong

1. **Codepage is `1200`, not `65001`.** NSIS rejects any other value in a
   Unicode installer, even though the files themselves stay UTF-8 + BOM (the
   same encoding NSIS uses for Armenian, Georgian and Hindi).
2. **Message packs must not have a BOM.** Tauri re-writes every
   `customLanguageFiles` entry with its own BOM; a BOM in the source produces a
   double BOM and makensis fails with `Invalid command: "﻿LangString"`.
   Core `.nlf`/`.nsh` tables in `Contrib` *do* need the BOM.
3. **NSIS has no `\"` escape.** A literal quote is `$\"`. Writing `\"` closes
   the string and makensis reports `LangString expects 3 parameters, got 6`.
4. **Ampersands are mnemonics, not text.** `&Next >` and `B&rowse...` must be
   stripped before translation and re-applied afterwards, otherwise the
   translator sees one opaque token and returns the English label unchanged.
5. **`$\n` glued to a word breaks the translator.** `"$\nClick"` becomes one
   token and machine translation mangles it; a space after the newline is
   visually identical and keeps the token separate.
6. **Sentence strings name the buttons.** `ClickNext` ("Click Next to
   continue."), `ClickInstall`, `ClickUninstall`, `LicenseText` ("click I
   Agree") and MUI's "Click Finish to close Setup" all keep the English button
   word after translation, contradicting the translated button right below. The
   generator replaces every literal English button label (`*Btn` keys plus
   `MUI_BUTTONTEXT_FINISH`) with its localized label across the `.nlf`, `.nsh`
   and Tauri message files of that language. For the 33 languages whose table
   NSIS ships, the generator reads NSIS's own translated buttons so the quoted
   label still matches.
7. **The footer is one string for all languages.** `bundle.copyright` becomes
   `BrandingText`, so it must stay language-neutral (`© 2026 Vellium`), not
   `© 2026 Vellium. All rights reserved.`.

## Keeping it honest

`npm run check:languages` fails on:

- a catalogue locale without an app translation, or vice versa;
- a duplicate NSIS language name;
- a missing `.nlf`/`.nsh` pair, wrong LCID, codepage other than 1200;
- an English sentinel line (`License Agreement`, `Choose Install Location`,
  `Installation Complete`, `Please wait`);
- an English button label (`Next`, `Install`, `Uninstall`, `I Agree`, `Finish`,
  `Browse`) inside any translated string of that language, while the matching
  button label in the same language *is* translated;
- a message pack with the wrong `LANG_*` constant, a `LANG_ENGLISH` reference, a
  BOM, or `\"` instead of `$\"`;
- a `picker.nsh` that is missing, lacks a title/info for a language, still uses
  the English sentinel for a non-English language, or is not wired into
  `hooks.nsh` through `MUI_LANGDLL_WINDOWTITLE`/`MUI_LANGDLL_INFO`;
- a `customLanguageFiles` entry pointing at a missing file or at a language
  Tauri already covers;
- a `tauri.conf.json` language list that differs from the catalogue order
  (English, Turkish, then alphabetical);
- **a stale copy in the NSIS toolset**: the file in `Contrib` is byte-compared
  against the repository. This check exists because a generator fix that was
  never synced shipped `Next >` and `Browse...` in English.

`npm run check:i18n` separately audits the legacy `src/locales/langs`
dictionaries that back the deprecated `tr` proxy. They escaped the
untranslated-value gate until 2.2.2, which is how the literal
`settings.platform: "Tauri v2 + React 18 + Rust"` survived in 72 languages. That
key had no reader and was removed.

## Translation quality

The generated tables are machine translation (Google Translate) from the English
templates, cached at `%TEMP%\dev-cleaner-mt-cache.json`. Delete the cache to
force re-translation. Each file's header records:

```
# Project-supplied machine translation (Google Translate); pending native review
```

They are good enough to remove the English leak and to keep the wizard
navigation consistent, but a native reviewer should still pass over the 21
tables before the strings are treated as final copy. The app's own 73
dictionaries are a separate, hand-maintained set.
