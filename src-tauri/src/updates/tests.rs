use crate::updates::{
    cleanup_stale_part_files, interpret_manifest, interpret_release, interpret_release_for_channel,
    is_newer, is_trusted_release_url, sanitize_update_filename, InstallChannel, Version,
};

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
    assert!(is_newer("1.0.0-rc.2", "1.0.0-rc.10"));
    assert!(!is_newer("1.0.0-rc.10", "1.0.0-rc.2"));
    assert!(is_newer("1.0.0-alpha", "1.0.0-alpha.1"));
    let pre = Version::parse("1.0.0-rc.1").unwrap();
    let stable = Version::parse("1.0.0").unwrap();
    assert!(pre < stable);
}

const SAMPLE: &str = r#"{
  "tag_name": "v1.0.1",
  "name": "Detergo 1.0.1",
  "body": "Fixes the catalog panel.",
  "html_url": "https://github.com/emirtdede/detergo/releases/tag/v1.0.1",
  "published_at": "2026-12-01T10:00:00Z",
  "draft": false,
  "prerelease": false,
  "assets": [
    {
      "name": "Detergo-1.0.1-x64-Setup.exe",
      "size": 8388608,
      "browser_download_url": "https://github.com/emirtdede/detergo/releases/download/v1.0.1/Detergo-1.0.1-x64-Setup.exe"
    },
    {
      "name": "Detergo-1.0.1-Portable.exe",
      "size": 8000000,
      "browser_download_url": "https://github.com/emirtdede/detergo/releases/download/v1.0.1/Detergo-1.0.1-Portable.exe"
    }
  ]
}"#;

#[test]
fn interprets_a_published_release() {
    let info = interpret_release(SAMPLE, "1.0.0").expect("payload should parse");
    assert_eq!(info.current_version, "1.0.0");
    assert_eq!(info.latest_version, "1.0.1");
    assert!(info.available);
    assert_eq!(info.release_name, "Detergo 1.0.1");
    assert_eq!(info.notes, "Fixes the catalog panel.");
    assert_eq!(info.assets.len(), 2);
    assert_eq!(info.assets[0].size, 8_388_608);
    assert_eq!(info.source, "github-api");
}

#[test]
fn channel_matching_selects_only_compatible_asset() {
    let installer = interpret_release_for_channel(SAMPLE, "1.0.0", InstallChannel::Installer)
        .expect("installer parse");
    assert!(!installer.managed_by_store);
    assert_eq!(
        installer
            .recommended_asset
            .as_ref()
            .map(|a| a.name.as_str()),
        Some("Detergo-1.0.1-x64-Setup.exe")
    );

    let portable = interpret_release_for_channel(SAMPLE, "1.0.0", InstallChannel::Portable)
        .expect("portable parse");
    assert!(!portable.managed_by_store);
    assert_eq!(
        portable.recommended_asset.as_ref().map(|a| a.name.as_str()),
        Some("Detergo-1.0.1-Portable.exe")
    );

    let store = interpret_release_for_channel(SAMPLE, "1.0.0", InstallChannel::MsixStore)
        .expect("store parse");
    assert!(store.managed_by_store);
    assert!(store.recommended_asset.is_none());
}

#[test]
fn interprets_static_cdn_manifest_with_sha256() {
    let digest = "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD";
    let manifest = format!(
        r#"{{
          "version": "1.2.0",
          "releaseName": "Detergo 1.2.0",
          "releaseUrl": "https://github.com/emirtdede/detergo/releases/tag/v1.2.0",
          "publishedAt": "2026-12-10T12:00:00Z",
          "notes": "Custom theme studio & verified updates.",
          "assets": [
            {{
              "name": "Detergo-1.2.0-x64-Setup.exe",
              "channel": "installer",
              "size": 9123456,
              "sha256": "{digest}",
              "downloadUrl": "https://github.com/emirtdede/detergo/releases/download/v1.2.0/Detergo-1.2.0-x64-Setup.exe"
            }},
            {{
              "name": "Detergo-1.2.0-Portable.exe",
              "channel": "portable",
              "size": 8800000,
              "sha256": "{digest}",
              "downloadUrl": "https://github.com/emirtdede/detergo/releases/download/v1.2.0/Detergo-1.2.0-Portable.exe"
            }}
          ]
        }}"#
    );

    let info =
        interpret_manifest(&manifest, "1.0.0", InstallChannel::Portable).expect("manifest parse");
    assert!(info.available);
    assert_eq!(info.source, "cdn-manifest");
    assert_eq!(info.latest_version, "1.2.0");
    let rec = info.recommended_asset.expect("recommended portable asset");
    assert_eq!(rec.name, "Detergo-1.2.0-Portable.exe");
    assert_eq!(rec.sha256.as_deref(), Some(digest));
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

#[test]
fn untrusted_release_and_asset_urls_are_rejected() {
    let payload = r#"{
      "tag_name": "v2.0.0",
      "html_url": "https://evil.example/phish",
      "assets": [
        {
          "name": "evil.exe",
          "size": 123,
          "browser_download_url": "https://evil.example/evil.exe"
        },
        {
          "name": "legit.exe",
          "size": 456,
          "browser_download_url": "https://objects.githubusercontent.com/github-production-release-asset/legit.exe"
        }
      ]
    }"#;
    let info = interpret_release(payload, "1.0.0").expect("payload should parse");
    assert_eq!(
        info.release_url,
        "https://github.com/emirtdede/detergo/releases/latest"
    );
    assert_eq!(info.assets.len(), 1);
    assert_eq!(info.assets[0].name, "legit.exe");
    assert!(is_trusted_release_url(
        "https://github.com/emirtdede/detergo/releases/latest"
    ));
    assert!(is_trusted_release_url(
        "https://github.com/emirtdede/dev-cleaner/releases/latest"
    ));
    assert!(!is_trusted_release_url(
        "http://github.com/emirtdede/detergo"
    ));
}

#[test]
fn sanitizes_update_filenames_and_cleans_part_files() {
    assert_eq!(
        sanitize_update_filename("Detergo-1.1.0-x64-Setup.exe").unwrap(),
        "Detergo-1.1.0-x64-Setup.exe"
    );
    assert!(sanitize_update_filename("../evil.exe").is_err());
    assert!(sanitize_update_filename("script.ps1").is_err());
    assert!(sanitize_update_filename("foo/bar.exe").is_err());

    let dir = tempfile::tempdir().expect("tempdir");
    let part = dir.path().join("half.exe.123.part");
    let keep = dir.path().join("Detergo-1.1.0-x64-Setup.exe");
    std::fs::write(&part, b"half").expect("write part");
    std::fs::write(&keep, b"good").expect("write keep");
    cleanup_stale_part_files(dir.path());
    assert!(!part.exists());
    assert!(keep.exists());
}
