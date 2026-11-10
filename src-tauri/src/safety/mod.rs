pub mod evidence_guard;
pub mod git_guard;
pub mod path_guard;
pub mod process_guard;

#[cfg(test)]
mod tests;

pub use evidence_guard::{revalidate_evidence, EvidenceSnapshot};
pub use git_guard::{inspect_git, GitError, GitStatus};
pub use path_guard::{validate_target, GuardContext, PathGuard};
pub use process_guard::{active_use_for_provider, is_target_in_use, ActiveUse};

/// Names that must never be removed by a generic cleanup rule, even when a rule
/// name happens to match. Checked on top of catalog rules (defence in depth).
pub const HARD_PROTECTED_NAMES: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    ".ssh",
    ".gnupg",
    ".aws",
    ".azure",
    ".kube",
    "auth.json",
    ".credentials.json",
    ".env",
    "config.toml",
    "settings.json",
    "CLAUDE.md",
    "AGENTS.md",
    "memories",
    "agent-memory",
    "file-history",
    "conversations",
    "brain",
    "src",
    "migrations",
];

/// Directory components that must never appear between the scan root and a
/// deletion target (VCS metadata and secret stores).
pub const PROTECTED_COMPONENTS: &[&str] = &[
    ".git", ".hg", ".svn", ".ssh", ".gnupg", ".aws", ".azure", ".kube",
];

pub fn is_protected_component(name: &str) -> bool {
    let lower = name.to_lowercase();
    PROTECTED_COMPONENTS.iter().any(|n| *n == lower)
}

pub fn is_hard_protected_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    HARD_PROTECTED_NAMES
        .iter()
        .any(|n| n.eq_ignore_ascii_case(&lower))
        || lower.starts_with(".env.")
        || lower == ".env"
}
