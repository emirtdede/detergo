# Dev Cleaner CLI

The same executable that opens the desktop window is also a scriptable
terminal tool. Run it with no arguments to launch the GUI; run it with a
command to stay in the terminal.

```text
dev-cleaner                     # open the desktop app
dev-cleaner scan .              # list the largest reclaimable targets under .
dev-cleaner scan . -i           # pick targets by number, then delete
dev-cleaner caches --clean npm  # run the official npm cache clean
dev-cleaner history             # show past cleanup records
```

> On Windows the installed binary may be on `PATH` as `dev-cleaner`. The
> portable build is `Dev-Cleaner-2.2.3-Portable.exe`; rename it to
> `dev-cleaner.exe` to use the examples verbatim.

## Commands

| Command | Purpose |
| --- | --- |
| `scan [DIRECTORY]` | Discover projects, AI-agent storage and caches; optionally clean. Defaults to the current directory. |
| `caches` | List the 21 supported developer tools, their versions and detection status. |
| `caches --clean <TOOL\|all>` | Run a tool's official cache clean. `all` requires `--yes`. |
| `history` | Print past cleanup records from the audit database. |
| `mcp` | Start the Model Context Protocol server on stdio. |
| `help`, `--help`, `-h` | Print the manual (works after any subcommand too). |
| `version`, `--version`, `-v` | Print the product and version. |

## `scan`

```text
dev-cleaner scan [DIRECTORY] [OPTIONS]
```

| Option | Meaning |
| --- | --- |
| `--scope <SCOPE>` | `projects` (default), `agents`, `combined`, or `all` (every fixed drive). |
| `--min-size <MB>` | Ignore targets smaller than this. |
| `--safety <LEVELS>` | Comma-separated allow-list: `safe`, `regenerate`, `review`, `keep`. Default `safe,regenerate`. |
| `--top <COUNT>` | Print the `COUNT` largest targets (default 20). |
| `--all` | Print every discovered target. |
| `-i`, `--interactive` | Number the selectable targets, read a selection, then move it to the Recycle Bin. |
| `--auto-clean` | Move every target that matches `--safety` and `--min-size` to the Recycle Bin without prompting. |
| `--dry-run` | With `--auto-clean`, report what would happen without deleting. |
| `--json` | Emit one machine-readable JSON document on stdout. |
| `--webhook <URL>` | POST the run summary to an n8n, Slack or Discord webhook. |

`--interactive` and `--auto-clean` are mutually exclusive, and
`--interactive` cannot be combined with `--json`.

### Interactive selection

```text
$ dev-cleaner scan . -i

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

Without `--json`, `scan` prints a size-ranked table followed by a summary:

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

## `caches`

```text
dev-cleaner caches                          # table of detected tools
dev-cleaner caches --json                   # machine-readable provider list
dev-cleaner caches --clean npm              # clean one tool
dev-cleaner caches --clean all --dry-run    # preview every tool
dev-cleaner caches --clean all --yes        # clean every detected tool
```

Cache cleanup only runs the provider's own official command (for example
`npm cache clean --force`); Dev Cleaner never deletes a tool's cache directory
by hand. It is disabled unless **Settings → Automation → Allow cache cleanup**
is enabled.

## `history`

```text
dev-cleaner history --limit 10
dev-cleaner history --json
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

`scan --json` prints a single object:

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

`caches --json` and `history --json` emit their own documents; see the source
in `src-tauri/src/cli/mod.rs`.

## Webhooks

```text
dev-cleaner scan D:\work --webhook https://discord.com/api/webhooks/…
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
| `npx npkill` | `dev-cleaner scan .` |
| Interactive arrow-key selection | `dev-cleaner scan . -i` |
| `npkill -d ~/projects` | `dev-cleaner scan ~/projects` |
| `npkill -x` / exclude | `--safety` and the settings protected-path list |
| Deletes `node_modules` only | 56-rule catalog: JS, Python, Rust, .NET, Java/Kotlin, Go, PHP, Dart, AI-agent storage and caches |
| Permanent delete | Recycle Bin by default, with an audit record |

The desktop app is the fully interactive experience (virtualised table,
monorepo grouping, size measurement, preview and confirmation); the CLI is the
same engine without the window.
