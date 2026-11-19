use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::platform::windows::delete::{delete_by_handle, HandleDeleteError};
use crate::platform::{identity, is_reparse_point, FileIdentity};
use crate::safety::path_guard::validate_ancestors;
use crate::safety::{validate_target, GuardContext};

pub struct PermanentDeleteService;

impl PermanentDeleteService {
    pub fn new() -> Self {
        Self
    }

    pub fn delete(&self, raw_path: &Path, ctx: &GuardContext<'_>) -> Result<PathBuf, AppError> {
        let canonical = validate_target(raw_path, ctx)?;

        if fs::symlink_metadata(&canonical).is_err() {
            return Err(AppError::PermanentDeleteFailed(
                "Target disappeared before deletion.".to_string(),
            ));
        }

        // Re-validate immediately before the destructive call: the first check
        // happened before metadata was read, so a target swapped for a symlink
        // in between used to be deleted unchecked (O-3, interim fix). Comparing
        // the canonical paths also catches a rename that resolves elsewhere.
        let revalidated = validate_target(&canonical, ctx)?;
        if revalidated != canonical {
            return Err(AppError::UnsafeDeleteTarget(
                "Target changed between validation and deletion.".to_string(),
            ));
        }
        if let Some(root) = ctx
            .scan_roots
            .iter()
            .filter_map(|root| fs::canonicalize(root).ok())
            .find(|root| canonical.starts_with(root) && &canonical != root)
        {
            // Last-moment ancestor check: a directory replaced by a symlink
            // between validation and deletion must abort the removal.
            validate_ancestors(&canonical, &root)?;
        }

        // Identity of the validated root. The handle-based delete compares it
        // again after opening, so a rename/swap in the remaining window cannot
        // redirect the deletion to another object.
        let expected = identity(&canonical);
        delete_tree(&canonical, expected)?;

        if canonical.exists() {
            return Err(AppError::PermanentDeleteFailed(
                "Target still exists after permanent delete.".to_string(),
            ));
        }

        Ok(canonical)
    }
}

impl Default for PermanentDeleteService {
    fn default() -> Self {
        Self::new()
    }
}

/// Deletes `root` and its contents without ever following a reparse point.
///
/// Iterative post-order: children are pushed above their parent so the parent
/// is only deleted once the directory is empty (required by the kernel's
/// delete-on-close for directories), and deep trees cannot exhaust the stack.
fn delete_tree(root: &Path, expected: Option<FileIdentity>) -> Result<(), AppError> {
    let mut stack: Vec<(PathBuf, Option<FileIdentity>, bool)> =
        vec![(root.to_path_buf(), expected, false)];

    while let Some((path, expected, visited)) = stack.pop() {
        let meta = fs::symlink_metadata(&path)
            .map_err(|e| AppError::PermanentDeleteFailed(e.to_string()))?;

        if is_reparse_point(&path) {
            // A link or junction inside the tree is removed itself, never its
            // target. The validated root is already known not to be one.
            if path == root {
                return Err(AppError::UnsafeDeleteTarget(
                    "Reparse point target cannot be deleted.".to_string(),
                ));
            }
            remove_link_only(&path)?;
            continue;
        }

        if meta.is_dir() && !visited {
            stack.push((path.clone(), expected, true));
            let entries =
                fs::read_dir(&path).map_err(|e| AppError::PermanentDeleteFailed(e.to_string()))?;
            for entry in entries {
                let child = entry
                    .map_err(|e| AppError::PermanentDeleteFailed(e.to_string()))?
                    .path();
                stack.push((child, None, false));
            }
            continue;
        }

        delete_one(&path, expected, meta.is_dir())?;
    }

    Ok(())
}

fn remove_link_only(path: &Path) -> Result<(), AppError> {
    // `symlink_metadata` reports a directory symlink as a file, so `is_dir()`
    // on it is always false. Asking the target's metadata (which follows the
    // link) picks the correct removal call: `remove_file` on a directory link
    // fails with "Access is denied" on Windows.
    let link_is_dir = fs::metadata(path)
        .map(|meta| meta.is_dir())
        .unwrap_or(false);
    let result = if link_is_dir {
        fs::remove_dir(path)
    } else {
        fs::remove_file(path).or_else(|_| fs::remove_dir(path))
    };
    result.map_err(|e| AppError::PermanentDeleteFailed(e.to_string()))
}

fn delete_one(path: &Path, expected: Option<FileIdentity>, is_dir: bool) -> Result<(), AppError> {
    match delete_by_handle(path, expected) {
        Ok(()) => Ok(()),
        // Windows before 10 1709 and some non-NTFS volumes do not implement
        // FileDispositionInfoEx. Only in that case fall back to the portable
        // path-based removal; every other failure stays an error.
        Err(err) if err.is_unsupported() => {
            let result = if is_dir {
                fs::remove_dir(path)
            } else {
                fs::remove_file(path)
            };
            result.map_err(|e| AppError::PermanentDeleteFailed(e.to_string()))
        }
        Err(HandleDeleteError::IdentityChanged) => Err(AppError::UnsafeDeleteTarget(
            "Target changed between validation and deletion.".to_string(),
        )),
        Err(HandleDeleteError::InUse) => Err(AppError::PermanentDeleteFailed(
            "Target is in use by another process.".to_string(),
        )),
        Err(err) => Err(AppError::PermanentDeleteFailed(format!(
            "Handle-based delete failed (Win32 error {}).",
            err.code().unwrap_or(0)
        ))),
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use crate::platform::identity;

    fn guard<'a>(roots: &'a [PathBuf]) -> GuardContext<'a> {
        GuardContext {
            scan_roots: roots,
            protected_paths: &[],
        }
    }

    /// Creates a directory link for the tree walk. A symlink needs Developer
    /// Mode or elevation; `mklink /J` (a junction) works for every user and is
    /// also a reparse point, so the same branch is exercised on CI and locally.
    fn make_dir_link(target: &Path, link: &Path) -> bool {
        if std::os::windows::fs::symlink_dir(target, link).is_ok() {
            return true;
        }
        std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false)
    }

    #[test]
    fn deletes_a_nested_tree_and_a_read_only_file() {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = dir.path().join("cache");
        let nested = root.join("a").join("b");
        fs::create_dir_all(&nested).expect("nested dirs");
        fs::write(nested.join("payload.bin"), b"1234").expect("write payload");
        let readonly = root.join("readonly.txt");
        fs::write(&readonly, b"x").expect("write readonly");
        let mut perms = fs::metadata(&readonly).expect("meta").permissions();
        perms.set_readonly(true);
        fs::set_permissions(&readonly, perms).expect("readonly");

        let roots = vec![dir.path().to_path_buf()];
        PermanentDeleteService::new()
            .delete(&root, &guard(&roots))
            .expect("delete");

        assert!(!root.exists());
    }

    #[test]
    fn keeps_a_linked_target_outside_the_scan_root() {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = dir.path().join("cache");
        let outside = dir.path().join("outside");
        fs::create_dir_all(&root).expect("root");
        fs::create_dir_all(&outside).expect("outside");
        let survivor = outside.join("survivor.txt");
        fs::write(&survivor, b"keep").expect("write survivor");
        let link = root.join("link");
        if !make_dir_link(&outside, &link) {
            // No way to create a link in this environment; the reparse-point
            // branch is covered by `delete_tree` unit logic elsewhere.
            return;
        }

        let roots = vec![dir.path().to_path_buf()];
        PermanentDeleteService::new()
            .delete(&root, &guard(&roots))
            .expect("delete");

        assert!(!link.exists());
        assert!(survivor.exists(), "the symlink target must survive");
    }

    #[test]
    fn refuses_a_target_outside_the_scan_root() {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = dir.path().join("cache");
        let sibling = dir.path().join("sibling");
        fs::create_dir_all(&root).expect("root");
        fs::create_dir_all(&sibling).expect("sibling");
        let target = sibling.join("keep.txt");
        fs::write(&target, b"keep").expect("write");

        let roots = vec![root.clone()];
        let err = PermanentDeleteService::new()
            .delete(&target, &guard(&roots))
            .expect_err("must refuse");

        assert!(matches!(err, AppError::UnsafeDeleteTarget(_)));
        assert!(target.exists());
    }

    #[test]
    fn handle_delete_verifies_identity_for_a_directory() {
        let dir = tempfile::tempdir().expect("temp dir");
        let expected = identity(dir.path()).expect("identity");
        delete_by_handle(dir.path(), Some(expected)).expect("delete dir handle");
        assert!(!dir.path().exists());
    }
}
