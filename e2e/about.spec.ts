import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";

/**
 * The About page is where a reviewer checks what the app actually knows: the
 * catalog size, the rules behind it, the update channel and the local error log.
 *
 * Counts are parsed directly from `src-tauri/assets/targets.toml` so adding
 * rules to the real catalog never breaks the test with a stale literal while
 * drift between `targets.toml` and the UI still fails immediately.
 */
const catalogToml = fs.readFileSync(
  path.resolve(process.cwd(), "src-tauri/assets/targets.toml"),
  "utf8",
);
const CATALOG_RULES = [...catalogToml.matchAll(/^id\s*=\s*"([^"]+)"/gm)].length;
const CATALOG_ECOSYSTEMS = new Set(
  [...catalogToml.matchAll(/^ecosystem\s*=\s*"([^"]+)"/gm)].map((m) => m[1]),
).size;
const JAVASCRIPT_RULES = [...catalogToml.matchAll(/^ecosystem\s*=\s*"javascript"/gm)].length;

async function openAbout(page: Page) {
  await page.goto("/");
  await expect(page.locator("main#main")).toBeVisible();
  // The app follows the OS locale; wait for startup settings to finish loading
  // before pinning English so `loadPreferences()` cannot overwrite it back.
  await page.evaluate(async () => {
    const { usePreferencesStore } = await import("/src/stores/preferences-store.ts");
    const deadline = Date.now() + 5000;
    while (!usePreferencesStore.getState().isLoaded && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    usePreferencesStore.getState().setLanguage("en");
    usePreferencesStore.getState().setOnboardingCompleted(true);
  });
  await page
    .locator("#primary-navigation")
    .getByRole("button", { name: "About", exact: true })
    .click();
}

async function openAboutSection(page: Page, name: string) {
  await page
    .locator(".about-split-layout .split-sidebar")
    .getByRole("button", { name, exact: true })
    .click();
}

test("About reports the real catalog size", async ({ page }) => {
  await openAbout(page);

  const kpis = page.locator(".nc-kpi-card");
  await expect(kpis.filter({ hasText: "Rule Catalog" })).toContainText(String(CATALOG_RULES));
  await expect(kpis.filter({ hasText: "Ecosystems" })).toContainText(String(CATALOG_ECOSYSTEMS));

  // Every ecosystem contributes at least one summary card inside the catalog pane.
  await openAboutSection(page, "Rule catalog");
  await expect(page.locator(".about-rule-card--button")).toHaveCount(CATALOG_ECOSYSTEMS);
});

test("a catalog card opens the rules behind it", async ({ page }) => {
  await openAbout(page);
  await openAboutSection(page, "Rule catalog");

  const explorer = page.locator(".about-catalog-explorer");
  await expect(explorer).toBeVisible();

  const javascriptCard = page.locator(".about-rule-card--button", {
    hasText: "JavaScript / TypeScript",
  });
  await javascriptCard.click();
  await expect(javascriptCard).toHaveAttribute("aria-expanded", "true");

  const rules = explorer.locator(".about-rule-item");
  await expect(rules).toHaveCount(JAVASCRIPT_RULES);

  // A rule expands into the details a user needs before deleting anything.
  const first = rules.first();
  await first.locator(".about-rule-item-head").click();
  const body = first.locator(".about-rule-item-body");
  await expect(body).toBeVisible();
  await expect(body).toContainText("Matches");
  await expect(body).toContainText("Regenerate with");
});

test("the error log and update check sit together in Updates & health", async ({ page }) => {
  await openAbout(page);
  await openAboutSection(page, "Updates & health");

  await expect(page.locator(".about-update-panel")).toBeVisible();
  await expect(page.locator(".about-health-panel")).toBeVisible();
  await expect(page.locator(".about-diagnostics-panel")).toBeVisible();
  // Local-only log: an untouched profile shows the "nothing recorded" state.
  await expect(page.locator(".about-diagnostics-panel")).toContainText("No errors recorded.");

  // The check runs only on demand, so no request happens before the click.
  const check = page.locator(".about-update-panel").getByRole("button", {
    name: "Check for updates",
  });
  await expect(check).toBeEnabled();
});
