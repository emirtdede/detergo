use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Instant;

use walkdir::WalkDir;

use crate::catalog::matcher::{classify, collect_evidence, GitState};
use crate::catalog::model::TargetKind;
use crate::catalog::project::{stable_path_id, ProjectInfo, ProjectResolver};
use crate::catalog::CatalogIndex;
use crate::error::AppError;
use crate::safety::evidence_guard::EvidenceSnapshot;
use crate::safety::{git_guard, ActiveUse};
use crate::scanner::cancellation::CancellationToken;
use crate::scanner::limits::{ScanBudget, ScanLimits, StopReason};
use crate::scanner::models::{
    CleanupItem, ItemStatus, ScanProgress, StoredTarget,
};

/// Excluded at any depth.
const DEFAULT_EXCLUSIONS: &[&str] = &[
    "$recycle.bin",
    "system volume information",
    ".git",
    ".svn",
    ".hg",
];

/// Excluded only at the first level below the scan root, so a legitimate
/// project folder named e.g. "windows" is still scanned.
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
    pub warnings: Vec<(String, Option<String>)>,
}

pub struct DiscoveryEngine<'a> {
    catalog: &'a CatalogIndex,
    token: CancellationToken,
    budget: ScanBudget,
    resolver: ProjectResolver,
    active: HashMap<PathBuf, (String, String)>,
}

impl<'a> DiscoveryEngine<'a> {
    pub fn new(catalog: &'a CatalogIndex, token: CancellationToken, limits: ScanLimits) -> Self {
        Self {
            catalog,
            token,
            budget: ScanBudget::new(limits),
            resolver: ProjectResolver::new(catalog.project_markers()),
            active: HashMap::new(),
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
                "Tarama kökü bir klasör olmalıdır.".to_string(),
            ));
        }
        if crate::platform::is_reparse_point(config.root) {
            return Err(AppError::InvalidPath(
                "Tarama kökü bir yeniden ayrıştırma noktası (junction/symlink) olamaz."
                    .to_string(),
            ));
        }

        let mut exclusions: HashSet<String> = HashSet::new();
        self.resolver.set_boundary(config.root);

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

        let mut items: Vec<CleanupItem> = Vec::new();
        let mut targets: Vec<StoredTarget> = Vec::new();
        let mut warnings = Vec::new();
        let mut directories_visited = 0u64;
        let mut batch: Vec<CleanupItem> = Vec::new();
        let mut last_progress = Instant::now();
        let mut stop_reason: Option<StopReason> = None;

        let walker = WalkDir::new(config.root)
            .follow_links(false)
            .same_file_system(true)
            .into_iter()
            .filter_entry(|entry| entry_allowed(entry, &exclusions));

        let mut it = walker;
        while let Some(result) = it.next() {
            if self.token.is_cancelled() {
                stop_reason = Some(StopReason::Cancelled);
                break;
            }
            if let Some(reason) = self.budget.exceeded() {
                stop_reason = Some(reason);
                break;
            }

            let entry = match result {
                Ok(e) => e,
                Err(err) => {
                    let path = err.path().map(|p| p.to_string_lossy().to_string());
                    warnings.push((
                        if err.io_error().map(|e| e.kind() == std::io::ErrorKind::PermissionDenied).unwrap_or(false) {
                            "ACCESS_DENIED".to_string()
                        } else {
                            "WALK_ERROR".to_string()
                        },
                        path,
                    ));
                    continue;
                }
            };

            let depth = entry.depth();
            if entry.file_type().is_dir() {
                directories_visited += 1;
                if depth >= self.budget.limits().max_depth {
                    self.budget.note_depth_exceeded();
                    it.skip_current_dir();
                    continue;
                }
            }

            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path().to_path_buf();

            let ancestor = self.nearest_active(&path);
            let candidates = self.catalog.rules_for_name(&name);
            if candidates.is_empty() {
                continue;
            }

            let mut matched_rule = None;
            let mut matched_evidence = None;
            let mut best_key = (0usize, 0usize, 0usize, usize::MAX);

            for rule in candidates {
                if let Some((parent_rule_id, _)) = &ancestor {
                    if !rule.nested_in.iter().any(|p| p == parent_rule_id) {
                        continue;
                    }
                }
                match rule.kind {
                    TargetKind::Directory if !entry.file_type().is_dir() => continue,
                    TargetKind::File | TargetKind::FileGroup if !entry.file_type().is_file() => {
                        continue
                    }
                    _ => {}
                }
                if let Some(max_depth) = rule.max_depth {
                    if depth > max_depth {
                        continue;
                    }
                }

                let parent = path.parent().unwrap_or(config.root);
                let project = self.resolver.resolve(parent);
                let project_root = project.as_ref().map(|p| PathBuf::from(&p.project_root));
                let workspace_root = project
                    .as_ref()
                    .map(|p| PathBuf::from(&p.root_project_root));

                let git_state = if rule.git_policy == crate::catalog::GitPolicy::DenyTracked {
                    Some(git_guard::git_state_for(&path))
                } else {
                    None
                };

                let evidence = collect_evidence(
                    rule,
                    &path,
                    project_root.as_deref(),
                    workspace_root.as_deref(),
                    git_state,
                );
                let key = (
                    evidence.marker_hits.len(),
                    evidence.content_hits.len(),
                    if rule.generic_name { 0 } else { 1 },
                );
                let rule_index = self
                    .catalog
                    .rules()
                    .iter()
                    .position(|r| r.id == rule.id)
                    .unwrap_or(usize::MAX);
                let cmp = (key.0, key.1, key.2, usize::MAX - rule_index);
                if matched_rule.is_none() || cmp > best_key {
                    best_key = cmp;
                    matched_rule = Some(rule.clone());
                    matched_evidence = Some(evidence);
                }
            }

            let (Some(rule), Some(evidence)) = (matched_rule, matched_evidence) else {
                continue;
            };

            let parent = path.parent().unwrap_or(config.root);
            let project = self.resolver.resolve(parent).unwrap_or_else(|| fallback_project(parent));
            let classification = classify(&rule, &evidence);

            let path_key = crate::safety::path_guard::normalize_key(&path);
            let user_protected = protected_keys
                .iter()
                .any(|key| path_key == *key || crate::safety::path_guard::is_within(&path_key, key));

            let mut warnings_for_item = classification.warnings.clone();
            // Project targets are checked against the live filesystem. A target
            // that is locked or whose lock state cannot be determined is
            // reported as active and cannot be selected.
            let active_use = crate::safety::is_target_in_use(&path);
            let mut selectable = classification.selectable;

            if user_protected {
                warnings_for_item.push("USER_PROTECTED".to_string());
                selectable = false;
            }
            if active_use.blocks_deletion() {
                warnings_for_item.push("TARGET_ACTIVE".to_string());
                selectable = false;
            }
            if rule.requires_idle && active_use != ActiveUse::No {
                selectable = false;
            }

            if self.budget.candidates() >= self.budget.limits().max_candidates {
                stop_reason = Some(StopReason::CandidateLimit);
                break;
            }

            let item_id = format!("t{}", &uuid::Uuid::new_v4().simple().to_string()[..24]);
            let parent_item_id = ancestor.as_ref().map(|(_, id)| id.clone());
            let sys_modified = std::fs::metadata(&path).ok().and_then(|m| m.modified().ok());
            let modified_at = sys_modified.map(system_time_to_iso);
            let last_modified_ms = sys_modified
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64);

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
                scan_session_id: config.scan_session_id.to_string(),
                rule_id: rule.id.clone(),
                provider: "project".to_string(),
                ecosystem: rule.ecosystem.clone(),
                category: rule.category.clone(),
                kind: rule.kind,
                project_id: Some(project.project_id.clone()),
                project_name: Some(project.project_name.clone()),
                project_root: Some(project.project_root.clone()),
                display_name: name.clone(),
                display_path: path.to_string_lossy().to_string(),
                logical_bytes: None,
                allocated_bytes: None,
                estimated_reclaim_bytes: None,
                safety_class: classification.safety_class,
                confidence: classification.confidence,
                active_use,
                evidence_codes: evidence.codes(),
                warning_codes: warnings_for_item.clone(),
                cleanup_method: rule.cleanup,
                regenerate_hint: rule.regenerate.clone(),
                protected: user_protected
                    || classification.safety_class == crate::catalog::SafetyClass::Keep,
                selectable,
                auto_selectable: selectable
                    && classification.safety_class == crate::catalog::SafetyClass::Safe
                    && classification.confidence == crate::catalog::Confidence::High
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

            targets.push(StoredTarget {
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
                    || classification.safety_class == crate::catalog::SafetyClass::Keep,
            });

            if entry.file_type().is_dir() {
                if self.catalog.has_child_rules(&rule.id) {
                    self.active.insert(path.clone(), (rule.id.clone(), item_id.clone()));
                } else {
                    it.skip_current_dir();
                }
            }

            self.budget.note_candidate();
            items.push(item.clone());
            batch.push(item);
            if batch.len() >= BATCH_SIZE {
                on_batch(&batch);
                batch.clear();
            }

            if last_progress.elapsed().as_millis() >= 100 {
                on_progress(ScanProgress {
                    phase: "discovering".to_string(),
                    directories_visited,
                    entries_found: items.len() as u64,
                    entries_measured: 0,
                    bytes_measured: 0,
                    current_path: Some(path.to_string_lossy().to_string()),
                    stop_reason: stop_reason.map(|r| r.code().to_string()),
                });
                last_progress = Instant::now();
            }
        }

        if !batch.is_empty() {
            on_batch(&batch);
        }

        on_progress(ScanProgress {
            phase: "discovering".to_string(),
            directories_visited,
            entries_found: items.len() as u64,
            entries_measured: 0,
            bytes_measured: 0,
            current_path: None,
            stop_reason: stop_reason.map(|r| r.code().to_string()),
        });

        Ok(DiscoveryOutcome {
            items,
            targets,
            directories_visited,
            stop_reason,
            warnings,
        })
    }

    fn nearest_active(&self, path: &Path) -> Option<(String, String)> {
        let mut current = path.parent();
        while let Some(dir) = current {
            if let Some(found) = self.active.get(dir) {
                return Some(found.clone());
            }
            current = dir.parent();
        }
        None
    }
}

fn entry_allowed(entry: &walkdir::DirEntry, exclusions: &HashSet<String>) -> bool {
    if entry.depth() == 0 {
        return true;
    }
    let name = entry.file_name().to_string_lossy().to_lowercase();
    if exclusions.contains(&name) {
        return false;
    }
    if entry.depth() == 1 && SYSTEM_EXCLUSIONS.iter().any(|s| *s == name) {
        return false;
    }
    if name == "packages" || name == "microsoft" {
        if let Some(p) = entry.path().parent().and_then(|p| p.file_name()).map(|f| f.to_string_lossy().to_lowercase()) {
            if p == "local" || p == "appdata" {
                return false;
            }
        }
    }
    // Fast zero-syscall check: if DirEntry is known symlink, prune immediately!
    if entry.file_type().is_symlink() {
        return false;
    }
    // Never descend through junctions or cloud reparse points.
    if crate::platform::is_reparse_point(entry.path()) {
        return false;
    }
    true
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
    }
}

fn system_time_to_iso(time: std::time::SystemTime) -> String {
    match time.duration_since(std::time::UNIX_EPOCH) {
        Ok(dur) => {
            let secs = dur.as_secs() as i64;
            chrono::DateTime::from_timestamp(secs, 0)
                .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
                .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string())
        }
        Err(_) => "1970-01-01T00:00:00Z".to_string(),
    }
}

/// Exposed for tests: evaluates a single directory without walking.
pub fn evaluate_path(
    catalog: &CatalogIndex,
    path: &Path,
) -> Option<(String, crate::catalog::SafetyClass, Vec<String>)> {
    let name = path.file_name()?.to_string_lossy().to_string();
    let parent = path.parent()?;
    let mut resolver = ProjectResolver::new(catalog.project_markers());
    let project = resolver.resolve(parent);
    let git_state = Some(GitState::Unknown);
    for rule in catalog.rules_for_name(&name) {
        let evidence = collect_evidence(
            rule,
            path,
            project.as_ref().map(|p| Path::new(&p.project_root)),
            project.as_ref().map(|p| Path::new(&p.root_project_root)),
            git_state,
        );
        if evidence.marker_hits.is_empty() && !rule.markers.is_empty() {
            continue;
        }
        let c = classify(rule, &evidence);
        return Some((rule.id.clone(), c.safety_class, c.warnings));
    }
    None
}
