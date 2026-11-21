//! Lightweight Windows console-subsystem companion binary (`detergo.com`).
//!
//! Because `.COM` precedes `.EXE` in Windows `PATHEXT`, placing this small
//! console-subsystem binary beside the GUI-subsystem `detergo.exe` gives
//! native synchronous terminal execution, clean pipe/redirection semantics
//! (`| jq`, `> out.json`, `> NUL`), and accurate exit codes without flashing a
//! console window when double-clicking `detergo.exe` from Explorer.

use std::env;
use std::process::{Command, ExitCode, Stdio};

fn is_gui_invocation(args: &[String]) -> bool {
    args.is_empty() || matches!(args[0].as_str(), "--open-view" | "--wait-pid")
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let Ok(self_exe) = env::current_exe() else {
        eprintln!("detergo: could not locate executable path");
        return ExitCode::from(1);
    };
    let Some(dir) = self_exe.parent() else {
        eprintln!("detergo: could not locate installation directory");
        return ExitCode::from(1);
    };
    let gui_exe = dir.join(if cfg!(windows) {
        "detergo.exe"
    } else {
        "detergo"
    });
    if !gui_exe.is_file() {
        eprintln!(
            "detergo: companion binary not found at {}",
            gui_exe.display()
        );
        return ExitCode::from(1);
    }

    if is_gui_invocation(&args) {
        match Command::new(&gui_exe)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(_) => return ExitCode::SUCCESS,
            Err(err) => {
                eprintln!("detergo: failed to launch GUI: {err}");
                return ExitCode::from(1);
            }
        }
    }

    match Command::new(&gui_exe)
        .args(&args)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
    {
        Ok(status) => {
            let code = status.code().unwrap_or(1).clamp(0, 255) as u8;
            ExitCode::from(code)
        }
        Err(err) => {
            eprintln!("detergo: failed to execute CLI: {err}");
            ExitCode::from(1)
        }
    }
}
