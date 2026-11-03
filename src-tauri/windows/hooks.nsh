; ScanToPrint installer hooks (Tauri NSIS). Runs elevated because installMode = perMachine.

!macro NSIS_HOOK_POSTINSTALL
  ; Let phones on the shop Wi-Fi reach the portal (port 8080, Private + Domain networks only).
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="ScanToPrint"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="ScanToPrint" dir=in action=allow protocol=TCP localport=8080 profile=private,domain'

  ; Shared data folder. Grant the local Users group (SID S-1-5-32-545, language-independent)
  ; modify rights so the app works when started by a non-admin account.
  ReadEnvStr $0 PROGRAMDATA
  CreateDirectory "$0\ScanToPrint"
  nsExec::ExecToLog 'icacls "$0\ScanToPrint" /grant *S-1-5-32-545:(OI)(CI)M /T /Q'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="ScanToPrint"'
  ; %ProgramData%\ScanToPrint (customer files, database) is intentionally kept.
!macroend
