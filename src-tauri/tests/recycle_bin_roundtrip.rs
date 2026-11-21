//! Real Recycle Bin round-trip, executed only when explicitly requested.
//!
//! `cargo test` must never move a user's files to the Recycle Bin, so this test
//! is `#[ignore]`d. Run it deliberately:
//!
//! ```text
//! cargo test --test recycle_bin_roundtrip -- --ignored --nocapture
//! ```
//!
//! It creates a throwaway folder under the system temp directory, validates it
//! with the production guard, moves it to the real Recycle Bin through
//! `RecycleBinService`, and asserts the source is gone while its parent stays.
//! The caller (see `scripts/verify-recycle-bin.ps1`) then confirms the item is
//! visible in the shell's Recycle Bin and removes that exact item.

use std::fs;

use detergo_lib::cleanup::RecycleBinService;
use detergo_lib::safety::{validate_target, GuardContext};

#[test]
#[ignore = "touches the real Windows Recycle Bin; run explicitly"]
fn recycle_bin_round_trip() {
    let marker = std::env::var("NC_TRASH_MARKER")
        .ok()
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| format!("nc-trash-probe-{}", uuid::Uuid::new_v4().simple()));

    let parent = std::env::temp_dir().join(&marker);
    let target = parent.join("payload");
    fs::create_dir_all(target.join("nested")).expect("create nested dir");
    fs::write(target.join("a.bin"), vec![7u8; 4096]).expect("write a.bin");
    fs::write(target.join("nested").join("b.bin"), vec![9u8; 2048]).expect("write b.bin");

    let roots = vec![parent.clone()];
    let guard = GuardContext {
        scan_roots: &roots,
        protected_paths: &[],
    };

    // The production guard must accept a legitimate temporary target; a guard
    // rejection here would make the rest of the test meaningless.
    validate_target(&target, &guard).expect("path guard rejected a valid temp target");

    let service = RecycleBinService::new();
    let recycled = service.recycle(&target, &guard).expect("recycle failed");

    assert!(!recycled.exists(), "source must be gone after recycling");
    assert!(parent.exists(), "the parent folder must not be removed");

    // Clean up the now-empty parent; the recycled payload stays in the bin so
    // the shell-level check can find it.
    let _ = fs::remove_dir(&parent);

    println!("NC_TRASH_MARKER={marker}");
    println!("NC_TRASH_ORIGINAL={}", target.display());
    println!("NC_TRASH_BYTES=6144");
}
