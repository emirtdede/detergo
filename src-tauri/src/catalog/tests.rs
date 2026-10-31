use super::*;
use super::matcher::{collect_evidence, GitState};
use std::fs;

const VALID: &str = r#"
schema_version = 1

[[rules]]
id = "js.node_modules"
ecosystem = "javascript"
category = "dependencies"
kind = "directory"
names = ["node_modules"]
markers = ["package.json", "pnpm-lock.yaml"]
content = ["package.json"]
min_evidence = 1
safety = "regenerate"
cleanup = "trash"
regenerate = "pnpm install"

[[rules]]
id = "js.build"
ecosystem = "javascript"
category = "build"
kind = "directory"
names = ["build"]
markers = ["package.json"]
generic_name = true
min_evidence = 2
safety = "regenerate"
cleanup = "trash"
git_policy = "denytracked"
"#;

#[test]
fn parses_and_validates_catalog() {
    let index = CatalogIndex::from_toml(VALID).expect("catalog should be valid");
    assert_eq!(index.rules().len(), 2);
    assert!(index.rule("js.node_modules").is_some());
    assert!(index.rule("missing").is_none());
}

#[test]
fn rejects_duplicate_rule_ids() {
    let t = VALID.replace("id = \"js.build\"", "id = \"js.node_modules\"");
    let err = CatalogIndex::from_toml(&t).unwrap_err();
    assert!(err.0.contains("yinelenen"));
}

#[test]
fn rejects_unknown_bucket_marker_reference() {
    let t = r#"
schema_version = 1
[[rules]]
id = "a.b"
ecosystem = "x"
category = "c"
kind = "directory"
names = ["cache"]
nested_in = ["not.there"]
safety = "safe"
cleanup = "trash"
"#;
    let err = CatalogIndex::from_toml(t).unwrap_err();
    assert!(err.0.contains("bilinmeyen"));
}

#[test]
fn rejects_generic_name_with_single_evidence() {
    let t = r#"
schema_version = 1
[[rules]]
id = "js.generic"
ecosystem = "javascript"
category = "build"
kind = "directory"
names = ["dist"]
generic_name = true
min_evidence = 1
safety = "regenerate"
cleanup = "trash"
"#;
    let err = CatalogIndex::from_toml(t).unwrap_err();
    assert!(err.0.contains("2 kan"), "unexpected error: {}", err.0);
}

#[test]
fn rejects_invalid_toml_and_keep_with_cleanup() {
    assert!(CatalogIndex::from_toml("this is not toml").is_err());

    let t = VALID.replace(
        "safety = \"regenerate\"\ncleanup = \"trash\"\nregenerate = \"pnpm install\"",
        "safety = \"keep\"\ncleanup = \"trash\"",
    );
    assert!(CatalogIndex::from_toml(&t).is_err());
}

#[test]
fn embedded_catalog_is_valid_and_covers_ecosystems() {
    let index = CatalogIndex::embedded().expect("embedded catalog must be valid");
    let ecosystems: std::collections::HashSet<_> =
        index.rules().iter().map(|r| r.ecosystem.as_str()).collect();
    for expected in [
        "javascript",
        "python",
        "rust",
        "dotnet",
        "java",
        "go",
        "php",
        "dart",
        "cpp",
        "unity",
        "unreal",
    ] {
        assert!(
            ecosystems.iter().any(|e| *e == expected),
            "missing ecosystem {}",
            expected
        );
    }
}

#[test]
fn name_matching_is_case_insensitive_and_supports_prefix_wildcards() {
    let index = CatalogIndex::from_toml(
        r#"
schema_version = 1
[[rules]]
id = "cpp.cmake_build"
ecosystem = "cpp"
category = "build"
kind = "directory"
names = ["cmake-build-*"]
safety = "regenerate"
cleanup = "trash"
"#,
    )
    .unwrap();
    assert_eq!(index.rules_for_name("CMake-Build-Debug").len(), 1);
    assert_eq!(index.rules_for_name("cmake-build-").len(), 0);
    assert_eq!(index.rules_for_name("cmake-build").len(), 0);
}

#[test]
fn evidence_requires_marker_for_generic_targets() {
    let rule = Rule {
        id: "js.build".into(),
        ecosystem: "javascript".into(),
        category: "build".into(),
        kind: TargetKind::Directory,
        names: vec!["build".into()],
        markers: vec!["package.json".into()],
        marker_mode: MarkerMode::Any,
        content: vec![],
        min_evidence: 2,
        safety: SafetyClass::Regenerate,
        confidence: Confidence::High,
        cleanup: CleanupMethod::Trash,
        regenerate: None,
        generic_name: true,
        protected: false,
        nested_in: vec![],
        child_rules: vec![],
        git_policy: GitPolicy::Ignore,
        requires_idle: false,
        max_depth: None,
        note: None,
    };

    let empty = Evidence::default();
    let c = classify(&rule, &empty);
    assert_eq!(c.safety_class, SafetyClass::Review);
    assert!(!c.warnings.is_empty());

    let with_marker = Evidence {
        marker_hits: vec!["package.json".into()],
        ..Default::default()
    };
    assert_eq!(classify(&rule, &with_marker).safety_class, SafetyClass::Regenerate);
}

#[test]
fn tracked_git_content_is_never_safe() {
    let index = CatalogIndex::from_toml(VALID).unwrap();
    let rule = index.rule("js.build").unwrap();
    let evidence = Evidence {
        marker_hits: vec!["package.json".into()],
        git_state: Some(GitState::TrackedModified),
        ..Default::default()
    };
    let c = classify(rule, &evidence);
    assert_eq!(c.safety_class, SafetyClass::Review);
    assert!(c.warnings.contains(&"GIT_TRACKED_CONTENT".to_string()));
}

#[test]
fn evidence_collection_finds_markers_and_content() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("app");
    let nm = project.join("node_modules");
    fs::create_dir_all(&nm).unwrap();
    fs::write(project.join("package.json"), "{}").unwrap();
    fs::write(nm.join("package.json"), "{}").unwrap();

    let index = CatalogIndex::from_toml(VALID).unwrap();
    let rule = index.rule("js.node_modules").unwrap();
    let evidence = collect_evidence(rule, &nm, Some(&project), Some(&project), None);
    assert!(evidence.marker_hits.contains(&"package.json".to_string()));
    assert!(evidence.content_hits.contains(&"package.json".to_string()));
}

#[test]
fn project_resolver_finds_nearest_root_and_workspace() {
    let temp = tempfile::tempdir().unwrap();
    let workspace = temp.path().join("mono");
    let app = workspace.join("apps").join("web");
    fs::create_dir_all(&app).unwrap();
    fs::write(workspace.join("pnpm-workspace.yaml"), "").unwrap();
    fs::write(workspace.join("package.json"), "{\"name\":\"mono-root\"}").unwrap();
    fs::write(app.join("package.json"), "{\"name\":\"web-app\"}").unwrap();

    let mut resolver = ProjectResolver::new(&[]);
    let info = resolver.resolve(&app).expect("project must resolve");
    assert_eq!(info.project_name, "web-app");
    assert_eq!(info.project_root, app.to_string_lossy());
    assert_eq!(info.root_project_name, "mono-root");
    assert_eq!(info.workspace_kind.as_deref(), Some("pnpm"));
}

fn materialize(root: &std::path::Path, pattern: &str, as_dir: bool) {
    let name = pattern.replace('*', "test");
    let path = root.join(name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    if as_dir {
        fs::create_dir_all(&path).unwrap();
    } else {
        fs::write(&path, "{}").unwrap();
    }
}

#[test]
fn every_catalog_rule_has_positive_and_negative_evidence() {
    use crate::catalog::matcher::classify;
    use crate::catalog::model::{SafetyClass, TargetKind};

    let index = CatalogIndex::embedded().unwrap();
    let temp = tempfile::tempdir().unwrap();

    for (i, rule) in index.rules().iter().enumerate() {
        let project = temp.path().join(format!("rule-{}", i));
        fs::create_dir_all(&project).unwrap();

        for marker in &rule.markers {
            let is_dir = marker == "Assets" || marker == "ProjectSettings";
            materialize(&project, marker, is_dir);
        }

        let name = rule.names[0].replace('*', "test");
        let candidate = project.join(&name);
        match rule.kind {
            TargetKind::Directory => fs::create_dir_all(&candidate).unwrap(),
            _ => fs::write(&candidate, "x").unwrap(),
        }
        for signature in &rule.content {
            materialize(&candidate, signature, false);
        }

        let evidence = collect_evidence(
            rule,
            &candidate,
            Some(&project),
            Some(&project),
            Some(GitState::NotRepository),
        );
        let positive = classify(rule, &evidence);
        assert_eq!(
            positive.safety_class, rule.safety,
            "{} positive evidence classified as {:?} ({:?})",
            rule.id, positive.safety_class, positive.warnings
        );
        assert_eq!(
            positive.selectable,
            rule.safety != SafetyClass::Keep,
            "{} selectability mismatch",
            rule.id
        );

        // Negative fixture: same name, no project markers at all.
        if rule.markers.is_empty() {
            continue;
        }
        let empty_project = temp.path().join(format!("empty-{}", i));
        fs::create_dir_all(&empty_project).unwrap();
        let bare = empty_project.join(&name);
        match rule.kind {
            TargetKind::Directory => fs::create_dir_all(&bare).unwrap(),
            _ => fs::write(&bare, "x").unwrap(),
        }
        let empty_evidence = collect_evidence(
            rule,
            &bare,
            Some(&empty_project),
            Some(&empty_project),
            Some(GitState::NotRepository),
        );
        let negative = classify(rule, &empty_evidence);
        if rule.is_protected() {
            assert_eq!(negative.safety_class, SafetyClass::Keep, "{}", rule.id);
        } else {
            assert_eq!(
                negative.safety_class,
                SafetyClass::Review,
                "{} without markers must be REVIEW, got {:?}",
                rule.id,
                negative.safety_class
            );
            assert!(negative.warnings.iter().any(|w| w == "NO_PROJECT_MARKER"));
        }
    }
}
