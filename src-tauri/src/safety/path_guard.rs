use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::error::AppError;
use crate::platform::{is_remote_path, is_reparse_point};
use crate::safety::{is_hard_protected_name, is_protected_component};

/// Context required to authorize a deletion target.
pub struct GuardContext<'a> {
    /// Every directory root of the scan that produced the target.
    pub scan_roots: &'a [PathBuf],
    /// User-configured protected folders (absolute paths).
    pub protected_paths: &'a [String],
}

pub struct PathGuard;

impl PathGuard {
    /// Full validation used before any destructive operation.
    pub fn validate(target: &Path, ctx: &GuardContext<'_>) -> Result<PathBuf, AppError> {
        if !target.exists() {
            return Err(AppError::PathNotFound(target.to_string_lossy().to_string()));
        }

        let meta = fs::symlink_metadata(target)
            .map_err(|e| AppError::InvalidPath(format!("Failed to read metadata: {}", e)))?;
        if meta.file_type().is_symlink() {
            return Err(AppError::UnsafeDeleteTarget(format!(
                "Symbolic link target cannot be deleted: {}",
                target.display()
            )));
        }
        // A reparse point that is not a symlink (e.g. OneDrive placeholder) is
        // never deleted either: the real payload may live elsewhere.
        if is_reparse_point(target) {
            return Err(AppError::UnsafeDeleteTarget(format!(
                "Reparse point target cannot be deleted: {}",
                target.display()
            )));
        }

        let canonical = fs::canonicalize(target)
            .map_err(|e| AppError::InvalidPath(format!("Failed to canonicalize path: {}", e)))?;
        let target_key = normalize_key(&canonical);

        if target_key.starts_with(r"\\") {
            return Err(AppError::UnsafeDeleteTarget(
                "UNC or device paths cannot be deleted.".to_string(),
            ));
        }

        let matching_root = ctx.scan_roots.iter().find_map(|root| {
            let canonical_root = fs::canonicalize(root).unwrap_or_else(|_| root.clone());
            let root_key = normalize_key(&canonical_root);
            if target_key != root_key && is_within(&target_key, &root_key) {
                Some(canonical_root)
            } else {
                None
            }
        });

        let Some(root_canonical) = matching_root else {
            if ctx
                .scan_roots
                .iter()
                .any(|r| normalize_key(r) == target_key)
            {
                return Err(AppError::UnsafeDeleteTarget(
                    "Scan root cannot be deleted.".to_string(),
                ));
            }
            return Err(AppError::UnsafeDeleteTarget(format!(
                "Target is outside scan root: {}",
                canonical.display()
            )));
        };
        let root_key = normalize_key(&root_canonical);

        validate_system_path(&target_key)?;
        validate_protected_paths(&target_key, ctx.protected_paths)?;
        validate_ancestors(&canonical, &root_canonical)?;

        if is_remote_path(&canonical) {
            return Err(AppError::UnsafeDeleteTarget(
                "Network path targets cannot be safely moved to Recycle Bin.".to_string(),
            ));
        }

        let name = canonical
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if name.is_empty() {
            return Err(AppError::UnsafeDeleteTarget(
                "Invalid target name.".to_string(),
            ));
        }
        if is_hard_protected_name(&name) {
            return Err(AppError::UnsafeDeleteTarget(format!(
                "Protected name cannot be deleted: {}",
                name
            )));
        }

        // Reject a path containing a protected directory component (`.git`,
        // `.ssh`, …) anywhere below the scan root.
        let relative = target_key
            .strip_prefix(&root_key)
            .unwrap_or(&target_key)
            .trim_start_matches('\\');
        for part in relative.split('\\') {
            if is_protected_component(part) {
                return Err(AppError::UnsafeDeleteTarget(format!(
                    "Contains protected directory component: {}",
                    part
                )));
            }
        }

        Ok(canonical)
    }
}

pub fn validate_target(target: &Path, ctx: &GuardContext<'_>) -> Result<PathBuf, AppError> {
    PathGuard::validate(target, ctx)
}

pub fn normalize_key(path: &Path) -> String {
    let mut s = path.to_string_lossy().replace('/', "\\");
    for prefix in [r"\\?\UNC\", r"\\?\", r"\\.\"] {
        if let Some(stripped) = s.strip_prefix(prefix) {
            s = if prefix == r"\\?\UNC\" {
                format!(r"\\{}", stripped)
            } else {
                stripped.to_string()
            };
            break;
        }
    }
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s.to_lowercase()
}

pub fn path_components(key: &str) -> Vec<String> {
    key.split('\\')
        .filter(|p| !p.is_empty())
        .map(|p| p.to_string())
        .collect()
}

/// Component-aware containment test (avoids `C:\foo` matching `C:\foobar`).
pub fn is_within(child: &str, root: &str) -> bool {
    let c = path_components(child);
    let r = path_components(root);
    if r.len() > c.len() {
        return false;
    }
    r.iter().zip(c.iter()).all(|(a, b)| a == b)
}

pub(crate) fn validate_system_path(key: &str) -> Result<(), AppError> {
    let parts = path_components(key);
    // A drive root (`C:\`) has no components beyond the prefix and is never a
    // valid cleanup target. Direct children of a drive root are allowed when
    // they are ordinary folders: `D:\node_modules` is a legitimate scan root
    // child. Sensitive first-level folders are still rejected below.
    if parts.len() < 2 {
        return Err(AppError::UnsafeDeleteTarget(
            "Drive root cannot be deleted.".to_string(),
        ));
    }

    let first_level_system_roots = ["users", "documents and settings", "config.msi"];
    if parts.len() == 2 && first_level_system_roots.contains(&parts[1].as_str()) {
        return Err(AppError::UnsafeDeleteTarget(format!(
            "System directory is protected: {}",
            key
        )));
    }

    let system_roots = [
        "windows",
        "program files",
        "program files (x86)",
        "programdata",
        "system volume information",
        "$recycle.bin",
        "recovery",
        "msocache",
        "boot",
        "perflogs",
        "system32",
        "syswow64",
    ];
    // Check every path component, not just the first one below the drive root:
    // `C:\Users\me\AppData\Windows` must be rejected just like `C:\Windows`.
    for part in parts.iter().skip(1) {
        if system_roots.contains(&part.as_str()) {
            return Err(AppError::UnsafeDeleteTarget(format!(
                "System directory is protected: {}",
                key
            )));
        }
    }

    if let Ok(profile) = std::env::var("USERPROFILE") {
        let profile_key = normalize_key(Path::new(&profile));
        if key == profile_key {
            return Err(AppError::UnsafeDeleteTarget(
                "User profile root cannot be deleted.".to_string(),
            ));
        }
        let parent = Path::new(key).parent().map(normalize_key);
        if parent.as_deref() == Some(profile_key.as_str()) {
            return Err(AppError::UnsafeDeleteTarget(
                "Direct children of user profile root cannot be deleted.".to_string(),
            ));
        }
    }

    Ok(())
}

fn validate_protected_paths(key: &str, protected: &[String]) -> Result<(), AppError> {
    for raw in protected {
        // Resolve the configured path too: a user can paste an 8.3 short path
        // (`C:\Users\RUNNER~1\...`) or a path with a different drive-letter
        // case, while `key` is always canonical. Comparing raw forms let a
        // protected folder slip through when the two spellings differed.
        let resolved =
            fs::canonicalize(Path::new(raw)).unwrap_or_else(|_| Path::new(raw).to_path_buf());
        let protected_key = normalize_key(&resolved);
        if protected_key.is_empty() {
            continue;
        }
        // Both directions matter. A target inside a protected folder must be
        // rejected, and so must a parent folder that *contains* a protected
        // folder: deleting `.venv` would otherwise take a user-protected
        // `.venv\keep` with it.
        if key == protected_key || is_within(key, &protected_key) || is_within(&protected_key, key)
        {
            return Err(AppError::UnsafeDeleteTarget(format!(
                "Target is in user protected paths: {}",
                raw
            )));
        }
    }
    Ok(())
}

pub(crate) fn validate_ancestors(target: &Path, scan_root: &Path) -> Result<(), AppError> {
    let mut current = target.parent();
    while let Some(dir) = current {
        if let Ok(meta) = fs::symlink_metadata(dir) {
            if meta.file_type().is_symlink() {
                return Err(AppError::UnsafeDeleteTarget(format!(
                    "Parent directory is a symlink: {}",
                    dir.display()
                )));
            }
        }
        if directory_prefix(dir) == directory_prefix(scan_root) {
            break;
        }
        current = dir.parent();
    }
    Ok(())
}

fn directory_prefix(path: &Path) -> String {
    // Comparison helper that keeps the check independent of drive-letter case.
    path.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().to_lowercase()),
            Component::RootDir => Some("\\".to_string()),
            Component::Prefix(p) => Some(p.as_os_str().to_string_lossy().to_lowercase()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\\")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is_blocked(key: &str) -> bool {
        let normalized = normalize_key(Path::new(key));
        matches!(
            validate_system_path(&normalized),
            Err(AppError::UnsafeDeleteTarget(_))
        )
    }

    fn is_allowed(key: &str) -> bool {
        let normalized = normalize_key(Path::new(key));
        validate_system_path(&normalized).is_ok()
    }

    #[test]
    fn drive_root_is_blocked() {
        assert!(is_blocked("C:\\"));
    }

    #[test]
    fn windows_directory_is_blocked() {
        assert!(is_blocked("C:\\Windows\\Temp"));
    }

    #[test]
    fn program_files_is_blocked() {
        assert!(is_blocked("C:\\Program Files\\App\\cache"));
    }

    #[test]
    fn system32_is_blocked() {
        assert!(is_blocked("D:\\Windows\\System32\\foo"));
    }

    #[test]
    fn system_directory_nested_below_user_profile_is_blocked() {
        // Regression for Y-9: only checking the first component missed this.
        assert!(is_blocked("C:\\Users\\me\\AppData\\Windows\\foo"));
    }

    #[test]
    fn programdata_nested_is_blocked() {
        assert!(is_blocked("C:\\Users\\me\\tmp\\ProgramData\\foo"));
    }

    #[test]
    fn shallow_ordinary_path_is_allowed() {
        // Depth alone is not a safety signal. A single folder below a drive
        // root can be a legitimate cleanup target; only roots and system
        // directories are rejected.
        assert!(is_allowed("C:\\Temp"));
    }

    #[test]
    fn drive_root_child_node_modules_is_allowed() {
        assert!(is_allowed("D:\\node_modules"));
    }

    #[test]
    fn users_root_child_is_blocked() {
        // `C:\Users` and `D:\Users` are first-level sensitive roots.
        assert!(is_blocked("C:\\Users"));
        assert!(is_blocked("D:\\Users"));
    }

    #[test]
    fn drive_root_recycle_bin_child_is_blocked() {
        assert!(is_blocked("D:\\$Recycle.Bin"));
    }

    #[test]
    fn ordinary_project_node_modules_is_allowed() {
        assert!(is_allowed("C:\\Code\\my-app\\node_modules"));
    }

    #[test]
    fn protected_descendant_blocks_parent_deletion() {
        // Regression for H4: a protected folder *inside* the cleanup target
        // must block the whole subtree delete.
        let target = normalize_key(Path::new("D:\\proj\\.venv"));
        let protected = vec!["D:\\proj\\.venv\\keep".to_string()];
        assert!(matches!(
            validate_protected_paths(&target, &protected),
            Err(AppError::UnsafeDeleteTarget(_))
        ));
    }

    #[test]
    fn sibling_protected_path_does_not_block() {
        let target = normalize_key(Path::new("D:\\proj\\.venv"));
        let protected = vec!["D:\\proj\\keep".to_string()];
        assert!(validate_protected_paths(&target, &protected).is_ok());
    }

    #[test]
    fn ordinary_target_directory_is_allowed() {
        assert!(is_allowed("D:\\work\\proj\\target\\debug"));
    }

    #[test]
    fn appdata_cache_is_allowed() {
        assert!(is_allowed("C:\\Users\\me\\AppData\\Local\\npm-cache"));
    }

    #[test]
    fn name_containing_windows_substring_is_allowed() {
        // Component-aware check: `WindowsApps` is not the `windows` component.
        assert!(is_allowed("C:\\Users\\me\\WindowsApps\\cache"));
    }

    #[test]
    fn recycle_bin_component_is_blocked() {
        assert!(is_blocked("C:\\$Recycle.Bin\\S-1-5-21"));
    }
}
