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
