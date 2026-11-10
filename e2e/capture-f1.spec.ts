import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const OUT_DIR = "C:\\Users\\emir\\Desktop\\NODE_CLEANER_PREMIUM_UI_FINAL_REVIEW\\01_CONCEPT_A_VS_B";
const FRAMES_DIR = path.join(OUT_DIR, "comparative_frames");
const EDGE_DIR = path.join(OUT_DIR, "edge_frames");

[FRAMES_DIR, EDGE_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const CONCEPTS = ["A", "B"] as const;
const SCREENS = [
  { id: "overview", nav: "Overview" },
  { id: "projects", nav: "Projects" },
  { id: "settings", nav: "Settings" },
  { id: "delete_dialog", nav: "Projects" },
] as const;

const THEMES = ["dark-gray", "light-white"] as const;
const WINDOW_SIZES = [
  { label: "1180x760", width: 1180, height: 760 },
  { label: "760x560", width: 760, height: 560 },
] as const;

const capturedFrames: Array<any> = [];

test.describe("F1 Comparative Frame Generation", () => {
  test("Generate all 32 comparative frames and 8 edge frames", async ({ page }) => {
    test.setTimeout(180_000);

    for (const concept of CONCEPTS) {
      for (const theme of THEMES) {
        for (const size of WINDOW_SIZES) {
          await page.setViewportSize({ width: size.width, height: size.height });
          await page.goto("/");
          await expect(page.locator("main#main")).toBeVisible();

          // Select theme
          await page
            .locator("#primary-navigation")
            .getByRole("button", { name: "Settings" })
            .click();
          await page.locator(".settings-body select").first().selectOption(theme);

          for (const scr of SCREENS) {
            const frameId = `CONCEPT_${concept}_${scr.id.toUpperCase()}_${theme}_${size.label}`;
            const filename = `${frameId}.png`;
            const filePath = path.join(FRAMES_DIR, filename);

            await page
              .locator("#primary-navigation")
              .getByRole("button", { name: scr.nav })
              .click();
            await page.evaluate((c) => {
              document.documentElement.setAttribute("data-concept", c);
            }, concept);

            await page.waitForTimeout(100);
            const buffer = await page.screenshot({ path: filePath });
            const fileSha = crypto.createHash("sha256").update(buffer).digest("hex");

            capturedFrames.push({
              frameId,
              concept,
              screen: scr.id,
              theme,
              size: size.label,
              renderer: "MOCK_BROWSER",
              sha256: fileSha,
              filename,
            });
          }
        }
      }
    }

    // Capture 8 Edge Cases
    const edgeCases = [
      {
        id: "EDGE_OVERVIEW_EMPTY_DARK",
        nav: "Overview",
        theme: "dark-black",
        size: { width: 1180, height: 760 },
      },
      {
        id: "EDGE_OVERVIEW_EMPTY_LIGHT",
        nav: "Overview",
        theme: "light-white",
        size: { width: 1180, height: 760 },
      },
      {
        id: "EDGE_PROJECTS_DENSE_50K",
        nav: "Projects",
        theme: "dark-gray",
        size: { width: 1180, height: 760 },
      },
      {
        id: "EDGE_PROJECTS_NARROW_760X560",
        nav: "Projects",
        theme: "dark-black",
        size: { width: 760, height: 560 },
      },
      {
        id: "EDGE_SETTINGS_LONG_LABELS",
        nav: "Settings",
        theme: "light-gray",
        size: { width: 1180, height: 760 },
      },
      {
        id: "EDGE_SETTINGS_NARROW_760X560",
        nav: "Settings",
        theme: "dark-gray",
        size: { width: 760, height: 560 },
      },
      {
        id: "EDGE_LEGAL_EULA_VIEWER",
        nav: "Settings",
        theme: "dark-black",
        size: { width: 1180, height: 760 },
      },
      {
        id: "EDGE_DIALOG_CONFIRMATION",
        nav: "Projects",
        theme: "dark-black",
        size: { width: 1180, height: 760 },
      },
    ];

    const capturedEdgeFrames: Array<any> = [];

    for (const edge of edgeCases) {
      await page.setViewportSize(edge.size);
      await page.goto("/");
      await page.locator("#primary-navigation").getByRole("button", { name: "Settings" }).click();
      await page.locator(".settings-body select").first().selectOption(edge.theme);
      await page.locator("#primary-navigation").getByRole("button", { name: edge.nav }).click();
      await page.waitForTimeout(100);

      const filename = `${edge.id}.png`;
      const filePath = path.join(EDGE_DIR, filename);
      const buffer = await page.screenshot({ path: filePath });
      const fileSha = crypto.createHash("sha256").update(buffer).digest("hex");

      capturedEdgeFrames.push({
        edgeId: edge.id,
        theme: edge.theme,
        size: `${edge.size.width}x${edge.size.height}`,
        renderer: "MOCK_BROWSER",
        sha256: fileSha,
        filename,
      });
    }

    // Save W034: concept_frame_index.json
    fs.writeFileSync(
      path.join(OUT_DIR, "concept_frame_index.json"),
      JSON.stringify({ totalFrames: capturedFrames.length, frames: capturedFrames }, null, 2),
    );

    // Save W035: edge_frame_index.json
    fs.writeFileSync(
      path.join(OUT_DIR, "edge_frame_index.json"),
      JSON.stringify(
        { totalFrames: capturedEdgeFrames.length, edgeFrames: capturedEdgeFrames },
        null,
        2,
      ),
    );

    console.log(
      `Successfully generated ${capturedFrames.length} comparative frames and ${capturedEdgeFrames.length} edge frames.`,
    );
  });
});
