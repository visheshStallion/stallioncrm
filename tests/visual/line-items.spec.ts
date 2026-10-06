/**
 * Ordered Items grid (prompt 24 §8): the empty one-row grid at 1440 px (light and dark) and on a phone. At 1440 px all
 * 8 columns are visible and their widths are within ±2 % of the specification; the red marker is only on Product Name.
 */
import { expect, test, type Page } from "@playwright/test";
import { login } from "../e2e/helpers";

const WIDTHS = [12, 23.5, 7.5, 11, 11.5, 11.5, 10.5, 12.5];

async function open(page: Page) {
  await login(page, "exec.hmnl.1");
  await page.goto("/salesOrders/new");
  await expect(page.getByTestId("line-items-grid")).toBeVisible();
  await expect(page.getByTestId("add-multiple").first()).toBeEnabled(); // products loaded
}

for (const theme of ["light", "dark"] as const) {
  test(`ordered items grid – desktop ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const grid = page.getByTestId("line-items-grid");
    const heads = grid.locator("thead th");
    await expect(heads).toHaveCount(8);
    const table = await grid.locator("table").boundingBox();
    for (let i = 0; i < 8; i++) {
      const box = await heads.nth(i).boundingBox();
      expect(box, `column ${i + 1} visible`).not.toBeNull();
      expect(Math.abs((box!.width / table!.width) * 100 - WIDTHS[i]!), `column ${i + 1} width`).toBeLessThanOrEqual(2);
    }
    await expect(grid.locator(".crm-grid-required")).toHaveCount(1);
    await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
    await page.mouse.move(0, 0);
    await expect(grid).toHaveScreenshot(`ordered-items-${theme}.png`);
  });
}

test("ordered items grid – mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(page.getByTestId("grid-cards")).toBeVisible();
  await expect(page.getByTestId("line-items-grid")).toHaveScreenshot("ordered-items-mobile.png");
});
