pub mod windows;

pub use windows::{
    facts, identity, is_in_use, is_remote_path, is_reparse_point, running_process_names,
    volume_free_bytes, FileFacts, FileIdentity,
};
pub use windows::{
    fixed_drive_roots, force_foreground, get_known_dev_locations, list_fixed_drives, DriveInfo,
    KnownLocation,
};

use std::fs;
use std::path::{Path, PathBuf};

/// Resolves the per-user application directory, migrating the pre-rename
/// `node-cleaner` folder on first use.
///
/// The migration used to be gated on `!dev_dir.exists()`. `create_dir_all`
/// succeeds before any file is copied, so a single failed copy (AV lock, ACL,
/// full disk) left an existing-but-empty directory that permanently disabled
/// the retry: the app started with default settings and an empty history while
/// the real files still sat in the legacy folder.
///
/// Migration is therefore idempotent and re-attempted on every launch: entries
/// already copied are skipped, and failures are reported on stderr instead of
/// being discarded.
pub fn resolve_app_dir(base_dir: &Path) -> PathBuf {
    let dev_dir = base_dir.join("dev-cleaner");
    let legacy_dir = base_dir.join("node-cleaner");

    if let Err(err) = fs::create_dir_all(&dev_dir) {
        crate::logging::warn(
            &format!(
                "could not create the application directory {}",
                dev_dir.display()
            ),
            err,
        );
        return dev_dir;
    }

    migrate_legacy_dir(&legacy_dir, &dev_dir);
    dev_dir
}

fn migrate_legacy_dir(legacy_dir: &Path, dev_dir: &Path) {
    if !legacy_dir.is_dir() || legacy_dir == dev_dir {
        return;
    }
    let entries = match fs::read_dir(legacy_dir) {
        Ok(entries) => entries,
        Err(err) => {
            crate::logging::warn(
                &format!(
                    "could not read the legacy directory {}",
                    legacy_dir.display()
                ),
                err,
            );
            return;
        }
    };

    for entry in entries.flatten() {
        let source = entry.path();
        let dest = dev_dir.join(entry.file_name());
        if dest.exists() {
            continue;
        }
        // Only regular files are copied: following a reparse point could pull
        // in a target outside the app directory, and a directory entry makes
        // `fs::copy` fail.
        let is_file = entry
            .file_type()
            .map(|kind| kind.is_file())
            .unwrap_or(false);
        if !is_file {
            continue;
        }
        if let Err(err) = fs::copy(&source, &dest) {
            crate::logging::warn(
                &format!(
                    "could not migrate {} to {}",
                    source.display(),
                    dest.display()
                ),
                err,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("dev-cleaner-platform-{name}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("temp root");
        root
    }

    #[test]
    fn migrates_legacy_files_into_the_new_directory() {
        let root = temp_root("migrate");
        let legacy = root.join("node-cleaner");
        fs::create_dir_all(&legacy).expect("legacy dir");
        fs::write(legacy.join("config.json"), b"{}").expect("write config");

        let resolved = resolve_app_dir(&root);

        assert_eq!(resolved, root.join("dev-cleaner"));
        assert_eq!(
            fs::read(resolved.join("config.json")).expect("migrated file"),
            b"{}"
        );
    }

    #[test]
    fn migration_retries_after_a_partial_copy() {
        let root = temp_root("retry");
        let legacy = root.join("node-cleaner");
        let dev = root.join("dev-cleaner");
        fs::create_dir_all(&legacy).expect("legacy dir");
        // The previous run created the target directory but never copied the
        // file: the old gate treated this as "migration done".
        fs::create_dir_all(&dev).expect("dev dir");
        fs::write(legacy.join("last-scan.json"), b"{\"schemaVersion\":1}").expect("write snapshot");

        let resolved = resolve_app_dir(&root);

        assert_eq!(
            fs::read(resolved.join("last-scan.json")).expect("migrated file"),
            b"{\"schemaVersion\":1}"
        );
    }

    #[test]
    fn existing_target_file_is_not_overwritten() {
        let root = temp_root("keep");
        let legacy = root.join("node-cleaner");
        let dev = root.join("dev-cleaner");
        fs::create_dir_all(&legacy).expect("legacy dir");
        fs::create_dir_all(&dev).expect("dev dir");
        fs::write(legacy.join("config.json"), b"legacy").expect("write legacy");
        fs::write(dev.join("config.json"), b"current").expect("write current");

        let resolved = resolve_app_dir(&root);

        assert_eq!(
            fs::read(resolved.join("config.json")).expect("current file"),
            b"current"
        );
    }
}
