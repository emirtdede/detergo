use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetupCliArgs {
    pub uninstall: bool,
    pub silent: bool,
    pub custom_dir: Option<PathBuf>,
    pub delete_user_data: bool,
}

impl SetupCliArgs {
    /// Parses installer/uninstaller arguments supporting standard Windows silent
    /// flags (`/S`, `/SILENT`, `/VERYSILENT`, `/P`, `/DIR="..."`), plus
    /// `--uninstall`, `/UNINSTALL`, and `--delete-user-data`.
    pub fn parse<I, S>(exe_name: Option<&str>, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut uninstall = exe_name
            .map(|n| n.to_ascii_lowercase().starts_with("uninstall"))
            .unwrap_or(false);
        let mut silent = false;
        let mut custom_dir: Option<PathBuf> = None;
        let mut delete_user_data = false;

        let mut iter = args.into_iter().map(|s| s.as_ref().to_string()).peekable();
        while let Some(raw) = iter.next() {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                continue;
            }
            let upper = trimmed.to_ascii_uppercase();
            match upper.as_str() {
                "/S" | "/SILENT" | "/VERYSILENT" | "/P" | "--SILENT" => {
                    silent = true;
                }
                "--UNINSTALL" | "/UNINSTALL" => {
                    uninstall = true;
                }
                "--DELETE-USER-DATA" | "/DELETEUSERDATA" => {
                    delete_user_data = true;
                }
                _ => {
                    if let Some(rest) = strip_prefix_ignore_ascii_case(trimmed, "/DIR=")
                        .or_else(|| strip_prefix_ignore_ascii_case(trimmed, "--dir="))
                        .or_else(|| strip_prefix_ignore_ascii_case(trimmed, "/D="))
                    {
                        let cleaned = rest.trim().trim_matches('"');
                        if !cleaned.is_empty() {
                            custom_dir = Some(PathBuf::from(cleaned));
                        }
                    } else if upper == "/DIR" || upper == "--DIR" {
                        if let Some(next_val) = iter.next() {
                            let cleaned = next_val.trim().trim_matches('"');
                            if !cleaned.is_empty() {
                                custom_dir = Some(PathBuf::from(cleaned));
                            }
                        }
                    }
                }
            }
        }

        Self {
            uninstall,
            silent,
            custom_dir,
            delete_user_data,
        }
    }

    pub fn from_env() -> Self {
        let exe_name = std::env::current_exe()
            .ok()
            .and_then(|p| p.file_name().map(|f| f.to_string_lossy().into_owned()));
        Self::parse(exe_name.as_deref(), std::env::args().skip(1))
    }
}

fn strip_prefix_ignore_ascii_case<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    if value.len() < prefix.len() {
        return None;
    }
    if value[..prefix.len()].eq_ignore_ascii_case(prefix) {
        Some(&value[prefix.len()..])
    } else {
        None
    }
}

pub fn is_safe_install_dir(dir: &Path) -> bool {
    if !dir.is_absolute() {
        return false;
    }
    let text = dir.to_string_lossy();
    let trimmed = text.trim_end_matches(['\\', '/']);
    // Refuse bare drive roots like `C:` or `D:`
    trimmed.len() > 2
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_silent_flags_and_custom_dir() {
        let parsed = SetupCliArgs::parse(
            Some("Detergo-1.0.0-x64-Setup.exe"),
            ["/VERYSILENT", r#"/DIR="D:\Apps\Detergo""#],
        );
        assert!(parsed.silent);
        assert!(!parsed.uninstall);
        assert_eq!(parsed.custom_dir, Some(PathBuf::from(r"D:\Apps\Detergo")));
    }

    #[test]
    fn supports_slash_s_and_slash_p() {
        assert!(SetupCliArgs::parse(Some("setup.exe"), ["/S"]).silent);
        assert!(SetupCliArgs::parse(Some("setup.exe"), ["/SILENT"]).silent);
        assert!(SetupCliArgs::parse(Some("setup.exe"), ["/P"]).silent);
    }

    #[test]
    fn detects_uninstall_from_binary_name_or_flag() {
        let by_name = SetupCliArgs::parse(Some("uninstall.exe"), ["/S", "--delete-user-data"]);
        assert!(by_name.uninstall);
        assert!(by_name.silent);
        assert!(by_name.delete_user_data);

        let by_flag = SetupCliArgs::parse(Some("Detergo-Setup.exe"), ["--uninstall"]);
        assert!(by_flag.uninstall);
        assert!(!by_flag.silent);
    }

    #[test]
    fn rejects_drive_root_as_install_dir() {
        assert!(!is_safe_install_dir(Path::new(r"C:\")));
        assert!(!is_safe_install_dir(Path::new("relative\\dir")));
        assert!(is_safe_install_dir(Path::new(r"C:\Users\dev\Detergo")));
    }
}
