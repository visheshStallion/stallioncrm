import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * Ordered Items grid (prompt 24 §8) in the browser: 5 rows by "Add row", 3 by "Add multiple products", 4 pasted from
 * Excel; delete and reorder renumber S.NO; keyboard-only entry; the phone layout shows cards.
 */
async function newOrder(page: Page) {
  await login(page, "exec.hmnl.1");
  await page.goto("/salesOrders/new");
  await expect(page.getByTestId("line-items-grid")).toBeVisible();
  await page.locator("#so-subject").fill(`Grid test ${Date.now()}`);
  await page.locator("#inv-account").fill(`Grid test ${Date.now()}`);
}
const rows = (page: Page) => page.getByTestId("grid-row");

test("12 lines: Add row ×5, Add multiple products ×3, paste 4 from Excel; delete and reorder renumber S.NO", async ({ page }) => {
  await newOrder(page);
  const grid = page.getByTestId("line-items-grid");
  // row 1 exists; 4 more by "Add row" – each new row gets the focus
  for (let i = 1; i <= 5; i++) {
    if (i > 1) await page.getByTestId("add-row").click();
    else await grid.getByLabel("Row 1, Product Name").click();
    await expect(grid.getByLabel(`Row ${i}, Product Name`)).toBeFocused();
    await page.keyboard.type(`Item ${i}`);
    await grid.getByLabel(`Row ${i}, List Price`).fill(String(1000 * i));
  }
  // 3 products in one go
  await page.getByTestId("add-multiple").click();
  const picker = page.getByTestId("multi-picker");
  for (let i = 0; i < 3; i++) await picker.getByRole("checkbox", { name: /^Select / }).nth(i).check();
  await picker.getByTestId("multi-picker-add").click();
  await expect(rows(page)).toHaveCount(8);
  // 4 rows pasted from Excel (product / code, quantity, price) – a preview first
  await grid.getByLabel("Row 8, Quantity").focus();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "Wheel lock\t4\t2500\nMud flaps\t2\t3000\nFirst aid kit\t1\t15000\nFire extinguisher\t1\t12000\n");
    document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.getByTestId("paste-preview")).toContainText("Add 4 pasted row(s)");
  await page.getByTestId("paste-confirm").click();
  await expect(rows(page)).toHaveCount(12);
  await expect(page.getByTestId("row-number")).toHaveText(Array.from({ length: 12 }, (_, i) => String(i + 1)));

  // delete row 2 → 11 rows numbered 1–11; move the last row up via its row menu
  await rows(page).nth(1).hover();
  await page.getByRole("button", { name: "Delete row 2" }).click();
  await expect(rows(page)).toHaveCount(11);
  await expect(page.getByTestId("row-number")).toHaveText(Array.from({ length: 11 }, (_, i) => String(i + 1)));
  await rows(page).nth(10).hover();
  await page.getByRole("button", { name: "Row 11 actions" }).click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await expect(grid.getByLabel("Row 10, Product Name")).toHaveValue("Fire extinguisher");

  await page.getByTestId("so-save").click();
  await expect(page).toHaveURL(/\/salesOrders\/(?!new$)[a-z0-9]+$/);
  await expect(page.getByTestId("grid-row")).toHaveCount(11);
  await expect(page.getByLabel("Row 10, Product Name")).toHaveValue("Fire extinguisher");
});

test("keyboard only: type a line, Enter in List Price adds the next row, Ctrl+Enter adds one anywhere; the discount pop-up", async ({ page }) => {
  await newOrder(page);
  const grid = page.getByTestId("line-items-grid");
  await grid.getByLabel("Row 1, Product Name").focus();
  await page.keyboard.type("Seat covers");
  await page.keyboard.press("Tab"); // description
  await page.keyboard.type("Leather, beige");
  await page.keyboard.press("Tab");
  await expect(grid.getByLabel("Row 1, Quantity")).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("2");
  await page.keyboard.press("Tab");
  await page.keyboard.type("40000");
  await page.keyboard.press("Enter");
  await expect(rows(page)).toHaveCount(2);
  await expect(grid.getByLabel("Row 2, Product Name")).toBeFocused();
  await page.keyboard.press("Control+Enter");
  await expect(rows(page)).toHaveCount(3);
  // 2 × 40,000 = 80,000 + 7.5 % VAT
  await expect(page.getByTestId("row-total").first()).toHaveText("86,000.00");
  // a 10 % discount through the pop-up
  await grid.getByRole("button", { name: /^Row 1, Discount/ }).click();
  await page.getByTestId("grid-popup").getByLabel("Discount %").fill("10");
  await expect(page.getByTestId("grid-popup")).toContainText("8,000.00");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("row-total").first()).toHaveText("77,400.00");
  await expect(page.getByTestId("grand-total")).toHaveText("77,400.00");
  await expect(page.getByTestId("amount-in-words")).toHaveText("Seventy-Seven Thousand, Four Hundred Naira Only");
});

test("phones: each line is a card, edited in a bottom sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newOrder(page);
  await expect(page.getByTestId("grid-cards")).toBeVisible();
  await page.getByRole("button", { name: "Edit line" }).click();
  const sheet = page.getByTestId("line-sheet");
  await sheet.getByLabel("Row 1, Product Name").fill("Phone case");
  await sheet.getByLabel("Quantity").fill("3");
  await sheet.getByLabel(/List Price/).fill("1000");
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("grid-card").first()).toContainText("Phone case");
  await expect(page.getByTestId("grid-card").first()).toContainText("3,225.00");
});
