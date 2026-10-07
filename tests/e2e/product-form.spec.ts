import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/** Create Product page: the Zoho-style fields, red bars, Taxable switching the tax off, Save and New. */
test("create a product with owner, vendor, manufacturer, tax and stock; Save and New opens a fresh form", async ({ page }) => {
  const stamp = Date.now().toString(36).toUpperCase();
  await login(page, "bm.hmnl");
  await page.goto("/products/new");
  const form = page.getByTestId("product-form");
  await expect(page.getByRole("heading", { name: "Create Product" })).toBeVisible();
  for (const id of ["#name", "#code", "#manufacturer", "#category", "#description"]) await expect(page.locator(id)).toHaveClass(/crm-po-req/);
  await expect(page.locator("#ownerId")).not.toHaveValue("");
  await expect(page.locator("#manufacturer")).not.toHaveValue("");
  await expect(page.locator("#active")).toBeChecked();
  await expect(page.locator("#taxable")).toBeChecked();

  await form.getByLabel("Product Name").fill(`Mud flaps ${stamp}`);
  await form.getByLabel("Product Code").fill(`MF-${stamp}`);
  await page.locator("#category").selectOption("ACCESSORY");
  await expect(page.locator("#modelYear")).toHaveCount(0); // specification is for vehicles
  await page.locator("#preferredVendorId").selectOption({ index: 1 });
  await page.locator("#listPrice").fill("12500");
  await page.locator("#taxable").uncheck();
  await expect(page.locator("#tax")).toBeDisabled();
  await page.locator("#qtyInStock").fill("30");
  await page.locator("#qtyOrdered").fill("10");
  await page.locator("#description").fill("Set of four mud flaps");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/products\/(?!new)[a-z0-9]+$/);
  await expect(page.locator('[data-field="Taxable"]')).toHaveText("No");
  await expect(page.locator('[data-field="Quantity in Stock"]')).toHaveText("30");
  await expect(page.locator('[data-field="Vendor Name"]')).not.toHaveText("—");

  await page.goto("/products/new");
  await form.getByLabel("Product Name").fill(`Seat covers ${stamp}`);
  await form.getByLabel("Product Code").fill(`SC-${stamp}`);
  await page.locator("#category").selectOption("ACCESSORY");
  await page.locator("#description").fill("Leather seat covers");
  await page.getByRole("button", { name: "Save and New" }).click();
  await expect(page).toHaveURL(/\/products\/new$/);
  await expect(page.locator("#name")).toHaveValue("");
});
