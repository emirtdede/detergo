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
            .map_err(|e| AppError::InvalidPath(format!("Meta veri okunamadı: {}", e)))?;
        if meta.file_type().is_symlink() {
            return Err(AppError::UnsafeDeleteTarget(format!(
                "Sembolik bağlantı hedefi silinemez: {}",
                target.display()
            )));
        }
        // A reparse point that is not a symlink (e.g. OneDrive placeholder) is
        // never deleted either: the real payload may live elsewhere.
        if is_reparse_point(target) {
            return Err(AppError::UnsafeDeleteTarget(format!(
                "Reparse point hedefi silinemez: {}",
                target.display()
            )));
        }

        let canonical = fs::canonicalize(target)
            .map_err(|e| AppError::InvalidPath(format!("Canonicalize başarısız: {}", e)))?;
        let target_key = normalize_key(&canonical);

        if target_key.starts_with(r"\\") {
            return Err(AppError::UnsafeDeleteTarget(
                "UNC veya aygıt yolları silinemez.".to_string(),
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
                    "Tarama kökü silinemez.".to_string(),
                ));
            }
            return Err(AppError::UnsafeDeleteTarget(format!(
                "Hedef tarama kökünün dışında: {}",
                canonical.display()
            )));
        };
        let root_key = normalize_key(&root_canonical);

        validate_system_path(&target_key)?;
        validate_protected_paths(&target_key, ctx.protected_paths)?;
        validate_ancestors(&canonical, &root_canonical)?;

        if is_remote_path(&canonical) {
            return Err(AppError::UnsafeDeleteTarget(
                "Ağ konumlarındaki hedefler güvenli biçimde çöp kutusuna taşınamaz.".to_string(),
            ));
        }

        let name = canonical
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if name.is_empty() {
            return Err(AppError::UnsafeDeleteTarget("Geçersiz hedef adı.".to_string()));
        }
        if is_hard_protected_name(&name) {
            return Err(AppError::UnsafeDeleteTarget(format!(
                "Korunan ad silinemez: {}",
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
                    "Korunan dizin bileşeni içeriyor: {}",
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
    if parts.len() < 2 {
        return Err(AppError::UnsafeDeleteTarget(
            "Sürücü kökü silinemez.".to_string(),
        ));
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
    if parts.len() >= 2 {
        let first = parts[1].as_str();
        if system_roots.contains(&first) {
            return Err(AppError::UnsafeDeleteTarget(format!(
                "Sistem dizini korumalı: {}",
                key
            )));
        }
    }
    for part in &parts {
        if part == "system volume information" || part == "$recycle.bin" {
            return Err(AppError::UnsafeDeleteTarget(
                "Sistem/çöp kutusu dizini korumalı.".to_string(),
            ));
        }
    }
    if parts.len() < 3 {
        return Err(AppError::UnsafeDeleteTarget(format!(
            "Yol güvenlik derinliği yetersiz: {}",
            key
        )));
    }

    if let Ok(profile) = std::env::var("USERPROFILE") {
        let profile_key = normalize_key(Path::new(&profile));
        if key == profile_key {
            return Err(AppError::UnsafeDeleteTarget(
                "Kullanıcı profil kökü silinemez.".to_string(),
            ));
        }
        let parent = Path::new(key).parent().map(normalize_key);
        if parent.as_deref() == Some(profile_key.as_str()) {
            return Err(AppError::UnsafeDeleteTarget(
                "Kullanıcı profil kökünün doğrudan alt öğesi silinemez.".to_string(),
            ));
        }
    }

    Ok(())
}

fn validate_protected_paths(key: &str, protected: &[String]) -> Result<(), AppError> {
    for raw in protected {
        let protected_key = normalize_key(Path::new(raw));
        if protected_key.is_empty() {
            continue;
        }
        if key == protected_key || is_within(key, &protected_key) {
            return Err(AppError::UnsafeDeleteTarget(format!(
                "Hedef kullanıcı koruma listesinde: {}",
                raw
            )));
        }
    }
    Ok(())
}

fn validate_ancestors(target: &Path, scan_root: &Path) -> Result<(), AppError> {
    let mut current = target.parent();
    while let Some(dir) = current {
        if let Ok(meta) = fs::symlink_metadata(dir) {
            if meta.file_type().is_symlink() {
                return Err(AppError::UnsafeDeleteTarget(format!(
                    "Üst dizin sembolik bağlantı: {}",
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
