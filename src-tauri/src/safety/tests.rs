use super::git_guard::ensure_not_tracked;
use super::path_guard::is_within;
use super::*;
use crate::catalog::CatalogIndex;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn single(root: &Path) -> GuardContext<'static> {
    // Leaked only in tests: keeps the guard context simple to build.
    let roots: &'static [PathBuf] = Box::leak(vec![root.to_path_buf()].into_boxed_slice());
    GuardContext {
        scan_roots: roots,
        protected_paths: &[],
    }
}

#[test]
fn path_guard_rejects_targets_outside_the_scan_root() {
    let root = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    let target = other.path().join("proj").join("node_modules");
    fs::create_dir_all(&target).unwrap();

    assert!(validate_target(&target, &single(root.path())).is_err());
}

#[test]
fn path_guard_rejects_scan_root_and_protected_names() {
    let root = tempfile::tempdir().unwrap();
    let proj = root.path().join("proj");
    fs::create_dir_all(&proj).unwrap();

    assert!(validate_target(root.path(), &single(root.path())).is_err());

    let git = proj.join(".git");
    fs::create_dir_all(&git).unwrap();
    assert!(validate_target(&git, &single(root.path())).is_err());

    let env_file = proj.join(".env");
    fs::write(&env_file, "SECRET=1").unwrap();
    assert!(validate_target(&env_file, &single(root.path())).is_err());
}

#[test]
fn path_guard_rejects_user_protected_folders() {
    let root = tempfile::tempdir().unwrap();
    let proj = root.path().join("proj");
    let nm = proj.join("node_modules");
    fs::create_dir_all(&nm).unwrap();

    let protected = vec![proj.to_string_lossy().to_string()];
    let roots = vec![root.path().to_path_buf()];
    let guard = GuardContext {
        scan_roots: &roots,
        protected_paths: &protected,
    };
    assert!(validate_target(&nm, &guard).is_err());
}

#[test]
fn path_guard_rejects_symlinked_directories() {
    let root = tempfile::tempdir().unwrap();
    let real = root.path().join("real");
    let proj = root.path().join("proj");
    fs::create_dir_all(&real).unwrap();
    fs::create_dir_all(&proj).unwrap();
    let link = proj.join("node_modules");
    if std::os::windows::fs::symlink_dir(&real, &link).is_err() {
        // Symlink creation requires developer mode / privileges; skip when the
        // environment cannot create one.
        return;
    }
    assert!(validate_target(&link, &single(root.path())).is_err());
}

#[test]
fn containment_is_component_aware() {
    assert!(is_within("c:\\foo\\bar", "c:\\foo"));
    assert!(!is_within("c:\\foobar", "c:\\foo"));
    assert!(!is_within("c:\\foo", "c:\\foo\\bar"));
}

fn git(repo: &Path, args: &[&str]) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["-c", "user.email=t@example.invalid", "-c", "user.name=Test"])
        .args(args)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[test]
fn git_guard_detects_tracked_and_untracked_content() {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path();
    if !git(repo, &["init"]) {
        return; // git is unavailable in this environment
    }
    let build = repo.join("build");
    fs::create_dir_all(&build).unwrap();
    fs::write(build.join("bundle.js"), "console.log(1)").unwrap();
    assert!(git(repo, &["add", "."]));
    assert!(git(repo, &["commit", "-m", "init"]));

    let status = inspect_git(&build).expect("git status");
    assert!(status.tracked);
    assert!(ensure_not_tracked(&build).is_err());

    let other = repo.join("dist");
    fs::create_dir_all(&other).unwrap();
    fs::write(other.join("out.js"), "x").unwrap();
    let status = inspect_git(&other).expect("git status");
    assert!(!status.tracked);
    assert!(ensure_not_tracked(&other).is_ok());
}

#[test]
fn git_guard_reports_non_repository() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path().join("proj").join("build");
    fs::create_dir_all(&dir).unwrap();
    let status = inspect_git(&dir).expect("non-repo is not an error");
    assert!(!status.repository);
    assert!(!status.tracked);
}

#[test]
fn evidence_revalidation_fails_when_marker_disappears() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("app");
    let build = project.join("build");
    fs::create_dir_all(&build).unwrap();
    fs::write(project.join("package.json"), "{}").unwrap();

    let catalog = CatalogIndex::embedded().unwrap();
    let rule = catalog.rule("js.build").unwrap();
    let snapshot = crate::safety::evidence_guard::EvidenceSnapshot {
        rule_id: rule.id.clone(),
        target_name: "build".to_string(),
        project_root: Some(project.to_string_lossy().to_string()),
        workspace_root: None,
        marker_hits: vec!["package.json".to_string()],
        content_hits: Vec::new(),
    };

    assert!(revalidate_evidence(rule, &build, &snapshot).is_ok());
    fs::remove_file(project.join("package.json")).unwrap();
    assert!(revalidate_evidence(rule, &build, &snapshot).is_err());
}

#[test]
fn protected_names_are_detected() {
    for name in [
        ".git",
        ".ssh",
        "auth.json",
        ".env.local",
        "CLAUDE.md",
        "brain",
    ] {
        assert!(is_hard_protected_name(name), "{} must be protected", name);
    }
    assert!(!is_hard_protected_name("node_modules"));
}

#[test]
fn source_folder_is_not_treated_as_a_protected_component() {
    let temp = tempfile::tempdir().unwrap();
    let proj = temp.path().join("proj");
    let nm = proj.join("src").join("node_modules");
    fs::create_dir_all(&nm).unwrap();
    assert!(validate_target(&nm, &single(temp.path())).is_ok());
}

#[test]
fn vcs_and_secret_components_block_deletion() {
    assert!(is_protected_component(".git"));
    assert!(is_protected_component(".ssh"));
    assert!(!is_protected_component("src"));
    assert!(!is_protected_component("brain"));
}

#[test]
fn path_guard_rejects_directory_junctions() {
    let root = tempfile::tempdir().unwrap();
    let real = root.path().join("real");
    let proj = root.path().join("proj");
    fs::create_dir_all(&real).unwrap();
    fs::create_dir_all(&proj).unwrap();
    let link = proj.join("node_modules");

    let status = Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&link)
        .arg(&real)
        .status();
    let Ok(status) = status else { return };
    if !status.success() {
        return; // junction creation unavailable in this environment
    }

    assert!(validate_target(&link, &single(root.path())).is_err());
}

#[test]
fn system_roots_are_rejected_by_path_analysis() {
    use super::path_guard::{normalize_key, validate_system_path};
    let check = |p: &str| validate_system_path(&normalize_key(std::path::Path::new(p)));
    assert!(check("c:/windows/system32/node_modules").is_err());
    assert!(check("c:/program files/app/x/node_modules").is_err());
    assert!(check("c:/programdata/x/node_modules").is_err());
    assert!(check("d:/work/proj/node_modules").is_ok());
}
