use super::agent_spec::*;
use crate::catalog::model::{CleanupMethod, SafetyClass};

#[test]
fn codex_targets_are_all_protected() {
    for spec in CODEX_TARGETS {
        assert!(spec.protected, "{} must be protected", spec.rule_id);
        assert_eq!(spec.cleanup, CleanupMethod::None);
    }
}

#[test]
fn claude_checkpoints_and_settings_are_protected() {
    for rel in ["file-history", "projects", "settings.json"] {
        let spec = CLAUDE_HOME_TARGETS
            .iter()
            .find(|s| s.rel == rel)
            .expect("target must exist");
        assert_eq!(spec.safety, SafetyClass::Keep);
        assert!(spec.protected);
    }
}

#[test]
fn antigravity_brain_is_protected_and_recordings_require_idle() {
    let brain = ANTIGRAVITY_DATA_TARGETS
        .iter()
        .find(|s| s.rel == "brain")
        .unwrap();
    assert_eq!(brain.safety, SafetyClass::Keep);
    let recordings = ANTIGRAVITY_DATA_TARGETS
        .iter()
        .find(|s| s.rel == "browser_recordings")
        .unwrap();
    assert_eq!(recordings.safety, SafetyClass::Review);
    assert!(recordings.requires_idle);
    assert!(!recordings.protected);
}

#[test]
fn unknown_provider_has_no_targets() {
    assert!(specs_for("unknown").is_empty());
}
