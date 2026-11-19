use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::catalog::matcher::GitState;

#[derive(Debug, Clone)]
pub struct GitStatus {
    pub repository: bool,
    pub root: Option<PathBuf>,
    pub tracked: bool,
    pub modified: bool,
    pub ignored: bool,
    pub linked_worktree: bool,
}

#[derive(Debug, Clone)]
pub enum GitError {
    Unavailable,
    Failure(String),
}

impl std::fmt::Display for GitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GitError::Unavailable => write!(f, "git executable not found"),
            GitError::Failure(msg) => write!(f, "git command failed: {}", msg),
        }
    }
}

fn command(repo: &Path, args: &[&str]) -> Result<std::process::Output, GitError> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(repo)
        .arg("-c")
        .arg("core.quotepath=false");
    for a in args {
        cmd.arg(a);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.output().map_err(|_| GitError::Unavailable)
}

pub fn find_repository_root(start: &Path) -> Option<PathBuf> {
    let mut current = Some(start);
    let mut depth = 0;
    while let Some(dir) = current {
        if depth > 16 {
            break;
        }
        if dir.join(".git").exists() {
            return Some(dir.to_path_buf());
        }
        current = dir.parent();
        depth += 1;
    }
    None
}

fn is_linked_worktree(root: &Path) -> bool {
    root.join(".git")
        .metadata()
        .map(|m| m.is_file())
        .unwrap_or(false)
}

/// Inspects the Git state of a path. Errors are returned instead of being
/// converted into "clean" so callers can fail closed.
pub fn inspect_git(path: &Path) -> Result<GitStatus, GitError> {
    let Some(root) = find_repository_root(path) else {
        return Ok(GitStatus {
            repository: false,
            root: None,
            tracked: false,
            modified: false,
            ignored: false,
            linked_worktree: false,
        });
    };

    let rel = match path.strip_prefix(&root) {
        Ok(r) => r.to_string_lossy().replace('\\', "/"),
        Err(_) => {
            return Err(GitError::Failure(
                "target is outside repository root".to_string(),
            ))
        }
    };

    let tracked_out = command(&root, &["ls-files", "--", &rel])?;
    if !tracked_out.status.success() {
        return Err(GitError::Failure(
            String::from_utf8_lossy(&tracked_out.stderr).to_string(),
        ));
    }
    let tracked = !tracked_out.stdout.is_empty();

    let status_out = command(&root, &["status", "--porcelain", "--", &rel])?;
    if !status_out.status.success() {
        return Err(GitError::Failure(
            String::from_utf8_lossy(&status_out.stderr).to_string(),
        ));
    }
    let modified = !status_out.stdout.is_empty();

    let ignored = match command(&root, &["check-ignore", "-q", "--", &rel]) {
        Ok(out) => out.status.success(),
        Err(_) => false,
    };

    Ok(GitStatus {
        repository: true,
        root: Some(root.clone()),
        tracked,
        modified,
        ignored,
        linked_worktree: is_linked_worktree(&root),
    })
}

/// Maps git output to the coarse state used by the classifier.
pub fn git_state_for(path: &Path) -> GitState {
    match inspect_git(path) {
        Err(_) => GitState::Unknown,
        Ok(status) if !status.repository => GitState::NotRepository,
        Ok(status) => {
            if status.tracked {
                if status.modified {
                    GitState::TrackedModified
                } else {
                    GitState::TrackedClean
                }
            } else if status.modified {
                GitState::UntrackedOnly
            } else {
                GitState::Clean
            }
        }
    }
}

/// Discovery-time Git probe with per-directory repository-root caching.
///
/// The classifier only treats tracked or unknown states as blocking; when
/// `git ls-files` confirms nothing under `path` is tracked we skip the extra
/// `git status` and `git check-ignore` process spawns entirely, which cuts
/// scan latency on Windows repositories by an order of magnitude.
pub fn fast_git_state(path: &Path, repo_cache: &mut HashMap<PathBuf, Option<PathBuf>>) -> GitState {
    let parent = path.parent().unwrap_or(path);
    let repo_root = if let Some(cached) = repo_cache.get(parent) {
        cached.clone()
    } else {
        let found = find_repository_root(parent);
        repo_cache.insert(parent.to_path_buf(), found.clone());
        found
    };

    let Some(root) = repo_root else {
        return GitState::NotRepository;
    };

    let Ok(rel_path) = path.strip_prefix(&root) else {
        return GitState::Unknown;
    };
    let rel = rel_path.to_string_lossy().replace('\\', "/");

    let Ok(tracked_out) = command(&root, &["ls-files", "--", &rel]) else {
        return GitState::Unknown;
    };
    if !tracked_out.status.success() {
        return GitState::Unknown;
    }
    if tracked_out.stdout.is_empty() {
        return GitState::UntrackedOnly;
    }

    // Tracked files exist: check whether they have uncommitted modifications.
    match command(&root, &["status", "--porcelain", "--", &rel]) {
        Ok(out) if out.status.success() && !out.stdout.is_empty() => GitState::TrackedModified,
        Ok(out) if out.status.success() => GitState::TrackedClean,
        _ => GitState::TrackedClean,
    }
}

/// Hard gate before deletion: tracked content must never be removed through a
/// generic cleanup rule.
pub fn ensure_not_tracked(path: &Path) -> Result<(), String> {
    match inspect_git(path) {
        Err(e) => Err(e.to_string()),
        Ok(status) => {
            if status.tracked {
                Err("Target is tracked by Git.".to_string())
            } else {
                Ok(())
            }
        }
    }
}
