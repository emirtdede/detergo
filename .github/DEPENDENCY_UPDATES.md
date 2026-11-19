# Dependency updates

Dependabot version-update pull requests are intentionally disabled.

The repository keeps exactly two branches, `main` and `development`, and every
pull request has to run the full CI matrix (frontend gates on Linux, Rust gates
on Windows). Dependabot's scheduled updates opened one branch per ecosystem and
group, which repeatedly broke that branch policy. Dependency bumps are therefore
made by hand, on `development`, with the same gates.

Dependabot **security alerts** and **security updates** are a repository setting
(Settings → Code security) and stay enabled; they do not need this file.
