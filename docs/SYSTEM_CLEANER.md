# C: Drive Cleaner

The C: drive cleaner is a first-class page in the app and a CLI subcommand. It
exists so a non-technical Windows user can reclaim system-drive space without
typing `cleanmgr`, `del` or `DISM` commands, and without a shell escaping into
paths the app does not control.

## What it cleans

| Action id | What it targets | Safety | Needs admin |
|---|---|---|---|
| `userTemp` | `%TEMP%` contents | safe | no |
| `windowsTemp` | `C:\Windows\Temp` contents | regenerate | yes |
| `prefetch` | `C:\Windows\Prefetch` contents | regenerate | yes |
| `windowsUpdate` | `C:\Windows\SoftwareDistribution\Download` contents | regenerate | yes |
| `errorReports` | Windows Error Reporting queues under `C:\ProgramData` | safe | yes |
| `recycleBin` | The Windows Recycle Bin (all drives) | review | no |
| `diskCleanup` | Windows Disk Cleanup profile (`cleanmgr` sageset 1997) | review | yes |
| `componentStore` | `DISM /Online /Cleanup-Image /StartComponentCleanup` | review | yes |

The roots above are the only paths the system cleaner can touch. Project
folders, user documents and Downloads are outside every audited root; they
cannot be selected from the UI and are rejected by the native guard if a
request names them.

## How a run works

1. **Measure.** The page sizes every action. Folder actions are walked by
   metadata; Windows-reported actions (Disk Cleanup, component store) show
   "Reported by Windows" because only the tool itself knows their size.
2. **Select.** The user ticks actions or presses *Quick clean* (user temp plus
   Windows Update leftovers). Locked rows explain why: needs administrator,
   not present, or reported by Windows.
3. **Confirm.** A dialog lists the exact action set and the measured total.
   Nothing is deleted before this confirmation.
4. **Execute.** The backend re-resolves each root, re-checks it against the
   audited list, and then deletes contents with a native walker. Native
   deletion never follows junctions or symbolic links, skips files held by a
   running process, clears read-only attributes, and reports skipped samples
   instead of failing the whole action.
5. **Audit.** Every action appends a record to the existing local audit
   history with its byte delta and duration. Nothing is uploaded.

Cancelling stops the run between files and between Windows tool steps; a step
already handed to `cleanmgr` or `DISM` finishes on its own.

## Administrator rights

Windows blocks the system folders for standard users, so the app still starts
unelevated and offers a single *Restart as administrator* button on the page.
The relaunch uses `ShellExecuteW("runas", ...)` with `--open-view system`; the
old process exits and the new one reopens the same page. The app never asks for
elevation on startup and never stores credentials.

## Disk Cleanup without `sageset`

The app writes the `StateFlags1997` registry values that Windows Disk Cleanup
reads, then runs `cleanmgr /sagerun:1997`. The interactive `/sageset` dialogs
are never shown during automated runs, so the profile is deterministic and the
user does not have to hunt through checkboxes. For users who also want the
native Windows Disk Cleanup UI (`cleanmgr /d c:`) or want to configure and run
their own profile 1 (`cleanmgr /sageset:1` / `cleanmgr /sagerun:1`), the System
Cleaner page provides one-click launcher buttons backed by an allowlisted
command (`system_launch_cleanmgr`).

The component-store action runs `DISM /Online /Cleanup-Image
/StartComponentCleanup` without `/ResetBase`: installed updates remain
uninstallable.

## Scheduled cleanup

The page can install a Windows scheduled task that runs a profile without any
prompt:

| Profile | Actions |
|---|---|
| `quick` | user temp, Windows Update leftovers |
| `standard` | quick plus Windows temp, Prefetch and error reports |
| `deep` | standard plus Disk Cleanup and component store |

The task is generated as XML and registered with `schtasks /Create /XML`,
running `dev-cleaner system --clean <profile> --yes --scheduled`. It runs with
the highest rights the account allows. The Recycle Bin is never part of a
profile. Removing the schedule deletes the task; the configuration itself lives
in `system-automation.json` next to the other app data, not in `AppSettings`, so
no settings migration is involved.

## Command line

```powershell
dev-cleaner system --list
dev-cleaner system --clean quick --yes
dev-cleaner system --clean userTemp,windowsTemp --dry-run
dev-cleaner system --clean standard --yes --scheduled
```

`--dry-run` measures and prints sizes without deleting. `--yes` is mandatory
before anything is removed. Exit codes follow the same contract as `scan`.

## Failure behavior

| Situation | Result |
|---|---|
| A selected action needs administrator rights | Row is locked before execution; the preview rejects the set |
| A file is held by a running process | Skipped and counted, never forced |
| A junction or symlink sits inside a root | The link is removed, its target is untouched |
| A root disappears between preview and execution | That action reports a path error; other actions continue |
| `cleanmgr` or `DISM` fails | Exit code and the tail of the tool output are kept in the result |
