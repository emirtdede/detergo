# Dev Cleaner CLI

The same executable that opens the desktop window is also a fast, concise
terminal tool. Run it with no arguments to launch the GUI; run it with a short
command to stay in the terminal.

```text
dev-cleaner                     # open the desktop app
dev-cleaner s .                 # scan projects under .
dev-cleaner s . -t p,a          # scan projects + AI tools
dev-cleaner s . -t all          # scan everything (projects, AI, caches, C: system)
dev-cleaner s . -i              # pick targets by number, move to Recycle Bin
dev-cleaner s . -c -n           # dry-run auto-clean preview
dev-cleaner c npm               # run the official npm cache clean
dev-cleaner sys                 # list C: system cleaner targets
dev-cleaner sys quick -y        # run quick C: cleanup
dev-cleaner hist 15             # show 15 most recent cleanup records
```

> All long subcommands and flags (`scan`, `caches`, `system`, `history`,
> `--auto-clean`, `--dry-run`, `--scope`, `--json`, etc.) remain 100% supported
> for backward compatibility.
>
> On Windows the installed binary may be on `PATH` as `dev-cleaner`. The
> portable build is `Dev-Cleaner-1.0.0-Portable.exe`; rename it to
> `dev-cleaner.exe` to use the examples verbatim.

## Commands

| Short | Long | Purpose |
| --- | --- | --- |
| `s [DIR]` | `scan [DIR]` | Discover projects, AI tools, caches and/or C: system targets; optionally clean. Defaults to `.`. |
| `c [TOOL\|all]` | `caches` | List the 21 developer-tool caches or clean one/all via official CLI commands (`all` needs `-y`). |
| `sys [PROFILE]` | `system` | Measure or clean C: drive maintenance targets (`quick`, `standard`, `deep`, or comma-separated IDs). |
| `h [N]` / `hist [N]` | `history` | Print past cleanup records from the audit database. |
| `mcp` | `mcp` | Start the Model Context Protocol server on stdio. |
| `-h` | `help`, `--help` | Print the manual (works after any subcommand too). |
| `-v` | `version`, `--version` | Print the product and version. |

## `s` / `scan`

```text
dev-cleaner s [DIRECTORY] [OPTIONS]
```

| Short | Long | Meaning |
| --- | --- | --- |
| `-t <LIST>` | `--targets`, `--scope` | Comma-separated targets: `p` (projects, default), `a` (AI agents), `c` (caches), `s` (C: system), `drives` (all fixed drives), `combined` (`p,a`), `all` (`p,a,c,s`). |
| `-m <MB>` | `--min-size <MB>` | Ignore targets smaller than this threshold. |
| `-s <LEVELS>` | `--safety <LEVELS>` | Comma-separated allow-list: `safe`, `regenerate`, `review`, `keep`. Default `safe,regenerate`. |
| — | `--top <COUNT>` | Print the `COUNT` largest targets (default 20). |
| `-a` | `--all` | Print every discovered target. |
| `-i` | `--interactive` | Number the selectable targets, read a selection, then move it to the Recycle Bin. |
| `-c` | `--clean`, `--auto-clean` | Move matching targets to the Recycle Bin without prompting. |
| `-n` | `--dry`, `--dry-run` | With `-c`, report what would happen without deleting. |
| `-j` | `--json` | Emit one machine-readable JSON document on stdout. |
| `-w <URL>` | `--webhook <URL>` | POST the run summary to an n8n, Slack or Discord webhook. |

`-i` (`--interactive`) and `-c` (`--auto-clean`) are mutually exclusive, and
`-i` cannot be combined with `-j` (`--json`).

### Multi-target selection (`-t`)

Matches the checkboxes in the desktop top bar so you can scan any 1–4 subsets in
one command:

```text
dev-cleaner s D:\work -t p,a         # projects + AI tools
dev-cleaner s D:\work -t p,a,c       # projects + AI tools + package caches
dev-cleaner s D:\work -t all         # projects + AI tools + caches + C: system
dev-cleaner s -t c,s                 # package caches + C: system only
dev-cleaner s -t drives              # full scan across all fixed drives
```

### Interactive selection

```text
$ dev-cleaner s . -i

Selectable targets (largest first):
  #        Size  Safety        Target
-------------------------------------------------------------------------------
  1     1.8 GB  safe          D:\work\shop\node_modules
  2   740.2 MB  safe          D:\work\api\target
  3   310.9 MB  regenerate    D:\work\docs\.venv

Select targets (e.g. 1,3-5 / all / none) [none]: 1,3
```

Accepted input: a single number (`2`), a list (`1,3`), a range (`2-5`),
whitespace-separated numbers, `all`, or `none`/empty. Out-of-range numbers and
typos are ignored, never guessed. The selected targets go to the Recycle Bin,
so they remain restorable.

### Output

Without `-j`, `s` prints a size-ranked table followed by a summary:

```text
Targets (largest first):
      Size  Safety        Target
------------------------------------------------------------------------------
  1.8 GB  safe          D:\work\shop\node_modules
740.2 MB  safe          D:\work\api\target
  ... 17 more; use --all or --top N to list them.

[OK] Scan completed!
  Found Targets       : 19
  Reclaimable Space   : 3.4 GB
```

Targets the safety layer refuses are shown with `[not selectable]` so the
reason a large folder is missing from the reclaimable total is visible.

## `c` / `caches`

```text
dev-cleaner c                # table of detected tools
dev-cleaner c -j             # machine-readable provider list
dev-cleaner c npm            # clean one tool
dev-cleaner c all -n         # preview every tool
dev-cleaner c all -y         # clean every detected tool
```

Cache cleanup only runs the provider's own official command (for example
`npm cache clean --force`); Dev Cleaner never deletes a tool's cache directory
by hand. It is disabled unless **Settings → Automation → Allow cache cleanup**
is enabled.

## `sys` / `system`

```text
dev-cleaner sys                  # measure & list all C: system cleaner targets
dev-cleaner sys quick -n         # preview quick profile without deleting
dev-cleaner sys quick -y         # clean user temp + Windows Update leftovers
dev-cleaner sys standard -y      # clean temp, Prefetch, WER (Admin recommended)
dev-cleaner sys deep -y          # includes Disk Cleanup & DISM WinSxS
```

Every action resolves paths against a fixed audited list on the native side and
never touches user projects, Documents, or Downloads.

## `h` / `hist` / `history`

```text
dev-cleaner hist 10          # last 10 cleanup records
dev-cleaner hist 50 -j       # JSON export of last 50 records
```

## Exit codes

These are part of the automation contract.

| Code | Meaning |
| --- | --- |
| `0` | Success. |
| `1` | Scan failed. |
| `2` | Cleanup failed (including partial failures and cache actions). |
| `3` | Argument or path error (unknown flag value, missing directory). |
| `4` | Blocked by a safety or policy guard. |

A cleanup that reports per-target failures exits `2`, even though the summary
was printed, so CI and Task Scheduler see the correct status.

## JSON output

`s -j` (`scan --json`) prints a single object:

```json
{
  "product": "Dev Cleaner by Vellium",
  "status": "success",
  "root": "D:\\work",
  "scope": "projects",
  "target_count": 19,
  "estimated_reclaim_bytes": 3650722201,
  "estimated_reclaim_human": "3.4 GB",
  "items": [
    {
      "id": "…",
      "name": "node_modules",
      "path": "D:\\work\\shop\\node_modules",
      "category": "node_modules",
      "safety": "Safe",
      "bytes": 1932735283,
      "human": "1.8 GB"
    }
  ]
}
```

`c -j` and `hist -j` emit their own documents; see `src-tauri/src/cli/mod.rs`.

## Webhooks

```text
dev-cleaner s D:\work -w https://discord.com/api/webhooks/…
```

Only the origin of the URL is ever logged or printed; the path is treated as a
bearer credential. Requests are retried with an `Idempotency-Key` header.

## MCP server

```text
dev-cleaner mcp
dev-cleaner mcp --allow-destructive
```

The server speaks the Model Context Protocol over stdio. Destructive MCP tools
require a preview → confirmation token → execute flow; `--allow-destructive`
only removes an additional operator opt-in, not the token gate. See
[`architecture/MCP.md`](architecture/MCP.md).

## Coming from npkill

| npkill | Dev Cleaner |
| --- | --- |
| `npx npkill` | `dev-cleaner s .` |
| Interactive arrow-key selection | `dev-cleaner s . -i` |
| `npkill -d ~/projects` | `dev-cleaner s ~/projects` |
| `npkill -x` / exclude | `-s` (`--safety`) and the settings protected-path list |
| Deletes `node_modules` only | 56-rule catalog: JS, Python, Rust, .NET, Java/Kotlin, Go, PHP, Dart, AI-agent storage, caches & C: system |
| Permanent delete | Recycle Bin by default, with an audit record |

The desktop app is the fully interactive experience (unified top-bar multi-target
scan hub, virtualised table, monorepo grouping, live progress, preview and
confirmation); the CLI is the same engine without the window.
