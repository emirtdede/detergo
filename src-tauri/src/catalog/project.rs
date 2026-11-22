use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use super::model::pattern_matches;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub project_root: String,
    pub project_name: String,
    pub project_id: String,
    pub root_project_root: String,
    pub root_project_name: String,
    pub workspace_kind: Option<String>,
    pub markers: Vec<String>,
    /// True when the root was confirmed by a manifest. The UI counts project
    /// roots from this flag, so fallback records can never inflate the KPI.
    #[serde(default = "default_true")]
    pub detected: bool,
}

fn default_true() -> bool {
    true
}

/// Resolves the nearest project root and the enclosing workspace root.
/// Results are cached per directory for the duration of one scan.
pub struct ProjectResolver {
    markers: Vec<String>,
    cache: HashMap<PathBuf, Option<ProjectInfo>>,
    workspace_cache: HashMap<PathBuf, (Option<PathBuf>, Option<String>)>,
    /// Never resolve a project above the scan root. Prevents a stray
    /// `package.json` in an unrelated ancestor (e.g. the user profile) from
    /// lending evidence to a folder outside the scan.
    boundary: Option<PathBuf>,
}

const MAX_ANCESTOR_DEPTH: usize = 12;

impl ProjectResolver {
    pub fn new(markers: &[String]) -> Self {
        let mut all: Vec<String> = markers.to_vec();
        for extra in [
            "package.json",
            "package-lock.json",
            "pnpm-lock.yaml",
            "yarn.lock",
            "bun.lock",
            "bun.lockb",
            "Cargo.toml",
            "pyproject.toml",
            "requirements.txt",
            "setup.py",
            "go.mod",
            "composer.json",
            "pubspec.yaml",
            "pom.xml",
            "build.gradle",
            "build.gradle.kts",
            "settings.gradle",
            "CMakeLists.txt",
            "mix.exs",
            "Package.swift",
            "project.godot",
            "*.csproj",
            "*.sln",
            "*.fsproj",
            "*.vbproj",
            "*.uproject",
        ] {
            if !all.iter().any(|m| m.eq_ignore_ascii_case(extra)) {
                all.push(extra.to_string());
            }
        }
        Self {
            markers: all,
            cache: HashMap::new(),
            workspace_cache: HashMap::new(),
            boundary: None,
        }
    }

    pub fn set_boundary(&mut self, boundary: &Path) {
        self.boundary = Some(boundary.to_path_buf());
        self.cache.clear();
        self.workspace_cache.clear();
    }

    fn at_boundary(&self, dir: &Path) -> bool {
        self.boundary
            .as_ref()
            .map(|b| normalized_key(b) == normalized_key(dir))
            .unwrap_or(false)
    }

    /// Finds the nearest ancestor (including `dir`) that looks like a project root.
    pub fn resolve(&mut self, dir: &Path) -> Option<ProjectInfo> {
        if let Some(cached) = self.cache.get(dir) {
            return cached.clone();
        }

        let mut result: Option<ProjectInfo> = None;
        let mut visited: Vec<PathBuf> = Vec::new();
        let mut current = Some(dir);
        let mut depth = 0;

        while let Some(candidate) = current {
            if let Some(cached) = self.cache.get(candidate) {
                result = cached.clone();
                break;
            }
            if depth > MAX_ANCESTOR_DEPTH {
                break;
            }
            visited.push(candidate.to_path_buf());
            let markers = find_matching_markers(candidate, &self.markers);
            if !markers.is_empty() {
                let (workspace_root, workspace_kind) =
                    if let Some(cached_ws) = self.workspace_cache.get(candidate) {
                        cached_ws.clone()
                    } else {
                        let found = find_workspace_root(candidate, self.boundary.as_deref());
                        self.workspace_cache
                            .insert(candidate.to_path_buf(), found.clone());
                        found
                    };
                let detected_name = project_name(candidate);
                let root_project_root = workspace_root
                    .clone()
                    .unwrap_or_else(|| candidate.to_path_buf());
                let root_project_name = if root_project_root == candidate {
                    detected_name.clone()
                } else {
                    project_name(&root_project_root)
                };
                result = Some(ProjectInfo {
                    project_root: candidate.to_string_lossy().to_string(),
                    project_name: detected_name,
                    project_id: stable_path_id(candidate),
                    root_project_root: root_project_root.to_string_lossy().to_string(),
                    root_project_name,
                    workspace_kind,
                    markers,
                    detected: true,
                });
                break;
            }
            if self.at_boundary(candidate) {
                break;
            }
            current = candidate.parent();
            depth += 1;
        }

        for ancestor in visited {
            self.cache.insert(ancestor, result.clone());
        }
        result
    }
}

pub fn stable_path_id(path: &Path) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    normalized_key(path).hash(&mut hasher);
    format!("p-{:016x}", hasher.finish())
}

pub fn normalized_key(path: &Path) -> String {
    let mut s = path.to_string_lossy().replace('/', "\\");
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        s = stripped.to_string();
    }
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s.to_lowercase()
}

/// Checks every configured project marker against `dir` in a single directory
/// enumeration pass (`FindFirstFileExW` on Windows, `read_dir` on Unix) using
/// an O(1) HashSet for exact names instead of issuing dozens of separate
/// `exists` + `read_dir` syscalls.
fn find_matching_markers(dir: &Path, markers: &[String]) -> Vec<String> {
    let mut exact_names: HashSet<String> = HashSet::new();
    let mut name_list: Vec<String> = Vec::new();

    #[cfg(windows)]
    {
        let Ok(entries) = crate::platform::windows::fast_walk::read_dir_fast(dir) else {
            return Vec::new();
        };
        for entry in entries {
            let lower = entry.name.to_string_lossy().to_lowercase();
            exact_names.insert(lower.clone());
            name_list.push(lower);
        }
    }
    #[cfg(not(windows))]
    {
        let Ok(entries) = fs::read_dir(dir) else {
            return Vec::new();
        };
        for entry in entries.flatten() {
            let lower = entry.file_name().to_string_lossy().to_lowercase();
            exact_names.insert(lower.clone());
            name_list.push(lower);
        }
    }

    if exact_names.is_empty() {
        return Vec::new();
    }

    let mut matched = Vec::new();
    for marker in markers {
        if marker.contains('/') || marker.contains('\\') {
            if dir.join(marker).exists() {
                matched.push(marker.clone());
            }
            continue;
        }
        let lower = marker.to_lowercase();
        let hit = if lower.contains('*') {
            name_list.iter().any(|name| pattern_matches(&lower, name))
        } else {
            exact_names.contains(&lower)
        };
        if hit {
            matched.push(marker.clone());
        }
    }
    matched
}

pub fn marker_exists(dir: &Path, marker: &str) -> bool {
    if marker.contains('*') {
        let Ok(entries) = fs::read_dir(dir) else {
            return false;
        };
        let lower = marker.to_lowercase();
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if pattern_matches(&lower, &name) {
                return true;
            }
        }
        false
    } else {
        dir.join(marker).exists()
    }
}

fn find_workspace_root(start: &Path, boundary: Option<&Path>) -> (Option<PathBuf>, Option<String>) {
    let mut current = Some(start);
    let mut depth = 0;
    while let Some(dir) = current {
        if depth > MAX_ANCESTOR_DEPTH {
            break;
        }
        if let Some(boundary) = boundary {
            if normalized_key(boundary) == normalized_key(dir) {
                // Evaluate the boundary itself, then stop.
                if let Some(kind) = workspace_kind(dir) {
                    return (Some(dir.to_path_buf()), Some(kind));
                }
                break;
            }
        }
        if dir.join("pnpm-workspace.yaml").is_file() {
            return (Some(dir.to_path_buf()), Some("pnpm".to_string()));
        }
        if dir.join("turbo.json").is_file() {
            return (Some(dir.to_path_buf()), Some("turbo".to_string()));
        }
        if dir.join("lerna.json").is_file() {
            return (Some(dir.to_path_buf()), Some("lerna".to_string()));
        }
        if dir.join("nx.json").is_file() {
            return (Some(dir.to_path_buf()), Some("nx".to_string()));
        }
        if let Some(kind) = gradle_workspace_kind(dir) {
            return (Some(dir.to_path_buf()), Some(kind));
        }
        if is_npm_workspace(dir) {
            return (Some(dir.to_path_buf()), Some("npm".to_string()));
        }
        if is_cargo_workspace(dir) {
            return (Some(dir.to_path_buf()), Some("cargo".to_string()));
        }
        current = dir.parent();
        depth += 1;
    }
    (None, None)
}

fn workspace_kind(dir: &Path) -> Option<String> {
    if dir.join("pnpm-workspace.yaml").is_file() {
        return Some("pnpm".to_string());
    }
    if dir.join("turbo.json").is_file() {
        return Some("turbo".to_string());
    }
    if dir.join("lerna.json").is_file() {
        return Some("lerna".to_string());
    }
    if dir.join("nx.json").is_file() {
        return Some("nx".to_string());
    }
    if dir.join("settings.gradle").is_file() || dir.join("settings.gradle.kts").is_file() {
        return Some("gradle".to_string());
    }
    if is_npm_workspace(dir) {
        return Some("npm".to_string());
    }
    if is_cargo_workspace(dir) {
        return Some("cargo".to_string());
    }
    None
}

fn gradle_workspace_kind(dir: &Path) -> Option<String> {
    if dir.join("settings.gradle").is_file() || dir.join("settings.gradle.kts").is_file() {
        return Some("gradle".to_string());
    }
    None
}

fn is_npm_workspace(dir: &Path) -> bool {
    let pkg = dir.join("package.json");
    let Ok(content) = fs::read_to_string(&pkg) else {
        return false;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) else {
        return false;
    };
    // `"workspaces": null` and `"workspaces": []` do not make a workspace root.
    // Accepting any present key resolved the wrong root and changed scan
    // grouping and evidence collection.
    json.get("workspaces")
        .and_then(|value| value.as_array())
        .map(|patterns| !patterns.is_empty())
        .unwrap_or(false)
}

fn is_cargo_workspace(dir: &Path) -> bool {
    let manifest = dir.join("Cargo.toml");
    let Ok(content) = fs::read_to_string(&manifest) else {
        return false;
    };
    // Parse instead of a substring test: a package whose manifest merely
    // mentions "[workspace]" in a comment or description is not a workspace
    // root.
    let Ok(value) = content.parse::<toml::Value>() else {
        return false;
    };
    value.get("workspace").is_some()
}

pub fn project_name(dir: &Path) -> String {
    if let Some(name) = read_package_json_name(dir) {
        return name;
    }
    if let Some(name) = read_cargo_package_name(dir) {
        return name;
    }
    if let Some(name) = read_pyproject_name(dir) {
        return name;
    }
    dir.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| dir.to_string_lossy().to_string())
}

fn read_package_json_name(dir: &Path) -> Option<String> {
    let content = fs::read_to_string(dir.join("package.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    let name = json.get("name")?.as_str()?.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn read_cargo_package_name(dir: &Path) -> Option<String> {
    let content = fs::read_to_string(dir.join("Cargo.toml")).ok()?;
    let value: toml::Value = content.parse().ok()?;
    let name = value.get("package")?.get("name")?.as_str()?.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn read_pyproject_name(dir: &Path) -> Option<String> {
    let content = fs::read_to_string(dir.join("pyproject.toml")).ok()?;
    let value: toml::Value = content.parse().ok()?;
    let name = value
        .get("project")
        .and_then(|p| p.get("name"))
        .or_else(|| {
            value
                .get("tool")
                .and_then(|t| t.get("poetry"))
                .and_then(|p| p.get("name"))
        })
        .and_then(|n| n.as_str())?
        .trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{is_cargo_workspace, is_npm_workspace};

    #[test]
    fn an_empty_workspaces_key_is_not_a_workspace_root() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = dir.path().join("package.json");

        std::fs::write(&manifest, r#"{"workspaces": []}"#).unwrap();
        assert!(!is_npm_workspace(dir.path()));

        std::fs::write(&manifest, r#"{"workspaces": null}"#).unwrap();
        assert!(!is_npm_workspace(dir.path()));

        std::fs::write(&manifest, r#"{"workspaces": ["packages/*"]}"#).unwrap();
        assert!(is_npm_workspace(dir.path()));
    }

    #[test]
    fn a_manifest_that_merely_mentions_workspace_is_not_a_root() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = dir.path().join("Cargo.toml");

        std::fs::write(
            &manifest,
            "# [workspace]\n[package]\nname = \"pkg\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        assert!(!is_cargo_workspace(dir.path()));

        std::fs::write(&manifest, "[workspace]\nmembers = [\"a\"]\n").unwrap();
        assert!(is_cargo_workspace(dir.path()));
    }
}
