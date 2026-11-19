use crate::updates::{interpret_release, is_newer, Version};

#[test]
fn parses_prefixed_and_bare_versions() {
    assert_eq!(Version::parse("v1.2.3").unwrap().to_string(), "1.2.3");
    assert_eq!(Version::parse("1.2.3").unwrap().to_string(), "1.2.3");
    assert_eq!(Version::parse(" 2.0 ").unwrap().to_string(), "2.0.0");
    assert_eq!(
        Version::parse("1.2.3+build.9").unwrap().to_string(),
        "1.2.3"
    );
    assert_eq!(
        Version::parse("1.2.3-rc.1").unwrap().to_string(),
        "1.2.3-rc.1"
    );
}

#[test]
fn rejects_versions_that_are_not_numbers() {
    for raw in ["", "latest", "v", "1.x.3", "1.2.3.4", "nightly-2026"] {
        assert!(Version::parse(raw).is_none(), "{raw} should not parse");
    }
}

#[test]
fn only_a_strictly_newer_release_is_offered() {
    assert!(is_newer("1.0.0", "v1.0.1"));
    assert!(is_newer("1.0.0", "v1.1.0"));
    assert!(is_newer("1.0.0", "v2.0.0"));
    assert!(is_newer("1.9.9", "1.10.0"), "numbers compare numerically");
    assert!(!is_newer("1.0.1", "v1.0.1"));
    assert!(!is_newer("1.1.0", "v1.0.9"));
    assert!(!is_newer("1.0.0", "not-a-version"));
    assert!(!is_newer("garbage", "v9.9.9"));
}

#[test]
fn a_release_outranks_its_own_pre_release() {
    assert!(is_newer("1.0.0-rc.1", "v1.0.0"));
    assert!(!is_newer("1.0.0", "v1.0.0-rc.1"));
}

const SAMPLE: &str = r#"{
  "tag_name": "v1.0.1",
  "name": "Dev Cleaner 1.0.1",
  "body": "Fixes the catalog panel.",
  "html_url": "https://github.com/emirtdede/dev-cleaner/releases/tag/v1.0.1",
  "published_at": "2026-12-01T10:00:00Z",
  "draft": false,
  "prerelease": false,
  "assets": [
    {
      "name": "Dev-Cleaner-1.0.1-x64-Setup.exe",
      "size": 8388608,
      "browser_download_url": "https://example.invalid/setup.exe"
    }
  ]
}"#;

#[test]
fn interprets_a_published_release() {
    let info = interpret_release(SAMPLE, "1.0.0").expect("payload should parse");
    assert_eq!(info.current_version, "1.0.0");
    assert_eq!(info.latest_version, "1.0.1");
    assert!(info.available);
    assert_eq!(info.release_name, "Dev Cleaner 1.0.1");
    assert_eq!(info.notes, "Fixes the catalog panel.");
    assert_eq!(info.assets.len(), 1);
    assert_eq!(info.assets[0].size, 8_388_608);
}

#[test]
fn a_draft_or_prerelease_never_becomes_an_offer() {
    let draft = SAMPLE.replace("\"draft\": false", "\"draft\": true");
    let info = interpret_release(&draft, "1.0.0").expect("payload should parse");
    assert!(!info.available);

    let pre = SAMPLE.replace("\"prerelease\": false", "\"prerelease\": true");
    let info = interpret_release(&pre, "1.0.0").expect("payload should parse");
    assert!(!info.available);
}

#[test]
fn tolerates_missing_optional_fields() {
    let payload = r#"{ "tag_name": "v2.0.0" }"#;
    let info = interpret_release(payload, "1.0.0").expect("payload should parse");
    assert!(info.available);
    assert_eq!(info.release_name, "2.0.0");
    assert_eq!(info.notes, "");
    assert!(info.assets.is_empty());
    assert!(info.release_url.contains("github.com"));
}

#[test]
fn reports_a_malformed_payload_instead_of_panicking() {
    assert!(interpret_release("not json", "1.0.0").is_err());
    assert!(interpret_release(r#"{ "tag_name": "nightly" }"#, "1.0.0").is_err());
}
