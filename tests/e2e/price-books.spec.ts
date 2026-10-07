import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/** Price Books: Create Price Book page fields; Import → upload step with samples → the import wizard. */
test("create a price book with owner, pricing model, naira and description; edit it", async ({ page }) => {
  const stamp = Date.now();
  await login(page, "bm.hmnl");
  await page.goto("/priceBooks");
  await page.getByTestId("new-price-book").click();
  await expect(page.getByRole("heading", { name: "Create Price Book" })).toBeVisible();
  await expect(page.locator("#name")).toHaveClass(/crm-po-req/);
  await expect(page.locator("#ownerId")).not.toHaveValue("");
  await expect(page.locator("#active")).toBeChecked();
  await page.locator("#name").fill(`Fleet prices ${stamp}`);
  await page.locator("#pricingModel").selectOption("FLAT");
  await page.locator("#naira").fill("150000");
  await page.locator("#description").fill("Prices for fleet customers");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/priceBooks\/(?!new)[a-z0-9]+$/);
  await expect(page.locator('[data-field="Pricing Model"]')).toHaveText("Flat");
  await expect(page.locator('[data-field="Description"]')).toHaveText("Prices for fleet customers");
  await page.getByTestId("price-book-edit").click();
  await page.locator("#pricingModel").selectOption("DIFFERENTIAL");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator('[data-field="Pricing Model"]')).toHaveText("Differential");
});

test("Import: the upload step with samples leads into the import wizard for price books", async ({ page }) => {
  await login(page, "bm.hmnl");
  await page.goto("/priceBooks");
  await page.getByTestId("import-price-books").click();
  await expect(page.getByRole("heading", { name: "Import Price Books" })).toBeVisible();
  await expect(page.getByTestId("import-steps").locator('[aria-current="step"]')).toHaveText("Upload");
  const sample = await page.request.get("/api/v1/imports/sample?module=priceBooks&format=csv");
  expect(sample.headers()["content-type"]).toContain("text/csv");
  const csv = await sample.text();
  expect(csv.split(/\r?\n/)[0]).toBe("Price book name,Product code,Price,Max discount %,Brand");
  expect((await page.request.get("/api/v1/imports/sample?module=priceBooks&format=xlsx")).headers()["content-type"]).toContain("spreadsheetml");
  await page.getByLabel("File to import").setInputFiles({ name: "prices.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByTestId("upload-file-name")).toHaveText("prices.csv");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/\/imports\/[a-z0-9]+$/);
  await expect(page.getByTestId("import-steps")).toBeVisible();
});
