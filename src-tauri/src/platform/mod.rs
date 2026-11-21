pub mod app_icon;
pub mod windows;

#[cfg(windows)]
pub use windows::force_foreground;
pub use windows::{
    facts, identity, is_elevated, is_in_use, is_remote_path, is_reparse_point, relaunch_elevated,
    running_process_names, volume_free_bytes, wait_for_pid_exit, FileFacts, FileIdentity,
};
pub use windows::{
    fixed_drive_roots, get_known_dev_locations, list_fixed_drives, DriveInfo, KnownLocation,
};

use std::fs;
use std::path::{Path, PathBuf};

/// Atomically replaces `to` with `from` on the same volume.
///
/// On Windows, `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH`
/// avoids the delete-then-rename race where a crash leaves no file at `to`.
#[cfg(windows)]
pub fn atomic_replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    use ::windows::core::PCWSTR;
    use ::windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MOVE_FILE_FLAGS,
    };
    use std::os::windows::ffi::OsStrExt;

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let from_w = wide(from);
    let to_w = wide(to);
    let flags = MOVE_FILE_FLAGS(MOVEFILE_REPLACE_EXISTING.0 | MOVEFILE_WRITE_THROUGH.0);
    unsafe { MoveFileExW(PCWSTR(from_w.as_ptr()), PCWSTR(to_w.as_ptr()), flags) }
        .map_err(|e| std::io::Error::from_raw_os_error(e.code().0))
}

#[cfg(not(windows))]
pub fn atomic_replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::rename(from, to)
}

/// Resolves the per-user application directory (`detergo`), idempotently
/// migrating pre-rename `lustra`, `dev-cleaner`, and `node-cleaner` folders on
/// first use so existing users keep all settings, history, and snapshots.
pub fn resolve_app_dir(base_dir: &Path) -> PathBuf {
    let app_dir = base_dir.join("detergo");
    let prev_lustra = base_dir.join("lustra");
    let prev_dir = base_dir.join("dev-cleaner");
    let legacy_dir = base_dir.join("node-cleaner");

    if let Err(err) = fs::create_dir_all(&app_dir) {
        crate::logging::warn(
            &format!(
                "could not create the application directory {}",
                app_dir.display()
            ),
            err,
        );
        return app_dir;
    }

    migrate_legacy_dirs(&[&prev_lustra, &prev_dir, &legacy_dir], &app_dir);
    app_dir
}

const LEGACY_MIGRATED_MARKER: &str = ".legacy-migrated-v3";

/// Records that legacy application directories (`lustra`, `dev-cleaner`,
/// `node-cleaner`) have already been migrated (or intentionally cleared by a
/// factory reset) so deleted files are never resurrected on the next launch.
pub fn mark_legacy_migrated(app_dir: &Path) {
    let _ = fs::create_dir_all(app_dir);
    let _ = fs::write(app_dir.join(LEGACY_MIGRATED_MARKER), b"1\n");
}

fn migrate_legacy_dirs(legacy_dirs: &[&Path], app_dir: &Path) {
    if app_dir.join(LEGACY_MIGRATED_MARKER).exists() {
        return;
    }
    let mut all_ok = true;
    for &legacy_dir in legacy_dirs {
        if !legacy_dir.is_dir() || legacy_dir == app_dir {
            continue;
        }
        let entries = match fs::read_dir(legacy_dir) {
            Ok(entries) => entries,
            Err(err) => {
                all_ok = false;
                crate::logging::warn(
                    &format!(
                        "could not read the legacy directory {}",
                        legacy_dir.display()
                    ),
                    err,
                );
                continue;
            }
        };

        for entry in entries.flatten() {
            let file_name = entry.file_name();
            if file_name == ".legacy-migrated"
                || file_name == ".legacy-migrated-v2"
                || file_name == LEGACY_MIGRATED_MARKER
            {
                continue;
            }
            let source = entry.path();
            let dest = app_dir.join(file_name);
            if dest.exists() {
                continue;
            }
            let is_file = entry
                .file_type()
                .map(|kind| kind.is_file())
                .unwrap_or(false);
            if !is_file {
                continue;
            }
            if let Err(err) = fs::copy(&source, &dest) {
                all_ok = false;
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
    if all_ok {
        mark_legacy_migrated(app_dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("detergo-platform-{name}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("temp root");
        root
    }

    #[test]
    fn migrates_legacy_files_into_the_new_directory() {
        let root = temp_root("migrate");
        let prev = root.join("dev-cleaner");
        let legacy = root.join("node-cleaner");
        fs::create_dir_all(&prev).expect("prev dir");
        fs::create_dir_all(&legacy).expect("legacy dir");
        fs::write(prev.join("config.json"), b"{\"theme\":\"dark-blue\"}").expect("write prev");
        fs::write(legacy.join("config.json"), b"{}").expect("write legacy");
        fs::write(legacy.join("history.db"), b"sqlite").expect("write legacy db");

        let resolved = resolve_app_dir(&root);

        assert_eq!(resolved, root.join("detergo"));
        assert_eq!(
            fs::read(resolved.join("config.json")).expect("migrated config"),
            b"{\"theme\":\"dark-blue\"}"
        );
        assert_eq!(
            fs::read(resolved.join("history.db")).expect("migrated db"),
            b"sqlite"
        );
    }

    #[test]
    fn migration_retries_after_a_partial_copy() {
        let root = temp_root("retry");
        let legacy = root.join("dev-cleaner");
        let app = root.join("detergo");
        fs::create_dir_all(&legacy).expect("legacy dir");
        fs::create_dir_all(&app).expect("app dir");
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
        let legacy = root.join("dev-cleaner");
        let app = root.join("detergo");
        fs::create_dir_all(&legacy).expect("legacy dir");
        fs::create_dir_all(&app).expect("app dir");
        fs::write(legacy.join("config.json"), b"legacy").expect("write legacy");
        fs::write(app.join("config.json"), b"current").expect("write current");

        let resolved = resolve_app_dir(&root);

        assert_eq!(
            fs::read(resolved.join("config.json")).expect("current file"),
            b"current"
        );
    }
}
