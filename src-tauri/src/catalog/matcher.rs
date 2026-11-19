use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

use super::model::{Confidence, GitPolicy, MarkerMode, Rule, SafetyClass};
use super::project::marker_exists;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitState {
    NotRepository,
    Unknown,
    Clean,
    TrackedClean,
    TrackedModified,
    UntrackedOnly,
}

impl GitState {
    pub fn blocks_auto_removal(self) -> bool {
        matches!(
            self,
            GitState::TrackedClean | GitState::TrackedModified | GitState::Unknown
        )
    }
}

#[derive(Debug, Clone, Default)]
pub struct Evidence {
    pub marker_hits: Vec<String>,
    pub content_hits: Vec<String>,
    pub missing_markers: Vec<String>,
    pub git_repo: bool,
    pub git_state: Option<GitState>,
}

impl Evidence {
    pub fn score(&self) -> u8 {
        // The matched name is always the first evidence source.
        let mut score = 1u8;
        if !self.marker_hits.is_empty() {
            score += 1;
        }
        if !self.content_hits.is_empty() {
            score += 1;
        }
        score
    }

    pub fn codes(&self) -> Vec<String> {
        let mut codes = vec!["NAME_MATCH".to_string()];
        if !self.marker_hits.is_empty() {
            codes.push("PROJECT_MARKER".to_string());
        }
        if !self.content_hits.is_empty() {
            codes.push("CONTENT_SIGNATURE".to_string());
        }
        if !self.missing_markers.is_empty() {
            codes.push("MISSING_MARKER".to_string());
        }
        if self.git_repo {
            codes.push("GIT_REPOSITORY".to_string());
        }
        codes
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Classification {
    pub safety_class: SafetyClass,
    pub confidence: Confidence,
    pub warnings: Vec<String>,
    pub selectable: bool,
}

/// Collects filesystem evidence for a candidate directory or file.
///
/// Marker evidence is only accepted from the resolved project root or its
/// enclosing workspace root. Never from arbitrary ancestors: a stray
/// `package.json` in the user's home directory must not make an unrelated
/// folder look like project output.
pub fn collect_evidence(
    rule: &Rule,
    candidate: &Path,
    project_root: Option<&Path>,
    workspace_root: Option<&Path>,
    git_state: Option<GitState>,
) -> Evidence {
    let mut evidence = Evidence {
        git_repo: git_state
            .map(|s| s != GitState::NotRepository)
            .unwrap_or(false),
        git_state,
        ..Default::default()
    };

    let roots: Vec<&Path> = [project_root, workspace_root]
        .into_iter()
        .flatten()
        .collect();

    for marker in &rule.markers {
        let found = roots.iter().any(|root| marker_exists(root, marker));
        if found {
            evidence.marker_hits.push(marker.clone());
        } else {
            evidence.missing_markers.push(marker.clone());
        }
    }

    if rule.kind == super::model::TargetKind::Directory && candidate.is_dir() {
        for signature in &rule.content {
            if marker_exists(candidate, signature) {
                evidence.content_hits.push(signature.clone());
            }
        }
    }

    evidence
}

/// Applies safety rules. Unknown or under-evidenced targets are never promoted
/// into an automatically selected class.
pub fn classify(rule: &Rule, evidence: &Evidence) -> Classification {
    let mut warnings: Vec<String> = Vec::new();

    if rule.is_protected() {
        return Classification {
            safety_class: SafetyClass::Keep,
            confidence: Confidence::High,
            warnings: vec!["PROTECTED_TARGET".to_string()],
            selectable: false,
        };
    }

    let mut safety = rule.safety;
    let mut confidence = rule.confidence;

    // Non-generic targets with internal content signatures (for example a real
    // `node_modules` containing `.package-lock.json` or `.pnpm` inside a
    // scanned monorepo subfolder whose root `package.json` sits above the scan
    // boundary) are still positively verified by their content signatures.
    let satisfied_by_content = !rule.generic_name && !evidence.content_hits.is_empty();
    if !rule.markers.is_empty() && evidence.marker_hits.is_empty() && !satisfied_by_content {
        warnings.push("NO_PROJECT_MARKER".to_string());
        safety = SafetyClass::Review;
        confidence = Confidence::Low;
    }

    if rule.marker_mode == MarkerMode::All && !evidence.missing_markers.is_empty() {
        warnings.push("INCOMPLETE_PROJECT_MARKERS".to_string());
        safety = SafetyClass::Review;
        confidence = Confidence::Low;
    }

    if evidence.score() < rule.min_evidence {
        warnings.push("INSUFFICIENT_EVIDENCE".to_string());
        safety = SafetyClass::Review;
        confidence = Confidence::Low;
    }

    if rule.generic_name && evidence.marker_hits.is_empty() {
        warnings.push("GENERIC_NAME_UNVERIFIED".to_string());
        safety = SafetyClass::Review;
        confidence = Confidence::Low;
    }

    if rule.git_policy == GitPolicy::DenyTracked {
        match evidence.git_state {
            Some(GitState::TrackedClean) | Some(GitState::TrackedModified) => {
                warnings.push("GIT_TRACKED_CONTENT".to_string());
                safety = SafetyClass::Review;
                confidence = Confidence::Medium;
            }
            Some(GitState::Unknown) => {
                warnings.push("GIT_STATE_UNKNOWN".to_string());
                safety = SafetyClass::Review;
                confidence = Confidence::Low;
            }
            _ => {}
        }
    }

    if safety == SafetyClass::Safe && confidence == Confidence::Low {
        safety = SafetyClass::Review;
    }

    Classification {
        safety_class: safety,
        confidence,
        warnings,
        selectable: safety.selectable(),
    }
}

/// Reads a marker file without loading large content.
pub fn has_marker(dir: &Path, name: &str) -> bool {
    fs::metadata(dir.join(name)).is_ok()
}
