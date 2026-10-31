fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=tauri.conf.json");
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
}
