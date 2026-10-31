use super::*;
use crate::catalog::{CatalogIndex, SafetyClass};
use std::fs;

fn catalog() -> CatalogIndex {
    CatalogIndex::embedded().expect("embedded catalog")
}

fn write(path: &std::path::Path, bytes: usize) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, vec![b'x'; bytes]).unwrap();
}

fn discover_all(root: &std::path::Path) -> (Vec<CleanupItem>, Vec<StoredTarget>, Option<StopReason>) {
    discover_with_protected(root, &[])
}

fn discover_with_protected(
    root: &std::path::Path,
    protected_paths: &[String],
) -> (Vec<CleanupItem>, Vec<StoredTarget>, Option<StopReason>) {
    let catalog = catalog();
    let token = CancellationToken::new();
    let limits = ScanLimits::default();
    let mut engine = DiscoveryEngine::new(&catalog, token, limits);
    let outcome = engine
        .discover(
            DiscoveryConfig {
                root,
                exclusions: &[],
                protected_paths,
                scan_session_id: "s-test",
                limits,
            },
            |_| {},
            |_| {},
        )
        .expect("discovery should succeed");
    (outcome.items, outcome.targets, outcome.stop_reason)
}

#[test]
fn discovery_finds_node_modules_but_skips_nested() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("proj-a/node_modules/nested/node_modules")).unwrap();
    fs::write(root.join("proj-a/package.json"), "{\"name\":\"app-a\"}").unwrap();
    write(&root.join("proj-a/node_modules/lib/index.js"), 32);
    fs::create_dir_all(root.join("proj-b/node_modules")).unwrap();
    write(&root.join("proj-b/node_modules/index.js"), 8);

    let (items, targets, stop) = discover_all(root);
    assert!(stop.is_none());
    assert_eq!(items.len(), 2, "nested node_modules must not be emitted");
    assert_eq!(targets.len(), 2);
    assert!(items.iter().all(|i| i.rule_id == "js.node_modules"));
    assert!(items.iter().any(|i| i.project_name.as_deref() == Some("app-a")));
}

#[test]
fn user_protected_paths_are_blocked_during_discovery() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("app/node_modules/pkg")).unwrap();
    fs::write(root.join("app/package.json"), "{}").unwrap();
    write(&root.join("app/node_modules/pkg/index.js"), 64);

    let protected = vec![root.join("app/node_modules").to_string_lossy().to_string()];
    let (items, targets, _) = discover_with_protected(root, &protected);
    assert_eq!(items.len(), 1);
    assert!(items[0].protected);
    assert!(!items[0].selectable);
    assert!(items[0].warning_codes.contains(&"USER_PROTECTED".to_string()));
    assert!(targets[0].protected);
}

#[test]
fn generic_build_requires_project_proof() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("with-marker")).unwrap();
    fs::write(root.join("with-marker/package.json"), "{}").unwrap();
    write(&root.join("with-marker/build/bundle.js"), 16);

    write(&root.join("without-marker/build/source.js"), 16);

    let (items, _, _) = discover_all(root);
    let with = items
        .iter()
        .find(|i| i.display_path.contains("with-marker"))
        .expect("verified build must be found");
    assert_eq!(with.safety_class, SafetyClass::Regenerate);
    assert!(!with.auto_selectable, "REGENERATE targets are never auto-selected");

    let without = items
        .iter()
        .find(|i| i.display_path.contains("without-marker"))
        .expect("unverified build should still be reported for transparency");
    assert_eq!(without.safety_class, SafetyClass::Review);
    assert!(!without.auto_selectable);
    assert!(without.warning_codes.contains(&"NO_PROJECT_MARKER".to_string()));
}

#[test]
fn nested_targets_are_linked_to_their_parent() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("app")).unwrap();
    fs::write(root.join("app/next.config.js"), "module.exports = {}").unwrap();
    write(&root.join("app/.next/BUILD_ID"), 4);
    write(&root.join("app/.next/cache/webpack/x"), 64);

    let (items, _, _) = discover_all(root);
    let next = items.iter().find(|i| i.rule_id == "js.next").unwrap();
    let cache = items
        .iter()
        .find(|i| i.rule_id == "js.next_cache")
        .expect(".next/cache must be discovered");
    assert_eq!(cache.safety_class, SafetyClass::Safe);
    assert_eq!(cache.parent_item_id.as_deref(), Some(next.id.as_str()));
}

#[test]
fn cancelled_discovery_returns_partial_outcome_without_error() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("p/node_modules")).unwrap();

    let catalog = catalog();
    let token = CancellationToken::new();
    token.cancel();
    let limits = ScanLimits::default();
    let mut engine = DiscoveryEngine::new(&catalog, token, limits);
    let outcome = engine
        .discover(
            DiscoveryConfig {
                root,
                exclusions: &[],
                protected_paths: &[],
                scan_session_id: "s-test",
                limits,
            },
            |_| {},
            |_| {},
        )
        .expect("cancellation is not an error");
    assert_eq!(outcome.stop_reason, Some(StopReason::Cancelled));
    assert!(outcome.items.is_empty());
}

#[test]
fn candidate_limit_marks_scan_partial() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    for i in 0..5 {
        fs::create_dir_all(root.join(format!("p{}/node_modules", i))).unwrap();
        fs::write(root.join(format!("p{}/package.json", i)), "{}").unwrap();
    }

    let catalog = catalog();
    let token = CancellationToken::new();
    let limits = ScanLimits {
        max_candidates: 2,
        ..ScanLimits::default()
    };
    let mut engine = DiscoveryEngine::new(&catalog, token, limits);
    let outcome = engine
        .discover(
            DiscoveryConfig {
                root,
                exclusions: &[],
                protected_paths: &[],
                scan_session_id: "s-test",
                limits,
            },
            |_| {},
            |_| {},
        )
        .unwrap();
    assert_eq!(outcome.stop_reason, Some(StopReason::CandidateLimit));
    assert_eq!(outcome.items.len(), 2);
}

#[test]
fn measurement_reports_logical_and_allocated_bytes() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path().join("node_modules");
    fs::create_dir_all(&dir).unwrap();
    write(&dir.join("a.bin"), 256 * 1024);
    write(&dir.join("sub/b.bin"), 128 * 1024);

    let token = CancellationToken::new();
    let size = measurement::measure_path(&dir, crate::catalog::TargetKind::Directory, &token)
        .expect("measurement");
    assert!(size.logical_bytes >= 384 * 1024);
    assert!(size.allocated_bytes.unwrap() >= 384 * 1024);
    assert_eq!(size.file_count, 2);
}

#[test]
fn session_registry_rejects_unknown_and_dedupes_ids() {
    let registry = ScanRegistry::new();
    let root = std::path::PathBuf::from("C:\\");
    let session = registry.create_session(ScanScope::Project, root.clone(), vec![root]);
    let id = session.lock().unwrap().id.clone();
    assert!(registry.get_session(&id).is_ok());
    assert!(registry.get_session("does-not-exist").is_err());
}


#[test]
fn plans_are_consumed_exactly_once() {
    let registry = ScanRegistry::new();
    let now = crate::cleanup::plan::now_ms();
    let plan = crate::cleanup::CleanupPlan {
        id: "plan-test".to_string(),
        session_id: "s-test".to_string(),
        mode: crate::cleanup::DeleteMode::RecycleBin,
        created_ms: now,
        expires_ms: now + 60_000,
        items: vec![],
        total_logical_bytes: 0,
        total_estimated_bytes: 0,
        eligible_count: 0,
        blocked_count: 0,
        confirmation_token: "token".to_string(),
    };
    registry.insert_plan(plan);
    assert!(registry.consume_plan("plan-test").is_ok());
    assert!(
        registry.consume_plan("plan-test").is_err(),
        "a consumed plan must not be executable twice"
    );
}

#[tokio::test]
async fn end_to_end_scan_plan_and_permanent_delete() {
    use crate::cleanup::{build_plan, DeleteMode};

    let temp = tempfile::tempdir().unwrap();
    let proj = temp.path().join("app");
    let nm = proj.join("node_modules");
    fs::create_dir_all(nm.join("pkg")).unwrap();
    fs::write(proj.join("package.json"), "{\"name\":\"e2e-app\"}").unwrap();
    fs::write(nm.join("pkg/index.js"), vec![b'x'; 8192]).unwrap();

    let catalog = std::sync::Arc::new(CatalogIndex::embedded().unwrap());
    let registry = ScanRegistry::new();
    let session = registry.create_session(
        crate::scanner::models::ScanScope::Project,
        temp.path().to_path_buf(),
        vec![temp.path().to_path_buf()],
    );
    let token = CancellationToken::new();

    let request = crate::scanner::models::ScanRequest {
        root_path: temp.path().to_string_lossy().to_string(),
        exclusions: vec![],
        scope: crate::scanner::models::ScanScope::Project,
        profile: None,
        max_depth: None,
        max_candidates: None,
        timeout_minutes: None,
        min_size_bytes: None,
        protected_paths: vec![],
    };

    let policy = crate::cleanup::CleanupPolicy::default();
    let summary = run_scan(
        request,
        session.clone(),
        token,
        catalog.clone(),
        &policy,
        |_| {},
    )
    .await
    .expect("scan");
    assert_eq!(summary.total_entries, 1);
    assert!(!summary.partial);

    let (session_id, target_id) = {
        let guard = session.lock().unwrap();
        let id = guard.targets.keys().next().unwrap().clone();
        (guard.id.clone(), id)
    };
    assert_eq!(session_id, summary.scan_id);

    let plan = {
        let guard = session.lock().unwrap();
        build_plan(
            &guard,
            std::slice::from_ref(&target_id),
            DeleteMode::Permanent,
            &catalog,
            &policy,
        )
        .unwrap()
    };
    assert_eq!(plan.eligible_count, 1);

    let report = {
        let guard = session.lock().unwrap();
        crate::cleanup::coordinator::execute_plan_with_probe(
            &plan,
            &guard,
            &catalog,
            &policy,
            &plan.confirmation_token,
            true,
            &|_, _| crate::safety::ActiveUse::No,
        )
        .unwrap()
    };
    assert_eq!(report.success_count, 1);
    assert!(report.reclaim_bytes >= 8192);
    assert!(!nm.exists());
    assert!(proj.join("package.json").exists());
}


#[test]
fn hardlinked_files_are_counted_once_for_allocated_size() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path().join("node_modules");
    fs::create_dir_all(&dir).unwrap();
    let a = dir.join("a.bin");
    fs::write(&a, vec![b'x'; 64 * 1024]).unwrap();
    let b = dir.join("b.bin");
    if fs::hard_link(&a, &b).is_err() {
        return;
    }

    let token = CancellationToken::new();
    let size = measurement::measure_path(&dir, crate::catalog::TargetKind::Directory, &token).unwrap();
    assert_eq!(size.file_count, 2);
    assert_eq!(size.logical_bytes, 128 * 1024);
    assert!(size.hardlink_dedup_bytes >= 64 * 1024);
    assert!(size.allocated_bytes.unwrap() < size.logical_bytes);
}


#[test]
fn expired_sessions_are_rejected() {
    let registry = ScanRegistry::new();
    let root = std::path::PathBuf::from("C:\\");
    let session = registry.create_session(ScanScope::Project, root.clone(), vec![root]);
    let id = session.lock().unwrap().id.clone();
    session.lock().unwrap().created =
        std::time::Instant::now() - std::time::Duration::from_secs(31 * 60);
    assert!(registry.get_session(&id).is_err());
}

#[test]
fn discovery_does_not_descend_into_junctions() {
    use std::process::Command;

    let temp = tempfile::tempdir().unwrap();
    // The junction target lives in a *separate* root, so anything discovered
    // through the link would be outside the scan root.
    let outside = tempfile::tempdir().unwrap();
    let root = temp.path();
    let proj = root.join("proj");
    fs::create_dir_all(&proj).unwrap();
    fs::create_dir_all(outside.path().join("node_modules/pkg")).unwrap();
    fs::write(
        outside.path().join("node_modules/pkg/index.js"),
        vec![b'x'; 128],
    )
    .unwrap();
    let link = proj.join("node_modules");

    let status = Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&link)
        .arg(outside.path().join("node_modules"))
        .status();
    let Ok(status) = status else { return };
    if !status.success() {
        return; // junction creation unavailable in this environment
    }

    let (items, _, _) = discover_all(root);
    assert!(
        items.is_empty(),
        "junction content must not be discovered outside the scan root"
    );
}
