# MCP Integration

Dev Cleaner ships a local stdio MCP (Model Context Protocol) server so AI tools
can inspect a workspace before anything is moved. The server never deletes
silently: destructive execution needs three independent gates.

## Running the server

```text
dev-cleaner mcp [--allow-destructive]
```

The server speaks JSON-RPC 2.0 over stdin/stdout and is intended to be launched
by the MCP client, not by a human.

## Tools

| Tool | Destructive | Purpose |
| --- | --- | --- |
| `devcleaner_scan_workspace` | No | Scans a path and returns a `scan_id` plus the top targets. |
| `devcleaner_preview_cleanup` | No | Builds a plan for selected target IDs and returns a single-use token. |
| `devcleaner_clean_safe` | No | Deprecated alias for preview; never deletes. |
| `devcleaner_list_caches` | No | Reports developer-tool cache status. |
| `devcleaner_clean_cache` | No | Runs an official CLI cache command (e.g. `npm cache clean`). |
| `devcleaner_get_history` | No | Lists audit records. |
| `devcleaner_inspect_target` | No | Explains the rule and safety class for a path. |
| `devcleaner_execute_cleanup` | Yes | Executes a previewed plan. Only listed when `--allow-destructive` is set. |

## Preview → execute flow

1. `devcleaner_scan_workspace` runs discovery and stores the session in memory.
   It returns a `scan_id`; each target also carries a `target_id`.
2. `devcleaner_preview_cleanup` accepts `target_ids` (and optionally `scan_id`).
   It reuses the stored scan session, measures only the selected IDs, and
   returns a preview plus a token. Nothing is deleted.
3. `devcleaner_execute_cleanup` accepts `{ "token": "...", "confirm": true }`.

Discovery generates fresh IDs on every run, so a preview must reference the
sessions produced by `scan_workspace`; the server resolves the matching session
automatically. Preview tokens expire after five minutes.

## Three independent destructive gates

`devcleaner_execute_cleanup` refuses unless all of the following are true:

1. the server was started with `--allow-destructive`,
2. `mcpAllowDestructive` is enabled in **Settings → Automation** (default off),
3. the request carries `confirm: true` and a valid, unused, unexpired token.

Tokens are single-use. A token is removed before execution starts, so a failed
or blocked run cannot be retried with the same token. Preview tokens also live
in process memory only, which means they cannot be replayed across a restart.

## Safety guarantees

- Preview never deletes. `clean_safe` is preview-only.
- Execution moves targets to the Windows Recycle Bin; permanent deletion is not
  reachable from MCP.
- The path guard rejects system directories, drive roots, user-profile roots and
  reparse points before any move.
