//! Prints the default `AppSettings` as JSON.
//!
//! Used to regenerate `scripts/fixtures/default-settings.json`, the seed file
//! the E1-03 smoke test writes into its sandbox APPDATA. A unit test in
//! `settings/tests.rs` fails when the fixture drifts from the real defaults.
//!
//! Regenerate with:
//!   cargo run --manifest-path src-tauri/Cargo.toml --example dump-default-settings

fn main() {
    let settings = dev_cleaner_lib::settings::AppSettings::default();
    println!(
        "{}",
        serde_json::to_string_pretty(&settings).expect("default settings serialize")
    );
}
