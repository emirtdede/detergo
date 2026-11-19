//! Root resolution and the audited allowlist for system cleanup.
//!
//! The generic [`crate::safety::PathGuard`] is intentionally *not* relaxed for
//! these paths: it exists to keep deletions inside a scan root. System cleanup
//! is a different trust boundary, so it gets its own gate with a much smaller
//! surface — a fixed set of roots and a refusal to touch anything that
//! canonicalises outside them.

use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::system_cleaner::SystemActionId;

/// Roots that are never acceptable, even if a future edit lists them by
/// accident. Compared after canonicalisation, case-insensitively.
const FORBIDDEN_ROOTS: &[&str] = &[
    r"c:\",
    r"c:\windows",
    r"c:\windows\system32",
    r"c:\windows\syswow64",
    r"c:\programdata",
    r"c:\programdata\microsoft",
    r"c:\programdata\microsoft\windows",
    r"c:\users",
    r"c:\program files",
    r"c:\program files (x86)",
];

fn windows_dir() -> PathBuf {
    std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
}

fn program_data() -> PathBuf {
    std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"))
}

/// The per-user temp directory that Windows itself uses.
///
/// `%TEMP%` can be redirected (sometimes to a network share); the local
/// `%LOCALAPPDATA%\Temp` folder is what the user expects a cleaner to empty and
/// is always on a local volume.
pub fn user_temp_root() -> Option<PathBuf> {
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        return Some(PathBuf::from(local).join("Temp"));
    }
    std::env::var_os("TEMP").map(PathBuf::from)
}

pub fn error_report_root() -> PathBuf {
    program_data().join("Microsoft").join("Windows").join("WER")
}

/// The root whose *contents* an action deletes, or `None` for the tool-driven
/// actions that own their own targets.
pub fn root_for(id: SystemActionId) -> Option<PathBuf> {
    Some(match id {
        SystemActionId::UserTemp => user_temp_root()?,
        SystemActionId::WindowsTemp => windows_dir().join("Temp"),
        SystemActionId::Prefetch => windows_dir().join("Prefetch"),
        SystemActionId::WindowsUpdate => {
            windows_dir().join("SoftwareDistribution").join("Download")
        }
        SystemActionId::ErrorReports => error_report_root(),
        SystemActionId::RecycleBin
        | SystemActionId::DiskCleanup
        | SystemActionId::ComponentStore => return None,
    })
}

fn normalize_for_compare(path: &Path) -> String {
    path.to_string_lossy()
        .trim_end_matches(['\\', '/'])
        .to_lowercase()
}

fn is_forbidden(canonical: &Path) -> bool {
    let text = normalize_for_compare(canonical);
    if text.is_empty() {
        return true;
    }
    FORBIDDEN_ROOTS
        .iter()
        .any(|root| text == normalize_for_compare(Path::new(root)))
}

/// Canonicalises a root and proves that it is the expected location.
///
/// A junction planted at `C:\Windows\Temp` canonicalises elsewhere and is
/// rejected; a deleted folder becomes `notPresent` rather than an empty string.
pub fn verify_root(expected: &Path) -> Result<PathBuf, AppError> {
    // `symlink_metadata` first: `exists()` follows a link, and a link planted at
    // the expected location must be rejected, not silently resolved.
    let metadata = std::fs::symlink_metadata(expected).map_err(|_| {
        AppError::PathNotFound("The cleanup target does not exist on this system.".to_string())
    })?;
    if metadata.file_type().is_symlink() || crate::platform::is_reparse_point(expected) {
        return Err(AppError::UnsafeDeleteTarget(
            "The cleanup target is a link; refusing to follow it.".to_string(),
        ));
    }
    if !metadata.is_dir() {
        return Err(AppError::InvalidPath(
            "The cleanup target is not a directory.".to_string(),
        ));
    }

    let canonical = std::fs::canonicalize(expected)
        .map_err(|e| AppError::InvalidPath(format!("Could not resolve the cleanup target: {e}")))?;
    if !canonical.is_dir() {
        return Err(AppError::InvalidPath(
            "The cleanup target is not a directory.".to_string(),
        ));
    }
    if canonical.components().count() < 3 {
        return Err(AppError::UnsafeDeleteTarget(
            "The cleanup target is too close to the drive root.".to_string(),
        ));
    }
    if is_forbidden(&canonical) {
        return Err(AppError::UnsafeDeleteTarget(
            "The cleanup target is a protected system location.".to_string(),
        ));
    }
    Ok(canonical)
}

/// True when the canonical root sits inside one of the audited roots. Used by
/// tests and by the execute path to abort a walk that escaped through a mount
/// point created after validation.
pub fn is_inside_audited_root(path: &Path) -> bool {
    let text = normalize_for_compare(path);
    [
        SystemActionId::UserTemp,
        SystemActionId::WindowsTemp,
        SystemActionId::Prefetch,
        SystemActionId::WindowsUpdate,
        SystemActionId::ErrorReports,
    ]
    .iter()
    .filter_map(|id| root_for(*id))
    .filter_map(|root| std::fs::canonicalize(root).ok())
    .any(|root| {
        let root_text = normalize_for_compare(&root);
        text == root_text || text.starts_with(&format!("{root_text}\\"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_drive_and_windows_roots() {
        for bad in [r"C:\", r"C:\Windows", r"C:\Windows\System32", r"C:\Users"] {
            assert!(is_forbidden(Path::new(bad)), "{bad} must be forbidden");
        }
    }

    #[test]
    fn accepts_a_cache_root() {
        assert!(!is_forbidden(Path::new(r"C:\Windows\Temp")));
        assert!(!is_forbidden(Path::new(r"C:\Windows\Prefetch")));
    }

    #[test]
    fn rejects_a_root_that_does_not_exist() {
        let missing = std::env::temp_dir().join("dev-cleaner-definitely-missing-root");
        let result = verify_root(&missing);
        assert!(matches!(result, Err(AppError::PathNotFound(_))));
    }
}
