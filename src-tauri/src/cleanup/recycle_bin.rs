use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::safety::{validate_target, GuardContext};

pub struct RecycleBinService;

impl RecycleBinService {
    pub fn new() -> Self {
        Self
    }

    /// Moves a validated target to the Windows Recycle Bin.
    ///
    /// There is deliberately no permanent fallback: if the recycle operation
    /// fails the caller receives an error and nothing is deleted.
    pub fn recycle(
        &self,
        raw_path: &Path,
        ctx: &GuardContext<'_>,
    ) -> Result<PathBuf, AppError> {
        let canonical = validate_target(raw_path, ctx)?;

        trash::delete(&canonical).map_err(|e| {
            AppError::RecycleBinFailed(format!(
                "Klasör çöp kutusuna taşınamadı ({}): {}",
                canonical.display(),
                e
            ))
        })?;

        if canonical.exists() {
            return Err(AppError::RecycleBinFailed(
                "Çöp kutusu işlemi sonrası hedef hâlâ mevcut.".to_string(),
            ));
        }

        Ok(canonical)
    }
}

impl Default for RecycleBinService {
    fn default() -> Self {
        Self::new()
    }
}
