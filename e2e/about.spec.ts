import { test, expect, type Page } from "@playwright/test";

/**
 * The About page is where a reviewer checks what the app actually knows: the
 * catalog size, the rules behind it, the update channel and the local error log.
 *
 * These assertions exist because the page used to show a hand-written summary
 * ("3 rules / 3 ecosystems") that disagreed with the shipped catalog. The
 * browser preview now renders the generated catalog, so the numbers here are the
 * real ones (56 rules across 14 ecosystems) and drift fails the test.
 */

const CATALOG_RULES = 56;
const CATALOG_ECOSYSTEMS = 14;

async function openAbout(page: Page) {
  await page.goto("/");
  await expect(page.locator("main#main")).toBeVisible();
  // The app follows the OS locale; pin English so the assertions are stable.
  await page.evaluate(async () => {
    const { usePreferencesStore } = await import("/src/stores/preferences-store.ts");
    usePreferencesStore.getState().setLanguage("en");
  });
  await page
    .locator("#primary-navigation")
    .getByRole("button", { name: "About", exact: true })
    .click();
}

test("About reports the real catalog size", async ({ page }) => {
  await openAbout(page);

  const kpis = page.locator(".nc-kpi-card");
  await expect(kpis.filter({ hasText: "Rule Catalog" })).toContainText(String(CATALOG_RULES));
  await expect(kpis.filter({ hasText: "Ecosystems" })).toContainText(String(CATALOG_ECOSYSTEMS));

  // Every ecosystem contributes at least one summary card.
  await expect(page.locator(".about-rule-card--button")).toHaveCount(CATALOG_ECOSYSTEMS);
});

test("a catalog card opens the rules behind it", async ({ page }) => {
  await openAbout(page);

  const explorer = page.locator(".about-catalog-explorer");
  await expect(explorer).toBeVisible();

  const javascriptCard = page.locator(".about-rule-card--button", {
    hasText: "JavaScript / TypeScript",
  });
  await javascriptCard.click();
  await expect(javascriptCard).toHaveAttribute("aria-expanded", "true");

  const rules = explorer.locator(".about-rule-item");
  await expect(rules).toHaveCount(24);

  // A rule expands into the details a user needs before deleting anything.
  const first = rules.first();
  await first.locator(".about-rule-item-head").click();
  const body = first.locator(".about-rule-item-body");
  await expect(body).toBeVisible();
  await expect(body).toContainText("Matches");
  await expect(body).toContainText("Regenerate with");
});

test("the error log and update check sit next to the health panel", async ({ page }) => {
  await openAbout(page);

  const row = page.locator(".about-workspace-grid--three");
  await expect(row.locator(".about-update-panel")).toBeVisible();
  await expect(row.locator(".about-diagnostics-panel")).toBeVisible();
  // Local-only log: an untouched profile shows the "nothing recorded" state.
  await expect(row.locator(".about-diagnostics-panel")).toContainText("No errors recorded.");

  // The check runs only on demand, so no request happens before the click.
  const check = row.getByRole("button", { name: "Check for updates" });
  await expect(check).toBeEnabled();
});
