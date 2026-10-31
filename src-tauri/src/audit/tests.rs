use super::*;
use crate::cleanup::DeleteMode;

#[test]
fn audit_records_roundtrip_and_are_ordered() {
    let temp = tempfile::tempdir().unwrap();
    let repo = AuditRepository::with_paths(
        temp.path().join("history.jsonl"),
        temp.path().join("snapshots.jsonl"),
    );

    for i in 0..3 {
        let record = AuditRecord {
            id: format!("h-{}", i),
            timestamp: format!("2026-10-28T10:0{}:00+03:00", i),
            session_id: "s".into(),
            plan_id: "p".into(),
            mode: DeleteMode::Permanent,
            success_count: 1,
            error_count: 0,
            reclaim_bytes: 100,
            moved_bytes: 100,
            duration_ms: 5,
            entries: vec![AuditEntry {
                target_id: "t".into(),
                rule_id: "js.node_modules".into(),
                path: "C:\\proj\\node_modules".into(),
                success: true,
                verified: true,
                error_code: None,
                bytes: 100,
            }],
        };
        repo.append_record(&record).unwrap();
    }

    let records = repo.list_records(2);
    assert_eq!(records.len(), 2);
    assert_eq!(records[1].id, "h-2");
}

#[test]
fn malformed_history_lines_are_ignored() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("history.jsonl");
    std::fs::write(&path, "{bad}\n\n").unwrap();
    let repo = AuditRepository::with_paths(path, temp.path().join("snapshots.jsonl"));
    assert!(repo.list_records(10).is_empty());
}

#[test]
fn growth_analysis_uses_the_two_latest_snapshots() {
    let snapshots = vec![
        StorageSnapshot {
            timestamp: "2026-10-28T10:00:00+00:00".into(),
            provider: "codex".into(),
            category: "sessions".into(),
            bytes: 1_000,
            item_count: 1,
        },
        StorageSnapshot {
            timestamp: "2026-10-28T11:00:00+00:00".into(),
            provider: "codex".into(),
            category: "sessions".into(),
            bytes: 3_000,
            item_count: 1,
        },
        StorageSnapshot {
            timestamp: "2026-10-28T12:00:00+00:00".into(),
            provider: "codex".into(),
            category: "sessions".into(),
            bytes: 5_000,
            item_count: 1,
        },
    ];
    let growth = crate::providers::growth::analyze_growth(&snapshots);
    assert_eq!(growth.len(), 1);
    assert_eq!(growth[0].delta_bytes, 2_000);
    assert_eq!(growth[0].window_seconds, 3_600);
    assert_eq!(growth[0].level, "ok");
}
