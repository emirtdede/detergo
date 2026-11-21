# Detergo - Windows C: Drive System Cleaner

The **C: Drive System Cleaner** is a dedicated, audited Windows maintenance subsystem (`src-tauri/src/system_cleaner/`) available in the desktop GUI (**System cleaner** tab), CLI (`detergo sys`), and MCP (`detergo_system_scan` / `detergo_system_preview` / `detergo_system_execute`).

## Audited Scope

Only a fixed, hardcoded allowlist of Windows maintenance targets can ever be inspected or cleaned. The frontend sends **action identifiers only** - never filesystem paths - and the Rust backend resolves and validates every path against audited Windows roots before any file operation:

| Action ID | Target | Elevation Needed | Included in Quick Profile |
| :--- | :--- | :---: | :---: |
| `user_temp` | User temporary files (`%TEMP%`) | No | Yes |
| `windows_temp` | Windows temporary files (`%SystemRoot%\Temp`) | Yes | Yes |
| `prefetch` | Windows Prefetch (`%SystemRoot%\Prefetch`) | Yes | No (Deep only) |
| `windows_update` | Windows Update download cache (`SoftwareDistribution\Download`) | Yes | Standard / Deep |
| `error_reports` | Windows Error Reporting queues (`WER\ReportArchive`, `ReportQueue`) | Yes | Yes |
| `recycle_bin` | Windows Recycle Bin | No | No (Explicit only) |
| `disk_cleanup` | Native Windows Disk Cleanup (`cleanmgr.exe` from System32) | Yes | Standard / Deep |
| `component_store` | DISM Component Store cleanup (`dism.exe /Online /Cleanup-Image /StartComponentCleanup`) | Yes | Deep only |

Project workspaces, user Documents, Desktop, and Downloads sit strictly outside every audited root and can never be selected or targeted.

## Safety & Execution Guarantees

- **No Symlink / Junction Traversal**: Every candidate path and its ancestors are checked against reparse points (`is_inside_audited_root`) before deletion. Locked files are skipped and reported gracefully.
- **Hardened Native Process Spawning**: External maintenance utilities (`cleanmgr.exe`, `dism.exe`, `schtasks.exe`) are resolved strictly from `%SystemRoot%\System32` (never via mutable `PATH`), with bounded 256 KiB output ring buffers.
- **On-Demand Elevation**: Detergo always launches without administrator privileges. If you select an admin-only action, the UI offers a one-click **Restart as administrator** prompt that preserves your current tab and selection.
- **Audit History**: Every manual and scheduled execution is recorded locally in SQLite (`actions.jsonl` / audit DB). Nothing is uploaded.

## Scheduled Automation

You can configure a daily or weekly Windows Task Scheduler job (`quick` or `standard` profile) directly from the **System cleaner** view. Temporary XML definitions use cryptographically unique UUID filenames and are cleaned up immediately after `schtasks.exe` registers the task. Prefetch, Recycle Bin, and WinSxS are never scheduled automatically.

## CLI Usage

```bash
detergo sys --list                 # Measure all C: drive categories
detergo sys quick --dry-run        # Preview quick profile (no elevation required)
detergo sys quick --yes            # Run quick profile
detergo sys standard --yes         # Run standard profile (requires elevated shell)
```
