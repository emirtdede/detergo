use super::*;
use crate::catalog::model::{CleanupMethod, SafetyClass, TargetKind};
use crate::catalog::CatalogIndex;
use crate::safety::{ActiveUse, EvidenceSnapshot};
use crate::scanner::models::{CleanupItem, ItemStatus, ScanScope, StoredTarget};
use crate::scanner::session::ScanSession;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

fn target(id: &str, path: PathBuf, rule_id: &str, safety: SafetyClass) -> StoredTarget {
    let project_root = path.parent().map(|p| p.to_string_lossy().to_string());
    let target_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let measured = crate::scanner::measurement::measure_path(
        &path,
        TargetKind::Directory,
        &crate::scanner::cancellation::CancellationToken::new(),
    );
    let logical = measured.as_ref().map(|s| s.logical_bytes);
    let allocated = measured.as_ref().and_then(|s| s.allocated_bytes);
    StoredTarget {
        id: id.to_string(),
        path,
        rule_id: rule_id.to_string(),
        provider: "project".to_string(),
        category: "build".to_string(),
        kind: TargetKind::Directory,
        safety_class: safety,
        cleanup_method: CleanupMethod::Trash,
        project_root: project_root.clone(),
        evidence: EvidenceSnapshot {
            rule_id: rule_id.to_string(),
            target_name,
            project_root,
            workspace_root: None,
            marker_hits: Vec::new(),
            content_hits: Vec::new(),
        },
        logical_bytes: logical,
        allocated_bytes: allocated,
        modified_at: None,
        active_use: ActiveUse::No,
        parent_id: None,
        protected: safety == SafetyClass::Keep,
    }
}

/// File-kind target used by the content-change tests. `target()` always models a
/// directory, and a directory deliberately ignores size/mtime (growth between
/// preview and execution is normal), so the file path is the only one that can
/// exercise `ContentChanged`.
fn file_target(id: &str, path: PathBuf, rule_id: &str, safety: SafetyClass) -> StoredTarget {
    let project_root = path.parent().map(|p| p.to_string_lossy().to_string());
    let target_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let measured = crate::scanner::measurement::measure_path(
        &path,
        TargetKind::File,
        &crate::scanner::cancellation::CancellationToken::new(),
    );
    StoredTarget {
        id: id.to_string(),
        path,
        rule_id: rule_id.to_string(),
        provider: "project".to_string(),
        category: "cache".to_string(),
        kind: TargetKind::File,
        safety_class: safety,
        cleanup_method: CleanupMethod::Trash,
        project_root: project_root.clone(),
        evidence: EvidenceSnapshot {
            rule_id: rule_id.to_string(),
            target_name,
            project_root,
            workspace_root: None,
            marker_hits: Vec::new(),
            content_hits: Vec::new(),
        },
        logical_bytes: measured.as_ref().map(|s| s.logical_bytes),
        allocated_bytes: measured.as_ref().and_then(|s| s.allocated_bytes),
        modified_at: None,
        active_use: ActiveUse::No,
        parent_id: None,
        protected: safety == SafetyClass::Keep,
    }
}

fn make_session(root: &Path, targets: Vec<StoredTarget>) -> ScanSession {
    let mut map = std::collections::HashMap::new();
    let mut items = Vec::new();
    for t in targets {
        items.push(CleanupItem {
            id: t.id.clone(),
            scan_session_id: "s-test".to_string(),
            rule_id: t.rule_id.clone(),
            provider: t.provider.clone(),
            ecosystem: "javascript".to_string(),
            category: "build".to_string(),
            kind: t.kind,
            project_id: None,
            project_name: Some("app".to_string()),
            project_root: t.project_root.clone(),
            project_detected: false,
            display_name: t.path.file_name().unwrap().to_string_lossy().to_string(),
            display_path: t.path.to_string_lossy().to_string(),
            logical_bytes: t.logical_bytes,
            allocated_bytes: t.allocated_bytes,
            estimated_reclaim_bytes: t.allocated_bytes,
            safety_class: t.safety_class,
            confidence: crate::catalog::Confidence::High,
            active_use: ActiveUse::No,
            evidence_codes: vec![],
            warning_codes: vec![],
            cleanup_method: t.cleanup_method,
            regenerate_hint: None,
            protected: t.protected,
            selectable: !t.protected,
            auto_selectable: false,
            last_modified_at: None,
            last_modified_ms: None,
            status: ItemStatus::Ready,
            parent_item_id: None,
            note: None,
        });
        map.insert(t.id.clone(), t);
    }
    ScanSession {
        id: "s-test".to_string(),
        scope: ScanScope::Project,
        root: root.to_path_buf(),
        allowed_roots: vec![root.to_path_buf()],
        created: Instant::now(),
        items,
        targets: map,
        summary: None,
    }
}

fn catalog() -> CatalogIndex {
    CatalogIndex::embedded().unwrap()
}

fn policy() -> crate::cleanup::CleanupPolicy {
    crate::cleanup::CleanupPolicy::default()
}

/// Tests must not depend on which agents happen to be running on the machine.
fn execute_plan_deterministic(
    plan: &crate::cleanup::CleanupPlan,
    session: &ScanSession,
    catalog: &CatalogIndex,
    protected_paths: &[String],
    token: &str,
    permanent_acknowledged: bool,
) -> Result<crate::cleanup::CleanupReport, crate::error::AppError> {
    let policy = crate::cleanup::CleanupPolicy {
        protected_paths: protected_paths.to_vec(),
        ..crate::cleanup::CleanupPolicy::default()
    };
    crate::cleanup::coordinator::execute_plan_with_probe(
        plan,
        session,
        catalog,
        &policy,
        token,
        permanent_acknowledged,
        &|_, _| ActiveUse::No,
    )
}

#[test]
fn parent_and_child_targets_are_not_double_counted() {
    let temp = tempfile::tempdir().unwrap();
    let next = temp.path().join("app/.next");
    let cache = next.join("cache");
    fs::create_dir_all(&cache).unwrap();
    fs::write(cache.join("data.bin"), vec![b'x'; 512]).unwrap();

    let session = make_session(
        temp.path(),
        vec![
            target("t-parent", next.clone(), "js.next", SafetyClass::Regenerate),
            target("t-child", cache.clone(), "js.next_cache", SafetyClass::Safe),
        ],
    );

    let plan = build_plan(
        &session,
        &["t-child".into(), "t-parent".into()],
        DeleteMode::RecycleBin,
        &catalog(),
        &policy(),
    )
    .unwrap();
    assert_eq!(plan.eligible_count, 1);
    let parent = plan
        .items
        .iter()
        .find(|i| i.target_id == "t-parent")
        .unwrap();
    assert_eq!(plan.total_estimated_bytes, parent.estimated_reclaim_bytes);
    assert!(plan.total_estimated_bytes >= 512);
    let child = plan
        .items
        .iter()
        .find(|i| i.target_id == "t-child")
        .unwrap();
    assert!(!child.eligible);
    assert_eq!(child.blocked_code.as_deref(), Some("COVERED_BY_PARENT"));
}

#[test]
fn blocked_parent_does_not_cover_an_eligible_child() {
    let temp = tempfile::tempdir().unwrap();
    let next = temp.path().join("app/.next");
    let cache = next.join("cache");
    fs::create_dir_all(&cache).unwrap();
    fs::write(cache.join("data.bin"), vec![b'x'; 512]).unwrap();

    let session = make_session(
        temp.path(),
        vec![
            // The parent is protected, so it will never be deleted. Its child
            // must still be planned independently instead of being reported as
            // covered by a parent that stays on disk.
            target("t-parent", next.clone(), "js.next", SafetyClass::Keep),
            target("t-child", cache.clone(), "js.next_cache", SafetyClass::Safe),
        ],
    );

    let plan = build_plan(
        &session,
        &["t-parent".into(), "t-child".into()],
        DeleteMode::RecycleBin,
        &catalog(),
        &policy(),
    )
    .unwrap();

    let parent = plan
        .items
        .iter()
        .find(|i| i.target_id == "t-parent")
        .unwrap();
    assert!(!parent.eligible);
    assert_eq!(parent.blocked_code.as_deref(), Some("PROTECTED"));

    let child = plan
        .items
        .iter()
        .find(|i| i.target_id == "t-child")
        .unwrap();
    assert!(
        child.eligible,
        "the child must not be covered by a blocked parent"
    );
    assert_eq!(plan.eligible_count, 1);
}

#[test]
fn duplicate_target_ids_are_processed_once() {
    let temp = tempfile::tempdir().unwrap();
    let nm = temp.path().join("app/node_modules");
    fs::create_dir_all(&nm).unwrap();
    let session = make_session(
        temp.path(),
        vec![target(
            "t-1",
            nm,
            "js.node_modules",
            SafetyClass::Regenerate,
        )],
    );
    let plan = build_plan(
        &session,
        &["t-1".into(), "t-1".into(), "t-1".into()],
        DeleteMode::RecycleBin,
        &catalog(),
        &policy(),
    )
    .unwrap();
    assert_eq!(plan.items.len(), 1);
    assert_eq!(plan.eligible_count, 1);
}

#[test]
fn unknown_target_ids_are_rejected() {
    let temp = tempfile::tempdir().unwrap();
    let session = make_session(temp.path(), vec![]);
    let result = build_plan(
        &session,
        &["t-unknown".into()],
        DeleteMode::RecycleBin,
        &catalog(),
        &policy(),
    );
    assert!(result.is_err());
}

#[test]
fn protected_targets_cannot_be_planned() {
    let temp = tempfile::tempdir().unwrap();
    let brain = temp.path().join("antigravity/brain");
    fs::create_dir_all(&brain).unwrap();
    let session = make_session(
        temp.path(),
        vec![target(
            "t-brain",
            brain,
            "antigravity.brain",
            SafetyClass::Keep,
        )],
    );
    let result = build_plan(
        &session,
        &["t-brain".into()],
        DeleteMode::Permanent,
        &catalog(),
        &policy(),
    );
    assert!(result.is_err());
}

#[test]
fn unmeasured_targets_are_blocked() {
    let temp = tempfile::tempdir().unwrap();
    let nm = temp.path().join("app/node_modules");
    fs::create_dir_all(&nm).unwrap();
    let mut t = target("t-1", nm, "js.node_modules", SafetyClass::Regenerate);
    t.logical_bytes = None;
    t.allocated_bytes = None;
    let session = make_session(temp.path(), vec![t]);
    let result = build_plan(
        &session,
        &["t-1".into()],
        DeleteMode::RecycleBin,
        &catalog(),
        &policy(),
    );
    assert!(result.is_err());
}

#[test]
fn permanent_mode_requires_explicit_acknowledgement() {
    let temp = tempfile::tempdir().unwrap();
    let nm = temp.path().join("app/node_modules");
    fs::create_dir_all(&nm).unwrap();
    let session = make_session(
        temp.path(),
        vec![target(
            "t-1",
            nm.clone(),
            "js.node_modules",
            SafetyClass::Regenerate,
        )],
    );
    let plan = build_plan(
        &session,
        &["t-1".into()],
        DeleteMode::Permanent,
        &catalog(),
        &policy(),
    )
    .unwrap();
    let err = execute_plan_deterministic(
        &plan,
        &session,
        &catalog(),
        &[],
        &plan.confirmation_token,
        false,
    );
    assert!(err.is_err());
    assert!(
        nm.exists(),
        "nothing may be deleted without acknowledgement"
    );
}

#[test]
fn permanent_execution_deletes_and_reports_measured_bytes() {
    let temp = tempfile::tempdir().unwrap();
    let nm = temp.path().join("app/node_modules");
    fs::create_dir_all(nm.join("pkg")).unwrap();
    fs::write(nm.join("pkg/index.js"), vec![b'x'; 4096]).unwrap();

    let session = make_session(
        temp.path(),
        vec![target(
            "t-1",
            nm.clone(),
            "js.node_modules",
            SafetyClass::Regenerate,
        )],
    );
    let plan = build_plan(
        &session,
        &["t-1".into()],
        DeleteMode::Permanent,
        &catalog(),
        &policy(),
    )
    .unwrap();
    let report = execute_plan_deterministic(
        &plan,
        &session,
        &catalog(),
        &[],
        &plan.confirmation_token,
        true,
    )
    .expect("execution");

    assert_eq!(report.success_count, 1);
    assert!(report.reclaim_bytes >= 4096);
    assert!(report.results[0].verified);
    assert!(!nm.exists());
    assert!(temp.path().join("app").exists());
}

#[test]
fn directory_growth_does_not_invalidate_the_plan() {
    let temp = tempfile::tempdir().unwrap();
    let nm = temp.path().join("app/node_modules");
    fs::create_dir_all(&nm).unwrap();
    fs::write(nm.join("a.js"), "one").unwrap();

    let session = make_session(
        temp.path(),
        vec![target(
            "t-1",
            nm.clone(),
            "js.node_modules",
            SafetyClass::Regenerate,
        )],
    );
    let plan = build_plan(
        &session,
        &["t-1".into()],
        DeleteMode::Permanent,
        &catalog(),
        &policy(),
    )
    .unwrap();

    fs::write(nm.join("b.js"), "two two two").unwrap();

    // A directory is identified by its NTFS object id only. Content growth is
    // an expected change between preview and execution and must not block it.
    let report = execute_plan_deterministic(
        &plan,
        &session,
        &catalog(),
        &[],
        &plan.confirmation_token,
        true,
    )
    .expect("execution");
    assert_eq!(report.success_count, 1);
    assert_eq!(report.error_count, 0);
    assert!(!nm.exists());
}

#[test]
fn missing_target_invalidates_the_plan() {
    let temp = tempfile::tempdir().unwrap();
    let nm = temp.path().join("app/node_modules");
    fs::create_dir_all(&nm).unwrap();
    fs::write(nm.join("a.js"), "one").unwrap();

    let session = make_session(
        temp.path(),
        vec![target(
            "t-1",
            nm.clone(),
            "js.node_modules",
            SafetyClass::Regenerate,
        )],
    );
    let plan = build_plan(
        &session,
        &["t-1".into()],
        DeleteMode::Permanent,
        &catalog(),
        &policy(),
    )
    .unwrap();

    fs::remove_dir_all(&nm).unwrap();

    let report = execute_plan_deterministic(
        &plan,
        &session,
        &catalog(),
        &[],
        &plan.confirmation_token,
        true,
    )
    .expect("execution");
    assert_eq!(report.success_count, 0);
    assert_eq!(
        report.results[0].error_code.as_deref(),
        Some("PLAN_CHANGED")
    );
}

#[test]
fn file_content_change_blocks_execution_and_keeps_the_target() {
    // End-to-end fault injection: the plan is built from a real file, the file
    // is mutated between preview and execution, and the coordinator must refuse
    // to delete it. `verify_snapshot` is unit-tested above; this covers the
    // wiring (snapshot capture in `build_plan` → fresh measure → block code) and
    // the most important property of all: the user's data survives.
    let temp = tempfile::tempdir().unwrap();
    let app = temp.path().join("app");
    fs::create_dir_all(&app).unwrap();
    let cache = app.join(".eslintcache");
    fs::write(&cache, vec![b'x'; 256]).unwrap();

    let session = make_session(
        temp.path(),
        vec![file_target(
            "t-file",
            cache.clone(),
            "js.eslintcache",
            SafetyClass::Safe,
        )],
    );
    let plan = build_plan(
        &session,
        &["t-file".into()],
        DeleteMode::Permanent,
        &catalog(),
        &policy(),
    )
    .unwrap();
    assert_eq!(
        plan.eligible_count, 1,
        "the previewed file must be eligible"
    );

    // The file is rewritten while the confirmation dialog is open. Size *and*
    // mtime change, which is exactly what a regenerated cache looks like.
    fs::write(&cache, vec![b'y'; 8192]).unwrap();

    let report = execute_plan_deterministic(
        &plan,
        &session,
        &catalog(),
        &[],
        &plan.confirmation_token,
        true,
    )
    .expect("execution reports results, not a hard error");
    assert_eq!(report.success_count, 0);
    assert_eq!(report.error_count, 1);
    assert_eq!(
        report.results[0].error_code.as_deref(),
        Some("CONTENT_CHANGED"),
        "a changed file is a content change, not a missing plan"
    );
    assert!(cache.exists(), "the mutated file must survive the attempt");
    assert_eq!(
        fs::metadata(&cache).unwrap().len(),
        8192,
        "the surviving file must still hold the new content"
    );
}

#[test]
fn verify_snapshot_separates_identity_from_content_changes() {
    let file = TargetSnapshot {
        exists: true,
        logical_bytes: 100,
        modified_secs: Some(10),
        file_id: Some("vol:1".to_string()),
        modified_nanos: Some(10_000),
    };

    // Same object, same content → verified.
    assert_eq!(
        verify_snapshot(TargetKind::File, &file, &file.clone(), Some(100)),
        VerificationOutcome::Verified
    );

    // Same object, different content → CONTENT_CHANGED, not PLAN_CHANGED.
    let grown = TargetSnapshot {
        logical_bytes: 200,
        modified_nanos: Some(20_000),
        ..file.clone()
    };
    assert_eq!(
        verify_snapshot(TargetKind::File, &file, &grown, Some(200)),
        VerificationOutcome::ContentChanged
    );

    // A different object at the same path → PLAN_CHANGED.
    let replaced = TargetSnapshot {
        file_id: Some("vol:2".to_string()),
        ..file.clone()
    };
    assert_eq!(
        verify_snapshot(TargetKind::File, &file, &replaced, Some(100)),
        VerificationOutcome::PlanChanged
    );

    // Unknown identity or unavailable measurement fails closed.
    let unknown = TargetSnapshot {
        file_id: None,
        ..file.clone()
    };
    assert_eq!(
        verify_snapshot(TargetKind::File, &file, &unknown, Some(100)),
        VerificationOutcome::NotMeasured
    );
    assert_eq!(
        verify_snapshot(TargetKind::File, &file, &file.clone(), None),
        VerificationOutcome::NotMeasured
    );

    // Directories ignore size and mtime; identity is authoritative.
    let directory = TargetSnapshot {
        logical_bytes: 0,
        ..file.clone()
    };
    let grown_directory = TargetSnapshot {
        logical_bytes: 4096,
        modified_nanos: Some(99_999),
        ..file.clone()
    };
    assert_eq!(
        verify_snapshot(
            TargetKind::Directory,
            &directory,
            &grown_directory,
            Some(4096)
        ),
        VerificationOutcome::Verified
    );
}

#[test]
fn wrong_confirmation_token_is_rejected() {
    let temp = tempfile::tempdir().unwrap();
    let nm = temp.path().join("app/node_modules");
    fs::create_dir_all(&nm).unwrap();
    let session = make_session(
        temp.path(),
        vec![target(
            "t-1",
            nm.clone(),
            "js.node_modules",
            SafetyClass::Regenerate,
        )],
    );
    let plan = build_plan(
        &session,
        &["t-1".into()],
        DeleteMode::Permanent,
        &catalog(),
        &policy(),
    )
    .unwrap();
    assert!(
        execute_plan_deterministic(&plan, &session, &catalog(), &[], "forged-token", true).is_err()
    );
    assert!(nm.exists());
}

#[test]
fn agent_cache_target_can_be_cleaned_without_a_project_catalog_rule() {
    let temp = tempfile::tempdir().unwrap();
    let tasks = temp.path().join(".claude").join("tasks");
    fs::create_dir_all(&tasks).unwrap();
    fs::write(tasks.join("output.txt"), vec![b'x'; 2048]).unwrap();

    let mut agent_target = target(
        "t-agent",
        tasks.clone(),
        "claude.tasks",
        SafetyClass::Review,
    );
    agent_target.provider = "claude-code".to_string();
    let session = make_session(temp.path(), vec![agent_target]);
    let plan = build_plan(
        &session,
        &["t-agent".into()],
        DeleteMode::Permanent,
        &catalog(),
        &policy(),
    )
    .unwrap();
    let report = execute_plan_deterministic(
        &plan,
        &session,
        &catalog(),
        &[],
        &plan.confirmation_token,
        true,
    )
    .expect("agent cache cleanup");
    assert_eq!(report.success_count, 1);
    assert!(!tasks.exists());
}

#[test]
fn agent_cache_setting_is_enforced_again_at_execution() {
    let temp = tempfile::tempdir().unwrap();
    let cache = temp.path().join(".claude").join("image-cache");
    fs::create_dir_all(&cache).unwrap();
    fs::write(cache.join("blob.bin"), vec![b'x'; 2048]).unwrap();

    let mut agent_target = target(
        "t-cache",
        cache.clone(),
        "claude.image_cache",
        SafetyClass::Safe,
    );
    agent_target.provider = "claude-code".to_string();
    agent_target.category = "cache".to_string();
    let session = make_session(temp.path(), vec![agent_target]);
    let plan = build_plan(
        &session,
        &["t-cache".into()],
        DeleteMode::Permanent,
        &catalog(),
        &policy(),
    )
    .unwrap();

    let disabled = crate::cleanup::CleanupPolicy {
        allow_agent_cache_cleanup: false,
        ..crate::cleanup::CleanupPolicy::default()
    };
    let report = crate::cleanup::coordinator::execute_plan_with_probe(
        &plan,
        &session,
        &catalog(),
        &disabled,
        &plan.confirmation_token,
        true,
        &|_, _| ActiveUse::No,
    )
    .unwrap();

    assert_eq!(report.success_count, 0);
    assert_eq!(
        report.results[0].error_code.as_deref(),
        Some("AGENT_CACHE_DISABLED")
    );
    assert!(cache.exists());
}

#[test]
fn browser_recording_setting_only_blocks_while_recently_active() {
    let temp = tempfile::tempdir().unwrap();
    let recordings = temp.path().join("antigravity/browser_recordings");
    fs::create_dir_all(&recordings).unwrap();
    fs::write(recordings.join("segment.webm"), vec![b'x'; 1024]).unwrap();

    let mut agent_target = target(
        "t-rec",
        recordings.clone(),
        "antigravity.browser_recordings",
        SafetyClass::Review,
    );
    agent_target.provider = "antigravity".to_string();
    agent_target.category = "browser-recordings".to_string();
    let session = make_session(temp.path(), vec![agent_target]);

    let protected = crate::cleanup::CleanupPolicy::default();
    assert!(build_plan(
        &session,
        &["t-rec".into()],
        DeleteMode::Permanent,
        &catalog(),
        &protected,
    )
    .is_err());

    let allowed = crate::cleanup::CleanupPolicy {
        protect_browser_recordings: false,
        ..crate::cleanup::CleanupPolicy::default()
    };
    let plan = build_plan(
        &session,
        &["t-rec".into()],
        DeleteMode::Permanent,
        &catalog(),
        &allowed,
    )
    .unwrap();
    assert_eq!(plan.eligible_count, 1);
}

#[test]
fn active_agent_blocks_execution_even_when_scan_was_idle() {
    let temp = tempfile::tempdir().unwrap();
    let tasks = temp.path().join(".claude").join("tasks");
    fs::create_dir_all(&tasks).unwrap();
    fs::write(tasks.join("output.txt"), vec![b'x'; 2048]).unwrap();

    let mut agent_target = target(
        "t-agent",
        tasks.clone(),
        "claude.tasks",
        SafetyClass::Review,
    );
    agent_target.provider = "claude-code".to_string();
    let session = make_session(temp.path(), vec![agent_target]);
    let plan = build_plan(
        &session,
        &["t-agent".into()],
        DeleteMode::Permanent,
        &catalog(),
        &policy(),
    )
    .unwrap();

    let report = crate::cleanup::coordinator::execute_plan_with_probe(
        &plan,
        &session,
        &catalog(),
        &policy(),
        &plan.confirmation_token,
        true,
        &|_, _| ActiveUse::Yes,
    )
    .expect("execution result");

    assert_eq!(report.success_count, 0);
    assert_eq!(report.results[0].error_code.as_deref(), Some("IN_USE"));
    assert!(tasks.exists(), "active provider data must never be deleted");
}

#[test]
fn unknown_provider_targets_are_blocked() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path().join("weird").join("cache");
    fs::create_dir_all(&dir).unwrap();
    let mut t = target("t-unknown", dir, "mystery.cache", SafetyClass::Review);
    t.provider = "mystery".to_string();
    let session = make_session(temp.path(), vec![t]);
    let plan = build_plan(
        &session,
        &["t-unknown".into()],
        DeleteMode::Permanent,
        &catalog(),
        &policy(),
    )
    .unwrap();
    let report = execute_plan_deterministic(
        &plan,
        &session,
        &catalog(),
        &[],
        &plan.confirmation_token,
        true,
    )
    .unwrap();
    assert_eq!(report.success_count, 0);
    assert_eq!(
        report.results[0].error_code.as_deref(),
        Some("AGENT_POLICY")
    );
}

#[test]
fn recreated_target_fails_identity_check() {
    let temp = tempfile::tempdir().unwrap();
    let nm = temp.path().join("app/node_modules");
    fs::create_dir_all(&nm).unwrap();
    fs::write(nm.join("a.js"), "one").unwrap();

    let session = make_session(
        temp.path(),
        vec![target(
            "t-1",
            nm.clone(),
            "js.node_modules",
            SafetyClass::Regenerate,
        )],
    );
    let plan = build_plan(
        &session,
        &["t-1".into()],
        DeleteMode::Permanent,
        &catalog(),
        &policy(),
    )
    .unwrap();

    fs::remove_dir_all(&nm).unwrap();
    fs::create_dir_all(&nm).unwrap();
    fs::write(nm.join("a.js"), "one").unwrap();
    fs::write(nm.join("new.js"), "new").unwrap();

    let report = execute_plan_deterministic(
        &plan,
        &session,
        &catalog(),
        &[],
        &plan.confirmation_token,
        true,
    )
    .unwrap();
    assert_eq!(report.success_count, 0);
    assert_eq!(
        report.results[0].error_code.as_deref(),
        Some("PLAN_CHANGED")
    );
    assert!(nm.exists());
}

#[test]
fn partial_batch_reports_success_and_failure_separately() {
    let temp = tempfile::tempdir().unwrap();
    let a = temp.path().join("app1/node_modules");
    let b = temp.path().join("app2/node_modules");
    fs::create_dir_all(&a).unwrap();
    fs::create_dir_all(&b).unwrap();
    fs::write(a.join("x.js"), vec![b'x'; 1024]).unwrap();
    fs::write(b.join("y.js"), vec![b'y'; 1024]).unwrap();

    let session = make_session(
        temp.path(),
        vec![
            target("t-a", a.clone(), "js.node_modules", SafetyClass::Regenerate),
            target("t-b", b.clone(), "js.node_modules", SafetyClass::Regenerate),
        ],
    );
    let plan = build_plan(
        &session,
        &["t-a".into(), "t-b".into()],
        DeleteMode::Permanent,
        &catalog(),
        &policy(),
    )
    .unwrap();

    // One target disappears between preview and execution.
    fs::remove_dir_all(&b).unwrap();

    let report = execute_plan_deterministic(
        &plan,
        &session,
        &catalog(),
        &[],
        &plan.confirmation_token,
        true,
    )
    .unwrap();
    assert_eq!(report.success_count, 1);
    assert_eq!(report.error_count, 1);
    assert!(!a.exists());
    assert!(!b.exists());
    assert_eq!(
        report
            .results
            .iter()
            .find(|r| r.target_id == "t-b")
            .unwrap()
            .error_code
            .as_deref(),
        Some("PLAN_CHANGED")
    );
}

#[test]
fn cancellation_between_items_stops_the_run() {
    use crate::cleanup::coordinator::CleanupEvent;
    use crate::scanner::cancellation::CancellationToken;

    let temp = tempfile::tempdir().unwrap();
    let a = temp.path().join("app1/node_modules");
    let b = temp.path().join("app2/node_modules");
    fs::create_dir_all(&a).unwrap();
    fs::create_dir_all(&b).unwrap();
    fs::write(a.join("x.js"), vec![b'x'; 1024]).unwrap();
    fs::write(b.join("y.js"), vec![b'y'; 1024]).unwrap();

    let session = make_session(
        temp.path(),
        vec![
            target("t-a", a.clone(), "js.node_modules", SafetyClass::Regenerate),
            target("t-b", b.clone(), "js.node_modules", SafetyClass::Regenerate),
        ],
    );
    let plan = build_plan(
        &session,
        &["t-a".into(), "t-b".into()],
        DeleteMode::Permanent,
        &catalog(),
        &policy(),
    )
    .unwrap();

    let token = CancellationToken::new();
    token.cancel();

    let events = std::sync::Mutex::new(Vec::new());
    let report = crate::cleanup::coordinator::execute_plan_with_hooks(
        &plan,
        &session,
        &catalog(),
        &policy(),
        &plan.confirmation_token,
        true,
        &|_, _| ActiveUse::No,
        &|event| events.lock().unwrap().push(event),
        &token,
    )
    .unwrap();

    assert!(report.cancelled);
    assert_eq!(report.processed_count, 0);
    assert_eq!(report.skipped_count, 2);
    assert!(a.exists(), "cancellation must not delete anything");
    assert!(b.exists(), "cancellation must not delete anything");

    let events = events.into_inner().unwrap();
    assert_eq!(events[0], CleanupEvent::Started { total: 2 });
    assert!(matches!(
        events.last(),
        Some(CleanupEvent::Cancelled {
            processed: 0,
            skipped: 2
        })
    ));
}

#[test]
fn progress_events_report_each_finished_item() {
    use crate::cleanup::coordinator::CleanupEvent;
    use crate::scanner::cancellation::CancellationToken;

    let temp = tempfile::tempdir().unwrap();
    let nm = temp.path().join("app/node_modules");
    fs::create_dir_all(&nm).unwrap();
    fs::write(nm.join("a.js"), "one").unwrap();

    let session = make_session(
        temp.path(),
        vec![target(
            "t-1",
            nm.clone(),
            "js.node_modules",
            SafetyClass::Regenerate,
        )],
    );
    let plan = build_plan(
        &session,
        &["t-1".into()],
        DeleteMode::Permanent,
        &catalog(),
        &policy(),
    )
    .unwrap();

    let events = std::sync::Mutex::new(Vec::new());
    let report = crate::cleanup::coordinator::execute_plan_with_hooks(
        &plan,
        &session,
        &catalog(),
        &policy(),
        &plan.confirmation_token,
        true,
        &|_, _| ActiveUse::No,
        &|event| events.lock().unwrap().push(event),
        &CancellationToken::new(),
    )
    .unwrap();

    assert_eq!(report.processed_count, 1);
    assert_eq!(report.skipped_count, 0);
    assert!(!report.cancelled);

    let events = events.into_inner().unwrap();
    assert_eq!(
        events,
        vec![
            CleanupEvent::Started { total: 1 },
            CleanupEvent::ItemStarted {
                index: 1,
                total: 1,
                display_path: nm.to_string_lossy().to_string(),
            },
            CleanupEvent::ItemFinished {
                index: 1,
                total: 1,
                success: true,
                error_code: None,
            },
        ]
    );
}

#[test]
fn read_only_target_never_reports_false_success() {
    let temp = tempfile::tempdir().unwrap();
    let nm = temp.path().join("app/node_modules");
    fs::create_dir_all(&nm).unwrap();
    let file = nm.join("locked.js");
    fs::write(&file, "x").unwrap();
    let mut perms = fs::metadata(&file).unwrap().permissions();
    perms.set_readonly(true);
    let _ = fs::set_permissions(&file, perms);

    let session = make_session(
        temp.path(),
        vec![target(
            "t-ro",
            nm.clone(),
            "js.node_modules",
            SafetyClass::Regenerate,
        )],
    );
    let plan = build_plan(
        &session,
        &["t-ro".into()],
        DeleteMode::Permanent,
        &catalog(),
        &policy(),
    )
    .unwrap();
    let report = execute_plan_deterministic(
        &plan,
        &session,
        &catalog(),
        &[],
        &plan.confirmation_token,
        true,
    )
    .unwrap();

    for result in &report.results {
        if result.success {
            assert!(!nm.exists(), "success requires the path to be gone");
        } else {
            assert!(result.error_code.is_some());
        }
    }
}

#[test]
fn official_actions_reject_unknown_and_read_only_requests() {
    use crate::cleanup::official_actions::{
        execute_action, preview_action, OfficialActionRegistry,
    };

    let registry = OfficialActionRegistry::new();
    let token = crate::scanner::cancellation::CancellationToken::new();
    assert!(preview_action(&registry, "not-a-tool", "x", &token).is_err());
    assert!(preview_action(&registry, "docker", "docker.prune", &token).is_err());
    assert!(execute_action(&registry, "forged-token").is_err());
}

#[test]
fn snapshot_identity_fails_closed_when_file_id_is_unknown() {
    use crate::cleanup::plan::TargetSnapshot;

    let unknown_a = TargetSnapshot {
        exists: true,
        logical_bytes: 10,
        modified_secs: Some(1),
        file_id: None,
        modified_nanos: None,
    };
    let unknown_b = unknown_a.clone();
    assert!(
        !unknown_a.identity_matches(&unknown_b),
        "unknown file ids must not be treated as a match"
    );

    let known_a = TargetSnapshot {
        file_id: Some("vol:1".to_string()),
        ..unknown_a.clone()
    };
    let known_b = TargetSnapshot {
        file_id: Some("vol:1".to_string()),
        ..unknown_a
    };
    assert!(known_a.identity_matches(&known_b));

    let different = TargetSnapshot {
        file_id: Some("vol:2".to_string()),
        ..known_b
    };
    assert!(!known_a.identity_matches(&different));
}

#[test]
fn volume_free_delta_is_signed() {
    use crate::cleanup::coordinator::signed_volume_delta;

    assert_eq!(signed_volume_delta(Some(100), Some(160)), Some(60));
    assert_eq!(
        signed_volume_delta(Some(160), Some(100)),
        Some(-60),
        "a decrease in free space must not be flattened to zero"
    );
    assert_eq!(signed_volume_delta(None, Some(1)), None);
    assert_eq!(signed_volume_delta(Some(1), None), None);
}

#[test]
fn incremental_plan_prunes_stale_slices_and_preserves_target_dir() {
    use crate::cleanup::build_plan_with_options;
    use filetime::{set_file_mtime, FileTime};
    use std::time::{SystemTime, UNIX_EPOCH};

    let temp = tempfile::tempdir().unwrap();
    let app = temp.path().join("rust-app");
    let target_dir = app.join("target");
    let old_inc = target_dir
        .join("debug")
        .join("incremental")
        .join("app-123")
        .join("s-old");
    let fresh_inc = target_dir
        .join("debug")
        .join("incremental")
        .join("app-123")
        .join("s-fresh");
    fs::create_dir_all(&old_inc).unwrap();
    fs::create_dir_all(&fresh_inc).unwrap();
    fs::write(app.join("Cargo.toml"), "[package]\nname = \"app\"\n").unwrap();
    fs::write(
        target_dir.join("CACHEDIR.TAG"),
        "Signature: 8a477f597d28d172789f06886806bc55",
    )
    .unwrap();
    let old_bin = old_inc.join("dep-graph.bin");
    let fresh_bin = fresh_inc.join("dep-graph.bin");
    fs::write(&old_bin, vec![b'a'; 4096]).unwrap();
    fs::write(&fresh_bin, vec![b'b'; 2048]).unwrap();

    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let old_ft = FileTime::from_unix_time(now_secs - 30 * 86_400, 0);
    set_file_mtime(&old_bin, old_ft).unwrap();
    set_file_mtime(&old_inc, old_ft).unwrap();

    let mut rust_target = target(
        "t-rust",
        target_dir.clone(),
        "rs.target",
        SafetyClass::Regenerate,
    );
    rust_target.evidence.marker_hits = vec!["Cargo.toml".into()];
    rust_target.evidence.content_hits = vec!["CACHEDIR.TAG".into()];
    let session = make_session(temp.path(), vec![rust_target]);

    let plan = build_plan_with_options(
        &session,
        &["t-rust".into()],
        DeleteMode::Permanent,
        &catalog(),
        &policy(),
        Some(14),
    )
    .expect("build incremental plan");

    assert_eq!(plan.incremental_older_than_days, Some(14));
    assert_eq!(plan.eligible_count, 1);
    assert_eq!(plan.total_estimated_bytes, 4096);
    assert_eq!(plan.items[0].incremental_slice_count, Some(1));

    let report = execute_plan_deterministic(
        &plan,
        &session,
        &catalog(),
        &[],
        &plan.confirmation_token,
        true,
    )
    .expect("execute incremental plan");

    assert_eq!(report.success_count, 1);
    assert_eq!(report.reclaim_bytes, 4096);
    assert!(
        !old_inc.exists(),
        "stale incremental session must be pruned"
    );
    assert!(
        fresh_inc.exists(),
        "recent incremental session must stay warm"
    );
    assert!(
        target_dir.exists(),
        "parent target/ directory must remain intact"
    );
}
