import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const THEMES = ["dark-black", "dark-gray", "light-white", "light-gray"] as const;

const VIEWS: Array<{ nav: string; view: string }> = [
  { nav: "Overview", view: "overview" },
  { nav: "Projects", view: "projects" },
  { nav: "AI Tools", view: "agents" },
  { nav: "Tool Caches", view: "caches" },
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
          .join("\n")
    )
    .join("\n\n");
}

async function expectNoViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious"
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
  await goToView(page, "Settings");
  await page.getByRole("tab", { name: "About", exact: true }).click();
  await expectNoViolations(page, "about");

  const firstDoc = page.locator(".about-legal-item").first();
  await firstDoc.click();
  const back = page.getByRole("button", { name: "Back", exact: true });
  await expect(back).toBeVisible();
  await expect(back).toBeFocused();
  await expectNoViolations(page, "legal");

  await back.click();
  await expect(page.getByRole("tab", { name: "About", exact: true })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(firstDoc).toBeFocused();
});

test("settings and history tabs follow the APG keyboard pattern", async ({ page }) => {
  await goToView(page, "Settings");

  const general = page.getByRole("tab", { name: "General", exact: true });
  await general.focus();
  await page.keyboard.press("ArrowRight");
  const scan = page.getByRole("tab", { name: "Scan limits", exact: true });
  await expect(scan).toHaveAttribute("aria-selected", "true");
  await expect(scan).toBeFocused();

  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "About", exact: true })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await page.keyboard.press("Home");
  await expect(general).toHaveAttribute("aria-selected", "true");

  await goToView(page, "History");
  const cleanups = page.getByRole("tab", { name: /^Cleanups/ });
  await cleanups.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /^Tool commands/ })).toHaveAttribute(
    "aria-selected",
    "true"
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
    const item = (
      id: string,
      name: string,
      safetyClass: string,
      overrides: Record<string, unknown> = {}
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
    page.getByRole("heading", { name: "No results match the current filters." })
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("table", { name: "Cleanup targets" })).toBeVisible();
  await expectNoViolations(page, "projects table after filters");
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
  await expect(page.locator(".settings-tabs-mobile")).toBeVisible();
  await expect(page.locator(".settings-tabs")).toBeHidden();
});
