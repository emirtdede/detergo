; ============================================================
; Dev Cleaner NSIS installer / uninstaller hooks
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
; Its OK/Cancel captions are compiled into LangDLL.dll and cannot be overridden
; (checked: only MUI_LANGDLL_WINDOWTITLE/INFO are parameters). Everything the
; dialog can say is localized; those two stock buttons stay as Windows draws
; them for the plugin.
!include "${__FILEDIR__}\languages\picker.nsh"

!define MUI_LANGDLL_WINDOWTITLE "$(DcPickerTitle)"
!define MUI_LANGDLL_INFO "$(DcPickerInfo)"

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
  ; One 15-frame ICO is shipped and copied verbatim; NSIS embeds every frame of
  ; ${INSTALLERICON}. Do not generate a second, lower-resolution fallback icon.
  File "/oname=$INSTDIR\app.ico" "${INSTALLERICON}"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\app.ico$\""

  ; Invalidate the shell icon/thumbnail cache, then target the surfaces that
  ; users see immediately.
  System::Call 'shell32::SHChangeNotify(i ${DC_SHCNE_ASSOCCHANGED}, i ${DC_SHCNF_FLUSH}, p 0, p 0)'
  System::Call 'shell32::SHChangeNotify(i ${DC_SHCNE_UPDATEITEM}, i ${DC_SHCNF_PATHW_FLUSH}, w "$INSTDIR\${MAINBINARYNAME}.exe", p 0)'
  System::Call 'shell32::SHChangeNotify(i ${DC_SHCNE_UPDATEITEM}, i ${DC_SHCNF_PATHW_FLUSH}, w "$DESKTOP\${PRODUCTNAME}.lnk", p 0)'
  System::Call 'shell32::SHChangeNotify(i ${DC_SHCNE_UPDATEITEM}, i ${DC_SHCNF_PATHW_FLUSH}, w "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk", p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\app.ico"
  System::Call 'shell32::SHChangeNotify(i ${DC_SHCNE_ASSOCCHANGED}, i ${DC_SHCNF_FLUSH}, p 0, p 0)'

  ; The uninstaller itself runs from $INSTDIR, so the template's `RMDir
  ; "$INSTDIR"` fails while uninstall.exe is still locked and leaves an empty
  ; folder behind. Queue an empty-only removal for the next logon, which is the
  ; earliest moment the folder can really go away.
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\RunOnce" \
    "DevCleanerRemoveInstallDir" 'cmd.exe /c rmdir /q "$INSTDIR"'
!macroend
