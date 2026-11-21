use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::catalog::project::marker_exists;
use crate::catalog::Rule;
use crate::error::AppError;
use crate::safety::is_hard_protected_name;

/// Evidence captured at scan time and re-checked before deletion.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceSnapshot {
    pub rule_id: String,
    pub target_name: String,
    pub project_root: Option<String>,
    #[serde(default)]
    pub workspace_root: Option<String>,
    pub marker_hits: Vec<String>,
    pub content_hits: Vec<String>,
}

/// Re-validates that the target is still the same kind of artifact that was
/// classified during the scan. Any inconsistency aborts the deletion.
pub fn revalidate_evidence(
    rule: &Rule,
    target: &Path,
    snapshot: &EvidenceSnapshot,
) -> Result<(), AppError> {
    if rule.id != snapshot.rule_id {
        return Err(AppError::UnsafeDeleteTarget(
            "Rule ID does not match scan record.".to_string(),
        ));
    }
    if rule.is_protected() {
        return Err(AppError::UnsafeDeleteTarget(
            "Protected target cannot be deleted.".to_string(),
        ));
    }

    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if name.to_lowercase() != snapshot.target_name.to_lowercase() {
        return Err(AppError::UnsafeDeleteTarget(
            "Target name does not match scan record.".to_string(),
        ));
    }
    if !rule.matches_name(&name) {
        return Err(AppError::UnsafeDeleteTarget(
            "Target name does not match catalog rule.".to_string(),
        ));
    }
    if is_hard_protected_name(&name) {
        return Err(AppError::UnsafeDeleteTarget(
            "Protected name cannot be deleted.".to_string(),
        ));
    }

    let roots: Vec<PathBuf> = [
        snapshot.project_root.as_ref(),
        snapshot.workspace_root.as_ref(),
    ]
    .into_iter()
    .flatten()
    .map(PathBuf::from)
    .collect();

    if !roots.is_empty() {
        if let Some(project_root) = &snapshot.project_root {
            if !Path::new(project_root).exists() {
                return Err(AppError::UnsafeDeleteTarget(
                    "Project root no longer exists; plan is invalid.".to_string(),
                ));
            }
        }
        for marker in &snapshot.marker_hits {
            let found = roots.iter().any(|root| marker_exists(root, marker));
            if !found {
                return Err(AppError::UnsafeDeleteTarget(format!(
                    "Project evidence changed ({}); plan is invalid.",
                    marker
                )));
            }
        }
    }

    // Content signatures live inside the target itself and must always be
    // re-validated even when no project/workspace root was recorded.
    for signature in &snapshot.content_hits {
        if !marker_exists(target, signature) {
            return Err(AppError::UnsafeDeleteTarget(format!(
                "Target content changed ({}); plan is invalid.",
                signature
            )));
        }
    }

    Ok(())
}
