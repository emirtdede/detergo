use std::fs;
use std::os::windows::fs::OpenOptionsExt;
use node_cleaner_lib::cleanup::RecycleBinService;
use node_cleaner_lib::safety::GuardContext;

#[test]
fn recycle_failure_reports_error_and_never_deletes_permanently() {
    let marker = format!("nc-trash-busy-{}", uuid::Uuid::new_v4().simple());
    let parent = std::env::temp_dir().join(&marker);
    let target = parent.join("payload");
    fs::create_dir_all(&target).expect("create target");
    let busy = target.join("busy.lock");
    fs::write(&busy, vec![1u8; 1024]).expect("write busy file");

    // Windows refuses to move a directory whose child is open without
    // FILE_SHARE_DELETE, which is exactly the "cannot recycle" condition the
    // release checklist wants to see surface as an error.
    let handle = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&busy)
        .expect("open with exclusive sharing");

    let roots = vec![parent.clone()];
    let guard = GuardContext { scan_roots: &roots, protected_paths: &[] };
    let result = RecycleBinService::new().recycle(&target, &guard);
    drop(handle);

    assert!(result.is_err(), "recycling an in-use folder must fail");
    assert!(target.exists(), "a failed recycle must leave the target in place");
    assert!(busy.exists(), "no permanent fallback may delete the payload");

    let _ = fs::remove_dir_all(&parent);
}
