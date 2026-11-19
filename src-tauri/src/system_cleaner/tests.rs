//! Unit and integration tests for the system cleaner.

use std::fs;

use crate::scanner::cancellation::CancellationToken;
use crate::system_cleaner::actions::{spec, Engine};
use crate::system_cleaner::delete::delete_contents;
use crate::system_cleaner::{profile_actions, SystemActionId, SystemAutomationConfig};

/// The quick profile is what an unattended schedule runs most often, so it
/// stays small and never includes a review-only action.
#[test]
fn quick_profile_is_minimal_and_never_review_only() {
    let quick = profile_actions("quick");
    assert_eq!(
        quick,
        vec![SystemActionId::UserTemp, SystemActionId::WindowsUpdate]
    );
    for id in &quick {
        assert_ne!(
            spec(*id).safety,
            crate::system_cleaner::SystemSafety::Review,
            "{} must not need a human review to be automated",
            id.as_str()
        );
        assert_ne!(*id, SystemActionId::RecycleBin);
    }
}

#[test]
fn deep_profile_covers_every_engine() {
    let engines: Vec<Engine> = profile_actions("deep")
        .into_iter()
        .map(|id| spec(id).engine)
        .collect();
    assert!(engines.contains(&Engine::Native));
    assert!(engines.contains(&Engine::CleanMgr));
    assert!(engines.contains(&Engine::Dism));
    assert!(
        !engines.contains(&Engine::RecycleBin),
        "emptying the Recycle Bin must never be automatic"
    );
}

#[test]
fn unknown_profiles_fall_back_to_the_safest_set() {
    assert_eq!(
        profile_actions("delete-everything"),
        profile_actions("quick")
    );
}

#[test]
fn delete_contents_keeps_the_root_and_removes_the_tree() {
    let dir = tempfile::tempdir().expect("temp dir");
    let root = dir.path().join("cache");
    let nested = root.join("a").join("b");
    fs::create_dir_all(&nested).expect("nested");
    fs::write(nested.join("payload.bin"), b"1234").expect("write");
    fs::write(root.join("readonly.txt"), b"xx").expect("write");
    let mut permissions = fs::metadata(root.join("readonly.txt"))
        .expect("meta")
        .permissions();
    permissions.set_readonly(true);
    fs::set_permissions(root.join("readonly.txt"), permissions).expect("readonly");

    let token = CancellationToken::new();
    let outcome = delete_contents(&root, &token).expect("delete");

    assert!(root.exists(), "the root itself must survive");
    assert_eq!(fs::read_dir(&root).expect("read").count(), 0);
    assert_eq!(outcome.deleted_files, 2);
    assert_eq!(outcome.freed_bytes, 6);
}

#[cfg(windows)]
#[test]
fn delete_contents_skips_a_locked_file_and_reports_it() {
    use std::os::windows::fs::OpenOptionsExt;

    let dir = tempfile::tempdir().expect("temp dir");
    let root = dir.path().join("cache");
    fs::create_dir_all(&root).expect("root");
    let locked = root.join("locked.txt");
    fs::write(&locked, b"held").expect("write");

    let handle = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&locked)
        .expect("open");
    // Without FILE_SHARE_DELETE the handle-based delete sees a sharing
    // violation and reports a skip.
    let token = CancellationToken::new();
    let outcome = delete_contents(&root, &token).expect("delete");

    assert_eq!(outcome.skipped, 1);
    assert!(outcome.skipped_sample.contains(&"locked.txt".to_string()));
    assert!(locked.exists());
    drop(handle);
}

#[cfg(windows)]
#[test]
fn delete_contents_never_follows_a_directory_link() {
    let dir = tempfile::tempdir().expect("temp dir");
    let root = dir.path().join("cache");
    let outside = dir.path().join("outside");
    fs::create_dir_all(&root).expect("root");
    fs::create_dir_all(&outside).expect("outside");
    let survivor = outside.join("survivor.txt");
    fs::write(&survivor, b"keep").expect("write");

    let link = root.join("link");
    let made = std::os::windows::fs::symlink_dir(&outside, &link).is_ok()
        || std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&outside)
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false);
    if !made {
        return;
    }

    let token = CancellationToken::new();
    delete_contents(&root, &token).expect("delete");

    assert!(!link.exists());
    assert!(survivor.exists(), "the link target must survive");
}

#[test]
fn delete_contents_cancels_between_entries() {
    let dir = tempfile::tempdir().expect("temp dir");
    let root = dir.path().join("cache");
    fs::create_dir_all(&root).expect("root");
    for index in 0..5 {
        fs::write(root.join(format!("file-{index}.bin")), b"x").expect("write");
    }

    let token = CancellationToken::new();
    token.cancel();
    let outcome = delete_contents(&root, &token).expect("delete");

    assert!(outcome.incomplete);
    assert_eq!(fs::read_dir(&root).expect("read").count(), 5);
}

#[test]
fn automation_defaults_are_safe() {
    let config = SystemAutomationConfig::default();
    assert!(!config.enabled);
    assert_eq!(config.profile, "quick");
    assert_eq!(config.frequency, "weekly");
}

#[test]
fn schedule_time_is_validated_without_panicking() {
    for (input, expected) in [
        ("09:30", "09:30"),
        ("23:59", "23:59"),
        ("24:00", "12:00"),
        ("9:30", "12:00"),
        ("ab:cd", "12:00"),
        ("１２:００", "12:00"),
    ] {
        let mut config = SystemAutomationConfig {
            time: input.to_string(),
            ..Default::default()
        };
        config.normalize();
        assert_eq!(config.time, expected, "input {input}");
    }
}
