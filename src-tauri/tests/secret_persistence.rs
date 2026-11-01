//! SEC-26 execution: a scan must never copy project file *contents* or secret
//! values into anything Node Cleaner persists.
//!
//! The 2.0.0 audit left this as "review-verified, execution pending". This test
//! executes it: it builds a fake project whose `.env` and `node_modules` content
//! contain a unique canary string, runs the real scanner against it, writes a
//! real cleanup audit record, and then proves the canary appears nowhere in the
//! app's own storage files.

use std::fs;
use std::path::Path;
use std::sync::Arc;

use node_cleaner_lib::audit::{
    AuditEntry, AuditRecord, AuditRepository,
};
use node_cleaner_lib::catalog::CatalogIndex;
use node_cleaner_lib::cleanup::{build_plan, DeleteMode};
use node_cleaner_lib::cleanup::CleanupPolicy;
use node_cleaner_lib::scanner::cancellation::CancellationToken;
use node_cleaner_lib::scanner::models::{ScanRequest, ScanScope};
use node_cleaner_lib::scanner::run_scan;
use node_cleaner_lib::scanner::ScanRegistry;

fn canary() -> String {
    format!(
        "SK-FAKE-LEAK-CANARY-{}",
        uuid::Uuid::new_v4().simple()
    )
}

fn write_project(root: &Path, secret: &str) {
    let project = root.join("webapp");
    let modules = project.join("node_modules").join("dummy-dep");
    fs::create_dir_all(&modules).expect("create project");
    fs::write(
        project.join("package.json"),
        b"{\"name\":\"leak-probe\",\"version\":\"1.0.0\"}",
    )
    .expect("package.json");
    fs::write(project.join(".env"), format!("API_KEY={secret}\n")).expect(".env");
    fs::write(
        modules.join("index.js"),
        format!("export const key = \"{secret}\";\n"),
    )
    .expect("index.js");
    fs::write(modules.join("README.md"), b"# dummy\n").expect("readme");
}

#[test]
fn scan_and_audit_never_persist_file_contents_or_secrets() {
    let secret = canary();
    let root = std::env::temp_dir().join(format!("nc-leak-{}", uuid::Uuid::new_v4().simple()));
    write_project(&root, &secret);

    let audit_dir = std::env::temp_dir().join(format!("nc-audit-{}", uuid::Uuid::new_v4().simple()));
    let repo = AuditRepository::with_paths(
        audit_dir.join("history.jsonl"),
        audit_dir.join("snapshots.jsonl"),
    );

    let catalog = Arc::new(CatalogIndex::embedded().expect("catalog"));
    let policy = CleanupPolicy::default();
    let registry = ScanRegistry::new();
    let roots = vec![root.clone()];
    let session = registry.create_session(ScanScope::Project, root.clone(), roots);

    let request = ScanRequest {
        root_path: root.to_string_lossy().to_string(),
        exclusions: Vec::new(),
        scope: ScanScope::Project,
        profile: Some("balanced".to_string()),
        max_depth: Some(16),
        max_candidates: Some(500),
        timeout_minutes: Some(5),
        min_size_bytes: Some(0),
        protected_paths: Vec::new(),
    };

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
        .expect("runtime");

    let summary = runtime
        .block_on(run_scan(
            request,
            session.clone(),
            CancellationToken::new(),
            catalog.clone(),
            &policy,
            |_| {},
        ))
        .expect("scan failed");
    assert!(summary.total_entries >= 1, "fixture must produce a candidate");

    // Build a plan for whatever the scan found, then persist a real audit record
    // exactly as `execute_cleanup` would.
    let handle = session.lock().unwrap();
    let target_ids: Vec<String> = handle.targets.keys().cloned().collect();
    assert!(!target_ids.is_empty(), "expected a stored target");
    let plan = build_plan(&handle, &target_ids, DeleteMode::RecycleBin, &catalog, &policy)
        .expect("plan");
    let record = AuditRecord {
        id: "h-test".to_string(),
        timestamp: "2026-11-01T00:00:00Z".to_string(),
        session_id: handle.id.clone(),
        plan_id: plan.id.clone(),
        mode: DeleteMode::RecycleBin,
        success_count: 1,
        error_count: 0,
        reclaim_bytes: 0,
        moved_bytes: 0,
        duration_ms: 1,
        entries: plan
            .items
            .iter()
            .map(|item| AuditEntry {
                target_id: item.target_id.clone(),
                rule_id: item.rule_id.clone(),
                path: item.display_path.clone(),
                success: true,
                verified: true,
                error_code: None,
                bytes: item.logical_bytes,
            })
            .collect(),
    };
    drop(handle);

    repo.append_record(&record).expect("audit write");
    repo.append_snapshots(&[node_cleaner_lib::audit::StorageSnapshot {
        timestamp: "2026-11-01T00:00:00Z".to_string(),
        provider: "project".to_string(),
        category: "dependencies".to_string(),
        bytes: 128,
        item_count: 1,
    }])
    .expect("snapshot write");

    // Every file the app persisted must be free of the canary, and must not hold
    // a copy of a project file.
    let mut checked = 0usize;
    for entry in fs::read_dir(&audit_dir).expect("read audit dir") {
        let path = entry.expect("dir entry").path();
        if !path.is_file() {
            continue;
        }
        let text = fs::read_to_string(&path).expect("read audit file");
        assert!(
            !text.contains(&secret),
            "secret leaked into {}",
            path.display()
        );
        assert!(
            !text.contains("export const key"),
            "project file contents copied into {}",
            path.display()
        );
        checked += 1;
    }
    assert!(checked >= 2, "expected history and snapshots files to exist");

    // The record itself must still be usable: the secret-free path is stored.
    let records = repo.list_records(10);
    assert_eq!(records.len(), 1);
    assert!(records[0].entries[0].path.contains("node_modules"));

    let _ = fs::remove_dir_all(&root);
    let _ = fs::remove_dir_all(&audit_dir);
}
