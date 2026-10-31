//! Integration test: when Git cannot be executed, the guard must report
//! `Unknown` (which classifies as REVIEW) instead of assuming a clean tree.
//! Runs in its own process so temporarily clearing PATH cannot affect the
//! unit-test process.

use node_cleaner_lib::catalog::matcher::GitState;
use node_cleaner_lib::safety::git_guard::git_state_for;

#[test]
fn unavailable_git_is_unknown_not_clean() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(temp.path().join(".git")).unwrap();
    std::fs::write(temp.path().join("build.txt"), "x").unwrap();

    std::env::set_var("PATH", "");

    let state = git_state_for(temp.path());
    assert_eq!(state, GitState::Unknown);
}
