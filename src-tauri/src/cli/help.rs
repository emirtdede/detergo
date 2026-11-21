use super::i18n::t;

pub(super) fn print_help() {
    let width = 66;
    let rule = "=".repeat(width);
    let mut out = String::new();
    out.push_str(&format!("\n{rule}\n"));
    out.push_str(&format!(
        "  {} (v{})\n",
        t("DETERGO by VELLIUM - CLI, MCP & Automation Engine"),
        env!("CARGO_PKG_VERSION")
    ));
    out.push_str(&format!("{rule}\n\n"));

    out.push_str(&format!("{}\n", t("USAGE:")));
    out.push_str(&format!("  {}\n\n", t("detergo [COMMAND] [OPTIONS]")));

    out.push_str(&format!("{}\n", t("COMMANDS:")));
    for line in [
        "  s, scan [DIR]            Scan selected targets (-t p,a,c,s | all | drives)",
        "  c, cache [TOOL|all]      List or clean developer tool caches (-n dry, -y confirm)",
        "  sys [PROFILE|IDS]        Clean C: drive temp, Prefetch, Windows Update (-l, -n, -y)",
        "  h, hist [N]              Show past cleanup & audit records (-l N, -j)",
        "  mcp                      Start the Model Context Protocol (MCP) stdio server",
    ] {
        out.push_str(&format!("{line}\n"));
    }
    out.push('\n');

    out.push_str(&format!("{}\n", t("SCAN OPTIONS:")));
    for line in [
        "  -t, --targets <LIST>     p(projects), a(agents), c(caches), s(system), all, drives",
        "  -c, --clean              Move matching safe targets to Recycle Bin (--auto-clean)",
        "  -n, --dry                Preview without deleting anything (--dry-run)",
        "  -s, --safety <LEVELS>    safe,regenerate,review (default: safe,regenerate)",
        "  -m, --min <SIZE>         Only include targets >= SIZE (e.g. 50, 500MB, 1.5GB)",
        "  -o, --older <AGE>        Only include stale targets untouched for >= AGE (7d, 30d, 3m, 1y)",
        "  -i, --interactive        Pick targets by number, then move to Recycle Bin",
        "  -a, --all                List every discovered target (--top N limits rows)",
        "  -j, --json               Emit machine-readable JSON output",
        "  -w, --webhook <URL>      POST summary to n8n, Slack, or Discord",
        "  --scope <SCOPE>          Legacy alias: projects | agents | combined | all",
        "  -h, --help / -v          Show help or version",
    ] {
        out.push_str(&format!("{line}\n"));
    }
    out.push('\n');

    out.push_str(&format!("{}\n", t("EXAMPLES:")));
    for line in [
        "detergo s .",
        "detergo s D:\\Projects -t p,a -o 30d",
        "detergo s -t all",
        "detergo s D:\\Projects -c -n",
        "detergo s . -i",
        "detergo c npm",
        "detergo c all -n",
        "detergo sys quick -n",
        "detergo sys quick -y",
        "detergo hist -l 15 -j",
    ] {
        out.push_str(&format!("  {line}\n"));
    }
    print!("{out}");
}

pub(super) fn print_scan_help() {
    println!(
        "\
Usage:
  detergo s [DIR] [OPTIONS]

Targets (-t, --targets):
  p(projects), a(agents), c(caches), s(system), drives, all

Options:
  -c, --clean              Move matching safe targets to Recycle Bin (--auto-clean)
  -n, --dry                Preview without deleting anything (--dry-run)
  -s, --safety <LEVELS>    safe,regenerate,review,keep (default: safe,regenerate)
  -m, --min <SIZE>         Minimum size threshold (e.g. 50, 500KB, 500MB, 1.5GB)
  -o, --older <AGE>        Minimum staleness age (e.g. 7d, 30d, 2w, 3m, 1y)
  -i, --interactive        Pick targets by number, then move to Recycle Bin
  -a, --all                List every discovered target (--top N limits rows)
  -j, --json               Emit machine-readable JSON output
  -w, --webhook <URL>      POST summary to n8n, Slack, or Discord
  --scope <SCOPE>          Legacy alias: projects | agents | combined | all

Examples:
  detergo s .
  detergo s D:\\Projects -t p,a -m 50MB -o 30d
  detergo s -t all -j
  detergo s D:\\Projects -cn
"
    );
}

pub(super) fn print_caches_help() {
    println!(
        "\
Usage:
  detergo c [-j]                            List & measure developer tool caches
  detergo c <tool|all> -n [-j]              Preview cache cleanup (--dry-run)
  detergo c <tool|all> -y [-j]              Clean cache via official tool command (--yes)
"
    );
}

pub(super) fn print_history_help() {
    println!(
        "\
Usage:
  detergo hist [N] [-l N] [-j]              Show past cleanup audit records
"
    );
}
