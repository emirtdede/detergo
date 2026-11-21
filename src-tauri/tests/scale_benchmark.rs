//! Large-scale scan benchmark, executed only when explicitly requested.
//!
//! The release checklist requires measurements for 10,000 / 50,000 candidates
//! and a 1,000,000-entry tree. Those numbers cannot come from unit tests, and
//! fabricating them is worse than leaving them unmeasured. This harness builds a
//! synthetic tree of that shape in the system temp directory and reports what
//! the real scanner did:
//!
//! ```text
//! $env:NC_BENCH_CANDIDATES=10000
//! cargo test --release --test scale_benchmark -- --ignored --nocapture
//! ```
//!
//! It never touches user data: everything is created under a unique temp root
//! and deleted afterwards. Results are printed as `NC_BENCH` lines so the exact
//! numbers can be copied into `docs/release/TEST_MATRIX.md`.

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use detergo_lib::catalog::CatalogIndex;
use detergo_lib::cleanup::CleanupPolicy;
use detergo_lib::scanner::cancellation::CancellationToken;
use detergo_lib::scanner::models::{ScanRequest, ScanScope};
use detergo_lib::scanner::run_scan;
use detergo_lib::scanner::ScanRegistry;

fn synthetic_tree(root: &Path, projects: usize, files_per_project: usize) -> u64 {
    let mut entries = 0u64;
    for i in 0..projects {
        let project = root.join(format!("proj-{:05}", i));
        let modules = project.join("node_modules");
        let dep = modules.join("dep-package");
        fs::create_dir_all(&dep).expect("create node_modules");
        fs::write(project.join("package.json"), b"{\"name\":\"bench\"}")
            .expect("write package.json");
        fs::write(dep.join("index.js"), b"module.exports = 1;\n").expect("write js");
        entries += 4;
        // Fill the project with ordinary source files so the walker has to
        // traverse a realistic number of directory entries around the target.
        let src = project.join("src");
        fs::create_dir_all(&src).expect("create src");
        for f in 0..files_per_project {
            fs::write(src.join(format!("file-{}.ts", f)), b"export const x = 1;\n")
                .expect("write source file");
            entries += 1;
        }
        entries += 1;
    }
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
#[ignore = "creates a large synthetic tree; run explicitly"]
fn scan_scale_benchmark() {
    let projects = std::env::var("NC_BENCH_CANDIDATES")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(10_000);
    let files_per_project = std::env::var("NC_BENCH_FILES_PER_PROJECT")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(2);

    let root = std::env::temp_dir().join(format!("nc-bench-{}-{}", projects, std::process::id()));
    if root.exists() {
        let _ = fs::remove_dir_all(&root);
    }
    fs::create_dir_all(&root).expect("create bench root");

    let build_started = Instant::now();
    let entries = synthetic_tree(&root, projects, files_per_project);
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
        include_agents: None,
        profile: Some("balanced".to_string()),
        max_depth: Some(32),
        max_candidates: Some((projects as u64) * 4 + 10_000),
        timeout_minutes: Some(15),
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
    let event_count = events.lock().map(|n| *n).unwrap_or(0);

    println!("NC_BENCH projects={projects}");
    println!("NC_BENCH files_per_project={files_per_project}");
    println!("NC_BENCH built_entries={entries}");
    println!("NC_BENCH build_ms={build_ms}");
    println!("NC_BENCH candidates={}", summary.total_entries);
    println!(
        "NC_BENCH directories_visited={}",
        summary.directories_visited
    );
    println!("NC_BENCH scan_ms={scan_ms}");
    println!("NC_BENCH partial={}", summary.partial);
    println!("NC_BENCH stop_reason={:?}", summary.stop_reason);
    println!("NC_BENCH events={event_count}");
    if let Some(peak) = peak {
        println!(
            "NC_BENCH peak_working_set_mb={:.1}",
            peak as f64 / (1024.0 * 1024.0)
        );
    }

    let cleanup_started = Instant::now();
    let _ = fs::remove_dir_all(&root);
    println!(
        "NC_BENCH cleanup_ms={}",
        cleanup_started.elapsed().as_millis()
    );

    assert_eq!(
        summary.stop_reason, None,
        "benchmark scan must complete, not stop early"
    );
}

/// Cancel reaction on a large tree: how long after `cancel()` does the scan
/// actually return, and does it report a partial result instead of a size?
///
/// ```text
/// $env:NC_CANCEL_CANDIDATES=20000
/// cargo test --release --test scale_benchmark cancel_latency -- --ignored --nocapture
/// ```
#[test]
#[ignore = "creates a large synthetic tree; run explicitly"]
fn cancel_latency_benchmark() {
    let projects = std::env::var("NC_CANCEL_CANDIDATES")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(20_000);
    let files_per_project = 2;

    let root = std::env::temp_dir().join(format!("nc-cancel-{}-{}", projects, std::process::id()));
    if root.exists() {
        let _ = fs::remove_dir_all(&root);
    }
    fs::create_dir_all(&root).expect("create cancel root");
    let entries = synthetic_tree(&root, projects, files_per_project);

    let catalog = Arc::new(CatalogIndex::embedded().expect("embedded catalog"));
    let policy = CleanupPolicy::default();
    let registry = ScanRegistry::new();
    let roots = vec![root.clone()];
    let session = registry.create_session(ScanScope::Project, root.clone(), roots);
    let token = CancellationToken::new();

    let request = ScanRequest {
        root_path: root.to_string_lossy().to_string(),
        exclusions: Vec::new(),
        scope: ScanScope::Project,
        include_agents: None,
        profile: Some("deep".to_string()),
        max_depth: Some(32),
        max_candidates: Some((projects as u64) * 4 + 10_000),
        timeout_minutes: Some(15),
        min_size_bytes: Some(0),
        protected_paths: Vec::new(),
    };

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("tokio runtime");

    let child_token = token.clone();
    let handle = std::thread::spawn(move || {
        runtime.block_on(run_scan(
            request,
            session,
            child_token,
            catalog,
            &policy,
            |_| {},
        ))
    });

    // Let the scan get going, then cancel and time how long it takes to stop.
    std::thread::sleep(std::time::Duration::from_millis(1500));
    let cancelled_at = Instant::now();
    token.cancel();
    let summary = handle
        .join()
        .expect("scan thread panicked")
        .expect("scan failed");
    let reaction_ms = cancelled_at.elapsed().as_millis() as u64;

    println!("NC_CANCEL projects={projects}");
    println!("NC_CANCEL built_entries={entries}");
    println!(
        "NC_CANCEL directories_visited={}",
        summary.directories_visited
    );
    println!("NC_CANCEL partial={}", summary.partial);
    println!("NC_CANCEL reaction_ms={reaction_ms}");

    let cleanup_started = Instant::now();
    let _ = fs::remove_dir_all(&root);
    println!(
        "NC_CANCEL cleanup_ms={}",
        cleanup_started.elapsed().as_millis()
    );

    assert!(summary.partial, "a cancelled scan must be reported partial");
    assert!(
        reaction_ms < 5_000,
        "cancel took {reaction_ms} ms; the UI thread would look frozen"
    );
}
