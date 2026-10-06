/**
 * Create Purchase Order page (prompt 25 §9) at 1440 px, light and dark: the fields in the reference positions, the red
 * bars on Subject, Vendor Name and the Purchase Items title. Today's date and the owner are masked.
 */
import { expect, test } from "@playwright/test";
import { login } from "../e2e/helpers";

for (const theme of ["light", "dark"] as const) {
  test(`create purchase order – ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, "logistics.hmnl");
    await page.goto("/purchaseOrders/new");
    await expect(page.getByTestId("line-items-grid")).toBeVisible();
    await expect(page.getByTestId("add-multiple")).toBeEnabled();
    await expect(page.locator("#billing-street")).not.toHaveValue("");
    // the subject and vendor bars sit on the left edge of their inputs
    for (const id of ["#po-subject", "#po-vendor"]) expect(await page.locator(id).evaluate((el) => getComputedStyle(el).boxShadow)).toContain("inset");
    await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
    await page.mouse.move(0, 0);
    // a full-page capture would freeze the sticky form-view bar in the middle of the page
    await page.addStyleTag({ content: ".crm-po-footer { position: static; }" });
    await expect(page).toHaveScreenshot(`create-purchase-order-${theme}.png`, { fullPage: true, mask: [page.locator("#po-date"), page.locator("#po-owner")] });
  });
}
