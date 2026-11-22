import { test, expect } from "@playwright/test";

test.describe("Frameless 640x420 Monochrome Setup & Uninstaller E2E", () => {
  test("install flow: 640x420 card, options sheet, 73 languages + RTL, progress, done", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 720, height: 500 });
    await page.goto("/setup.html?lang=tr&fast=1");

    const card = page.getByTestId("setup-card");
    await expect(card).toBeVisible();

    const box = await card.boundingBox();
    expect(box?.width).toBeCloseTo(640, 0);
    expect(box?.height).toBeCloseTo(420, 0);

    // Monochrome styling check
    const styles = await card.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, radius: s.borderRadius };
    });
    expect(styles.bg).toBe("rgb(17, 17, 19)");
    expect(styles.radius).toBe("22px");

    // Welcome screen
    await expect(page.getByTestId("setup-version-pill")).toHaveText("1.0.0");
    await expect(page.getByTestId("setup-primary-install")).toHaveText("Kur");

    // Open Options Sheet and verify 73 languages + live RTL switching
    await page.getByTestId("setup-options-toggle").click();
    const sheet = page.getByTestId("setup-options-sheet");
    await expect(sheet).toHaveClass(/is-open/);

    const langSelect = page.getByTestId("setup-language-select");
    const optionCount = await langSelect.locator("option").count();
    expect(optionCount).toBe(73);

    await langSelect.selectOption("ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("setup-sheet-install")).toHaveText("تثبيت");

    await langSelect.selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByTestId("setup-sheet-install")).toHaveText("Install");

    // Start install -> Done screen
    await page.getByTestId("setup-sheet-install").click();
    await expect(page.getByTestId("setup-done-title")).toHaveText("Detergo is ready");
    await expect(page.getByTestId("setup-done-launch")).toBeVisible();
    await expect(page.getByTestId("setup-done-close")).toBeVisible();
  });

  test("uninstall flow: delete user data checkbox -> progress -> uninstalled", async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 500 });
    await page.goto("/setup.html?mode=uninstall&lang=tr&fast=1");

    await expect(page.getByTestId("setup-uninstall-title")).toHaveText("Detergo'yu kaldır");
    const checkbox = page.getByTestId("setup-delete-user-data");
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await expect(checkbox).toBeChecked();

    await page.getByTestId("setup-uninstall-confirm").click();
    await expect(page.getByTestId("setup-uninstalled-title")).toHaveText("Detergo kaldırıldı");
    await expect(page.getByTestId("setup-uninstalled-close")).toBeVisible();
  });
});
