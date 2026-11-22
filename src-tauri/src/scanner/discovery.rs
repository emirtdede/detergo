use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use crossbeam_channel as channel;

use crate::catalog::matcher::{classify, collect_evidence, GitState};
use crate::catalog::model::TargetKind;
use crate::catalog::project::{stable_path_id, ProjectInfo, ProjectResolver};
use crate::catalog::CatalogIndex;
use crate::error::AppError;
use crate::safety::evidence_guard::EvidenceSnapshot;
use crate::safety::{git_guard, ActiveUse};
use crate::scanner::cancellation::CancellationToken;
use crate::scanner::limits::{ScanBudget, ScanLimits, StopReason};
use crate::scanner::models::{CleanupItem, ItemStatus, ScanProgress, StoredTarget};

/// Excluded at any depth.
const DEFAULT_EXCLUSIONS: &[&str] = &[
    "$recycle.bin",
    "system volume information",
    ".git",
    ".svn",
    ".hg",
];

/// Upper bound on retained walk notices.
const MAX_SCAN_NOTICES: usize = 1_000;

/// Excluded only at the first level below a drive/filesystem root, so a
/// legitimate project folder named e.g. `windows` or `recovery` is still scanned.
#[cfg(windows)]
const SYSTEM_EXCLUSIONS: &[&str] = &[
    "windows",
    "program files",
    "program files (x86)",
    "programdata",
    "recovery",
    "msocache",
    "$windows.~bt",
    "$windows.~ws",
    "system32",
    "syswow64",
    "perflogs",
    "intel",
    "amd",
    "microsoft",
];

#[cfg(not(windows))]
const SYSTEM_EXCLUSIONS: &[&str] = &[
    "proc",
    "sys",
    "dev",
    "run",
    "usr",
    "bin",
    "sbin",
    "lib",
    "lib64",
    "etc",
    "boot",
    "root",
    "system",
    "library",
    "applications",
    "volumes",
    "cores",
    "private",
    "net",
];

const BATCH_SIZE: usize = 100;

pub struct DiscoveryConfig<'a> {
    pub root: &'a Path,
    pub exclusions: &'a [String],
    pub protected_paths: &'a [String],
    pub scan_session_id: &'a str,
    pub limits: ScanLimits,
}

pub struct DiscoveryOutcome {
    pub items: Vec<CleanupItem>,
    pub targets: Vec<StoredTarget>,
    pub directories_visited: u64,
    pub stop_reason: Option<StopReason>,
    pub warnings: Vec<crate::scanner::notices::ScanNotice>,
}

struct DirJob {
    path: PathBuf,
    depth: usize,
    active_ancestor: Option<(String, String)>,
}

enum WorkerMsg {
    Discovered {
        item: Box<CleanupItem>,
        target: Box<StoredTarget>,
    },
    Warning(crate::scanner::notices::ScanNotice),
    ProgressPath(String),
}

struct PortableEntry {
    name: std::ffi::OsString,
    is_dir: bool,
    is_file: bool,
    is_redirecting_reparse: bool,
    modified_ms: Option<i64>,
}

#[cfg(windows)]
fn read_dir_entries(dir: &Path) -> std::io::Result<Vec<PortableEntry>> {
    crate::platform::windows::fast_walk::read_dir_fast(dir).map(|entries| {
        entries
            .into_iter()
            .map(|e| PortableEntry {
                name: e.name,
                is_dir: e.is_dir,
                is_file: e.is_file,
                is_redirecting_reparse: e.is_redirecting_reparse,
                modified_ms: e.modified_ms,
            })
            .collect()
    })
}

#[cfg(not(windows))]
fn read_dir_entries(dir: &Path) -> std::io::Result<Vec<PortableEntry>> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let Ok(entry) = entry else { continue };
        let Ok(ft) = entry.file_type() else { continue };
        let is_symlink = ft.is_symlink();
        let modified_ms = if is_symlink {
            None
        } else {
            entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
        };
        out.push(PortableEntry {
            name: entry.file_name(),
            is_dir: !is_symlink && ft.is_dir(),
            is_file: !is_symlink && ft.is_file(),
            is_redirecting_reparse: is_symlink,
            modified_ms,
        });
    }
    Ok(out)
}

pub struct DiscoveryEngine<'a> {
    catalog: &'a CatalogIndex,
    token: CancellationToken,
    budget: ScanBudget,
}

impl<'a> DiscoveryEngine<'a> {
    pub fn new(catalog: &'a CatalogIndex, token: CancellationToken, limits: ScanLimits) -> Self {
        Self {
            catalog,
            token,
            budget: ScanBudget::new(limits),
        }
    }

    pub fn discover<B, P>(
        &mut self,
        config: DiscoveryConfig<'_>,
        mut on_batch: B,
        mut on_progress: P,
    ) -> Result<DiscoveryOutcome, AppError>
    where
        B: FnMut(&[CleanupItem]),
        P: FnMut(ScanProgress),
    {
        if !config.root.exists() {
            return Err(AppError::PathNotFound(
                config.root.to_string_lossy().to_string(),
            ));
        }
        if !config.root.is_dir() {
            return Err(AppError::InvalidPath(
                "Scan root must be a directory.".to_string(),
            ));
        }
        if crate::platform::is_reparse_point(config.root) {
            return Err(AppError::InvalidPath(
                "Scan root cannot be a reparse point (junction or symlink).".to_string(),
            ));
        }

        if self.token.is_cancelled() {
            on_progress(ScanProgress {
                phase: "discovering".to_string(),
                directories_visited: 0,
                entries_found: 0,
                entries_measured: 0,
                bytes_measured: 0,
                current_path: None,
                stop_reason: Some(StopReason::Cancelled.code().to_string()),
            });
            return Ok(DiscoveryOutcome {
                items: Vec::new(),
                targets: Vec::new(),
                directories_visited: 0,
                stop_reason: Some(StopReason::Cancelled),
                warnings: Vec::new(),
            });
        }

        let mut exclusions: HashSet<String> = HashSet::new();
        for ex in DEFAULT_EXCLUSIONS {
            exclusions.insert(ex.to_string());
        }
        for ex in config.exclusions {
            exclusions.insert(ex.to_lowercase());
        }
        let protected_keys: Vec<String> = config
            .protected_paths
            .iter()
            .map(|p| crate::safety::path_guard::normalize_key(Path::new(p)))
            .filter(|p| !p.is_empty())
            .collect();

        let is_drive_root = is_drive_root_path(config.root);
        let root_label = config.root.to_string_lossy().to_string();
        let limits = self.budget.limits().to_owned();
        let started = Instant::now();

        let worker_count = std::thread::available_parallelism()
            .map(|n| n.get().clamp(2, 8))
            .unwrap_or(4);

        let (job_tx, job_rx) = channel::unbounded::<DirJob>();
        let (msg_tx, msg_rx) = channel::unbounded::<WorkerMsg>();

        let in_flight = AtomicUsize::new(1);
        let directories_visited = AtomicU64::new(0);
        let candidates_count = AtomicU64::new(0);
        let depth_hit = AtomicBool::new(false);
        let candidate_limit_hit = AtomicBool::new(false);
        let timeout_hit = AtomicBool::new(false);
        let warning_count = AtomicUsize::new(0);

        // Precompute rule index ordering once so tie-breaking stays deterministic.
        let rule_order: HashMap<&str, usize> = self
            .catalog
            .rules()
            .iter()
            .enumerate()
            .map(|(idx, r)| (r.id.as_str(), idx))
            .collect();

        let _ = job_tx.send(DirJob {
            path: config.root.to_path_buf(),
            depth: 0,
            active_ancestor: None,
        });

        let mut items: Vec<CleanupItem> = Vec::new();
        let mut targets: Vec<StoredTarget> = Vec::new();
        let mut warnings: Vec<crate::scanner::notices::ScanNotice> = Vec::new();
        let mut batch: Vec<CleanupItem> = Vec::new();
        let mut last_progress = Instant::now();
        let mut last_path: Option<String> = None;

        let catalog = self.catalog;
        let token = &self.token;
        let scan_root = config.root;
        let session_id = config.scan_session_id;

        std::thread::scope(|scope| {
            for _ in 0..worker_count {
                let job_tx = job_tx.clone();
                let job_rx = job_rx.clone();
                let msg_tx = msg_tx.clone();
                let exclusions = &exclusions;
                let protected_keys = &protected_keys;
                let root_label = &root_label;
                let in_flight = &in_flight;
                let directories_visited = &directories_visited;
                let candidates_count = &candidates_count;
                let depth_hit = &depth_hit;
                let candidate_limit_hit = &candidate_limit_hit;
                let timeout_hit = &timeout_hit;
                let warning_count = &warning_count;
                let rule_order = &rule_order;

                scope.spawn(move || {
                    let mut resolver = ProjectResolver::new(catalog.project_markers());
                    resolver.set_boundary(scan_root);
                    let mut git_repo_cache: HashMap<PathBuf, Option<PathBuf>> = HashMap::new();
                    let mut local_stack: Vec<DirJob> = Vec::with_capacity(16);
                    let mut last_ping = Instant::now();

                    loop {
                        if token.is_cancelled()
                            || candidate_limit_hit.load(Ordering::Relaxed)
                            || timeout_hit.load(Ordering::Relaxed)
                        {
                            return;
                        }
                        if started.elapsed() >= limits.timeout {
                            timeout_hit.store(true, Ordering::Relaxed);
                            return;
                        }

                        let job = if let Some(local_job) = local_stack.pop() {
                            local_job
                        } else {
                            match job_rx.recv_timeout(Duration::from_millis(1)) {
                                Ok(j) => j,
                                Err(channel::RecvTimeoutError::Timeout) => {
                                    if in_flight.load(Ordering::Acquire) == 0 {
                                        return;
                                    }
                                    continue;
                                }
                                Err(channel::RecvTimeoutError::Disconnected) => return,
                            }
                        };

                        directories_visited.fetch_add(1, Ordering::Relaxed);

                        if last_ping.elapsed() >= Duration::from_millis(120) {
                            let _ = msg_tx.send(WorkerMsg::ProgressPath(
                                job.path.to_string_lossy().to_string(),
                            ));
                            last_ping = Instant::now();
                        }

                        let entries = match read_dir_entries(&job.path) {
                            Ok(e) => e,
                            Err(err) => {
                                let prev = warning_count.fetch_add(1, Ordering::Relaxed);
                                if prev < MAX_SCAN_NOTICES {
                                    let code = if err.kind() == std::io::ErrorKind::PermissionDenied
                                    {
                                        "ACCESS_DENIED"
                                    } else {
                                        "WALK_ERROR"
                                    };
                                    let p = job.path.to_string_lossy().to_string();
                                    let _ = msg_tx.send(WorkerMsg::Warning(
                                        crate::scanner::notices::ScanNotice {
                                            code: code.to_string(),
                                            severity: crate::scanner::notices::classify(
                                                code,
                                                Some(&p),
                                                Some(root_label),
                                            ),
                                            path: Some(p),
                                            root: Some(root_label.clone()),
                                        },
                                    ));
                                } else if prev == MAX_SCAN_NOTICES {
                                    let _ = msg_tx.send(WorkerMsg::Warning(
                                        crate::scanner::notices::ScanNotice {
                                            code: "WARNINGS_TRUNCATED".to_string(),
                                            severity:
                                                crate::scanner::notices::ScanNoticeSeverity::Info,
                                            path: None,
                                            root: Some(root_label.clone()),
                                        },
                                    ));
                                }
                                if in_flight.fetch_sub(1, Ordering::AcqRel) == 1 {
                                    return;
                                }
                                continue;
                            }
                        };

                        // Resolve project context once for all children of `job.path`.
                        let mut resolved_project_loaded = false;
                        let mut resolved_project: Option<ProjectInfo> = None;

                        let child_depth = job.depth + 1;
                        let mut child_jobs: Vec<DirJob> = Vec::new();

                        for entry in entries {
                            if token.is_cancelled()
                                || candidate_limit_hit.load(Ordering::Relaxed)
                                || timeout_hit.load(Ordering::Relaxed)
                            {
                                break;
                            }
                            if started.elapsed() >= limits.timeout {
                                timeout_hit.store(true, Ordering::Relaxed);
                                break;
                            }

                            let name = entry.name.to_string_lossy().to_string();
                            let name_lower = name.to_lowercase();
                            if !entry_allowed_fast(
                                &name_lower,
                                &job.path,
                                child_depth,
                                entry.is_redirecting_reparse,
                                exclusions,
                                is_drive_root,
                            ) {
                                continue;
                            }

                            let path = job.path.join(&entry.name);
                            let depth_limited = entry.is_dir && child_depth >= limits.max_depth;
                            if depth_limited {
                                depth_hit.store(true, Ordering::Relaxed);
                                directories_visited.fetch_add(1, Ordering::Relaxed);
                            }

                            let candidates = catalog.rules_for_name(&name);
                            if candidates.is_empty() {
                                if entry.is_dir && !depth_limited {
                                    child_jobs.push(DirJob {
                                        path,
                                        depth: child_depth,
                                        active_ancestor: job.active_ancestor.clone(),
                                    });
                                }
                                continue;
                            }

                            if !resolved_project_loaded {
                                resolved_project = resolver.resolve(&job.path);
                                resolved_project_loaded = true;
                            }
                            let project_root = resolved_project
                                .as_ref()
                                .map(|p| PathBuf::from(&p.project_root));
                            let workspace_root = resolved_project
                                .as_ref()
                                .map(|p| PathBuf::from(&p.root_project_root));
                            let inside_source_subtree = is_inside_source_subtree(
                                &job.path,
                                project_root.as_deref().unwrap_or(scan_root),
                            );

                            let mut matched_rule = None;
                            let mut matched_evidence = None;
                            let mut best_key = (0usize, 0usize, 0usize, usize::MAX);

                            for rule in candidates {
                                if !rule.nested_in.is_empty() {
                                    let Some((parent_rule_id, _)) = &job.active_ancestor else {
                                        continue;
                                    };
                                    if !rule.nested_in.iter().any(|p| p == parent_rule_id) {
                                        continue;
                                    }
                                }
                                match rule.kind {
                                    TargetKind::Directory if !entry.is_dir => continue,
                                    TargetKind::File | TargetKind::FileGroup if !entry.is_file => {
                                        continue
                                    }
                                    _ => {}
                                }
                                if let Some(rule_max_depth) = rule.max_depth {
                                    if child_depth > rule_max_depth {
                                        continue;
                                    }
                                }
                                if rule.generic_name && inside_source_subtree {
                                    continue;
                                }

                                let evidence = collect_evidence(
                                    rule,
                                    &path,
                                    project_root.as_deref(),
                                    workspace_root.as_deref(),
                                    None,
                                );

                                if !rule.markers.is_empty()
                                    && evidence.marker_hits.is_empty()
                                    && evidence.content_hits.is_empty()
                                {
                                    if rule.is_protected() {
                                        continue;
                                    }
                                    let conflicting_project = resolved_project.is_some();
                                    let allow_unverified_generic =
                                        rule.id == "js.build" && !conflicting_project;
                                    if rule.generic_name && !allow_unverified_generic {
                                        continue;
                                    }
                                    if !rule.generic_name
                                        && matches!(
                                            rule.id.as_str(),
                                            "unreal.intermediate"
                                                | "unreal.ddc"
                                                | "dotnet.testresults"
                                                | "elixir.build"
                                                | "swift.build"
                                                | "godot.imported"
                                                | "zig.cache"
                                                | "zig.out"
                                                | "ruby.yardoc"
                                        )
                                    {
                                        continue;
                                    }
                                }

                                let key = (
                                    evidence.marker_hits.len(),
                                    evidence.content_hits.len(),
                                    if rule.generic_name { 0 } else { 1 },
                                );
                                let rule_index = rule_order
                                    .get(rule.id.as_str())
                                    .copied()
                                    .unwrap_or(usize::MAX);
                                let cmp = (key.0, key.1, key.2, usize::MAX - rule_index);
                                if matched_rule.is_none() || cmp > best_key {
                                    best_key = cmp;
                                    matched_rule = Some(rule);
                                    matched_evidence = Some(evidence);
                                }
                            }

                            let (Some(rule), Some(mut evidence)) = (matched_rule, matched_evidence)
                            else {
                                if entry.is_dir && !depth_limited {
                                    child_jobs.push(DirJob {
                                        path,
                                        depth: child_depth,
                                        active_ancestor: job.active_ancestor.clone(),
                                    });
                                }
                                continue;
                            };

                            if rule.git_policy == crate::catalog::GitPolicy::DenyTracked
                                && !evidence.marker_hits.is_empty()
                            {
                                let state = git_guard::fast_git_state(&path, &mut git_repo_cache);
                                evidence.git_repo = state != GitState::NotRepository;
                                evidence.git_state = Some(state);
                            }

                            let project = resolved_project
                                .clone()
                                .unwrap_or_else(|| fallback_project(&job.path));
                            let classification = classify(rule, &evidence);

                            let path_key = crate::safety::path_guard::normalize_key(&path);
                            let user_protected = protected_keys.iter().any(|key| {
                                path_key == *key
                                    || crate::safety::path_guard::is_within(&path_key, key)
                                    || crate::safety::path_guard::is_within(key, &path_key)
                            });

                            let mut warnings_for_item = classification.warnings.clone();
                            let active_use = crate::safety::is_target_in_use(&path);
                            let mut selectable = classification.selectable;

                            let system_blocked =
                                crate::safety::path_guard::validate_system_path(&path_key).is_err();

                            if user_protected {
                                warnings_for_item.push("USER_PROTECTED".to_string());
                                selectable = false;
                            }
                            if system_blocked {
                                warnings_for_item.push("PATH_GUARD".to_string());
                                selectable = false;
                            }
                            if active_use.blocks_deletion() {
                                warnings_for_item.push("TARGET_ACTIVE".to_string());
                                selectable = false;
                            }
                            if rule.requires_idle && active_use != ActiveUse::No {
                                selectable = false;
                            }

                            // Atomic candidate budget reservation: never overshoot `max_candidates`.
                            let reserved = loop {
                                let curr = candidates_count.load(Ordering::Acquire);
                                if curr >= limits.max_candidates {
                                    break false;
                                }
                                if candidates_count
                                    .compare_exchange_weak(
                                        curr,
                                        curr + 1,
                                        Ordering::AcqRel,
                                        Ordering::Acquire,
                                    )
                                    .is_ok()
                                {
                                    break true;
                                }
                            };
                            if !reserved {
                                candidate_limit_hit.store(true, Ordering::Relaxed);
                                break;
                            }

                            let item_id =
                                format!("t{}", &uuid::Uuid::new_v4().simple().to_string()[..24]);
                            let parent_item_id =
                                job.active_ancestor.as_ref().map(|(_, id)| id.clone());
                            let last_modified_ms = entry.modified_ms;
                            let modified_at = last_modified_ms.map(unix_ms_to_iso);

                            let evidence_snapshot = EvidenceSnapshot {
                                rule_id: rule.id.clone(),
                                target_name: name.clone(),
                                project_root: Some(project.project_root.clone()),
                                workspace_root: Some(project.root_project_root.clone()),
                                marker_hits: evidence.marker_hits.clone(),
                                content_hits: evidence.content_hits.clone(),
                            };

                            let item = CleanupItem {
                                id: item_id.clone(),
                                scan_session_id: session_id.to_string(),
                                rule_id: rule.id.clone(),
                                provider: "project".to_string(),
                                ecosystem: rule.ecosystem.clone(),
                                category: rule.category.clone(),
                                kind: rule.kind,
                                project_id: Some(project.project_id.clone()),
                                project_name: Some(project.project_name.clone()),
                                project_root: Some(project.project_root.clone()),
                                project_detected: project.detected,
                                display_name: name,
                                display_path: path.to_string_lossy().to_string(),
                                logical_bytes: None,
                                allocated_bytes: None,
                                estimated_reclaim_bytes: None,
                                safety_class: classification.safety_class,
                                confidence: classification.confidence,
                                active_use,
                                evidence_codes: evidence.codes(),
                                warning_codes: warnings_for_item,
                                cleanup_method: rule.cleanup,
                                regenerate_hint: rule.regenerate.clone(),
                                protected: user_protected
                                    || classification.safety_class
                                        == crate::catalog::SafetyClass::Keep,
                                selectable,
                                auto_selectable: selectable
                                    && classification.safety_class
                                        == crate::catalog::SafetyClass::Safe
                                    && classification.confidence
                                        == crate::catalog::Confidence::High
                                    && !rule.requires_idle,
                                last_modified_at: modified_at.clone(),
                                last_modified_ms,
                                status: if selectable {
                                    ItemStatus::Discovered
                                } else {
                                    ItemStatus::Blocked
                                },
                                parent_item_id: parent_item_id.clone(),
                                note: rule.note.clone(),
                            };

                            let stored = StoredTarget {
                                id: item_id.clone(),
                                path: path.clone(),
                                rule_id: rule.id.clone(),
                                provider: "project".to_string(),
                                category: rule.category.clone(),
                                kind: rule.kind,
                                safety_class: classification.safety_class,
                                cleanup_method: rule.cleanup,
                                project_root: Some(project.project_root.clone()),
                                evidence: evidence_snapshot,
                                logical_bytes: None,
                                allocated_bytes: None,
                                modified_at,
                                active_use,
                                parent_id: parent_item_id,
                                protected: user_protected
                                    || classification.safety_class
                                        == crate::catalog::SafetyClass::Keep,
                            };

                            let _ = msg_tx.send(WorkerMsg::Discovered {
                                item: Box::new(item),
                                target: Box::new(stored),
                            });

                            if entry.is_dir && !depth_limited {
                                let unverified_generic = rule.generic_name
                                    && evidence.marker_hits.is_empty()
                                    && evidence.content_hits.is_empty();
                                if catalog.has_child_rules(&rule.id) {
                                    child_jobs.push(DirJob {
                                        path,
                                        depth: child_depth,
                                        active_ancestor: Some((rule.id.clone(), item_id)),
                                    });
                                } else if unverified_generic {
                                    child_jobs.push(DirJob {
                                        path,
                                        depth: child_depth,
                                        active_ancestor: job.active_ancestor.clone(),
                                    });
                                }
                            }
                        }

                        if !child_jobs.is_empty()
                            && !token.is_cancelled()
                            && !candidate_limit_hit.load(Ordering::Relaxed)
                            && !timeout_hit.load(Ordering::Relaxed)
                        {
                            in_flight.fetch_add(child_jobs.len(), Ordering::AcqRel);
                            // Keep one job on this worker's LIFO stack for depth-first
                            // cache locality and zero channel contention; push sibling
                            // directories to the shared channel for idle workers to steal.
                            let mut iter = child_jobs.into_iter();
                            if let Some(first) = iter.next() {
                                local_stack.push(first);
                            }
                            for child in iter {
                                let _ = job_tx.send(child);
                            }
                        }

                        if in_flight.fetch_sub(1, Ordering::AcqRel) == 1 {
                            return;
                        }
                    }
                });
            }

            // Drop the coordinator's sender clones so `msg_rx` closes as soon
            // as all workers finish.
            drop(job_tx);
            drop(msg_tx);

            for msg in msg_rx {
                match msg {
                    WorkerMsg::Discovered { item, target } => {
                        let item = *item;
                        items.push(item.clone());
                        targets.push(*target);
                        batch.push(item);
                        if batch.len() >= BATCH_SIZE {
                            on_batch(&batch);
                            batch.clear();
                        }
                    }
                    WorkerMsg::Warning(notice) => {
                        warnings.push(notice);
                    }
                    WorkerMsg::ProgressPath(path) => {
                        last_path = Some(path);
                    }
                }

                if last_progress.elapsed().as_millis() >= 100 {
                    on_progress(ScanProgress {
                        phase: "discovering".to_string(),
                        directories_visited: directories_visited.load(Ordering::Relaxed),
                        entries_found: items.len() as u64,
                        entries_measured: 0,
                        bytes_measured: 0,
                        current_path: last_path.clone(),
                        stop_reason: None,
                    });
                    last_progress = Instant::now();
                }
            }
        });

        if !batch.is_empty() {
            on_batch(&batch);
        }

        let stop_reason = if self.token.is_cancelled() {
            Some(StopReason::Cancelled)
        } else if candidate_limit_hit.load(Ordering::Relaxed) {
            Some(StopReason::CandidateLimit)
        } else if timeout_hit.load(Ordering::Relaxed) {
            Some(StopReason::Timeout)
        } else if depth_hit.load(Ordering::Relaxed) {
            Some(StopReason::DepthLimit)
        } else {
            None
        };

        let dirs_visited = directories_visited.load(Ordering::Relaxed);
        on_progress(ScanProgress {
            phase: "discovering".to_string(),
            directories_visited: dirs_visited,
            entries_found: items.len() as u64,
            entries_measured: 0,
            bytes_measured: 0,
            current_path: None,
            stop_reason: stop_reason.map(|r| r.code().to_string()),
        });

        Ok(DiscoveryOutcome {
            items,
            targets,
            directories_visited: dirs_visited,
            stop_reason,
            warnings,
        })
    }
}

fn is_drive_root_path(path: &Path) -> bool {
    let s = path.to_string_lossy();
    let stripped = s.strip_prefix(r"\\?\").unwrap_or(&s);
    if stripped == "/" {
        return true;
    }
    let bytes = stripped.as_bytes();
    (bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
        || (bytes.len() == 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/'))
}

fn is_inside_source_subtree(parent: &Path, boundary: &Path) -> bool {
    const SOURCE_DIRS: &[&str] = &["src", "source", "wwwroot", "public", "assets"];
    let Ok(relative) = parent.strip_prefix(boundary) else {
        return false;
    };
    relative.components().any(|component| {
        if let std::path::Component::Normal(name) = component {
            let lower = name.to_string_lossy().to_lowercase();
            SOURCE_DIRS.iter().any(|dir| *dir == lower)
        } else {
            false
        }
    })
}

fn entry_allowed_fast(
    name_lower: &str,
    parent: &Path,
    child_depth: usize,
    is_redirecting_reparse: bool,
    exclusions: &HashSet<String>,
    is_drive_root: bool,
) -> bool {
    if exclusions.contains(name_lower) {
        return false;
    }
    if is_drive_root && child_depth == 1 && SYSTEM_EXCLUSIONS.contains(&name_lower) {
        return false;
    }
    if name_lower == "packages" || name_lower == "microsoft" {
        let parent_name = parent
            .file_name()
            .map(|f| f.to_string_lossy().to_lowercase());
        let grandparent_name = parent
            .parent()
            .and_then(|gp| gp.file_name())
            .map(|f| f.to_string_lossy().to_lowercase());
        let is_appdata_system_dir = matches!(parent_name.as_deref(), Some("appdata"))
            || (matches!(parent_name.as_deref(), Some("local" | "roaming"))
                && matches!(grandparent_name.as_deref(), Some("appdata")));
        if is_appdata_system_dir {
            return false;
        }
    }
    !is_redirecting_reparse
}

fn fallback_project(parent: &Path) -> ProjectInfo {
    let name = parent
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| parent.to_string_lossy().to_string());
    ProjectInfo {
        project_root: parent.to_string_lossy().to_string(),
        project_name: name.clone(),
        project_id: stable_path_id(parent),
        root_project_root: parent.to_string_lossy().to_string(),
        root_project_name: name,
        workspace_kind: None,
        markers: Vec::new(),
        detected: false,
    }
}

fn unix_ms_to_iso(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    chrono::DateTime::from_timestamp(secs, 0)
        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
        .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string())
}

/// Evaluates a single path against the catalog rules and project markers
/// without running a full directory walk. Shared by unit tests and MCP
/// `detergo_inspect_target`.
pub fn evaluate_path(
    catalog: &CatalogIndex,
    path: &Path,
) -> Option<(String, crate::catalog::SafetyClass, Vec<String>)> {
    let name = path.file_name()?.to_string_lossy().to_string();
    let parent = path.parent()?;
    let mut resolver = ProjectResolver::new(catalog.project_markers());
    let project = resolver.resolve(parent);
    let project_root = project.as_ref().map(|p| PathBuf::from(&p.project_root));
    let workspace_root = project
        .as_ref()
        .map(|p| PathBuf::from(&p.root_project_root));
    let inside_source_subtree = project_root
        .as_deref()
        .is_some_and(|root| is_inside_source_subtree(parent, root));
    let is_dir = path.is_dir();
    let is_file = path.is_file();
    let mut git_repo_cache: HashMap<PathBuf, Option<PathBuf>> = HashMap::new();

    let mut best: Option<(
        usize,
        usize,
        usize,
        String,
        crate::catalog::SafetyClass,
        Vec<String>,
    )> = None;
    for rule in catalog.rules_for_name(&name) {
        match rule.kind {
            TargetKind::Directory if !is_dir => continue,
            TargetKind::File | TargetKind::FileGroup if !is_file => continue,
            _ => {}
        }
        if rule.generic_name && inside_source_subtree {
            continue;
        }
        let mut evidence = collect_evidence(
            rule,
            path,
            project_root.as_deref(),
            workspace_root.as_deref(),
            None,
        );
        if !rule.markers.is_empty()
            && evidence.marker_hits.is_empty()
            && evidence.content_hits.is_empty()
        {
            continue;
        }
        if rule.git_policy == crate::catalog::GitPolicy::DenyTracked
            && !evidence.marker_hits.is_empty()
        {
            let state = git_guard::fast_git_state(path, &mut git_repo_cache);
            evidence.git_repo = state != GitState::NotRepository;
            evidence.git_state = Some(state);
        }
        let c = classify(rule, &evidence);
        let key = (
            evidence.marker_hits.len(),
            evidence.content_hits.len(),
            if rule.generic_name { 0 } else { 1 },
        );
        if best.as_ref().is_none_or(|b| key > (b.0, b.1, b.2)) {
            best = Some((
                key.0,
                key.1,
                key.2,
                rule.id.clone(),
                c.safety_class,
                c.warnings,
            ));
        }
    }
    best.map(|(_, _, _, id, safety, warnings)| (id, safety, warnings))
}
