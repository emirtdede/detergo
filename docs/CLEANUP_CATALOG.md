# Cleanup Catalog (`src-tauri/assets/targets.toml`)

**Schema version:** 1
**Rules:** 56 (16 `safe`, 18 `regenerate`, 21 `review`, 1 `keep`)

The catalog is embedded in the binary and validated on startup. Any invalid
rule disables cleanup (`get_catalog().valid == false`).

## Rule fields

| Field | Meaning |
|---|---|
| `id` | Stable unique rule id (`ecosystem.name`) |
| `kind` | `directory` / `file` / `fileGroup` |
| `names` | Case-insensitive names; a single `*` wildcard is allowed |
| `markers` | Files/dirs expected at the **project root** or **workspace root** |
| `marker_mode` | `any` (default) or `all` |
| `content` | Paths that must exist **inside** the candidate (extra evidence) |
| `min_evidence` | 1–3; name always counts as one |
| `generic_name` | Forces `min_evidence >= 2` |
| `safety` | Default safety class |
| `cleanup` | `trash` / `permanent` / `officialTool` / `none` |
| `git_policy` | `ignore` or `denytracked` |
| `nested_in` | Parent rules that may contain this target |
| `child_rules` | Declares traversal into this target |
| `requires_idle` | Deletion blocked while the producer is active |
| `protected` | `KEEP`, non-selectable, no cleanup method |

## Classification

```
score = 1 (name) + marker hits + content hits
if markers declared and none found        -> REVIEW, LOW, NO_PROJECT_MARKER
if marker_mode=all and one is missing     -> REVIEW, LOW
if score < min_evidence                   -> REVIEW, LOW, INSUFFICIENT_EVIDENCE
if generic_name and no marker             -> REVIEW, LOW, GENERIC_NAME_UNVERIFIED
if git tracked/tracked-modified           -> REVIEW, MEDIUM, GIT_TRACKED_CONTENT
if git state unknown                      -> REVIEW, LOW, GIT_STATE_UNKNOWN
else                                      -> rule safety/confidence
KEEP always wins and is never selectable
```

`safe` + `low` confidence is downgraded to `review`. `autoSelectable` requires
`safe` + `high` + selectable + not `requires_idle`.

## Coverage

| Ecosystem | Rules | Examples |
|---|---|---|
| JavaScript/TypeScript | 24 | `node_modules`, `.next`(+`cache`), `.nuxt`, `.turbo`, `.nx`(+`cache`), `.vite`, `.angular`, `.svelte-kit`, `.astro`, `dist`, `build`, `out`, `coverage`, `.eslintcache`, `*.tsbuildinfo`, `.yarn/cache`, `.vercel` |
| Python | 9 | `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.tox`, `.nox`, `.venv`/`venv`, `htmlcov`, `.coverage` |
| Rust | 1 | `target` + `Cargo.toml` |
| .NET | 3 | `bin`, `obj`, `TestResults` |
| Java/Kotlin | 4 | Maven `target`, Gradle `build`, `.gradle`, `.kotlin` |
| Go | 1 | `vendor` |
| PHP | 1 | `vendor` |
| Dart/Flutter | 2 | `build`, `.dart_tool` |
| C/C++ | 2 | `CMakeFiles`, `cmake-build-*` |
| Unity | 2 | `Library`, `Temp` (both need `Assets` **and** `ProjectSettings`) |
| Unreal | 3 | `Intermediate`, `DerivedDataCache`, `Saved` (**KEEP**) |
| Elixir / Swift / Godot | 4 | `_build`, `deps`, `.build`, `.godot` |

## Important examples

| Target | Required evidence | Default | Notes |
|---|---|---|---|
| `node_modules` | name + project marker (manifest/lockfile/workspace) | `regenerate` | Without a manifest it is `review`; nested `node_modules` is not scanned |
| `.next` | Next config | `regenerate` | Descends only for `js.next_cache` |
| `.next/cache` | nested in `.next` | `safe` | Parent/child overlap resolved in the planner |
| `build` (JS) | `package.json` + name | `regenerate` | `generic_name`, Git-tracked blocked |
| `target` (Rust) | `Cargo.toml` + name | `regenerate` | Same name in Maven is a separate rule |
| `bin`/`obj` (.NET) | project/solution + name | `regenerate` | |
| `vendor` | `go.mod` / `composer.json` + name | `review` | Offline builds may require it |
| `.venv` | Python manifest | `review` | Local environment may contain unmanaged state |
| `Unity/Library` | `Assets` **and** `ProjectSettings` | `review` | Expensive reimport |
| `Unreal/Saved` | `.uproject` | `keep` | Contains autosaves/user assets |

## Adding a rule

1. Add a `[[rules]]` block with a unique id and at least one name.
2. Add markers unless the name is globally unique and safe.
3. Generic names (`build`, `dist`, `out`, `bin`, `obj`, `target`, `vendor`,
   `Library`, `Temp`, `deps`) must use `generic_name = true`,
   `min_evidence >= 2`.
4. Use `denytracked` when Git may track the output.
5. Add positive and negative fixtures in `catalog::tests` / `scanner::tests`.
6. A rule that fails validation blocks the whole catalog by design.
