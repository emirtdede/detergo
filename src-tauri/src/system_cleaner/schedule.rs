//! Windows Task Scheduler integration for unattended runs.
//!
//! One named task runs the same executable with `system --clean <profile>
//! --yes`, so the scheduled path and the GUI path share every guard. The task
//! is created from generated XML rather than `schtasks` command-line switches:
//! the XML schema is language-neutral, while the CLI strings are localised and
//! would have to be parsed back.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{Datelike, Local, NaiveDate, NaiveDateTime, NaiveTime, Weekday};

use crate::error::AppError;
use crate::system_cleaner::SystemAutomationConfig;

pub const TASK_NAME: &str = "Detergo System Cleanup";

const CREATE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

pub struct SystemAutomationRepository {
    path: PathBuf,
}

impl SystemAutomationRepository {
    pub fn new() -> Self {
        let base = std::env::var("APPDATA")
            .map(PathBuf::from)
            .or_else(|_| std::env::var("USERPROFILE").map(|p| PathBuf::from(p).join(".config")))
            .unwrap_or_else(|_| PathBuf::from("."));
        let app_dir = crate::platform::resolve_app_dir(&base);
        Self {
            path: app_dir.join("system-automation.json"),
        }
    }

    pub fn with_path(path: PathBuf) -> Self {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> SystemAutomationConfig {
        let mut config = fs::read_to_string(&self.path)
            .ok()
            .and_then(|text| serde_json::from_str::<SystemAutomationConfig>(&text).ok())
            .unwrap_or_default();
        config.normalize();
        config.installed = is_installed();
        // A stale "enabled" flag with no task behind it is a repair case, not a
        // silent success: the UI shows it and offers to reinstall.
        config
    }

    pub fn save(&self, config: &SystemAutomationConfig) -> Result<(), AppError> {
        let mut config = config.clone();
        config.installed = false;
        let text = serde_json::to_string_pretty(&config)
            .map_err(|e| AppError::SettingsWriteFailed(e.to_string()))?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| AppError::SettingsWriteFailed(e.to_string()))?;
        }
        let tmp = self.path.with_extension(format!(
            "tmp.{}.{}.json",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ));
        {
            use std::io::Write;
            let mut file =
                fs::File::create(&tmp).map_err(|e| AppError::SettingsWriteFailed(e.to_string()))?;
            file.write_all(text.as_bytes())
                .and_then(|()| file.flush())
                .and_then(|()| file.sync_all())
                .map_err(|e| {
                    let _ = fs::remove_file(&tmp);
                    AppError::SettingsWriteFailed(e.to_string())
                })?;
        }
        if let Err(err) = crate::platform::atomic_replace_file(&tmp, &self.path) {
            let _ = fs::remove_file(&tmp);
            return Err(AppError::SettingsWriteFailed(err.to_string()));
        }
        Ok(())
    }

    pub fn clear(&self) -> Result<(), AppError> {
        if self.path.exists() {
            fs::remove_file(&self.path)
                .map_err(|e| AppError::SettingsWriteFailed(e.to_string()))?;
        }
        Ok(())
    }
}

impl Default for SystemAutomationRepository {
    fn default() -> Self {
        Self::new()
    }
}

fn schtasks_exe() -> String {
    std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32")
        .join("schtasks.exe")
        .to_string_lossy()
        .to_string()
}

/// True when the scheduled task exists.
pub fn is_installed() -> bool {
    let bin = schtasks_exe();
    let outcome = super::process::run(
        &bin,
        &["/Query", "/TN", TASK_NAME],
        std::time::Duration::from_secs(10),
        &crate::scanner::cancellation::CancellationToken::new(),
    );
    matches!(outcome, Ok(outcome) if outcome.exit_code == Some(0))
}

/// Creates or replaces the task. Requires the caller to be an administrator for
/// `HighestAvailable` to mean anything, but creating the task itself only needs
/// the right to write to the user's task folder.
pub fn install(config: &SystemAutomationConfig) -> Result<(), AppError> {
    let exe = std::env::current_exe()
        .map_err(|e| AppError::Blocked(format!("Could not locate the application binary: {e}")))?;

    let xml = build_xml(config, &exe)?;
    let temp = std::env::temp_dir().join(format!(
        "detergo-task-{}-{}.xml",
        std::process::id(),
        uuid::Uuid::new_v4().simple()
    ));
    {
        use std::io::Write;
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| {
                AppError::Blocked(format!("Could not create the scheduled task file: {e}"))
            })?;
        f.write_all(xml.as_bytes()).map_err(|e| {
            let _ = fs::remove_file(&temp);
            AppError::Blocked(format!("Could not write the scheduled task file: {e}"))
        })?;
    }

    let bin = schtasks_exe();
    let temp_text = temp.to_string_lossy().to_string();
    let outcome = super::process::run(
        &bin,
        &["/Create", "/TN", TASK_NAME, "/XML", &temp_text, "/F"],
        CREATE_TIMEOUT,
        &crate::scanner::cancellation::CancellationToken::new(),
    );
    let _ = fs::remove_file(&temp);

    let outcome = outcome?;
    if outcome.exit_code != Some(0) {
        return Err(AppError::Blocked(format!(
            "Windows could not create the scheduled task: {}",
            first_line(&outcome.stderr, &outcome.stdout)
        )));
    }
    Ok(())
}

/// Deletes the task. A missing task is not an error: the end state is the same.
pub fn uninstall() -> Result<(), AppError> {
    if !is_installed() {
        return Ok(());
    }
    let bin = schtasks_exe();
    let outcome = super::process::run(
        &bin,
        &["/Delete", "/TN", TASK_NAME, "/F"],
        CREATE_TIMEOUT,
        &crate::scanner::cancellation::CancellationToken::new(),
    )?;
    if outcome.exit_code != Some(0) {
        return Err(AppError::Blocked(format!(
            "Windows could not remove the scheduled task: {}",
            first_line(&outcome.stderr, &outcome.stdout)
        )));
    }
    Ok(())
}

fn first_line(stderr: &str, stdout: &str) -> String {
    stderr
        .lines()
        .chain(stdout.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("unknown error")
        .to_string()
}

/// Builds a language-neutral task definition.
fn build_xml(config: &SystemAutomationConfig, exe: &Path) -> Result<String, AppError> {
    let mut config = config.clone();
    config.normalize();

    let time = NaiveTime::parse_from_str(&config.time, "%H:%M")
        .map_err(|_| AppError::InvalidPath("Invalid schedule time.".to_string()))?;
    let start = next_start(&config, time);

    let trigger = if config.frequency == "daily" {
        format!(
            "<CalendarTrigger><StartBoundary>{}</StartBoundary><Enabled>true</Enabled>\
             <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>",
            start.format("%Y-%m-%dT%H:%M:%S")
        )
    } else {
        format!(
            "<CalendarTrigger><StartBoundary>{}</StartBoundary><Enabled>true</Enabled>\
             <ScheduleByWeek><WeeksInterval>1</WeeksInterval>{}</ScheduleByWeek></CalendarTrigger>",
            start.format("%Y-%m-%dT%H:%M:%S"),
            day_element(config.weekday)
        )
    };

    let command = escape_xml(&exe.to_string_lossy());
    let arguments = format!("system --clean {} --yes --scheduled", config.profile);

    Ok(format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Detergo system cleanup. Created from the app; remove it from the app or Task Scheduler.</Description>
  </RegistrationInfo>
  <Triggers>{trigger}</Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{command}</Command>
      <Arguments>{arguments}</Arguments>
    </Exec>
  </Actions>
</Task>
"#
    ))
}

fn day_element(weekday: u8) -> String {
    let name = match weekday {
        1 => "Monday",
        2 => "Tuesday",
        3 => "Wednesday",
        4 => "Thursday",
        5 => "Friday",
        6 => "Saturday",
        _ => "Sunday",
    };
    format!("<DaysOfWeek><{name} /></DaysOfWeek>")
}

/// The first occurrence of `time` that is in the future and, for a weekly task,
/// falls on the selected weekday.
fn next_start(config: &SystemAutomationConfig, time: NaiveTime) -> NaiveDateTime {
    let now = Local::now().naive_local();
    let today = now.date();
    for offset in 0..=8 {
        let date = today + chrono::Duration::days(offset);
        let candidate = NaiveDateTime::new(date, time);
        if candidate <= now {
            continue;
        }
        if config.frequency == "weekly" && weekday_of(date) != config.weekday {
            continue;
        }
        return candidate;
    }
    NaiveDateTime::new(today + chrono::Duration::days(1), time)
}

fn weekday_of(date: NaiveDate) -> u8 {
    match date.weekday() {
        Weekday::Sun => 0,
        Weekday::Mon => 1,
        Weekday::Tue => 2,
        Weekday::Wed => 3,
        Weekday::Thu => 4,
        Weekday::Fri => 5,
        Weekday::Sat => 6,
    }
}

fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::system_cleaner::SystemAutomationConfig;

    fn config() -> SystemAutomationConfig {
        SystemAutomationConfig {
            enabled: true,
            frequency: "weekly".to_string(),
            time: "09:30".to_string(),
            weekday: 1,
            profile: "standard".to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn xml_contains_the_profile_and_a_highest_runlevel() {
        let xml = build_xml(&config(), Path::new(r"C:\Apps\Detergo.exe")).expect("xml");
        assert!(xml.contains("system --clean standard --yes"));
        assert!(xml.contains("<RunLevel>HighestAvailable</RunLevel>"));
        assert!(xml.contains("<Monday />"));
        assert!(xml.contains(r"C:\Apps\Detergo.exe"));
    }

    #[test]
    fn xml_escapes_ampersands_in_the_path() {
        let xml = build_xml(&config(), Path::new(r"C:\A & B\Detergo.exe")).expect("xml");
        assert!(xml.contains("A &amp; B"));
        assert!(!xml.contains("A & B"));
    }

    #[test]
    fn daily_schedule_has_no_weekday() {
        let mut cfg = config();
        cfg.frequency = "daily".to_string();
        let xml = build_xml(&cfg, Path::new(r"C:\Detergo.exe")).expect("xml");
        assert!(xml.contains("ScheduleByDay"));
        assert!(!xml.contains("DaysOfWeek"));
    }

    #[test]
    fn next_start_is_in_the_future() {
        let cfg = config();
        let time = NaiveTime::parse_from_str("09:30", "%H:%M").expect("time");
        let start = next_start(&cfg, time);
        assert!(start > Local::now().naive_local());
        assert_eq!(weekday_of(start.date()), 1);
    }

    #[test]
    fn invalid_values_are_normalized() {
        let mut cfg = SystemAutomationConfig {
            enabled: true,
            frequency: "hourly".to_string(),
            time: "99:99".to_string(),
            weekday: 12,
            profile: "obliterate".to_string(),
            installed: false,
            last_run: None,
            last_freed_bytes: None,
        };
        cfg.normalize();
        assert_eq!(cfg.frequency, "weekly");
        assert_eq!(cfg.time, "12:00");
        assert_eq!(cfg.weekday, 0);
        assert_eq!(cfg.profile, "quick");
    }
}
