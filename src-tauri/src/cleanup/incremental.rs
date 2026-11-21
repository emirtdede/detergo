//! Intra-target age-based incremental build artifact pruning (`cargo-sweep` style).
//!
//! When a user works on an active Rust, Next.js, Gradle, or C/C++ project,
//! deleting the entire `target/` or build cache directory forces a cold rebuild.
//! This module inspects the internal structure of a build target directory and
//! selects only stale incremental compilation slices older than `older_than_days`
//! while keeping recent compilation outputs, root markers (`CACHEDIR.TAG`,
//! `.cargo-lock`), and active binaries warm.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::catalog::TargetKind;
use crate::platform::{is_in_use, is_reparse_point};
use crate::scanner::cancellation::CancellationToken;
use crate::scanner::measurement::measure_path;

/// Root metadata and lock files inside build directories that must never be
/// removed during partial incremental pruning.
const PRESERVED_ROOT_FILES: &[&str] = &[
    "CACHEDIR.TAG",
    ".cargo-lock",
    ".rustc_info.json",
    ".lock",
    "lock",
];

#[derive(Debug, Clone)]
pub struct IncrementalSlice {
    pub path: PathBuf,
    pub kind: TargetKind,
    pub logical_bytes: u64,
    pub modified_secs: Option<u64>,
}

#[derive(Debug, Clone, Default)]
pub struct IncrementalTargetSummary {
    pub stale_bytes: u64,
    pub stale_slices: Vec<IncrementalSlice>,
    pub kept_recent_count: u32,
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn is_preserved_marker(name: &str) -> bool {
    PRESERVED_ROOT_FILES
        .iter()
        .any(|marker| name.eq_ignore_ascii_case(marker))
}

/// Returns the most recent modification timestamp (in UNIX seconds) across
/// `path` and (if a directory) up to two levels of its children.
fn latest_mtime_secs(path: &Path, max_depth: u8) -> Option<u64> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if meta.file_type().is_symlink() || is_reparse_point(path) {
        return None;
    }
    let mut latest = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())?;

    if meta.is_dir() && max_depth > 0 {
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                if let Some(child_mtime) = latest_mtime_secs(&entry.path(), max_depth - 1) {
                    if child_mtime > latest {
                        latest = child_mtime;
                    }
                }
            }
        }
    }
    Some(latest)
}

fn build_slice(
    path: PathBuf,
    cutoff_secs: u64,
    cancel: &CancellationToken,
) -> Option<IncrementalSlice> {
    if cancel.is_cancelled() {
        return None;
    }
    let meta = std::fs::symlink_metadata(&path).ok()?;
    if meta.file_type().is_symlink() || is_reparse_point(&path) {
        return None;
    }
    let mtime = latest_mtime_secs(&path, 2)?;
    if mtime > cutoff_secs {
        return None;
    }
    if is_in_use(&path).unwrap_or(true) {
        return None;
    }
    let kind = if meta.is_dir() {
        TargetKind::Directory
    } else {
        TargetKind::File
    };
    let logical_bytes = if meta.is_file() {
        meta.len()
    } else {
        measure_path(&path, kind, cancel)
            .map(|m| m.logical_bytes)
            .unwrap_or(0)
    };
    Some(IncrementalSlice {
        path,
        kind,
        logical_bytes,
        modified_secs: Some(mtime),
    })
}

fn is_cargo_profile_dir(path: &Path) -> bool {
    if !path.is_dir() || is_reparse_point(path) {
        return false;
    }
    path.join("incremental").is_dir()
        || path.join("deps").is_dir()
        || path.join(".fingerprint").is_dir()
        || path.join("build").is_dir()
}

fn collect_cargo_profile_slices(
    profile_dir: &Path,
    cutoff_secs: u64,
    cancel: &CancellationToken,
    summary: &mut IncrementalTargetSummary,
) {
    // 1. `incremental/<crate>/<session>`: prune stale incremental sessions or
    // whole crate incremental folders when every session inside is stale.
    let inc_dir = profile_dir.join("incremental");
    if inc_dir.is_dir() && !is_reparse_point(&inc_dir) {
        if let Ok(crates) = std::fs::read_dir(&inc_dir) {
            for crate_entry in crates.flatten() {
                let crate_path = crate_entry.path();
                if !crate_path.is_dir() || is_reparse_point(&crate_path) {
                    continue;
                }
                let mut sessions = Vec::new();
                let mut stale_sessions = Vec::new();
                let mut any_recent = false;
                if let Ok(sess_entries) = std::fs::read_dir(&crate_path) {
                    for sess in sess_entries.flatten() {
                        let sess_path = sess.path();
                        sessions.push(sess_path.clone());
                        if let Some(slice) = build_slice(sess_path, cutoff_secs, cancel) {
                            stale_sessions.push(slice);
                        } else {
                            any_recent = true;
                            summary.kept_recent_count = summary.kept_recent_count.saturating_add(1);
                        }
                    }
                }
                if !sessions.is_empty() && !any_recent && stale_sessions.len() == sessions.len() {
                    if let Some(crate_slice) = build_slice(crate_path, cutoff_secs, cancel) {
                        summary.stale_bytes = summary
                            .stale_bytes
                            .saturating_add(crate_slice.logical_bytes);
                        summary.stale_slices.push(crate_slice);
                        continue;
                    }
                }
                for slice in stale_sessions {
                    summary.stale_bytes = summary.stale_bytes.saturating_add(slice.logical_bytes);
                    summary.stale_slices.push(slice);
                }
            }
        }
    }

    // 2. `deps/`, `examples/`, `build/`, `.fingerprint/`: prune individual
    // stale entries while keeping recent compilation outputs intact.
    for sub in ["deps", "examples", "build", ".fingerprint"] {
        let sub_dir = profile_dir.join(sub);
        if !sub_dir.is_dir() || is_reparse_point(&sub_dir) {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&sub_dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let entry_path = entry.path();
            let name = entry.file_name();
            if is_preserved_marker(&name.to_string_lossy()) {
                continue;
            }
            if let Some(slice) = build_slice(entry_path, cutoff_secs, cancel) {
                summary.stale_bytes = summary.stale_bytes.saturating_add(slice.logical_bytes);
                summary.stale_slices.push(slice);
            } else {
                summary.kept_recent_count = summary.kept_recent_count.saturating_add(1);
            }
        }
    }
}

fn looks_like_cargo_target(target_path: &Path, rule_id: &str) -> bool {
    if rule_id == "rs.target" {
        return true;
    }
    is_cargo_profile_dir(&target_path.join("debug"))
        || is_cargo_profile_dir(&target_path.join("release"))
}

/// Collects stale intra-target slices older than `older_than_days` inside
/// `target_path`. Never returns `target_path` itself, so the parent target
/// directory and all recent (`<= older_than_days`) artifacts remain intact.
pub fn collect_incremental_slices(
    target_path: &Path,
    rule_id: &str,
    older_than_days: u32,
) -> IncrementalTargetSummary {
    let mut summary = IncrementalTargetSummary::default();
    if older_than_days == 0 || !target_path.is_dir() || is_reparse_point(target_path) {
        return summary;
    }

    let now_secs = now_unix_secs();
    let age_window_secs = u64::from(older_than_days).saturating_mul(86_400);
    let cutoff_secs = now_secs.saturating_sub(age_window_secs);
    let cancel = CancellationToken::new();

    if looks_like_cargo_target(target_path, rule_id) {
        let Ok(entries) = std::fs::read_dir(target_path) else {
            return summary;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if is_preserved_marker(&name_str) || !path.is_dir() || is_reparse_point(&path) {
                continue;
            }
            if is_cargo_profile_dir(&path) {
                collect_cargo_profile_slices(&path, cutoff_secs, &cancel, &mut summary);
            } else if matches!(name_str.as_ref(), "doc" | "package" | "tmp") {
                if let Some(slice) = build_slice(path, cutoff_secs, &cancel) {
                    summary.stale_bytes = summary.stale_bytes.saturating_add(slice.logical_bytes);
                    summary.stale_slices.push(slice);
                } else {
                    summary.kept_recent_count = summary.kept_recent_count.saturating_add(1);
                }
            } else {
                // Check target-triple directories (e.g. `target/x86_64-pc-windows-msvc/debug`).
                if let Ok(sub_entries) = std::fs::read_dir(&path) {
                    for sub in sub_entries.flatten() {
                        let sub_path = sub.path();
                        if is_cargo_profile_dir(&sub_path) {
                            collect_cargo_profile_slices(
                                &sub_path,
                                cutoff_secs,
                                &cancel,
                                &mut summary,
                            );
                        }
                    }
                }
            }
        }
        return summary;
    }

    // General multi-entry build or cache directory (e.g. `.next`, `.gradle`,
    // `.turbo`, `.vite`, `.zig-cache`): inspect `.next/cache` subtrees or
    // top-level entries inside `target_path`.
    let scan_root = if target_path.join("cache").is_dir()
        && (rule_id.starts_with("js.next") || target_path.ends_with(".next"))
    {
        target_path.join("cache")
    } else {
        target_path.to_path_buf()
    };

    let Ok(entries) = std::fs::read_dir(&scan_root) else {
        return summary;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        if is_preserved_marker(&name.to_string_lossy()) {
            continue;
        }
        if let Some(slice) = build_slice(path, cutoff_secs, &cancel) {
            summary.stale_bytes = summary.stale_bytes.saturating_add(slice.logical_bytes);
            summary.stale_slices.push(slice);
        } else {
            summary.kept_recent_count = summary.kept_recent_count.saturating_add(1);
        }
    }

    summary
}

#[cfg(test)]
mod tests {
    use super::*;
    use filetime::{set_file_mtime, FileTime};

    fn set_age_days(path: &Path, days_old: u64) {
        let target_unix = now_unix_secs().saturating_sub(days_old * 86_400) as i64;
        let ft = FileTime::from_unix_time(target_unix, 0);
        if path.is_dir() {
            if let Ok(entries) = std::fs::read_dir(path) {
                for entry in entries.flatten() {
                    set_age_days(&entry.path(), days_old);
                }
            }
        }
        set_file_mtime(path, ft).expect("set filetime");
    }

    #[test]
    fn prunes_only_stale_cargo_incremental_and_deps_while_keeping_recent_build_warm() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let target_dir = tmp.path().join("target");
        let inc_crate = target_dir
            .join("debug")
            .join("incremental")
            .join("app-1a2b3c");
        let old_session = inc_crate.join("s-old-session");
        let fresh_session = inc_crate.join("s-fresh-session");
        let deps_dir = target_dir.join("debug").join("deps");

        std::fs::create_dir_all(&old_session).unwrap();
        std::fs::create_dir_all(&fresh_session).unwrap();
        std::fs::create_dir_all(&deps_dir).unwrap();
        std::fs::write(
            target_dir.join("CACHEDIR.TAG"),
            b"Signature: 8a477f597d28d172789f06886806bc55",
        )
        .unwrap();

        let old_dep = deps_dir.join("libold_crate-1111.rlib");
        let fresh_dep = deps_dir.join("libfresh_crate-2222.rlib");
        std::fs::write(old_session.join("dep-graph.bin"), vec![1u8; 4096]).unwrap();
        std::fs::write(fresh_session.join("dep-graph.bin"), vec![2u8; 2048]).unwrap();
        std::fs::write(&old_dep, vec![3u8; 8192]).unwrap();
        std::fs::write(&fresh_dep, vec![4u8; 1024]).unwrap();

        set_age_days(&target_dir.join("CACHEDIR.TAG"), 90);
        set_age_days(&old_session, 30);
        set_age_days(&old_dep, 30);
        set_age_days(&fresh_session, 1);
        set_age_days(&fresh_dep, 1);

        let summary = collect_incremental_slices(&target_dir, "rs.target", 14);
        assert_eq!(summary.stale_slices.len(), 2);
        assert_eq!(summary.stale_bytes, 4096 + 8192);
        assert!(summary.kept_recent_count >= 2);
        assert!(summary.stale_slices.iter().any(|s| s.path == old_session));
        assert!(summary.stale_slices.iter().any(|s| s.path == old_dep));
        assert!(!summary.stale_slices.iter().any(|s| s.path == fresh_session));
        assert!(!summary.stale_slices.iter().any(|s| s.path == fresh_dep));
        assert!(!summary
            .stale_slices
            .iter()
            .any(|s| s.path.ends_with("CACHEDIR.TAG")));
    }

    #[test]
    fn returns_empty_when_all_artifacts_are_recent() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let target_dir = tmp.path().join("target");
        let deps_dir = target_dir.join("release").join("deps");
        std::fs::create_dir_all(&deps_dir).unwrap();
        std::fs::write(deps_dir.join("libfresh.rlib"), vec![0u8; 512]).unwrap();

        let summary = collect_incremental_slices(&target_dir, "rs.target", 7);
        assert!(summary.stale_slices.is_empty());
        assert_eq!(summary.stale_bytes, 0);
        assert!(summary.kept_recent_count >= 1);
    }
}
