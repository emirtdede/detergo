# Security policy

Detergo deletes files from disk, so a defect in its path validation, IPC
surface, or MCP destructive gates can cause data loss. We take reports
seriously and prefer private disclosure until a fix is available.

## Supported versions

| Version           | Supported |
| ----------------- | --------- |
| 2.2.x             | Yes       |
| 2.1.x and earlier | No        |

Only the current minor line receives security fixes. Upgrade to the latest
release before reporting a problem that may already be fixed.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

1. Open the repository's **Security** tab and choose
   **Report a vulnerability** (GitHub private security advisory).
2. Include the affected version, the exact steps to reproduce, the expected and
   actual behaviour, and a proof of concept if you have one.
3. If the advisory form is unavailable, contact the maintainers through
   <https://vellium.dev> and ask for a private channel.

Please allow up to 7 days for an initial response. We will confirm the issue,
agree on a disclosure timeline, and credit you in the release notes unless you
ask to remain anonymous.

## In scope

- Path traversal or canonicalisation defects that let a target escape its
  allowed root.
- Any way to delete a protected path (drive root, Windows directory,
  `Program Files`, user profile root) despite the guard.
- IPC commands that accept a path the UI could not produce.
- MCP preview/execute gates that allow a destructive action without a valid,
  unexpired confirmation token.
- Recycle Bin or permanent-delete flows that report success without deleting,
  or delete without an audit record.
- Privilege escalation through the installer or the single-instance plugin.
- Secret leakage in logs, audit files, or webhook payloads.

## Out of scope

- Denial of service that requires local administrator rights.
- Reports about third-party tools whose caches Detergo can clean.
- Missing hardening that does not change the security properties above.
- Social engineering.

## Our commitments

- Detergo collects no telemetry and makes no network request unless you
  explicitly configure a webhook or use the MCP server.
- Deletion defaults to the Windows Recycle Bin.
- Every destructive IPC path is covered by an automated test suite; a fix for a
  security report will include a regression test.
