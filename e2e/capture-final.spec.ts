import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const OUT_DIR = "C:\\Users\\emir\\Desktop\\NODE_CLEANER_PREMIUM_UI_FINAL_REVIEW\\03_SCREENSHOTS_AFTER";
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const THEMES = ["dark-black", "dark-gray", "light-white", "light-gray"] as const;
const VIEWS = [
  { id: "01_OVERVIEW", nav: "Overview" },
  { id: "02_PROJECTS", nav: "Projects" },
  { id: "03_AI_TOOLS", nav: "AI Tools" },
  { id: "04_TOOL_CACHES", nav: "Tool Caches" },
  { id: "05_HISTORY", nav: "History" },
  { id: "06_SETTINGS", nav: "Settings" },
] as const;

const SIZES = [
  { label: "1180x760", width: 1180, height: 760 },
  { label: "760x560", width: 760, height: 560 },
  { label: "1920x1080", width: 1920, height: 1080 },
] as const;

const captured: Array<any> = [];

test("Capture all post-implementation final screenshots", async ({ page }) => {
  test.setTimeout(180_000);

  // 1. Standard views across themes and sizes
  for (const theme of THEMES) {
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto("/");
      await expect(page.locator("main#main")).toBeVisible();

      // Set theme
      await page.locator("#primary-navigation").getByRole("button", { name: "Settings" }).click();
      await page.locator(".settings-body select").first().selectOption(theme);

      for (const view of VIEWS) {
        await page.locator("#primary-navigation").getByRole("button", { name: view.nav }).click();
        await page.waitForTimeout(100);

        const filename = `FINAL_${view.id}_${theme}_${size.label}.png`;
        const filePath = path.join(OUT_DIR, filename);
        const buffer = await page.screenshot({ path: filePath });
        const fileSha = crypto.createHash("sha256").update(buffer).digest("hex");

        captured.push({
          view: view.id,
          theme,
          size: size.label,
          filename,
          sha256: fileSha,
          renderer: "MOCK_BROWSER",
        });
      }
    }
  }

  // 2. Modals & Dialogs (History Clear Dialog, Legal About Doc)
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto("/");
  await page.locator("#primary-navigation").getByRole("button", { name: "History" }).click();
  
  // Click Clear History button to open themed Dialog
  const clearBtn = page.getByRole("button", { name: "Clear History", exact: false });
  if (await clearBtn.isVisible() && !(await clearBtn.isDisabled())) {
    await clearBtn.click();
    await page.waitForTimeout(150);
    const dlgBuf = await page.screenshot({ path: path.join(OUT_DIR, "FINAL_MODAL_CLEAR_HISTORY_DIALOG.png") });
    captured.push({
      view: "MODAL_CLEAR_HISTORY",
      theme: "dark-black",
      size: "1180x760",
      filename: "FINAL_MODAL_CLEAR_HISTORY_DIALOG.png",
      sha256: crypto.createHash("sha256").update(dlgBuf).digest("hex"),
    });
    // Close modal
    await page.getByRole("button", { name: "Cancel", exact: false }).click();
  }

  // Legal view
  await page.locator("#primary-navigation").getByRole("button", { name: "Settings" }).click();
  await page.getByRole("tab", { name: "About", exact: true }).click();
  const firstDoc = page.locator(".about-legal-item").first();
  if (await firstDoc.isVisible()) {
    await firstDoc.click();
    await page.waitForTimeout(150);
    const legalBuf = await page.screenshot({ path: path.join(OUT_DIR, "FINAL_07_LEGAL_EULA_VIEWER.png") });
    captured.push({
      view: "LEGAL_EULA_VIEWER",
      theme: "dark-black",
      size: "1180x760",
      filename: "FINAL_07_LEGAL_EULA_VIEWER.png",
      sha256: crypto.createHash("sha256").update(legalBuf).digest("hex"),
    });
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "FINAL_SCREENSHOT_MANIFEST.json"),
    JSON.stringify({ total: captured.length, screenshots: captured }, null, 2)
  );
  console.log(`Successfully captured ${captured.length} final post-implementation screenshots.`);
});

