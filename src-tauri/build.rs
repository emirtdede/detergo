use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    for size in [16, 20, 24, 28, 32, 36, 40, 48] {
        println!("cargo:rerun-if-changed=icons/tray-{size}.png");
    }
    println!("cargo:rerun-if-changed=tauri.conf.json");
    // The release artifact must be traceable to a commit. Re-run when the git
    // head moves so the embedded stamp never goes stale.
    //
    // `.git/HEAD` alone is not enough: on a normal branch it contains a ref
    // (`ref: refs/heads/...`) and does not change when a commit is created, so an
    // incremental build kept embedding the previous commit. The reflog and the
    // index both change on commit/checkout/stage, which is what actually needs to
    // invalidate this script.
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/logs/HEAD");
    println!("cargo:rerun-if-changed=../.git/index");
    for var in ["NC_BUILD_COMMIT", "NC_BUILD_DIRTY", "NC_BUILD_TIME"] {
        println!("cargo:rerun-if-env-changed={var}");
    }

    tauri_build::build();

    // Guard against a build where the ACL capability set never reached OUT_DIR.
    // Without these files `tauri::generate_context!` resolves an empty runtime
    // authority and every window/IPC command fails with "not allowed by ACL".
    let out_dir = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is not set"));
    for name in ["capabilities.json", "acl-manifests.json"] {
        let path = out_dir.join(name);
        assert!(
            path.is_file(),
            "ACL build output missing: {name} (expected at {}). Refusing to build an app whose IPC would be denied.",
            path.display()
        );
    }
    let capabilities = std::fs::read_to_string(out_dir.join("capabilities.json"))
        .expect("failed to read generated capabilities.json");
    assert!(
        capabilities.len() > 2,
        "Generated capabilities.json is empty; the app would ship without any capability."
    );

    embed_build_identity();
}

/// Embeds the exact commit (and whether the tree was dirty) into the binary so
/// an installed build can be compared with the audited source revision.
fn embed_build_identity() {
    let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let commit = env_override("NC_BUILD_COMMIT")
        .or_else(|| git(&repo_root, &["rev-parse", "HEAD"]))
        .unwrap_or_else(|| "unknown".to_string());
    let dirty = env_override("NC_BUILD_DIRTY").unwrap_or_else(|| match git_is_dirty(&repo_root) {
        Some(true) => "true".to_string(),
        Some(false) => "false".to_string(),
        None => "unknown".to_string(),
    });
    let built_at = env_override("NC_BUILD_TIME").unwrap_or_else(|| {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        secs.to_string()
    });
    let short = if commit.len() >= 7 && commit != "unknown" {
        commit[..7].to_string()
    } else {
        commit.clone()
    };

    println!("cargo:rustc-env=NC_BUILD_COMMIT={commit}");
    println!("cargo:rustc-env=NC_BUILD_COMMIT_SHORT={short}");
    println!("cargo:rustc-env=NC_BUILD_DIRTY={dirty}");
    println!("cargo:rustc-env=NC_BUILD_TIME={built_at}");
}

fn env_override(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.trim().is_empty())
}

/// `Some(true)` = tree has changes, `Some(false)` = tree is clean, `None` = git
/// could not be read at all.
///
/// This must not go through `git()`: a clean tree produces empty stdout, and
/// `git()` maps empty output to `None`. That made every plain `cargo build` on a
/// committed tree stamp itself `unknown`, which the app reports as dirty and the
/// IPC probe rejects as a provenance mismatch.
fn git_is_dirty(repo_root: &std::path::Path) -> Option<bool> {
    let output = Command::new("git")
        .current_dir(repo_root)
        .args(["status", "--porcelain"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(!String::from_utf8_lossy(&output.stdout).trim().is_empty())
}

fn git(repo_root: &std::path::Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .current_dir(repo_root)
        .args(args)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}
