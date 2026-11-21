use crate::error::AppError;
use crate::scanner::models::ScanScope;

use super::args::{
    parse_human_size, parse_scan_args, parse_scan_scope, parse_selection, TargetSelection,
};
use super::{is_gui_launch_args, scan_exit_code};

#[test]
fn scope_aliases_map_to_expected_variants() {
    assert_eq!(parse_scan_scope("project").unwrap(), ScanScope::Project);
    assert_eq!(parse_scan_scope("projects").unwrap(), ScanScope::Project);
    assert_eq!(parse_scan_scope("agents").unwrap(), ScanScope::Agents);
    assert_eq!(parse_scan_scope("all").unwrap(), ScanScope::AllDrives);
    assert_eq!(parse_scan_scope("combined").unwrap(), ScanScope::Combined);
}

#[test]
fn caches_scope_points_at_the_caches_command() {
    let err = parse_scan_scope("caches").unwrap_err();
    assert!(format!("{err}").contains("caches --clean all --yes"));
    assert_eq!(scan_exit_code(&err), 3);
}

#[test]
fn unknown_scope_is_an_argument_error() {
    let err = parse_scan_scope("everything").unwrap_err();
    assert_eq!(scan_exit_code(&err), 3);
}

#[test]
fn exit_codes_follow_the_automation_contract() {
    assert_eq!(scan_exit_code(&AppError::ScanFailed("x".into())), 1);
    assert_eq!(scan_exit_code(&AppError::RecycleBinFailed("x".into())), 2);
    assert_eq!(
        scan_exit_code(&AppError::PermanentDeleteFailed("x".into())),
        2
    );
    assert_eq!(scan_exit_code(&AppError::InvalidPath("x".into())), 3);
    assert_eq!(scan_exit_code(&AppError::PathNotFound("x".into())), 3);
    assert_eq!(scan_exit_code(&AppError::Blocked("x".into())), 4);
    assert_eq!(scan_exit_code(&AppError::UnsafeDeleteTarget("x".into())), 4);
    assert_eq!(scan_exit_code(&AppError::PlanInvalid("x".into())), 4);
}

#[test]
fn target_selection_parses_short_and_long_subsets() {
    let pa = TargetSelection::parse("p,a").unwrap();
    assert!(pa.projects && pa.agents && !pa.caches && !pa.system);
    assert_eq!(pa.scanner_scope(), Some(ScanScope::Combined));

    let cs = TargetSelection::parse("caches,sys").unwrap();
    assert!(!cs.projects && !cs.agents && cs.caches && cs.system);
    assert_eq!(cs.scanner_scope(), None);

    let all = TargetSelection::parse("all").unwrap();
    assert!(all.projects && all.agents && all.caches && all.system);
    assert_eq!(all.scanner_scope(), Some(ScanScope::Combined));

    let drives = TargetSelection::parse("drives").unwrap();
    assert_eq!(drives.scanner_scope(), Some(ScanScope::AllDrives));

    assert!(TargetSelection::parse("bogus").is_err());
}

#[test]
fn selection_supports_lists_ranges_and_words() {
    assert_eq!(parse_selection("", 5), Vec::<usize>::new());
    assert_eq!(parse_selection("none", 5), Vec::<usize>::new());
    assert_eq!(parse_selection("all", 3), vec![0, 1, 2]);
    assert_eq!(parse_selection("1,3-4", 5), vec![0, 2, 3]);
    assert_eq!(parse_selection(" 2 2 9 0 ", 4), vec![1]);
    assert_eq!(parse_selection("4-2", 5), Vec::<usize>::new());
    assert_eq!(parse_selection("x,2,y", 5), vec![1]);
}

#[test]
fn gui_launch_flags_are_never_captured_by_cli() {
    assert!(is_gui_launch_args(&["detergo.exe".into()]));
    assert!(is_gui_launch_args(&[
        "detergo.exe".into(),
        "--open-view".into(),
        "system".into(),
    ]));
    assert!(is_gui_launch_args(&[
        "detergo.exe".into(),
        "--wait-pid".into(),
        "1234".into(),
    ]));
    assert!(!is_gui_launch_args(&["detergo.exe".into(), "s".into()]));
}

#[test]
fn unknown_scan_flags_fail_closed_with_exit_code_3() {
    let args = vec![".".into(), "-c".into(), "--dryrun".into()];
    let err = parse_scan_args(&args).unwrap_err();
    assert_eq!(scan_exit_code(&err), 3);

    let args = vec!["-cn".into(), "-m".into(), "500MB".into()];
    let parsed = parse_scan_args(&args).unwrap();
    assert!(parsed.auto_clean && parsed.dry_run);
    assert_eq!(parsed.min_size_bytes, 500 * 1024 * 1024);
}

#[test]
fn older_flag_parses_durations_and_rejects_invalid_values() {
    let args = vec![".".into(), "-o".into(), "30d".into()];
    assert_eq!(parse_scan_args(&args).unwrap().older_than_days, Some(30));

    let args = vec![".".into(), "--older".into(), "3m".into()];
    assert_eq!(parse_scan_args(&args).unwrap().older_than_days, Some(90));

    let args = vec![".".into(), "--older-than".into(), "1y".into()];
    assert_eq!(parse_scan_args(&args).unwrap().older_than_days, Some(365));

    let bad = vec![".".into(), "--older".into(), "forever".into()];
    let err = parse_scan_args(&bad).unwrap_err();
    assert_eq!(scan_exit_code(&err), 3);
}

#[test]
fn equals_syntax_and_double_dash_are_supported() {
    let args = vec![
        "--min-size=500MB".into(),
        "--older-than=30d".into(),
        "--top=10".into(),
        "--scope=projects".into(),
        "--safety=safe,regenerate".into(),
        "--".into(),
        "-weird-folder".into(),
    ];
    let parsed = parse_scan_args(&args).unwrap();
    assert_eq!(parsed.min_size_bytes, 500 * 1024 * 1024);
    assert_eq!(parsed.older_than_days, Some(30));
    assert_eq!(parsed.top, Some(10));
    assert_eq!(parsed.root_path, std::path::PathBuf::from("-weird-folder"));
}

#[test]
fn human_size_parses_units_and_rejects_garbage() {
    assert_eq!(parse_human_size("50").unwrap(), 50 * 1024 * 1024);
    assert_eq!(parse_human_size("500KB").unwrap(), 500 * 1024);
    assert_eq!(parse_human_size("1.5GB").unwrap(), 1_610_612_736);
    assert!(parse_human_size("abc").is_err());
    assert!(parse_human_size("-5MB").is_err());
}
