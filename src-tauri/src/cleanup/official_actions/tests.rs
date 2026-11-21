use super::catalog::ACTIONS;
use super::exec::{extract_version, quote_cmd_arg, tail, CmdQuoteError};
use super::{
    list_cache_providers, preview_action, CacheMeasureEvent, OfficialActionRegistry,
    PendingExecution, MAX_PENDING_ACTIONS, PENDING_TTL,
};
use std::path::PathBuf;
use std::time::{Duration, Instant};

#[test]
fn quote_cmd_arg_keeps_shell_metacharacters_inside_quotes() {
    assert_eq!(
        quote_cmd_arg("C:\\Program Files\\nodejs\\npm.cmd").unwrap(),
        "\"C:\\Program Files\\nodejs\\npm.cmd\""
    );
    assert_eq!(quote_cmd_arg("a&b|c<d>e^f").unwrap(), "\"a&b|c<d>e^f\"");
    assert_eq!(quote_cmd_arg("say \"hi\"").unwrap(), "\"say \"\"hi\"\"\"");
}

#[test]
fn quote_cmd_arg_rejects_unrecoverable_tokens() {
    assert_eq!(
        quote_cmd_arg("C:\\Users\\me\\%TEMP%\\npm.cmd"),
        Err(CmdQuoteError::PercentExpansion)
    );
    assert_eq!(quote_cmd_arg("a\nb"), Err(CmdQuoteError::ControlChar));
    assert_eq!(quote_cmd_arg("a\0b"), Err(CmdQuoteError::ControlChar));
}

#[cfg(windows)]
#[test]
fn command_for_executable_runs_batch_in_path_with_spaces_and_blocks_injection() {
    let temp = tempfile::tempdir().expect("temp dir");
    let spaced_dir = temp.path().join("Program Files Mock");
    std::fs::create_dir_all(&spaced_dir).expect("create spaced dir");
    let script = spaced_dir.join("echo-tool.cmd");
    std::fs::write(&script, "@echo off\r\necho OK-%~1-%~2\r\n").expect("write cmd");

    let mut cmd =
        super::exec::command_for_executable(&script, &["cache".to_string(), "clean".to_string()])
            .expect("build command");
    let out = cmd.output().expect("run batch in spaced path");
    assert!(
        out.status.success(),
        "batch execution failed: stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        String::from_utf8_lossy(&out.stdout).contains("OK-cache-clean"),
        "unexpected stdout: {}",
        String::from_utf8_lossy(&out.stdout)
    );

    // Reject shell metacharacters in batch paths/arguments.
    let bad_dir = temp.path().join("bad&dir");
    let bad_script = bad_dir.join("tool.cmd");
    assert!(super::exec::command_for_executable(&bad_script, &["--version".to_string()]).is_err());
    assert!(super::exec::command_for_executable(&script, &["a&calc".to_string()]).is_err());
}

#[test]
fn tail_is_utf8_safe() {
    let text = "başlangıç".repeat(400);
    let result = tail(&text, 101);
    assert!(result.len() <= 101);
    assert!(text.ends_with(&result));
}

#[test]
fn tail_keeps_short_text() {
    assert_eq!(tail("  kısa çıktı  ", 100), "kısa çıktı");
}

#[test]
fn version_banners_reduce_to_the_numeric_part() {
    assert_eq!(
        extract_version("pip 26.2.1 from C:\\Users\\emir\\AppData\\Local\\Programs\\Python\\Python312\\Lib\\site-packages\\pip (python 3.12)").as_deref(),
        Some("26.2.1")
    );
    assert_eq!(
        extract_version("Docker version 29.9.2, build a82e528").as_deref(),
        Some("29.9.2")
    );
    assert_eq!(
        extract_version("go version go1.27.0 windows/amd64").as_deref(),
        Some("1.27.0")
    );
    assert_eq!(extract_version("npm 11.9.1").as_deref(), Some("11.9.1"));
    assert_eq!(extract_version("10.0.403").as_deref(), Some("10.0.403"));
    assert_eq!(
        extract_version("WSL sürümü: 2.7.14.0").as_deref(),
        Some("2.7.14.0")
    );
    assert_eq!(extract_version("Yarn 1.22.22").as_deref(), Some("1.22.22"));
}

#[test]
fn version_extraction_rejects_non_versions() {
    assert_eq!(extract_version("command not found"), None);
    assert_eq!(extract_version("v2"), None);
    assert_eq!(extract_version(""), None);
}

#[test]
fn pending_actions_stay_bounded_and_drop_the_oldest() {
    let registry = OfficialActionRegistry::new();
    let mut tokens = Vec::new();
    for _ in 0..MAX_PENDING_ACTIONS {
        tokens.push(registry.issue(
            "npm",
            "npm.cache.clean",
            PendingExecution::Command {
                exe: PathBuf::from("npm.cmd"),
                args: vec!["cache".into(), "clean".into(), "--force".into()],
            },
            0,
            false,
        ));
    }
    {
        let now = Instant::now();
        let mut pending = registry.lock_pending();
        for (index, token) in tokens.iter().enumerate() {
            let age = u64::try_from(MAX_PENDING_ACTIONS - index).unwrap_or(0);
            let action = pending.get_mut(token).expect("token was just issued");
            action.created = now.checked_sub(Duration::from_secs(age)).unwrap_or(now);
        }
    }

    let newest = registry.issue(
        "npm",
        "npm.cache.clean",
        PendingExecution::Command {
            exe: PathBuf::from("npm.cmd"),
            args: vec!["cache".into(), "clean".into(), "--force".into()],
        },
        0,
        false,
    );

    assert!(registry.take(&tokens[0]).is_err());
    assert!(registry.take(&tokens[1]).is_ok());
    assert!(registry.take(&newest).is_ok());
    assert_eq!(registry.lock_pending().len(), MAX_PENDING_ACTIONS - 2);
}

#[test]
fn an_expired_action_token_is_rejected() {
    let registry = OfficialActionRegistry::new();
    let token = registry.issue(
        "npm",
        "npm.cache.clean",
        PendingExecution::Command {
            exe: PathBuf::from("npm.cmd"),
            args: vec![],
        },
        0,
        false,
    );
    {
        let mut pending = registry.lock_pending();
        let action = pending.get_mut(&token).expect("token was just issued");
        action.created = Instant::now()
            .checked_sub(PENDING_TTL + Duration::from_secs(1))
            .unwrap_or_else(Instant::now);
    }
    assert!(registry.take(&token).is_err());
    assert!(registry.lock_pending().is_empty());
}

#[test]
fn cache_measure_events_serialize_as_camel_case() {
    let started = serde_json::to_value(CacheMeasureEvent::Started { provider_count: 5 }).unwrap();
    assert_eq!(started["type"], "started");
    assert_eq!(started["providerCount"], 5);

    let path = serde_json::to_value(CacheMeasureEvent::PathMeasured {
        provider_id: "pnpm".to_string(),
        path: "C:\\cache".to_string(),
        exists: true,
        bytes: Some(42),
        unmeasured_reason: None,
    })
    .unwrap();
    assert_eq!(path["type"], "pathMeasured");
    assert_eq!(path["providerId"], "pnpm");
    assert_eq!(path["bytes"], 42);
}

#[test]
fn major_disk_hog_providers_expose_clean_actions_while_wsl_stays_read_only() {
    for id in [
        "docker",
        "cargo",
        "gradle",
        "maven",
        "vcpkg",
        "huggingface",
        "ollama",
        "electron",
    ] {
        let def = ACTIONS
            .iter()
            .find(|p| p.id == id)
            .unwrap_or_else(|| panic!("provider '{id}' missing"));
        assert!(!def.read_only, "provider '{id}' must not be read-only");
        assert!(
            !def.actions.is_empty(),
            "provider '{id}' must expose at least one cleanup action"
        );
    }

    let wsl = ACTIONS.iter().find(|p| p.id == "wsl").unwrap();
    assert!(wsl.read_only);
    let registry = OfficialActionRegistry::new();
    let token = crate::scanner::cancellation::CancellationToken::new();
    assert!(preview_action(&registry, "wsl", "wsl.clean", &token).is_err());

    // Playwright and Cypress npx invocations must pass --no-install so offline
    // runs never silently download packages from npm.
    let providers = list_cache_providers();
    for pid in ["playwright", "cypress"] {
        let p = providers.iter().find(|p| p.id == pid).unwrap();
        let npx_action = &p.actions[0];
        assert!(
            npx_action.args.iter().any(|a| a == "--no-install"),
            "{pid} npx action must include --no-install"
        );
    }
}
