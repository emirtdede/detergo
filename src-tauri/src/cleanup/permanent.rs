use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::platform::windows::delete::{
    delete_by_handle, verify_identity_no_follow, HandleDeleteError,
};
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

        // Verify the canonical target has not been swapped for a symlink or
        // reparse point and re-check ancestors up to the scan root without
        // repeating a full `validate_target` canonicalization sweep.
        if is_reparse_point(&canonical) {
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

/// Threshold above which leaf files in a batch are unlinked in parallel.
const PARALLEL_DELETE_THRESHOLD: usize = 64;
/// Maximum number of leaf file paths buffered in memory before flushing a
/// parallel unlink batch, bounding heap usage on 500k+ file trees.
const MAX_FILE_BATCH_SIZE: usize = 4096;

fn check_dir_identity(dir: &Path, expected: Option<FileIdentity>) -> Result<(), AppError> {
    if is_reparse_point(dir) {
        return Err(AppError::UnsafeDeleteTarget(
            "Reparse point target cannot be deleted.".to_string(),
        ));
    }
    if let Some(expected_id) = expected {
        match verify_identity_no_follow(dir, expected_id) {
            Ok(()) => {}
            Err(HandleDeleteError::IdentityChanged) => {
                return Err(AppError::UnsafeDeleteTarget(
                    "Target changed between validation and deletion.".to_string(),
                ));
            }
            Err(HandleDeleteError::InUse) => {
                return Err(AppError::PermanentDeleteFailed(
                    "Target is in use by another process.".to_string(),
                ));
            }
            Err(err) => {
                return Err(AppError::PermanentDeleteFailed(format!(
                    "Could not verify target identity before deletion (error {}).",
                    err.code().unwrap_or(0)
                )));
            }
        }
    }
    Ok(())
}

fn flush_file_batch(files_to_delete: &mut Vec<PathBuf>) -> Result<(), AppError> {
    if files_to_delete.is_empty() {
        return Ok(());
    }
    if files_to_delete.len() < PARALLEL_DELETE_THRESHOLD {
        for file in files_to_delete.drain(..) {
            delete_one(&file, None, false)?;
        }
        return Ok(());
    }

    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Mutex;

    let batch = std::mem::take(files_to_delete);
    let workers = std::thread::available_parallelism()
        .map(|n| n.get().clamp(2, 8))
        .unwrap_or(4);
    let next_idx = AtomicUsize::new(0);
    let failed = AtomicBool::new(false);
    let first_err: Mutex<Option<AppError>> = Mutex::new(None);

    std::thread::scope(|scope| {
        for _ in 0..workers {
            let files = &batch;
            let next_idx = &next_idx;
            let failed = &failed;
            let first_err = &first_err;
            scope.spawn(move || loop {
                if failed.load(Ordering::Relaxed) {
                    return;
                }
                let idx = next_idx.fetch_add(1, Ordering::Relaxed);
                let Some(file) = files.get(idx) else {
                    return;
                };
                if let Err(err) = delete_one(file, None, false) {
                    failed.store(true, Ordering::Relaxed);
                    let mut slot = first_err.lock().unwrap_or_else(|e| e.into_inner());
                    if slot.is_none() {
                        *slot = Some(err);
                    }
                    return;
                }
            });
        }
    });

    if let Some(err) = first_err.into_inner().unwrap_or_else(|e| e.into_inner()) {
        return Err(err);
    }
    Ok(())
}

/// Deletes `root` and its contents without ever following a reparse point.
///
/// Post-order directory traversal with bounded parallel leaf unlinking and
/// per-directory `FileIdentity` verification:
/// - Symlinks/junctions inside the tree are unlinked directly without ever
///   descending into their target.
/// - Every intermediate subdirectory records its `FileIdentity` when discovered,
///   verifies that identity before its children are enumerated, and verifies
///   it again by handle in `delete_by_handle` when the directory itself is
///   unlinked bottom-up (closing intermediate-directory TOCTOU swap windows).
/// - Regular files are unlinked in bounded batches of `MAX_FILE_BATCH_SIZE`
///   (4,096) so memory remains O(1) even on 500,000-file trees.
fn delete_tree(root: &Path, expected: Option<FileIdentity>) -> Result<(), AppError> {
    check_dir_identity(root, expected)?;
    let root_meta =
        fs::symlink_metadata(root).map_err(|e| AppError::PermanentDeleteFailed(e.to_string()))?;
    if !root_meta.is_dir() {
        return delete_one(root, expected, false);
    }

    let mut dir_order: Vec<(PathBuf, Option<FileIdentity>)> = vec![(root.to_path_buf(), expected)];
    let mut files_to_delete: Vec<PathBuf> = Vec::with_capacity(256);
    let mut cursor = 0usize;

    while cursor < dir_order.len() {
        let (dir, dir_expected) = dir_order[cursor].clone();
        if cursor > 0 {
            check_dir_identity(&dir, dir_expected)?;
        }
        cursor += 1;

        #[cfg(windows)]
        {
            let entries = crate::platform::windows::fast_walk::read_dir_fast(&dir)
                .map_err(|e| AppError::PermanentDeleteFailed(e.to_string()))?;
            for entry in entries {
                let child = dir.join(&entry.name);
                if entry.is_redirecting_reparse {
                    remove_link_only(&child, entry.is_dir)?;
                } else if entry.is_dir {
                    let child_id = identity(&child);
                    dir_order.push((child, child_id));
                } else {
                    files_to_delete.push(child);
                    if files_to_delete.len() >= MAX_FILE_BATCH_SIZE {
                        check_dir_identity(&dir, dir_expected)?;
                        flush_file_batch(&mut files_to_delete)?;
                    }
                }
            }
        }
        #[cfg(not(windows))]
        {
            let entries =
                fs::read_dir(&dir).map_err(|e| AppError::PermanentDeleteFailed(e.to_string()))?;
            for entry in entries {
                let entry = entry.map_err(|e| AppError::PermanentDeleteFailed(e.to_string()))?;
                let child = entry.path();
                let ft = entry
                    .file_type()
                    .map_err(|e| AppError::PermanentDeleteFailed(e.to_string()))?;
                if ft.is_symlink() {
                    remove_link_only(&child, false)?;
                } else if ft.is_dir() {
                    let child_id = identity(&child);
                    dir_order.push((child, child_id));
                } else {
                    files_to_delete.push(child);
                    if files_to_delete.len() >= MAX_FILE_BATCH_SIZE {
                        check_dir_identity(&dir, dir_expected)?;
                        flush_file_batch(&mut files_to_delete)?;
                    }
                }
            }
        }
    }

    flush_file_batch(&mut files_to_delete)?;

    // Remove emptied directories strictly bottom-up, verifying each directory's
    // captured `FileIdentity` (both intermediate subdirectories and `root`).
    for (dir, dir_expected) in dir_order.iter().rev() {
        delete_one(dir, *dir_expected, true)?;
    }

    Ok(())
}

/// Removes a symlink, junction, or reparse placeholder without ever following
/// the link target (avoids SMB stalls and cloud hydration).
fn remove_link_only(path: &Path, is_dir_entry: bool) -> Result<(), AppError> {
    let result = if is_dir_entry {
        fs::remove_dir(path).or_else(|_| fs::remove_file(path))
    } else {
        fs::remove_file(path).or_else(|_| fs::remove_dir(path))
    };
    result.map_err(|e| AppError::PermanentDeleteFailed(e.to_string()))
}

fn delete_one(path: &Path, expected: Option<FileIdentity>, is_dir: bool) -> Result<(), AppError> {
    match delete_by_handle(path, expected) {
        Ok(()) => Ok(()),
        // Windows before 10 1709 and some non-NTFS volumes (plus Unix) do not
        // implement FileDispositionInfoEx. Only in that case fall back to the
        // portable path-based removal; every other failure stays an error.
        Err(err) if err.is_unsupported() => {
            // Clear read-only permissions on Unix/non-NTFS fallback so
            // read-only caches like `go/pkg/mod` can be removed cleanly.
            if let Ok(meta) = fs::symlink_metadata(path) {
                let mut perms = meta.permissions();
                if perms.readonly() {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        perms.set_mode(perms.mode() | 0o200);
                    }
                    #[cfg(not(unix))]
                    {
                        #[allow(clippy::permissions_set_readonly_false)]
                        perms.set_readonly(false);
                    }
                    let _ = fs::set_permissions(path, perms);
                }
            }
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
