use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::safety::{validate_target, GuardContext};

pub struct PermanentDeleteService;

impl PermanentDeleteService {
    pub fn new() -> Self {
        Self
    }

    pub fn delete(&self, raw_path: &Path, ctx: &GuardContext<'_>) -> Result<PathBuf, AppError> {
        let canonical = validate_target(raw_path, ctx)?;

        let meta = fs::symlink_metadata(&canonical)
            .map_err(|e| AppError::PermanentDeleteFailed(e.to_string()))?;

        if meta.is_dir() {
            fs::remove_dir_all(&canonical).map_err(|e| {
                AppError::PermanentDeleteFailed(format!("{}: {}", canonical.display(), e))
            })?;
        } else {
            fs::remove_file(&canonical).map_err(|e| {
                AppError::PermanentDeleteFailed(format!("{}: {}", canonical.display(), e))
            })?;
        }

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
