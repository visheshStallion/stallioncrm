/**
 * Create Invoice page (prompt 26 §9) at 1440 px, light and dark: the fields in the reference positions, the red bars on
 * Subject, Account Name and the Invoiced Items title. Today's dates and the owner are masked.
 */
import { expect, test } from "@playwright/test";
import { login } from "../e2e/helpers";

for (const theme of ["light", "dark"] as const) {
  test(`create invoice – ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, "exec.hmnl.1");
    await page.goto("/invoices/new");
    await expect(page.getByTestId("line-items-grid")).toBeVisible();
    await expect(page.getByTestId("add-multiple")).toBeEnabled();
    for (const id of ["#inv-subject", "#inv-account"]) expect(await page.locator(id).evaluate((el) => getComputedStyle(el).boxShadow)).toContain("inset");
    await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
    await page.mouse.move(0, 0);
    // a full-page capture would freeze the sticky form-view bar in the middle of the page
    await page.addStyleTag({ content: ".crm-po-footer { position: static; }" });
    await expect(page).toHaveScreenshot(`create-invoice-${theme}.png`, { fullPage: true, mask: [page.locator("#inv-date"), page.locator("#inv-due"), page.locator("#inv-owner")] });
  });
}
