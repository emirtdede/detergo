//! SEC-28 execution: killing the process during a multi-item permanent delete
//! must not produce a false audit record.
//!
//! The 2.0.0 audit listed "crash during deletion" as PENDING. This test runs the
//! real pipeline (scan → plan → permanent delete → audit write) in a child
//! process, kills that process while it is deleting, and then verifies:
//!
//!   * some targets are gone (the delete really was in progress),
//!   * some targets remain (the run did not finish),
//!   * no history record exists for the interrupted run, so a restart cannot
//!     show a success that never happened.
//!
//! It writes only to a temp APPDATA and a temp fixture, and runs as a normal
//! `cargo test` (no `--ignored` flag needed).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};

const PROJECTS: usize = 500;
const CHILD_ENV: &str = "NC_CRASH_CHILD";

fn build_fixture(root: &Path) {
    for i in 0..PROJECTS {
        let project = root.join(format!("proj-{:04}", i));
        let modules = project.join("node_modules").join("dep");
        fs::create_dir_all(&modules).expect("create fixture");
        fs::write(project.join("package.json"), b"{\"name\":\"crash-probe\"}")
            .expect("package.json");
        for f in 0..6 {
            fs::write(
                modules.join(format!("file-{}.js", f)),
                b"module.exports = 1;\n",
            )
            .expect("file");
        }
    }
}

fn remaining_targets(root: &Path) -> usize {
    let mut count = 0;
    for entry in fs::read_dir(root).expect("read fixture") {
        let path = entry.expect("entry").path();
        if path.join("node_modules").exists() {
            count += 1;
        }
    }
    count
}

fn child_main() {
    let root = PathBuf::from(std::env::var("NC_CRASH_FIXTURE").expect("fixture env"));
    let catalog = Arc::new(node_cleaner_lib::catalog::CatalogIndex::embedded().expect("catalog"));
    let policy = node_cleaner_lib::cleanup::CleanupPolicy::default();
    let registry = node_cleaner_lib::scanner::ScanRegistry::new();
    let roots = vec![root.clone()];
    let session = registry.create_session(
        node_cleaner_lib::scanner::models::ScanScope::Project,
        root.clone(),
        roots,
    );

    let request = node_cleaner_lib::scanner::models::ScanRequest {
        root_path: root.to_string_lossy().to_string(),
        exclusions: Vec::new(),
        scope: node_cleaner_lib::scanner::models::ScanScope::Project,
        profile: Some("balanced".to_string()),
        max_depth: Some(16),
        max_candidates: Some(50_000),
        timeout_minutes: Some(5),
        min_size_bytes: Some(0),
        protected_paths: Vec::new(),
    };

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("runtime");

    runtime
        .block_on(node_cleaner_lib::scanner::run_scan(
            request,
            session.clone(),
            node_cleaner_lib::scanner::cancellation::CancellationToken::new(),
            catalog.clone(),
            &policy,
            |_| {},
        ))
        .expect("scan");

    let handle = session.lock().unwrap();
    let ids: Vec<String> = handle.targets.keys().cloned().collect();
    assert_eq!(ids.len(), PROJECTS, "expected one target per project");
    let plan = node_cleaner_lib::cleanup::build_plan(
        &handle,
        &ids,
        node_cleaner_lib::cleanup::DeleteMode::Permanent,
        &catalog,
        &policy,
    )
    .expect("plan");

    let report = node_cleaner_lib::cleanup::execute_plan(
        &plan,
        &handle,
        &catalog,
        &policy,
        &plan.confirmation_token,
        true,
        &node_cleaner_lib::scanner::cancellation::CancellationToken::new(),
    )
    .expect("execute");
    drop(handle);

    // Only a completed run is recorded — this is the line the crash must skip.
    let repo = node_cleaner_lib::audit::AuditRepository::new();
    let record = node_cleaner_lib::audit::AuditRecord {
        id: "h-child".to_string(),
        timestamp: "2026-11-01T00:00:00Z".to_string(),
        session_id: plan.session_id.clone(),
        plan_id: plan.id.clone(),
        mode: node_cleaner_lib::cleanup::DeleteMode::Permanent,
        success_count: report.success_count,
        error_count: report.error_count,
        reclaim_bytes: report.reclaim_bytes,
        moved_bytes: report.moved_bytes,
        duration_ms: report.duration_ms,
        entries: Vec::new(),
        cancelled: report.cancelled,
        processed_count: report.processed_count,
        skipped_count: report.skipped_count,
    };
    repo.append_record(&record).expect("audit write");
}

#[test]
fn crash_during_permanent_delete_writes_no_audit_record() {
    if std::env::var(CHILD_ENV).ok().as_deref() == Some("1") {
        child_main();
        return;
    }

    let fixture = std::env::temp_dir().join(format!("nc-crash-{}", uuid::Uuid::new_v4().simple()));
    let appdata = std::env::temp_dir().join(format!(
        "nc-crash-appdata-{}",
        uuid::Uuid::new_v4().simple()
    ));
    fs::create_dir_all(&fixture).expect("fixture root");
    fs::create_dir_all(&appdata).expect("appdata root");
    build_fixture(&fixture);

    let exe = std::env::current_exe().expect("current exe");
    let mut child = Command::new(&exe)
        .args([
            "--exact",
            "crash_during_permanent_delete_writes_no_audit_record",
            "--nocapture",
            "--test-threads=1",
        ])
        .env(CHILD_ENV, "1")
        .env("NC_CRASH_FIXTURE", &fixture)
        .env("APPDATA", &appdata)
        .spawn()
        .expect("spawn child");

    // Wait until deletion has visibly started but is still running, then kill.
    let deadline = Instant::now() + Duration::from_secs(120);
    let mut killed_midway = false;
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(15));
        if let Ok(Some(_)) = child.try_wait() {
            break;
        }
        let remaining = remaining_targets(&fixture);
        if remaining > 0 && remaining < PROJECTS {
            let _ = child.kill();
            killed_midway = true;
            break;
        }
        if remaining == 0 {
            break;
        }
    }
    let _ = child.wait();

    assert!(
        killed_midway,
        "the child finished before a mid-delete kill was possible; \
         the fixture must be large enough for the window to exist"
    );

    let remaining = remaining_targets(&fixture);
    assert!(
        remaining > 0,
        "interrupted run must leave unfinished targets on disk"
    );
    assert!(
        remaining < PROJECTS,
        "the delete must actually have removed something before the kill"
    );

    // No history file, or an empty one: the interrupted run was never recorded.
    let history = appdata.join("node-cleaner").join("history.jsonl");
    let recorded = fs::read_to_string(&history).unwrap_or_default();
    assert!(
        recorded.trim().is_empty(),
        "a killed run must not leave an audit record: {recorded}"
    );

    let _ = fs::remove_dir_all(&fixture);
    let _ = fs::remove_dir_all(&appdata);
}
