//! Tolerant, guarded deletion of a fixed root's contents.
//!
//! Unlike [`crate::cleanup::permanent`] this walk does not delete the root and
//! does not abort on a single locked file: a temp folder almost always has one
//! file held by a running process, and reporting it as a failure would make the
//! whole action look broken. Every failure is counted and sampled instead.

use std::fs;
use std::path::Path;

use crate::error::AppError;
use crate::platform::is_reparse_point;
use crate::platform::windows::delete::{delete_by_handle, HandleDeleteError};
use crate::scanner::cancellation::CancellationToken;

/// Names kept in the report. The rest only increment `skipped`.
const SKIPPED_SAMPLE: usize = 20;

#[derive(Debug, Default)]
pub struct DeleteOutcome {
    pub scanned_bytes: u64,
    pub freed_bytes: u64,
    pub deleted_files: u64,
    pub deleted_dirs: u64,
    pub skipped: u64,
    pub skipped_sample: Vec<String>,
    pub incomplete: bool,
}

impl DeleteOutcome {
    fn skip(&mut self, path: &Path) {
        self.skipped = self.skipped.saturating_add(1);
        if self.skipped_sample.len() < SKIPPED_SAMPLE {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "?".to_string());
            self.skipped_sample.push(name);
        }
    }
}

/// Deletes every entry inside `root` while keeping `root` itself.
pub fn delete_contents(root: &Path, token: &CancellationToken) -> Result<DeleteOutcome, AppError> {
    let root = super::guard::verify_root(root)?;
    let mut outcome = DeleteOutcome::default();

    let entries = fs::read_dir(&root).map_err(|e| {
        AppError::PermanentDeleteFailed(format!("Could not read the cleanup target: {e}"))
    })?;

    // Iterative post-order so deep trees cannot exhaust the stack and a
    // directory is only removed after its children.
    let mut stack: Vec<(std::path::PathBuf, bool)> = Vec::new();
    for entry in entries {
        match entry {
            Ok(entry) => stack.push((entry.path(), false)),
            Err(_) => outcome.skip(&root),
        }
    }

    while let Some((path, visited)) = stack.pop() {
        if token.is_cancelled() {
            outcome.incomplete = true;
            break;
        }

        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(_) => {
                // Gone between read_dir and now is a success, not a skip: the
                // goal (the name no longer exists) is already true.
                continue;
            }
        };

        if meta.file_type().is_symlink() || is_reparse_point(&path) {
            match remove_link_only(&path) {
                Ok(()) => outcome.deleted_dirs = outcome.deleted_dirs.saturating_add(1),
                Err(_) => outcome.skip(&path),
            }
            continue;
        }

        if meta.is_dir() {
            if !visited {
                match fs::read_dir(&path) {
                    Ok(children) => {
                        stack.push((path.clone(), true));
                        for child in children {
                            match child {
                                Ok(child) => stack.push((child.path(), false)),
                                Err(_) => outcome.skip(&path),
                            }
                        }
                    }
                    // Unreadable directory: report it and leave it in place.
                    Err(_) => outcome.skip(&path),
                }
                continue;
            }
            match remove_dir(&path) {
                Ok(()) => outcome.deleted_dirs = outcome.deleted_dirs.saturating_add(1),
                Err(_) => outcome.skip(&path),
            }
            continue;
        }

        let size = meta.len();
        outcome.scanned_bytes = outcome.scanned_bytes.saturating_add(size);
        match delete_file(&path) {
            Ok(()) => {
                outcome.deleted_files = outcome.deleted_files.saturating_add(1);
                outcome.freed_bytes = outcome.freed_bytes.saturating_add(size);
            }
            Err(_) => outcome.skip(&path),
        }
    }

    Ok(outcome)
}

fn delete_file(path: &Path) -> Result<(), ()> {
    match delete_by_handle(path, None) {
        Ok(()) => Ok(()),
        // Windows before 10 1709 / non-NTFS volumes: fall back to the portable
        // call. Every other error (in use, access denied) is a skip.
        Err(err) if err.is_unsupported() => remove_file_portable(path),
        Err(HandleDeleteError::InUse) => Err(()),
        Err(_) => Err(()),
    }
}

fn remove_file_portable(path: &Path) -> Result<(), ()> {
    if fs::remove_file(path).is_ok() {
        return Ok(());
    }
    // A read-only leftover (common in Temp) needs the attribute cleared first.
    if let Ok(metadata) = fs::metadata(path) {
        let mut permissions = metadata.permissions();
        if permissions.readonly() {
            #[allow(clippy::permissions_set_readonly_false)]
            permissions.set_readonly(false);
            let _ = fs::set_permissions(path, permissions);
        }
    }
    fs::remove_file(path).map_err(|_| ())
}

fn remove_dir(path: &Path) -> Result<(), ()> {
    match delete_by_handle(path, None) {
        Ok(()) => Ok(()),
        Err(err) if err.is_unsupported() => fs::remove_dir(path).map_err(|_| ()),
        Err(_) => fs::remove_dir(path).map_err(|_| ()),
    }
}

/// Removes the link itself, never its target.
fn remove_link_only(path: &Path) -> Result<(), ()> {
    // `symlink_metadata` reports a directory link as a file, so the *target's*
    // metadata decides which removal call is correct.
    let link_is_dir = fs::metadata(path).map(|m| m.is_dir()).unwrap_or(false);
    if link_is_dir {
        fs::remove_dir(path)
            .or_else(|_| fs::remove_file(path))
            .map_err(|_| ())
    } else {
        fs::remove_file(path)
            .or_else(|_| fs::remove_dir(path))
            .map_err(|_| ())
    }
}
