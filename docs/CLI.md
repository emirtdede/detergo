# Detergo - CLI & MCP Reference

The `detergo` desktop executable ships alongside a console-subsystem companion (`detergo.com`) so Windows shells (`cmd.exe`, PowerShell, Git Bash) automatically invoke the synchronous CLI without GUI flash while preserving redirected `stdout`/`stderr` pipes (`| ConvertFrom-Json`, `> report.json`, `> NUL`).

---

## Commands

| Command | Short | Description |
| :--- | :--- | :--- |
| `detergo scan [DIR]` | `s` | Scan projects, AI agents, tool caches, and/or C: system targets |
| `detergo caches [TOOL\|all]` | `c` | List, measure, preview, or clean 27 developer tool caches (opt-in LLM caches skipped on `all`) |
| `detergo system [PROFILE\|IDS]` | `sys` | Measure or clean Windows C: system categories |
| `detergo history [N]` | `h`, `hist` | Show past cleanup and tool-action audit records |
| `detergo mcp` | `--mcp` | Start the stdio Model Context Protocol (MCP) JSON-RPC server |

---

## Scan Options (`detergo s [DIR] [OPTIONS]`)

| Flag | Description |
| :--- | :--- |
| `-t, --targets <LIST>` | Comma-separated subset: `p` (`projects`), `a` (`agents`), `c` (`caches`), `s` (`system`), `drives`, `all` |
| `-c, --clean`, `--auto-clean` | Move matching selectable targets to the Recycle Bin |
| `-n, --dry`, `--dry-run` | Preview cleanup counts and sizes without deleting anything |
| `-s, --safety <LEVELS>` | Allowed classes: `safe,regenerate,review,keep` (default: `safe,regenerate`) |
| `-m, --min <SIZE>` | Minimum size threshold: bare number = MiB (`50`), or units (`500KB`, `250MB`, `1.5GB`) |
| `-o, --older <AGE>` | Only include stale targets untouched for at least `<AGE>`: `7d`, `30d`, `2w`, `3m`, `1y` (or bare days) |
| `-i, --interactive` | Numbered picker (`1,3-5`, `all`, `none`), then move selected targets to Recycle Bin |
| `-a, --all` / `--top <N>` | Show all rows or top `N` largest targets (default: `20`) |
| `-j, --json` | Emit one machine-readable JSON document on `stdout` |
| `-w, --webhook <URL>` | POST canonical JSON report to Slack, Discord, n8n, or custom webhook |
| `--scope <SCOPE>` | Legacy scope alias: `projects`, `agents`, `combined`, `all` |

### Examples

```bash
# List the top 20 largest targets in the current workspace
detergo s .

# Find stale dependencies (> 30 days old, >= 100 MB) across projects and AI tools
detergo s D:\Projects -t p,a -o 30d -m 100MB

# Dry-run autonomous Recycle Bin cleanup of safe + regenerable targets older than 90 days
detergo s D:\Projects -o 90d -c -n

# Interactive numbered selection
detergo s . -i

# Full multi-target JSON report (projects + AI + caches + C: system)
detergo s D:\Projects -t all -j

# Measure all 27 developer tool caches
detergo c

# Clean Docker build cache or Cargo registry cache via audited actions
detergo c docker -n
detergo c cargo -y

# Preview and run Windows C: quick cleanup
detergo sys quick -n
detergo sys quick -y

# Inspect last 15 audit records as JSON
detergo hist -l 15 -j
```

---

## Exit Codes (Automation Contract)

| Code | Meaning |
| :--- | :--- |
| `0` | Success |
| `1` | Scan or unexpected runtime failure |
| `2` | Cleanup or cache action failure (partial or complete) |
| `3` | Invalid CLI flag, argument, or path not found |
| `4` | Blocked by safety policy (`PathGuard`, agent policy, or invalid plan) |

---

## Webhooks (Public & Self-Hosted LAN)

Webhooks use DNS IP pinning, disallow HTTP redirects, send an `Idempotency-Key` header, and retry transient `429`/`5xx` failures up to 3 times.

- **Default**: Public `http`/`https` endpoints only (Slack, Discord, cloud n8n).
- **Self-Hosted (e.g. local n8n at `http://localhost:5678/...`)**: Enable **Settings → Automation → Allow local & LAN webhooks (self-hosted)** (`allowPrivateWebhooks: true` in `config.json`). Cloud instance metadata (`169.254.0.0/16`, `fe80::/10`, `metadata.google.internal`), `0.0.0.0`, `::`, and multicast remain permanently blocked.

---

## MCP Server (`detergo mcp`)

Run over stdio for Claude Code, Cursor, Codex, or custom MCP clients:

```bash
# Safe read-only + preview mode (default)
detergo mcp

# Enable destructive execution tools (also requires Settings -> Allow MCP destructive actions)
detergo mcp --allow-destructive
```

### Exposed Tools

- **Read-only / Preview (always available, protocol `2024-11-05` .. `2025-11-25`)**:
  - `detergo_scan_workspace` - supports `path`, `scope`, `targets`, `min_size_mb`, `older_than_days`, and opaque cursor pagination (`cursor`, `limit`, `nextCursor`)
  - `detergo_preview_cleanup` - creates a 5-minute single-use preview token
  - `detergo_list_caches` - lists and measures all 27 cache providers
  - `detergo_preview_cache` - measures a provider and returns a single-use `preview_token`
  - `detergo_system_scan` / `detergo_system_preview` - C: drive system cleaner discovery & token preview
  - `detergo_get_history` - recent cleanup audit records
  - `detergo_inspect_target` - checks `PathGuard`, reparse-point status, rule match, and eligibility
- **Destructive (hidden unless `--allow-destructive` AND `mcpAllowDestructive: true` AND valid single-use token + `confirm: true`)**:
  - `detergo_execute_cleanup`
  - `detergo_clean_cache`
  - `detergo_system_execute`
