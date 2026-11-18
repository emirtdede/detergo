import { describe, expect, it } from "vitest";

import { classifyNotice, formatNoticeDetails, groupNotices } from "../features/shell/scan-notice";
import { viewForScanScope } from "../stores/scan-store";
import type { ScanWarning } from "../types";

describe("scan notice severity", () => {
  it("treats Windows-owned locations as information, not as a failed scan", () => {
    expect(classifyNotice({ code: "ACCESS_DENIED", path: "C:\\Windows\\System32" })).toBe("info");
    expect(classifyNotice({ code: "ACCESS_DENIED", path: "C:\\System Volume Information" })).toBe(
      "info",
    );
    expect(classifyNotice({ code: "ACCESS_DENIED", path: "D:\\$RECYCLE.BIN" })).toBe("info");
  });

  it("keeps a real unreadable folder in scope as a warning", () => {
    expect(classifyNotice({ code: "ACCESS_DENIED", path: "D:\\Projects\\app\\node_modules" })).toBe(
      "warning",
    );
  });

  it("keeps a backend severity authoritative when present", () => {
    // The backend knows the true walk root; the UI only sees a joined label.
    expect(
      classifyNotice({
        code: "ACCESS_DENIED",
        path: "C:\\Windows",
        severity: "warning",
      }),
    ).toBe("warning");
    expect(classifyNotice({ code: "WALK_ERROR", path: "D:\\Projects", severity: "info" })).toBe(
      "info",
    );
  });

  it("reports a blocked drive or agent step as an error", () => {
    expect(classifyNotice({ code: "DRIVE_SCAN_FAILED", path: "E:\\" })).toBe("error");
    expect(classifyNotice({ code: "AGENT_SCAN_FAILED" })).toBe("error");
  });

  it("groups notices by severity and leads with errors", () => {
    const warnings: ScanWarning[] = [
      { code: "ACCESS_DENIED", path: "C:\\Windows" },
      { code: "ACCESS_DENIED", path: "D:\\Projects\\locked" },
      { code: "DRIVE_SCAN_FAILED", path: "E:\\" },
    ];
    const groups = groupNotices(warnings);
    expect(groups.infoCount).toBe(1);
    expect(groups.warningCount).toBe(1);
    expect(groups.errorCount).toBe(1);
    expect(groups.issues.map((n) => n.severity)).toEqual(["error", "warning"]);
  });

  it("keeps the machine-readable record in the copied details", () => {
    const groups = groupNotices([{ code: "ACCESS_DENIED", path: "D:\\Projects\\locked" }]);
    const text = formatNoticeDetails(groups.issues, true);
    expect(text).toContain("[warning] ACCESS_DENIED");
    expect(text).toContain("D:\\Projects\\locked");
  });
});

describe("combined scan routing", () => {
  it("opens the overview because it shows both project and agent rows", () => {
    expect(viewForScanScope("combined")).toBe("overview");
    expect(viewForScanScope("project")).toBe("projects");
    expect(viewForScanScope("agents")).toBe("agents");
  });
});
