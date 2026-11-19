import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const THEMES = ["dark-black", "dark-gray", "light-white", "light-gray"] as const;

const VIEWS: Array<{ nav: string; view: string }> = [
  { nav: "Overview", view: "overview" },
  { nav: "Projects", view: "projects" },
  { nav: "AI Tools", view: "agents" },
  { nav: "Tool Caches", view: "caches" },
  { nav: "System cleaner", view: "system" },
  { nav: "History", view: "history" },
  { nav: "Settings", view: "settings" },
];

interface AxeViolation {
  id: string;
  impact?: string | null;
  help: string;
  nodes: Array<{ target: unknown[]; failureSummary?: string }>;
}

function formatViolations(violations: AxeViolation[]) {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? "unknown"}): ${violation.help}\n` +
        violation.nodes
          .slice(0, 4)
          .map((node) => `  ${node.target.join(" ")}\n    ${node.failureSummary ?? ""}`)
          .join("\n"),
    )
    .join("\n\n");
}

async function expectNoViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(blocking.length, `${label}\n\n${formatViolations(blocking)}`).toBe(0);
}

function navButton(page: Page, name: string) {
  return page.locator("#primary-navigation").getByRole("button", { name, exact: true });
}

async function selectTheme(page: Page, theme: string) {
  await navButton(page, "Settings").click();
  await page.locator(".settings-body select").first().selectOption(theme);
}

async function goToView(page: Page, name: string) {
  await navButton(page, name).click();
  await expect(page.locator("main#main")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main#main")).toBeVisible();
  // The app follows the OS locale by default, which makes English role/name
  // assertions fail on a Turkish machine. Pin the UI language for every test.
  await page.evaluate(async () => {
    const { usePreferencesStore } = await import("/src/stores/preferences-store.ts");
    usePreferencesStore.getState().setLanguage("en");
  });
  await expect(navButton(page, "AI Tools")).toBeVisible();
});

for (const theme of THEMES) {
  test(`WCAG 2.2 AA axe scan in ${theme}`, async ({ page }) => {
    await selectTheme(page, theme);
    await navButton(page, "Overview").click();
    await expectNoViolations(page, `overview / ${theme}`);

    await navButton(page, "Settings").click();
    await expectNoViolations(page, `settings / ${theme}`);
  });
}

test("every top-level view passes axe", async ({ page }) => {
  for (const entry of VIEWS) {
    await goToView(page, entry.nav);
    await expectNoViolations(page, entry.view);
  }
});

test("About and the embedded legal documents pass axe", async ({ page }) => {
  // About is a top-level navigation destination (the settings tab named
  // "About" was removed when the informational and legal content moved to its
  // own view), so the scan must enter through the primary navigation.
  await goToView(page, "About");
  await expectNoViolations(page, "about");

  await page
    .locator(".about-split-layout .split-sidebar")
    .getByRole("button", { name: "Legal", exact: true })
    .click();
  const firstDoc = page.locator("[data-legal-doc]").first();
  await firstDoc.click();
  const back = page.getByRole("button", { name: "Back", exact: true });
  await expect(back).toBeVisible();
  await expect(back).toBeFocused();
  await expectNoViolations(page, "legal");

  await back.click();
  await expect(page.locator("[data-legal-doc]").first()).toBeFocused();
});

test("settings and history tabs follow the APG keyboard pattern", async ({ page }) => {
  await goToView(page, "Settings");

  const general = page.getByRole("tab", { name: "General", exact: true });
  await general.focus();
  await page.keyboard.press("ArrowRight");
  const scan = page.getByRole("tab", { name: "Scan limits", exact: true });
  await expect(scan).toHaveAttribute("aria-selected", "true");
  await expect(scan).toBeFocused();

  // End must land on the *last* settings tab. The About tab used to be last
  // here; About is now a primary-navigation view, so Privacy is the tail.
  const lastTab = page.getByRole("tab").last();
  const lastLabel = await lastTab.innerText();
  await page.keyboard.press("End");
  await expect(lastTab).toHaveAttribute("aria-selected", "true");
  await expect(lastTab).toBeFocused();
  expect(lastLabel.trim().length).toBeGreaterThan(0);
  await page.keyboard.press("Home");
  await expect(general).toHaveAttribute("aria-selected", "true");

  await goToView(page, "History");
  const cleanups = page.getByRole("tab", { name: /^Cleanups/ });
  await cleanups.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /^Tool commands/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("dialogs trap focus and restore it on close", async ({ page }) => {
  await goToView(page, "AI Tools");
  const addTool = page.getByRole("button", { name: "Add tool", exact: true });
  await addTool.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expectNoViolations(page, "add tool dialog");

  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(addTool).toBeFocused();
});

test("the location disclosure exposes its state and closes with Escape", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Change location", exact: true });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#location-menu")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
});

test("the results table exposes table semantics and clears filters", async ({ page }) => {
  // The browser harness has no scanner, so seed the same store the Tauri events
  // would fill. This is the only way axe can audit the virtualised table.
  await page.evaluate(async () => {
    const { useScanStore } = await import("/src/stores/scan-store.ts");
    // The harness restores a demo "last scan" from the mock backend, so the
    // store is not empty here. Reset first, otherwise the demo rows (10) are
    // unioned with the four seeded rows and the row count is not deterministic.
    useScanStore.getState().resetScan();
    const item = (
      id: string,
      name: string,
      safetyClass: string,
      overrides: Record<string, unknown> = {},
    ) => ({
      id,
      scanSessionId: "e2e-scan",
      ruleId: "node_modules",
      provider: "project",
      ecosystem: "node",
      category: "Dependencies",
      kind: "directory",
      projectId: "demo-project",
      projectName: "demo-project",
      projectRoot: "C:\\workspace\\demo-project",
      displayName: name,
      displayPath: `C:\\workspace\\demo-project\\${name}`,
      logicalBytes: 1048576,
      allocatedBytes: 1048576,
      estimatedReclaimBytes: 1048576,
      safetyClass,
      confidence: "high",
      activeUse: "no",
      evidenceCodes: [],
      warningCodes: [],
      cleanupMethod: "trash",
      protected: false,
      selectable: true,
      autoSelectable: true,
      status: "ready",
      ...overrides,
    });
    useScanStore.getState().addItems([
      item("a", "node_modules", "safe"),
      item("b", ".next", "regenerate"),
      item("c", "coverage", "review"),
      // A blocked row keeps its own background instead of row-wide opacity, so
      // its text must still pass contrast in every theme.
      item("d", ".cache", "keep", {
        selectable: false,
        autoSelectable: false,
        protected: true,
        status: "blocked",
      }),
    ]);
    useScanStore.getState().completeScan({
      scanId: "e2e-scan",
      rootPath: "C:\\workspace\\demo-project",
      scope: "project",
      totalEntries: 4,
      totalBytes: 4194304,
      totalAllocatedBytes: 4194304,
      protectedBytes: 0,
      durationMs: 1200,
      errorsCount: 0,
      warningsCount: 0,
      directoriesVisited: 4,
      partial: false,
      providerTotals: [],
    });
  });

  await navButton(page, "Projects").click();
  const table = page.getByRole("table", { name: "Cleanup targets" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(5);
  await expectNoViolations(page, "projects table");

  const targetHeader = page.getByRole("columnheader", { name: /Target/ });
  await expect(targetHeader).toHaveAttribute("aria-sort", "none");
  await targetHeader.getByRole("button").click();
  await expect(targetHeader).toHaveAttribute("aria-sort", "descending");
  await targetHeader.getByRole("button").click();
  await expect(targetHeader).toHaveAttribute("aria-sort", "ascending");

  const rowCheckbox = page.getByRole("checkbox", { name: "Select row: node_modules" });
  await rowCheckbox.locator("xpath=..").click();
  await expect(rowCheckbox).toBeChecked();
  await expect(page.locator(".selection-action-bar")).toBeVisible();
  await expectNoViolations(page, "selection action bar");
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await expect(page.locator(".selection-action-bar")).toBeHidden();

  await page.locator(".search-field-input").fill("no-such-target");
  await expect(
    page.getByRole("heading", { name: "No results match the current filters." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("table", { name: "Cleanup targets" })).toBeVisible();
  await expectNoViolations(page, "projects table after filters");
});

test("AI Tools separates detected items from providers and keeps the table scrollable", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { useScanStore } = await import("/src/stores/scan-store.ts");
    useScanStore.getState().addItems([
      {
        id: "agent-a",
        scanSessionId: "e2e-agents",
        ruleId: "claude.tasks",
        provider: "claude-code",
        ecosystem: "ai",
        category: "sessions",
        kind: "directory",
        projectId: null,
        projectName: "Claude Code",
        projectRoot: "C:\\Users\\demo\\.claude",
        displayName: "tasks",
        displayPath: "C:\\Users\\demo\\.claude\\tasks",
        logicalBytes: 2048,
        allocatedBytes: 2048,
        estimatedReclaimBytes: 2048,
        safetyClass: "review",
        confidence: "high",
        activeUse: "no",
        evidenceCodes: [],
        warningCodes: [],
        cleanupMethod: "trash",
        protected: false,
        selectable: false,
        autoSelectable: false,
        status: "ready",
      },
    ]);
  });

  await navButton(page, "AI Tools").click();

  const itemsTab = page.getByRole("tab", { name: "Detected items", exact: true });
  const providersTab = page.getByRole("tab", { name: "AI providers", exact: true });
  await expect(itemsTab).toHaveAttribute("aria-selected", "true");

  const table = page.getByRole("table", { name: "Cleanup targets" });
  await expect(table).toBeVisible();

  // The virtualizer measured 0px before the scoped CSS fix, which collapsed
  // the whole table to a sliver inside the document-style AI Tools page.
  const box = await page.locator(".page-view .items-view").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewport = element.querySelector(".items-viewport");
    return {
      height: rect.height,
      viewportHeight: viewport ? viewport.getBoundingClientRect().height : 0,
    };
  });
  expect(box.height).toBeGreaterThan(300);
  expect(box.viewportHeight).toBeGreaterThan(100);

  await providersTab.click();
  await expect(providersTab).toHaveAttribute("aria-selected", "true");
  await expect(table).toHaveCount(0);
  await expect(page.locator(".agents-provider-grid")).toBeVisible();

  // APG keyboard pattern: arrow keys move between the two tabs.
  await providersTab.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(itemsTab).toHaveAttribute("aria-selected", "true");
  await expect(table).toBeVisible();
});

test("checked checkbox glyph contrasts against the accent fill in every theme", async ({
  page,
}) => {
  // The tick is an SVG stroke drawn with `currentColor`. A missing token used
  // to leave it inheriting the page text colour, so the tick vanished against
  // the accent background. Measured directly instead of relying on the global
  // contrast script, which is red for unrelated missing tokens.
  await page.evaluate(async () => {
    const { useScanStore } = await import("/src/stores/scan-store.ts");
    useScanStore.getState().addItems([
      {
        id: "contrast-a",
        scanSessionId: "e2e-contrast",
        ruleId: "node_modules",
        provider: "project",
        ecosystem: "node",
        category: "Dependencies",
        kind: "directory",
        projectId: "demo-project",
        projectName: "demo-project",
        projectRoot: "C:\\workspace\\demo-project",
        displayName: "node_modules",
        displayPath: "C:\\workspace\\demo-project\\node_modules",
        logicalBytes: 1048576,
        allocatedBytes: 1048576,
        estimatedReclaimBytes: 1048576,
        safetyClass: "safe",
        confidence: "high",
        activeUse: "no",
        evidenceCodes: [],
        warningCodes: [],
        cleanupMethod: "trash",
        protected: false,
        selectable: true,
        autoSelectable: true,
        status: "ready",
      },
    ]);
  });

  for (const theme of THEMES) {
    await selectTheme(page, theme);
    await navButton(page, "Projects").click();

    const row = page
      .locator(".items-row")
      .filter({ hasText: "C:\\workspace\\demo-project\\node_modules" })
      .first();
    await expect(row).toBeVisible();
    const checkbox = row.getByRole("checkbox");
    if (!(await checkbox.isChecked())) {
      await row.locator(".checkbox-container").click();
    }

    const table = row.locator(
      "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' items-view ')][1]",
    );
    const box = row.locator(".checkbox-box");
    const headerBox = table.locator(".items-head-row .checkbox-box").first();
    const headerInput = table.locator(".items-head-row input[type=checkbox]").first();
    if (!(await headerInput.isChecked())) {
      await table.locator(".items-head-row .checkbox-container").first().click();
    }

    for (const target of [box, headerBox]) {
      const colors = await target.evaluate((element) => {
        const style = getComputedStyle(element);
        const parse = (value: string) => {
          const parts = value.match(/[\d.]+/g);
          if (!parts || parts.length < 3) throw new Error(`Unparsable color: ${value}`);
          return parts.slice(0, 3).map(Number);
        };
        const luminance = (rgb: number[]) => {
          const [r, g, b] = rgb.map((channel) => {
            const c = channel / 255;
            return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const foreground = parse(style.color);
        const background = parse(style.backgroundColor);
        const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
          (a, b) => b - a,
        );
        return {
          foreground: style.color,
          background: style.backgroundColor,
          ratio: (lighter + 0.05) / (darker + 0.05),
        };
      });
      // The tick is a non-text indicator, so WCAG 1.4.11 requires 3:1 against
      // the accent fill (1.4.3's 4.5:1 applies to body text, not glyphs).
      expect(
        colors.ratio,
        `glyph ${colors.foreground} on ${colors.background} (${theme})`,
      ).toBeGreaterThanOrEqual(3);
    }
  }
});

test("320 CSS px reflow keeps every page inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  for (const entry of VIEWS) {
    await goToView(page, entry.nav);
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      const main = document.querySelector("main");
      return {
        root: root.scrollWidth - root.clientWidth,
        main: main ? main.scrollWidth - main.clientWidth : 0,
      };
    });
    expect(overflow.root, `${entry.view} root overflow`).toBeLessThanOrEqual(1);
    expect(overflow.main, `${entry.view} main overflow`).toBeLessThanOrEqual(1);
  }

  await goToView(page, "Settings");
  await expect(page.locator(".settings-split-layout .split-sidebar")).toBeVisible();
});
