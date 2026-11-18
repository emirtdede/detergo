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

#[test]
fn recently_modified_finds_file_after_two_hundred_entries() {
    use std::time::{Duration, SystemTime};

    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let old = SystemTime::now() - Duration::from_secs(86_400);

    for index in 0..250 {
        let path = root.join(format!("a{:03}.txt", index));
        std::fs::write(&path, b"x").unwrap();
        filetime::set_file_mtime(&path, filetime::FileTime::from_system_time(old)).unwrap();
    }

    // The recent file sorts after the 250 stale entries on NTFS, so it is only
    // reached once the walk passes the old 200-entry cap.
    let recent = root.join("zz-recent.txt");
    std::fs::write(&recent, b"x").unwrap();

    // The directory entry itself must look old; otherwise the check would
    // return true on the root alone and prove nothing about the cap.
    filetime::set_file_mtime(root, filetime::FileTime::from_system_time(old)).unwrap();

    assert!(super::root_locator::recently_modified(root, 3_600));
}

#[test]
fn recently_modified_returns_false_for_an_old_tree() {
    use std::time::{Duration, SystemTime};

    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let old = SystemTime::now() - Duration::from_secs(86_400);

    for index in 0..250 {
        let path = root.join(format!("a{:03}.txt", index));
        std::fs::write(&path, b"x").unwrap();
        filetime::set_file_mtime(&path, filetime::FileTime::from_system_time(old)).unwrap();
    }
    filetime::set_file_mtime(root, filetime::FileTime::from_system_time(old)).unwrap();

    assert!(!super::root_locator::recently_modified(root, 3_600));
}

#[test]
fn agent_exclusion_matches_relative_components_only() {
    use std::collections::HashSet;
    use std::path::Path;

    let exclusions: HashSet<String> = ["node_modules".to_string()].into_iter().collect();
    let root = Path::new(r"D:\Users\me\.cache\tool");

    // A file directly below an excluded folder name inside the root is skipped.
    assert!(super::path_is_excluded(
        Path::new(r"D:\Users\me\.cache\tool\node_modules"),
        root,
        &exclusions
    ));
    assert!(super::path_is_excluded(
        Path::new(r"D:\Users\me\.cache\tool\logs\node_modules"),
        root,
        &exclusions
    ));
    // A sibling with a similar name is not excluded.
    assert!(!super::path_is_excluded(
        Path::new(r"D:\Users\me\.cache\tool\nodes"),
        root,
        &exclusions
    ));
    // The root's own path components are never treated as exclusions.
    assert!(!super::path_is_excluded(
        Path::new(r"D:\Users\me\.cache\tool"),
        root,
        &exclusions
    ));
}

#[test]
fn custom_root_exclusion_ignores_drive_prefix() {
    use std::collections::HashSet;
    use std::path::Path;

    let exclusions: HashSet<String> = ["temp".to_string()].into_iter().collect();
    assert!(super::components_are_excluded(
        Path::new(r"D:\Temp\my-tool"),
        &exclusions
    ));
    assert!(!super::components_are_excluded(
        Path::new(r"D:\work\my-tool"),
        &exclusions
    ));
    assert!(!super::components_are_excluded(
        Path::new(r"D:\work\my-tool"),
        &HashSet::new()
    ));
}
