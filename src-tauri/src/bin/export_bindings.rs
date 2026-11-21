//! Writes the TypeScript contract for the IPC surface (T-37).
//!
//! Usage:
//!   cargo run --features bindings --bin export_bindings
//!   cargo run --features bindings --bin export_bindings -- --check
//!
//! `--check` is what CI runs: it regenerates into a temporary file and fails if
//! the committed `src/lib/tauri/bindings.ts` differs, so a Rust type change can
//! never land without the frontend contract being updated in the same commit.

use std::path::{Path, PathBuf};

use specta_typescript::Typescript;

fn main() {
    let check = std::env::args().any(|arg| arg == "--check");
    let target = output_path();
    let generated = target.with_extension("ts.generated");

    tauri_specta::Builder::<tauri::Wry>::new()
        .types(&detergo_lib::bindings::collect())
        .export(Typescript::default(), &generated)
        .expect("failed to export TypeScript bindings");

    let produced = std::fs::read_to_string(&generated).expect("read generated bindings");

    if check {
        let committed = std::fs::read_to_string(&target).unwrap_or_default();
        let _ = std::fs::remove_file(&generated);
        if produced != committed {
            eprintln!(
                "[FAIL] {} is stale. Run `cargo run --features bindings --bin export_bindings`.",
                target.display()
            );
            std::process::exit(1);
        }
        println!("TypeScript bindings are up to date: {}", target.display());
        return;
    }

    std::fs::rename(&generated, &target).expect("replace bindings file");
    println!("Wrote {}", target.display());
}

/// Repository root, independent of the working directory Cargo was invoked from.
fn output_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent")
        .join("src/lib/tauri/bindings.ts")
}
