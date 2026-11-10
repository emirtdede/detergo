pub mod matcher;
pub mod model;
pub mod project;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::Arc;

pub use matcher::{classify, Classification, Evidence};
pub use model::{
    validate_catalog, Catalog, CatalogError, CleanupMethod, Confidence, GitPolicy, MarkerMode,
    Rule, SafetyClass, TargetKind,
};
pub use project::{ProjectInfo, ProjectResolver};

/// The catalog ships inside the binary. It is parsed and strictly validated on
/// startup; if anything is wrong the cleanup engine is disabled (fail-closed).
pub const EMBEDDED_CATALOG: &str = include_str!("../../assets/targets.toml");

#[derive(Debug, Clone)]
pub struct CatalogIndex {
    catalog: Catalog,
    by_id: HashMap<String, usize>,
    exact: HashMap<String, Vec<usize>>,
    by_extension: HashMap<String, Vec<usize>>,
    patterns: Vec<(String, usize)>,
    project_markers: Vec<String>,
}

impl CatalogIndex {
    pub fn from_toml(source: &str) -> Result<Self, CatalogError> {
        let catalog: Catalog = toml::from_str(source)
            .map_err(|e| CatalogError(format!("Failed to parse TOML catalog: {}", e)))?;
        validate_catalog(&catalog)?;
        Ok(Self::build(catalog))
    }

    pub fn embedded() -> Result<Self, CatalogError> {
        Self::from_toml(EMBEDDED_CATALOG)
    }

    fn build(catalog: Catalog) -> Self {
        let mut by_id = HashMap::new();
        let mut exact: HashMap<String, Vec<usize>> = HashMap::new();
        let mut by_extension: HashMap<String, Vec<usize>> = HashMap::new();
        let mut patterns = Vec::new();
        let mut project_markers: Vec<String> = Vec::new();

        for (idx, rule) in catalog.rules.iter().enumerate() {
            by_id.insert(rule.id.clone(), idx);
            for name in &rule.names {
                let lower = name.to_lowercase();
                if lower.starts_with("*.") && lower[2..].find('*').is_none() {
                    let ext = lower[2..].to_string();
                    by_extension.entry(ext).or_default().push(idx);
                } else if lower.contains('*') {
                    patterns.push((lower, idx));
                } else {
                    exact.entry(lower).or_default().push(idx);
                }
            }
            for marker in &rule.markers {
                if !project_markers.contains(marker) {
                    project_markers.push(marker.clone());
                }
            }
        }

        // Universal project markers are always considered when locating a project
        // root, even if no individual rule referenced them.
        for marker in [
            "package.json",
            "Cargo.toml",
            "pyproject.toml",
            "go.mod",
            "composer.json",
            "pubspec.yaml",
            "pom.xml",
            "build.gradle",
            "build.gradle.kts",
            "CMakeLists.txt",
            "mix.exs",
            "Package.swift",
            "project.godot",
        ] {
            if !project_markers.iter().any(|m| m == marker) {
                project_markers.push(marker.to_string());
            }
        }

        Self {
            catalog,
            by_id,
            exact,
            by_extension,
            patterns,
            project_markers,
        }
    }

    pub fn rules(&self) -> &[Rule] {
        &self.catalog.rules
    }

    pub fn schema_version(&self) -> u32 {
        self.catalog.schema_version
    }

    pub fn rule(&self, id: &str) -> Option<&Rule> {
        self.by_id.get(id).map(|idx| &self.catalog.rules[*idx])
    }

    pub fn project_markers(&self) -> &[String] {
        &self.project_markers
    }

    pub fn rules_for_name(&self, name: &str) -> Vec<&Rule> {
        let lower = name.to_lowercase();
        let mut out: Vec<&Rule> = Vec::new();
        if let Some(idxs) = self.exact.get(&lower) {
            for idx in idxs {
                out.push(&self.catalog.rules[*idx]);
            }
        }
        if let Some(pos) = lower.rfind('.') {
            let ext = &lower[pos + 1..];
            if let Some(idxs) = self.by_extension.get(ext) {
                for idx in idxs {
                    out.push(&self.catalog.rules[*idx]);
                }
            }
        }
        for (pattern, idx) in &self.patterns {
            if model::pattern_matches(pattern, &lower) {
                out.push(&self.catalog.rules[*idx]);
            }
        }
        out
    }

    pub fn child_rules(&self, parent_id: &str) -> Vec<&Rule> {
        self.catalog
            .rules
            .iter()
            .filter(|r| r.nested_in.iter().any(|p| p == parent_id))
            .collect()
    }

    pub fn has_child_rules(&self, parent_id: &str) -> bool {
        self.catalog
            .rules
            .iter()
            .any(|r| r.nested_in.iter().any(|p| p == parent_id))
    }
}

pub type SharedCatalog = Arc<CatalogIndex>;

pub fn load_embedded() -> Result<SharedCatalog, CatalogError> {
    CatalogIndex::embedded().map(Arc::new)
}

pub use model::CleanupMethod as Method;
