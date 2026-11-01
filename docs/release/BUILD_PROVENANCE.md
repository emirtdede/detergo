# Build Provenance & Reproducibility

**Applies to:** Node Cleaner 2.0.0 and later
**Introduced:** 2026-11-01 (release-gate audit follow-up)

## Why this exists

The 2.0.0 audit found a release-integrity defect: `release_output/` contained
packages built at **02:42**, while the audited HEAD was committed at **06:37**.
The verified source revision and the shipped binary were not the same code, and
nothing in the pipeline would have caught it. A destructive desktop app must be
able to prove which commit a user is running.

## How the gate works

| Layer | Mechanism |
|---|---|
| Clean tree | `scripts/build-release.js` aborts if `git status --porcelain` is non-empty. Override only with `--allow-dirty`, which also marks the build as unpublishable. |
| Commit stamp | The same script exports `NC_BUILD_COMMIT`, `NC_BUILD_DIRTY` and `NC_BUILD_TIME`; `src-tauri/build.rs` bakes them into the binary. |
| Runtime proof | The About card calls `get_build_info` and shows the short commit plus `(+uncommitted changes)` when the tree was dirty. |
| Freshness | The script refuses to package a `node-cleaner.exe`, NSIS or MSI file whose mtime predates the current run, so stale artifacts cannot be re-shipped. |
| Artifact manifest | `release_output/BUILD_INFO.json` records commit, branch, dirty flag, build time, and the size + SHA-256 of every artifact. |
| Machine independence | `.cargo/config.toml` no longer pins a developer-specific `target-dir` or MSVC/SDK `LIBPATH` values, so the same commit builds on any configured toolchain. |

## Release procedure

```powershell
git status --porcelain        # must print nothing
npm run build:release
type release_output\BUILD_INFO.json
```

Verify `dirty` is `false` and `commit` equals the audited revision before the
packages are published.

## Environment overrides

`NC_BUILD_COMMIT`, `NC_BUILD_DIRTY`, and `NC_BUILD_TIME` exist for CI systems
that build without a `.git` directory. When git metadata is unavailable and no
override is supplied, the build reports `unknown`/`dirty: true` — the app never
claims a clean, traceable build it cannot prove.

## Remaining limitation

The binaries are not code-signed. The manifest proves *what source* was built,
not *who* built it; provenance against tampering still depends on the SHA-256
file plus the distribution channel.
