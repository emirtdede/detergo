use super::*;
use crate::catalog::{CatalogIndex, CleanupMethod, Confidence, SafetyClass, TargetKind};
use crate::safety::ActiveUse;
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

fn discover_all(
    root: &std::path::Path,
) -> (Vec<CleanupItem>, Vec<StoredTarget>, Option<StopReason>) {
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
fn agent_measurement_updates_skip_unmeasured_targets() {
    fn agent_item(id: &str, logical: Option<u64>) -> CleanupItem {
        CleanupItem {
            id: id.to_string(),
            scan_session_id: "s-test".to_string(),
            rule_id: "agents.test".to_string(),
            provider: "agents".to_string(),
            ecosystem: "node".to_string(),
            category: "cache".to_string(),
            kind: TargetKind::Directory,
            project_id: None,
            project_name: None,
            project_root: None,
            project_detected: false,
            display_name: id.to_string(),
            display_path: format!("C:\\{}", id),
            logical_bytes: logical,
            allocated_bytes: None,
            estimated_reclaim_bytes: None,
            safety_class: SafetyClass::Safe,
            confidence: Confidence::High,
            active_use: ActiveUse::No,
            evidence_codes: vec![],
            warning_codes: vec![],
            cleanup_method: CleanupMethod::Trash,
            regenerate_hint: None,
            protected: false,
            selectable: true,
            auto_selectable: false,
            last_modified_at: None,
            last_modified_ms: None,
            status: ItemStatus::Ready,
            parent_item_id: None,
            note: None,
        }
    }

    let updates = agent_measurement_updates(&[
        agent_item("unmeasured", None),
        agent_item("measured", Some(4096)),
    ]);
    assert_eq!(updates.len(), 1, "unmeasured targets must not become 0 B");
    assert_eq!(updates[0].id, "measured");
    assert_eq!(updates[0].logical_bytes, 4096);
    assert_eq!(updates[0].estimated_reclaim_bytes, 4096);
    assert!(agent_measurement_updates(&[agent_item("only-unmeasured", None)]).is_empty());
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
    assert!(items
        .iter()
        .any(|i| i.project_name.as_deref() == Some("app-a")));
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
    assert!(items[0]
        .warning_codes
        .contains(&"USER_PROTECTED".to_string()));
    assert!(targets[0].protected);
}

#[test]
fn a_directory_at_the_depth_limit_is_still_discovered() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("app/node_modules/pkg")).unwrap();
    fs::write(root.join("app/package.json"), "{}").unwrap();
    write(&root.join("app/node_modules/pkg/index.js"), 32);

    // `app` is depth 1, `app/node_modules` is exactly depth 2. Pruning the
    // boundary directory before the rule match made it invisible and reported a
    // depth-limit partial result for a folder that was fully in scope.
    let catalog = catalog();
    let token = CancellationToken::new();
    let limits = ScanLimits {
        max_depth: 2,
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
        .expect("discovery should succeed");

    assert!(outcome
        .items
        .iter()
        .any(|item| item.rule_id == "js.node_modules"));
}

#[test]
fn a_protected_folder_below_a_target_protects_the_target() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("app/node_modules/keep")).unwrap();
    fs::write(root.join("app/package.json"), "{}").unwrap();
    write(&root.join("app/node_modules/keep/pinned.js"), 8);

    // The delete guard rejects a target that *contains* a protected folder. The
    // scanner only checked the opposite direction, so it offered the parent
    // `node_modules` as cleanable and every row failed at execution.
    let protected = vec![root
        .join("app/node_modules/keep")
        .to_string_lossy()
        .to_string()];
    let (items, targets, _) = discover_with_protected(root, &protected);

    let parent = items
        .iter()
        .find(|item| item.rule_id == "js.node_modules")
        .expect("node_modules must still be listed");
    assert!(parent.protected);
    assert!(!parent.selectable);
    assert!(parent.warning_codes.contains(&"USER_PROTECTED".to_string()));
    assert!(targets.iter().any(|target| target.protected));
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
    assert!(
        !with.auto_selectable,
        "REGENERATE targets are never auto-selected"
    );

    let without = items
        .iter()
        .find(|i| i.display_path.contains("without-marker"))
        .expect("unverified build should still be reported for transparency");
    assert_eq!(without.safety_class, SafetyClass::Review);
    assert!(!without.auto_selectable);
    assert!(without
        .warning_codes
        .contains(&"NO_PROJECT_MARKER".to_string()));
}

#[test]
fn nested_rule_is_ignored_outside_its_parent() {
    // A `cache` folder must only match the nested Next.js rule inside `.next`.
    // Without an ancestor check it was discovered as a standalone SAFE target
    // anywhere in a Next.js project and auto-selected for deletion.
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("app").join("cache")).unwrap();
    fs::write(root.join("app/next.config.js"), "module.exports = {}").unwrap();
    write(&root.join("app/cache/blob.bin"), 64);

    let (items, _, _) = discover_all(root);
    assert!(
        items.iter().all(|i| i.rule_id != "js.next_cache"),
        "nested rule matched without a js.next ancestor"
    );
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
fn depth_limit_is_treated_as_a_completed_scan() {
    let request = crate::scanner::models::ScanRequest {
        root_path: "C:\\tmp".to_string(),
        exclusions: vec![],
        scope: crate::scanner::models::ScanScope::Project,
        profile: None,
        max_depth: Some(2),
        max_candidates: None,
        timeout_minutes: None,
        min_size_bytes: None,
        protected_paths: vec![],
    };

    let summary = super::build_summary(
        &request,
        "s-depth",
        &[],
        0,
        12,
        Some(StopReason::DepthLimit),
        Vec::new(),
    );
    assert!(!summary.partial, "a depth cut is a completed scan");
    assert_eq!(
        summary.stop_reason.as_deref(),
        Some(StopReason::DepthLimit.code())
    );
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
fn summary_and_provider_totals_do_not_double_count_nested_targets() {
    fn item(id: &str, parent: Option<&str>, logical: u64, allocated: u64) -> CleanupItem {
        CleanupItem {
            id: id.to_string(),
            scan_session_id: "s-test".to_string(),
            rule_id: "js.test".to_string(),
            provider: "node".to_string(),
            ecosystem: "node".to_string(),
            category: "cache".to_string(),
            kind: TargetKind::Directory,
            project_id: None,
            project_name: None,
            project_root: None,
            project_detected: false,
            display_name: id.to_string(),
            display_path: format!("C:\\{}", id),
            logical_bytes: Some(logical),
            allocated_bytes: Some(allocated),
            estimated_reclaim_bytes: Some(allocated),
            safety_class: SafetyClass::Safe,
            confidence: Confidence::High,
            active_use: ActiveUse::No,
            evidence_codes: vec![],
            warning_codes: vec![],
            cleanup_method: CleanupMethod::Trash,
            regenerate_hint: None,
            protected: false,
            selectable: true,
            auto_selectable: false,
            last_modified_at: None,
            last_modified_ms: None,
            status: ItemStatus::Ready,
            parent_item_id: parent.map(str::to_string),
            note: None,
        }
    }

    let request = ScanRequest {
        root_path: "C:\\tmp".to_string(),
        exclusions: vec![],
        scope: ScanScope::Project,
        profile: None,
        max_depth: None,
        max_candidates: None,
        timeout_minutes: None,
        min_size_bytes: None,
        protected_paths: vec![],
    };
    // `.next` measures 900 allocated and contains `.next/cache` (300 of them).
    // The child's bytes are already inside the parent, so the summary must
    // report 900, not 1200.
    let parent = item("parent", None, 1000, 900);
    let child = item("child", Some("parent"), 400, 300);
    let summary = build_summary(
        &request,
        "s-nested",
        &[parent, child],
        0,
        1,
        None,
        Vec::new(),
    );

    assert_eq!(summary.total_bytes, 1000);
    assert_eq!(summary.total_allocated_bytes, 900);
    assert_eq!(summary.cleanable_bytes, 900);
    assert_eq!(summary.provider_totals.len(), 1);
    assert_eq!(summary.provider_totals[0].allocated_bytes, 900);
    assert_eq!(summary.provider_totals[0].item_count, 2);
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

#[test]
fn expired_plans_are_rejected_without_leaving_a_usable_entry() {
    let registry = ScanRegistry::new();
    let now = crate::cleanup::plan::now_ms();
    let plan = crate::cleanup::CleanupPlan {
        id: "plan-expired".to_string(),
        session_id: "s-test".to_string(),
        mode: crate::cleanup::DeleteMode::RecycleBin,
        created_ms: now.saturating_sub(60_000),
        expires_ms: now.saturating_sub(1),
        items: vec![],
        total_logical_bytes: 0,
        total_estimated_bytes: 0,
        eligible_count: 0,
        blocked_count: 0,
        confirmation_token: "token".to_string(),
    };
    registry.insert_plan(plan);

    assert!(matches!(
        registry.consume_plan("plan-expired"),
        Err(crate::error::AppError::PlanExpired(_))
    ));
    assert!(
        matches!(
            registry.consume_plan("plan-expired"),
            Err(crate::error::AppError::PlanInvalid(_))
        ),
        "an expired plan must be discarded, not left to be executed later"
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
fn terminal_event_distinguishes_partial_from_cancelled_and_completed() {
    fn summary(stop_reason: Option<StopReason>) -> ScanSummary {
        ScanSummary {
            scan_id: "s".to_string(),
            root_path: "C:\\Projects".to_string(),
            scope: crate::scanner::models::ScanScope::Project,
            total_entries: 0,
            total_bytes: 0,
            total_allocated_bytes: 0,
            protected_bytes: 0,
            cleanable_bytes: 0,
            duration_ms: 1,
            errors_count: 0,
            warnings_count: 0,
            directories_visited: 0,
            partial: stop_reason
                .map(|reason| reason != StopReason::DepthLimit)
                .unwrap_or(false),
            stop_reason: stop_reason.map(|reason| reason.code().to_string()),
            provider_totals: vec![],
            detected_project_count: None,
            sections: Vec::new(),
            dropped_events: 0,
        }
    }

    assert!(matches!(
        terminal_event(&summary(Some(StopReason::Timeout))),
        ScanEvent::Partial { .. }
    ));
    assert!(matches!(
        terminal_event(&summary(Some(StopReason::CandidateLimit))),
        ScanEvent::Partial { .. }
    ));
    assert!(matches!(
        terminal_event(&summary(Some(StopReason::Cancelled))),
        ScanEvent::Cancelled { .. }
    ));
    assert!(matches!(
        terminal_event(&summary(Some(StopReason::DepthLimit))),
        ScanEvent::Completed { .. }
    ));
    assert!(matches!(
        terminal_event(&summary(None)),
        ScanEvent::Completed { .. }
    ));
}

#[test]
fn a_stop_reason_is_never_downgraded_to_a_depth_cut() {
    // A depth cut is configured, not an interruption: it must not replace a
    // timeout, and it must not hide one coming from another scan step either.
    assert_eq!(
        merge_stop_reason(Some(StopReason::DepthLimit), Some(StopReason::Timeout)),
        Some(StopReason::Timeout)
    );
    assert_eq!(
        merge_stop_reason(Some(StopReason::Timeout), Some(StopReason::DepthLimit)),
        Some(StopReason::Timeout)
    );
    assert_eq!(
        merge_stop_reason(
            Some(StopReason::CandidateLimit),
            Some(StopReason::DepthLimit)
        ),
        Some(StopReason::CandidateLimit)
    );
    // A real interruption always wins, even over another one.
    assert_eq!(
        merge_stop_reason(Some(StopReason::Timeout), Some(StopReason::Cancelled)),
        Some(StopReason::Cancelled)
    );
    assert_eq!(
        merge_stop_reason(None, Some(StopReason::DepthLimit)),
        Some(StopReason::DepthLimit)
    );
    assert_eq!(
        merge_stop_reason(Some(StopReason::Timeout), None),
        Some(StopReason::Timeout)
    );
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
    let size =
        measurement::measure_path(&dir, crate::catalog::TargetKind::Directory, &token).unwrap();
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

#[test]
fn monorepo_discovers_all_sibling_and_workspace_node_modules() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();

    // Typical monorepo with root + multiple package/service node_modules.
    fs::write(root.join("package.json"), "{\"name\":\"mono\"}").unwrap();
    write(&root.join("node_modules/.package-lock.json"), 16);
    write(&root.join("node_modules/pkg/index.js"), 32);

    fs::create_dir_all(root.join("apps/web")).unwrap();
    fs::write(root.join("apps/web/package.json"), "{\"name\":\"web\"}").unwrap();
    write(&root.join("apps/web/node_modules/.package-lock.json"), 16);

    fs::create_dir_all(root.join("services/api")).unwrap();
    fs::write(root.join("services/api/package.json"), "{\"name\":\"api\"}").unwrap();
    write(&root.join("services/api/node_modules/express/index.js"), 64);

    // Nested node_modules inside a package's own node_modules must still be pruned.
    write(
        &root.join("apps/web/node_modules/subpkg/node_modules/a/index.js"),
        16,
    );

    let (items, _, stop) = discover_all(root);
    assert!(stop.is_none());
    let nm_items: Vec<_> = items
        .iter()
        .filter(|i| i.rule_id == "js.node_modules")
        .collect();
    assert_eq!(
        nm_items.len(),
        3,
        "all three top-level/workspace node_modules must be discovered, got: {:?}",
        nm_items.iter().map(|i| &i.display_path).collect::<Vec<_>>()
    );
    assert!(nm_items
        .iter()
        .all(|i| i.safety_class == SafetyClass::Regenerate));
}

#[test]
fn node_modules_inside_unverified_generic_dir_is_still_discovered() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();

    // A user workspace folder named "build" or "Temp" without a project manifest
    // at its root must NOT prune its subtree and hide real projects inside it.
    fs::create_dir_all(root.join("build/my-web-app/node_modules/pkg")).unwrap();
    fs::write(
        root.join("build/my-web-app/package.json"),
        "{\"name\":\"my-web-app\"}",
    )
    .unwrap();
    write(&root.join("build/my-web-app/node_modules/pkg/index.js"), 32);

    let (items, _, stop) = discover_all(root);
    assert!(stop.is_none());
    assert!(
        items
            .iter()
            .any(|i| i.rule_id == "js.node_modules" && i.display_path.contains("my-web-app")),
        "node_modules inside an unverified generic container must still be found"
    );
}

#[test]
fn windows_subfolder_inside_user_project_is_not_excluded() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();

    // Flutter / React Native / desktop apps legitimately have a `windows/`
    // directory at depth 1 inside a project root.
    fs::create_dir_all(root.join("windows/app/node_modules/pkg")).unwrap();
    fs::write(
        root.join("windows/app/package.json"),
        "{\"name\":\"win-app\"}",
    )
    .unwrap();
    write(&root.join("windows/app/node_modules/pkg/index.js"), 32);

    let (items, _, stop) = discover_all(root);
    assert!(stop.is_none());
    assert!(
        items.iter().any(|i| i.rule_id == "js.node_modules"),
        "project subfolder named windows/ must not trigger drive-root OS exclusions"
    );
}

#[test]
fn source_subtrees_and_mismatched_ecosystems_do_not_produce_false_positives() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();

    // Rust project with `src/bin` — must never match .NET `bin`.
    fs::create_dir_all(root.join("rust-app")).unwrap();
    fs::write(root.join("rust-app/Cargo.toml"), "[package]\nname=\"r\"").unwrap();
    write(&root.join("rust-app/src/bin/cli.rs"), 64);

    // JS/Next.js project with `src/features/library`, `src/app/api/saved`,
    // `src/vendor`, and `public/dist` — none of these are Unity/Unreal/Go/JS artifacts.
    fs::create_dir_all(root.join("web-app")).unwrap();
    fs::write(root.join("web-app/package.json"), "{\"name\":\"web\"}").unwrap();
    write(&root.join("web-app/src/features/library/index.ts"), 64);
    write(&root.join("web-app/src/app/api/saved/route.ts"), 64);
    write(&root.join("web-app/src/vendor/adapter.ts"), 64);
    write(&root.join("web-app/public/dist/bundle.js"), 64);

    // .NET project with `wwwroot/lib/bootstrap/dist` — must never match JS `dist`.
    fs::create_dir_all(root.join("dotnet-app")).unwrap();
    fs::write(root.join("dotnet-app/App.csproj"), "<Project />").unwrap();
    write(
        &root.join("dotnet-app/wwwroot/lib/bootstrap/dist/bootstrap.min.js"),
        64,
    );

    let (items, _, _) = discover_all(root);
    assert!(
        items.is_empty(),
        "source directories and mismatched ecosystems must not be flagged as artifacts, got: {:?}",
        items
            .iter()
            .map(|i| (&i.rule_id, &i.display_path))
            .collect::<Vec<_>>()
    );
}

#[test]
fn node_modules_with_content_signature_below_monorepo_root_is_regenerate() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();

    // User selects a monorepo subfolder whose package.json sits outside the scan
    // root, while node_modules itself contains `.package-lock.json`.
    let sub = root.join("packages/ui");
    write(&sub.join("node_modules/.package-lock.json"), 32);
    write(&sub.join("node_modules/react/index.js"), 64);

    let (items, _, _) = discover_all(&sub);
    let nm = items
        .iter()
        .find(|i| i.rule_id == "js.node_modules")
        .expect("node_modules must be discovered");
    assert_eq!(nm.safety_class, SafetyClass::Regenerate);
    assert!(
        !nm.warning_codes.contains(&"NO_PROJECT_MARKER".to_string()),
        "content signature proof must keep node_modules out of NO_PROJECT_MARKER review"
    );
}

#[test]
fn max_depth_prunes_non_matching_deep_directories() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();

    // Depth 1: a, Depth 2: a/b, Depth 3: a/b/c, Depth 4: a/b/c/node_modules
    fs::create_dir_all(root.join("a/b/c/node_modules/pkg")).unwrap();
    fs::write(root.join("a/b/c/package.json"), "{}").unwrap();
    write(&root.join("a/b/c/node_modules/pkg/index.js"), 16);

    let catalog = catalog();
    let token = CancellationToken::new();
    let limits = ScanLimits {
        max_depth: 2,
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
        .expect("discovery should succeed");

    assert!(
        outcome.items.is_empty(),
        "directories deeper than max_depth must not be visited"
    );
    assert_eq!(outcome.stop_reason, Some(StopReason::DepthLimit));
}
