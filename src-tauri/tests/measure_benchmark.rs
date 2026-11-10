//! Measurement benchmark for recording-heavy folders (300,000 files), executed
//! only when explicitly requested.
//!
//! The release checklist asks for a 300,000-recording measurement. That path is
//! `measure_path`, which is metadata-only: it must not read file contents and
//! must not blow up memory on a directory with a huge number of entries.
//!
//! ```text
//! $env:NC_RECORDINGS=300000
//! cargo test --release --test measure_benchmark -- --ignored --nocapture
//! ```

use std::fs;
use std::path::Path;
use std::time::Instant;

use node_cleaner_lib::catalog::model::TargetKind;
use node_cleaner_lib::scanner::cancellation::CancellationToken;
use node_cleaner_lib::scanner::measurement::measure_path;

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

fn build_recordings(root: &Path, count: usize) -> u64 {
    let mut bytes = 0u64;
    for i in 0..count {
        // ~1 KiB payload, which is representative of a screen-event chunk.
        let payload = vec![b'r'; 1024];
        fs::write(root.join(format!("rec-{:06}.bin", i)), &payload).expect("write recording");
        bytes += payload.len() as u64;
    }
    bytes
}

#[test]
#[ignore = "creates hundreds of thousands of files; run explicitly"]
fn recordings_measurement_benchmark() {
    let count = std::env::var("NC_RECORDINGS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(300_000);

    let root = std::env::temp_dir().join(format!("nc-recordings-{}-{}", count, std::process::id()));
    if root.exists() {
        let _ = fs::remove_dir_all(&root);
    }
    fs::create_dir_all(&root).expect("create recordings root");

    let build_started = Instant::now();
    let expected_bytes = build_recordings(&root, count);
    let build_ms = build_started.elapsed().as_millis() as u64;

    let started = Instant::now();
    let measured = measure_path(&root, TargetKind::Directory, &CancellationToken::new());
    let measure_ms = started.elapsed().as_millis() as u64;
    let peak = peak_working_set_bytes();

    let size = measured.expect("measurement must complete");
    println!("NC_RECORDINGS files={count}");
    println!("NC_RECORDINGS expected_bytes={expected_bytes}");
    println!("NC_RECORDINGS logical_bytes={}", size.logical_bytes);
    println!("NC_RECORDINGS file_count={:?}", size.file_count);
    println!("NC_RECORDINGS build_ms={build_ms}");
    println!("NC_RECORDINGS measure_ms={measure_ms}");
    if let Some(peak) = peak {
        println!(
            "NC_RECORDINGS peak_working_set_mb={:.1}",
            peak as f64 / (1024.0 * 1024.0)
        );
    }

    let cleanup_started = Instant::now();
    let _ = fs::remove_dir_all(&root);
    println!(
        "NC_RECORDINGS cleanup_ms={}",
        cleanup_started.elapsed().as_millis()
    );

    assert_eq!(
        size.logical_bytes, expected_bytes,
        "measured size must match the bytes actually written"
    );
}
