use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Safety classification, ordered from least to most dangerous to remove.
#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SafetyClass {
    /// Proven reproducible cache with no persistent user data.
    Safe,
    /// Reinstall/rebuild required, but no original user data is lost.
    Regenerate,
    /// User data, costly environment, or insufficient evidence. Manual decision.
    Review,
    /// Protected data. Never selectable, never deletable.
    Keep,
}

impl SafetyClass {
    pub fn default_selected(self) -> bool {
        matches!(self, SafetyClass::Safe)
    }

    pub fn selectable(self) -> bool {
        !matches!(self, SafetyClass::Keep)
    }
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CleanupMethod {
    Trash,
    Permanent,
    OfficialTool,
    None,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TargetKind {
    Directory,
    File,
    FileGroup,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MarkerMode {
    Any,
    All,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum GitPolicy {
    /// Do not consult Git.
    #[default]
    Ignore,
    /// Tracked or modified content blocks automatic cleanup.
    DenyTracked,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    High,
    Medium,
    Low,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct Rule {
    pub id: String,
    pub ecosystem: String,
    pub category: String,
    pub kind: TargetKind,
    /// Case-insensitive literal names or prefix patterns such as `cmake-build-*`.
    pub names: Vec<String>,
    /// Files/directories that must exist at the project root or an ancestor.
    #[serde(default)]
    pub markers: Vec<String>,
    #[serde(default = "default_marker_mode")]
    pub marker_mode: MarkerMode,
    /// Evidence paths that must exist inside the candidate itself.
    #[serde(default)]
    pub content: Vec<String>,
    /// Minimum independent evidence sources (name is always one).
    #[serde(default = "default_min_evidence")]
    pub min_evidence: u8,
    pub safety: SafetyClass,
    #[serde(default = "default_confidence")]
    pub confidence: Confidence,
    pub cleanup: CleanupMethod,
    #[serde(default)]
    pub regenerate: Option<String>,
    /// Generic names (build/dist/out/bin/obj/target/Library) require project proof.
    #[serde(default)]
    pub generic_name: bool,
    /// Never selected automatically and never deletable.
    #[serde(default)]
    pub protected: bool,
    /// Rule IDs whose directory may contain this target (e.g. `.next/cache`).
    #[serde(default)]
    pub nested_in: Vec<String>,
    /// Rules that may be discovered inside this target.
    #[serde(default)]
    pub child_rules: Vec<String>,
    #[serde(default)]
    pub git_policy: GitPolicy,
    /// Browser/agent recording targets must be idle before selection.
    #[serde(default)]
    pub requires_idle: bool,
    /// Maximum directory depth at which this rule matches.
    #[serde(default)]
    #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<usize>>))]
    pub max_depth: Option<usize>,
    #[serde(default)]
    pub note: Option<String>,
}

fn default_marker_mode() -> MarkerMode {
    MarkerMode::Any
}

fn default_min_evidence() -> u8 {
    1
}

fn default_confidence() -> Confidence {
    Confidence::High
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct Catalog {
    pub schema_version: u32,
    pub rules: Vec<Rule>,
}

impl Rule {
    pub fn is_protected(&self) -> bool {
        self.protected || self.safety == SafetyClass::Keep || self.cleanup == CleanupMethod::None
    }

    /// True when the given file name matches this rule (case-insensitive).
    pub fn matches_name(&self, name: &str) -> bool {
        let lower = name.to_lowercase();
        self.names
            .iter()
            .any(|pattern| pattern_matches(&pattern.to_lowercase(), &lower))
    }
}

/// Supports exact names and a single `*` wildcard at any position.
pub fn pattern_matches(pattern: &str, candidate: &str) -> bool {
    match pattern.find('*') {
        Some(pos) => {
            let prefix = &pattern[..pos];
            let suffix = &pattern[pos + 1..];
            candidate.len() > prefix.len() + suffix.len()
                && candidate.starts_with(prefix)
                && candidate.ends_with(suffix)
        }
        None => pattern == candidate,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogError(pub String);

impl std::fmt::Display for CatalogError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Catalog validation error: {}", self.0)
    }
}

impl std::error::Error for CatalogError {}

/// Strict validation. A single invalid rule rejects the whole catalog so that the
/// application fails closed instead of running with a partially trusted rule set.
pub fn validate_catalog(catalog: &Catalog) -> Result<(), CatalogError> {
    if catalog.schema_version != 1 {
        return Err(CatalogError(format!(
            "unsupported schema version: {}",
            catalog.schema_version
        )));
    }
    if catalog.rules.is_empty() {
        return Err(CatalogError("catalog cannot be empty".to_string()));
    }

    let mut ids = HashSet::new();
    for rule in &catalog.rules {
        if rule.id.trim().is_empty() {
            return Err(CatalogError("empty rule id".to_string()));
        }
        if !rule
            .id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '-' | '_'))
        {
            return Err(CatalogError(format!("invalid rule id: {}", rule.id)));
        }
        if !ids.insert(rule.id.clone()) {
            return Err(CatalogError(format!("duplicate rule id: {}", rule.id)));
        }
        if rule.names.is_empty() {
            return Err(CatalogError(format!("{}: missing target names", rule.id)));
        }
        for name in &rule.names {
            let n = name.trim();
            if n.is_empty() || n == "*" || n.contains("..") || n.contains('/') || n.contains('\\') {
                return Err(CatalogError(format!(
                    "{}: invalid name pattern '{}'",
                    rule.id, name
                )));
            }
            if n.matches('*').count() > 1 {
                return Err(CatalogError(format!(
                    "{}: at most a single '*' wildcard is supported: '{}'",
                    rule.id, name
                )));
            }
        }
        if rule.min_evidence == 0 || rule.min_evidence > 3 {
            return Err(CatalogError(format!(
                "{}: min_evidence must be in 1..=3",
                rule.id
            )));
        }
        if rule.generic_name && rule.min_evidence < 2 {
            return Err(CatalogError(format!(
                "{}: generic targets require at least 2 pieces of evidence",
                rule.id
            )));
        }
        if rule.protected && rule.cleanup != CleanupMethod::None {
            return Err(CatalogError(format!(
                "{}: protected rule cannot declare a cleanup method",
                rule.id
            )));
        }
        if rule.safety == SafetyClass::Keep && rule.cleanup != CleanupMethod::None {
            return Err(CatalogError(format!(
                "{}: KEEP safety class cannot declare a cleanup method",
                rule.id
            )));
        }
        if rule.kind != TargetKind::Directory && !rule.content.is_empty() {
            return Err(CatalogError(format!(
                "{}: only directory targets can declare content signatures",
                rule.id
            )));
        }
    }

    for rule in &catalog.rules {
        for parent in rule.nested_in.iter().chain(rule.child_rules.iter()) {
            if !ids.contains(parent) {
                return Err(CatalogError(format!(
                    "{}: unknown related rule '{}'",
                    rule.id, parent
                )));
            }
        }
    }

    Ok(())
}
