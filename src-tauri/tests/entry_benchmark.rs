//! Directory-entry traversal benchmark, executed only when explicitly requested.
//!
//! The release checklist also asks for a 1,000,000-directory-entry tree. That is
//! a *walk* cost, not a candidate count: most of those entries are ordinary
//! folders and files the scanner must skip over. This test builds a wide,
//! mostly-irrelevant tree (few real targets) and reports the observed walk time
//! and peak working set.
//!
//! ```text
//! $env:NC_ENTRY_BENCH=1000000
//! cargo test --release --test entry_benchmark -- --ignored --nocapture
//! ```
//!
//! Everything is created under a unique temp root and removed afterwards.

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use node_cleaner_lib::catalog::CatalogIndex;
use node_cleaner_lib::cleanup::CleanupPolicy;
use node_cleaner_lib::scanner::cancellation::CancellationToken;
use node_cleaner_lib::scanner::models::{ScanRequest, ScanScope};
use node_cleaner_lib::scanner::run_scan;
use node_cleaner_lib::scanner::ScanRegistry;

/// Creates `dirs` folders of `files` files each, plus one real `node_modules`
/// deep in the tree so discovery has something legitimate to find.
fn wide_tree(root: &Path, dirs: usize, files_per_dir: usize) -> u64 {
    let mut entries = 0u64;
    for d in 0..dirs {
        let dir = root.join(format!("d{:05}", d));
        fs::create_dir_all(&dir).expect("create dir");
        entries += 1;
        for f in 0..files_per_dir {
            fs::write(dir.join(format!("f{}.txt", f)), b"x").expect("write file");
            entries += 1;
        }
    }
    let real = root
        .join("a")
        .join("b")
        .join("project")
        .join("node_modules");
    fs::create_dir_all(&real).expect("create target");
    fs::write(
        root.join("a")
            .join("b")
            .join("project")
            .join("package.json"),
        b"{\"name\":\"entry-bench\"}",
    )
    .expect("write package.json");
    fs::write(real.join("index.js"), b"module.exports=1;\n").expect("write target file");
    entries += 5;
    entries
}

#[cfg(windows)]
fn peak_working_set_bytes() -> Option<u64> {
    use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows::Win32::System::Threading::GetCurrentProcess;

    let mut counters = PROCESS_MEMORY_COUNTERS {
        cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        ..Default::default()
    };
    let ok = unsafe { GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, counters.cb) };
    ok.ok().map(|_| counters.PeakWorkingSetSize as u64)
}

#[cfg(not(windows))]
fn peak_working_set_bytes() -> Option<u64> {
    None
}

#[test]
#[ignore = "creates a very large synthetic tree; run explicitly"]
fn directory_entry_benchmark() {
    let total_entries = std::env::var("NC_ENTRY_BENCH")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(1_000_000);
    // Two entries per folder (the folder + one file) keeps the on-disk inode
    // count proportional to the requested entry count.
    let dirs = (total_entries / 2).max(1);

    let root = std::env::temp_dir().join(format!(
        "nc-entries-{}-{}",
        total_entries,
        std::process::id()
    ));
    if root.exists() {
        let _ = fs::remove_dir_all(&root);
    }
    fs::create_dir_all(&root).expect("create bench root");

    let build_started = Instant::now();
    let entries = wide_tree(&root, dirs, 1);
    let build_ms = build_started.elapsed().as_millis() as u64;

    let catalog = Arc::new(CatalogIndex::embedded().expect("embedded catalog"));
    let policy = CleanupPolicy::default();
    let registry = ScanRegistry::new();
    let roots = vec![root.clone()];
    let session = registry.create_session(ScanScope::Project, root.clone(), roots);

    let events = Arc::new(Mutex::new(0u64));
    let counter = events.clone();
    let callback = move |_event| {
        if let Ok(mut n) = counter.lock() {
            *n += 1;
        }
    };

    let request = ScanRequest {
        root_path: root.to_string_lossy().to_string(),
        exclusions: Vec::new(),
        scope: ScanScope::Project,
        profile: Some("deep".to_string()),
        max_depth: Some(64),
        max_candidates: Some(100_000),
        timeout_minutes: Some(30),
        min_size_bytes: Some(0),
        protected_paths: Vec::new(),
    };

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("tokio runtime");

    let started = Instant::now();
    let summary = runtime
        .block_on(run_scan(
            request,
            session,
            CancellationToken::new(),
            catalog,
            &policy,
            callback,
        ))
        .expect("scan failed");
    let scan_ms = started.elapsed().as_millis() as u64;
    let peak = peak_working_set_bytes();

    println!("NC_ENTRY requested_entries={total_entries}");
    println!("NC_ENTRY dirs={dirs}");
    println!("NC_ENTRY built_entries={entries}");
    println!("NC_ENTRY build_ms={build_ms}");
    println!(
        "NC_ENTRY directories_visited={}",
        summary.directories_visited
    );
    println!("NC_ENTRY candidates={}", summary.total_entries);
    println!("NC_ENTRY scan_ms={scan_ms}");
    println!("NC_ENTRY partial={}", summary.partial);
    println!("NC_ENTRY stop_reason={:?}", summary.stop_reason);
    println!("NC_ENTRY events={}", events.lock().map(|n| *n).unwrap_or(0));
    if let Some(peak) = peak {
        println!(
            "NC_ENTRY peak_working_set_mb={:.1}",
            peak as f64 / (1024.0 * 1024.0)
        );
    }

    let cleanup_started = Instant::now();
    let _ = fs::remove_dir_all(&root);
    println!(
        "NC_ENTRY cleanup_ms={}",
        cleanup_started.elapsed().as_millis()
    );

    assert_eq!(
        summary.stop_reason, None,
        "entry benchmark must traverse the whole tree without stopping early"
    );
    assert_eq!(
        summary.total_entries, 1,
        "the wide tree contains exactly one legitimate cleanup target"
    );
}
