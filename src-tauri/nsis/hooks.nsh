; ============================================================
; Detergo NSIS installer / uninstaller hooks
;
; Content is ASCII-only on purpose except the !include line: NSIS reads this
; file with the system code page, so non-ASCII comments turn into mojibake. The
; generated picker strings (languages/picker.nsh) carry the Unicode text.
; ============================================================

; --- Localized language picker ---
; MUI_LANGDLL_DISPLAY reads the saved language from the registry in .onInit and
; applies it before any page is built, which is the only moment NSIS honours a
; language change. It then asks LangDLL for its dialog. LangDLL's title/info
; come from the two defines below, so we point them at generated LangStrings:
; the dialog speaks whatever language MUI just resolved.
;
; English (1033) is index 0 in tauri.conf.json, so NSIS preselects the user's
; Windows UI language (GetUserDefaultUILanguage) when supported and falls back
; to English when Windows uses a language outside the 73 shipped locales.
!include "${__FILEDIR__}\languages\picker.nsh"

!define MUI_LANGDLL_WINDOWTITLE "$(DcPickerTitle)"
!define MUI_LANGDLL_INFO "$(DcPickerInfo)"

; Show ALL 73 languages in the picker regardless of the Windows non-Unicode
; system codepage (without this, MUI filters out languages whose codepage
; differs from the current machine's ANSI codepage).
!define MUI_LANGDLL_ALLLANGUAGES

; Show the picker on every run, not only on the first install. The saved choice
; is still preselected because MUI reads the registry first.
!define MUI_LANGDLL_ALWAYSSHOW

; --- Header bitmap on the right, art block aligns with the window edge ---
!ifndef MUI_HEADERIMAGE_RIGHT
  !define MUI_HEADERIMAGE_RIGHT
!endif

; --- Keep the wizard chrome neutral so the brand art stays the accent ---
!define MUI_ABORTWARNING

; --- Branded progress bar -----------------------------------------------
; MUI falls back to the stock Windows green bar, the only surface in the
; wizard that is not part of the identity. `colored` makes the fill use the
; first InstallColors value and the trough (plus the details log) the second,
; so an obsidian fill on a light trough replaces the system green while the
; log stays dark-on-light and readable.
!define MUI_INSTFILESPAGE_PROGRESSBAR "smooth colored"
!define MUI_INSTFILESPAGE_COLORS "17171E EFF0F3"

; InstallColors alone is not enough: a themed progress bar ignores the classic
; bar/trough colours, which is why the wizard still showed Windows green. The
; helper below strips the theme from the bar and paints the brand pair directly.
; It runs from PREINSTALL/PREUNINSTALL, the first moment the page controls exist.
; Colours are Win32 COLORREF (0x00BBGGRR), hence the reversed byte order.
; The fill is the app accent (#3B82F6) so a completed bar reads as progress
; instead of a solid graphite slab, and it matches the native blue wizard
; controls. The trough stays light so the bar never looks empty.
!define DC_PBM_SETBARCOLOR 0x0409
!define DC_PBM_SETBKCOLOR  0x2001
!define DC_BAR_COLOR       0x00F6823B
!define DC_TROUGH_COLOR    0x00F2EDEC

; Shared body: the installer and uninstaller are separate script contexts, so
; each needs its own function, but the code must not drift between them.
!macro DC_STYLE_PROGRESSBAR_BODY
  ; The page's inner dialog holds the bar as control 1004 (MUI InstallFiles.nsh).
  FindWindow $0 "#32770" "" $HWNDPARENT
  ${If} $0 != 0
    GetDlgItem $1 $0 1004
    ${If} $1 != 0
      ; Empty theme name + empty id list = classic, colour-capable control.
      System::Call 'uxtheme::SetWindowTheme(p r1, w "", w "") i .r2'
      System::Call 'user32::SendMessage(p r1, i ${DC_PBM_SETBKCOLOR}, p 0, p ${DC_TROUGH_COLOR}) i .r2'
      System::Call 'user32::SendMessage(p r1, i ${DC_PBM_SETBARCOLOR}, p 0, p ${DC_BAR_COLOR}) i .r2'
    ${EndIf}
  ${EndIf}
!macroend

Function DcStyleProgressBar
  !insertmacro DC_STYLE_PROGRESSBAR_BODY
FunctionEnd

Function un.DcStyleProgressBar
  !insertmacro DC_STYLE_PROGRESSBAR_BODY
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  Call DcStyleProgressBar
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Call un.DcStyleProgressBar
!macroend

; ============================================================
; Post-install / post-uninstall: app.ico and Windows shell refresh
; ============================================================
; Prefix the constants so they cannot collide with Tauri's FileAssociation.nsh,
; which already defines SHCNE_ASSOCCHANGED and SHCNF_FLUSH.
!define DC_SHCNE_ASSOCCHANGED 0x08000000
!define DC_SHCNE_UPDATEITEM    0x00002000
!define DC_SHCNF_FLUSH         0x1000
; SHCNF_PATHW (0x0005) | SHCNF_FLUSH (0x1000). The System plugin takes a
; literal, not an expression, so the combined flags are defined once.
!define DC_SHCNF_PATHW_FLUSH   0x1005

!macro NSIS_HOOK_POSTINSTALL
  ; Persist the chosen installer language so subsequent runs and the
  ; uninstaller remember the user's selection.
  !insertmacro MUI_LANGDLL_SAVELANGUAGE

  ; One 15-frame ICO is shipped and copied verbatim; NSIS embeds every frame of
  ; ${INSTALLERICON}. Do not generate a second, lower-resolution fallback icon.
  File "/oname=$INSTDIR\app.ico" "${INSTALLERICON}"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\app.ico$\""

  ; Add $INSTDIR to per-user PATH via PowerShell (avoids NSIS 1024-char limit
  ; and passes $INSTDIR via environment variable to avoid quote injection).
  System::Call 'kernel32::SetEnvironmentVariable(t "DC_INSTDIR", t "$INSTDIR")'
  nsExec::ExecToStack 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$t = $$env:DC_INSTDIR.TrimEnd([char]92); $$p = [Environment]::GetEnvironmentVariable(\"Path\", \"User\"); $$parts = @(); if ($$p) { $$parts = $$p -split \";\" | Where-Object { $$_.Trim() -ne \"\" } }; if (-not ($$parts | Where-Object { $$_.Trim().TrimEnd([char]92) -ieq $$t })) { $$parts += $$t; [Environment]::SetEnvironmentVariable(\"Path\", ($$parts -join \";\"), \"User\") }"'
  Pop $0
  Pop $1
  System::Call 'user32::SendMessageTimeout(i 0xffff, i 0x001A, i 0, t "Environment", i 2, i 5000, *i .r0)'

  ; Invalidate the shell icon/thumbnail cache, then target the surfaces that
  ; users see immediately.
  System::Call 'shell32::SHChangeNotify(i ${DC_SHCNE_ASSOCCHANGED}, i ${DC_SHCNF_FLUSH}, p 0, p 0)'
  System::Call 'shell32::SHChangeNotify(i ${DC_SHCNE_UPDATEITEM}, i ${DC_SHCNF_PATHW_FLUSH}, w "$INSTDIR\${MAINBINARYNAME}.exe", p 0)'
  System::Call 'shell32::SHChangeNotify(i ${DC_SHCNE_UPDATEITEM}, i ${DC_SHCNF_PATHW_FLUSH}, w "$DESKTOP\${PRODUCTNAME}.lnk", p 0)'
  System::Call 'shell32::SHChangeNotify(i ${DC_SHCNE_UPDATEITEM}, i ${DC_SHCNF_PATHW_FLUSH}, w "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk", p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\app.ico"
  ; Remove $INSTDIR and any per-user shim bin directory from user PATH.
  System::Call 'kernel32::SetEnvironmentVariable(t "DC_INSTDIR", t "$INSTDIR")'
  nsExec::ExecToStack 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$t1 = $$env:DC_INSTDIR.TrimEnd([char]92); $$t2 = (Join-Path $$env:LOCALAPPDATA \"detergo\bin\").TrimEnd([char]92); $$t3 = (Join-Path $$env:LOCALAPPDATA \"lustra\bin\").TrimEnd([char]92); $$t4 = (Join-Path $$env:LOCALAPPDATA \"dev-cleaner\bin\").TrimEnd([char]92); $$p = [Environment]::GetEnvironmentVariable(\"Path\", \"User\"); if ($$p) { $$parts = $$p -split \";\" | Where-Object { $$n = $$_.Trim().TrimEnd([char]92); $$n -ne \"\" -and $$n -ine $$t1 -and $$n -ine $$t2 -and $$n -ine $$t3 -and $$n -ine $$t4 }; [Environment]::SetEnvironmentVariable(\"Path\", ($$parts -join \";\"), \"User\") }"'
  Pop $0
  Pop $1
  Delete "$LOCALAPPDATA\detergo\bin\detergo.cmd"
  RMDir "$LOCALAPPDATA\detergo\bin"
  Delete "$LOCALAPPDATA\lustra\bin\lustra.cmd"
  Delete "$LOCALAPPDATA\lustra\bin\dev-cleaner.cmd"
  RMDir "$LOCALAPPDATA\lustra\bin"
  Delete "$LOCALAPPDATA\dev-cleaner\bin\dev-cleaner.cmd"
  RMDir "$LOCALAPPDATA\dev-cleaner\bin"
  System::Call 'user32::SendMessageTimeout(i 0xffff, i 0x001A, i 0, t "Environment", i 2, i 5000, *i .r0)'
  System::Call 'shell32::SHChangeNotify(i ${DC_SHCNE_ASSOCCHANGED}, i ${DC_SHCNF_FLUSH}, p 0, p 0)'

  ; Remove Detergo and any migrated legacy folders when requested on uninstall.
  ; Updates never take this path; they must keep the user's data.
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RmDir /r "$APPDATA\detergo"
    RmDir /r "$APPDATA\lustra"
    RmDir /r "$APPDATA\dev-cleaner"
    RmDir /r "$APPDATA\node-cleaner"
  ${EndIf}

  ; The uninstaller itself runs from $INSTDIR, so the template's `RMDir
  ; "$INSTDIR"` fails while uninstall.exe is still locked and leaves an empty
  ; folder behind. Queue an empty-only removal for the next logon, which is the
  ; earliest moment the folder can really go away.
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\RunOnce" \
    "DetergoRemoveInstallDir" 'cmd.exe /c rmdir /q "$INSTDIR"'
!macroend
