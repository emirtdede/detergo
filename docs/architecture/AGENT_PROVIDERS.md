# AI Agent Providers

Scans are **metadata-only**: names, sizes, timestamps, file counts. Chat
contents, prompts, tokens and `.env` values are never read or logged.

## Roots

| Provider | Roots |
|---|---|
| Codex | `%CODEX_HOME%` or `%USERPROFILE%\\.codex` |
| Claude Code | `%CLAUDE_CONFIG_DIR%` or `%USERPROFILE%\\.claude`; `%CLAUDE_CODE_TMPDIR%` or `%TEMP%\\claude` |
| Antigravity | `%USERPROFILE%\\.gemini\\antigravity`, `-ide`, `-backup`; `%APPDATA%\\Antigravity`; `%LOCALAPPDATA%\\Antigravity` |

Roots pointing to the same normalised path are deduplicated. WSL and remote
file systems are out of scope.

## Targets and defaults

### Codex — all KEEP (read-only)

`sessions`, `archived_sessions`, `worktrees`, `log`, `logs_2.sqlite`,
`skills`, `memories`, `config.toml`, `auth.json`.

Reason: official session/worktree lifecycle, SQLite integrity and credentials.
Worktrees are never removed through the filesystem.

### Claude Code

| Target | Class | Cleanup |
|---|---|---|
| `projects`, `file-history`, `settings.json`, `plans`, `plugins`, `skills`, `todos` | KEEP | none |
| `debug`, `shell-snapshots`, `statsig`, `tasks` | REVIEW | trash |
| `image-cache`, `paste-cache` | SAFE | trash |
| `%TEMP%\\claude\\tasks`, `%TEMP%\\claude\\shell-snapshots` | REVIEW | trash |

`file-history` checkpoints are always KEEP. Large `tasks/*.output` files are
visible but only removable when Claude is not running.

### Antigravity

| Target | Class | Cleanup |
|---|---|---|
| `brain`, `conversations`, `backups`, user settings | KEEP | none |
| `browser_recordings` | REVIEW, `requires_idle` | trash |
| `skills` | REVIEW | trash |
| Chromium `Cache`, `Code Cache`, `GPUCache`, `CachedData` | REVIEW | trash |

`browser_recordings` is blocked when:
- an Antigravity/Electron process is running, or
- any file under it changed in the last 120 seconds.

## Active-use policy

- Provider process detection (`codex`, `claude`, `antigravity`, `electron`) or
  an exclusive-open sharing violation marks the target `activeUse = yes`.
- `yes`/`unknown` blocks planning and execution.
- Provider targets are **never auto-selected** (`autoSelectable = false`).

## Growth analysis

Each agent scan appends `StorageSnapshot` entries (provider, category, bytes).
`get_growth_report` compares the two latest snapshots per category:

- `attention`: ≥ 1 GiB/hour or ≥ 10 GiB observed delta
- `critical`: ≥ 5 GiB/hour
- alerts never trigger deletion

Single-file threshold: 1 GiB (informational).

## Deliberate limitations

- Codex managed worktrees and sessions are not deleted by this application.
- Claude `purge` is not executed automatically because its flags cannot be
  verified offline; the app shows the storage breakdown instead.
- Antigravity brain/conversation backups are never offered for deletion.
- No background watcher runs; all analysis is user-initiated.
