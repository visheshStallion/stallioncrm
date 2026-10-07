import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/** Vendors module: list, Create Vendor with image and the screenshot's fields, record page, edit; sales users get 403. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("create a vendor with image, owner, website, GL account, category, opt-out and address; edit it", async ({ page }) => {
  const stamp = Date.now();
  await login(page, "logistics.hmnl");
  await page.goto("/vendors");
  await page.getByTestId("new-vendor").click();
  await expect(page.getByRole("heading", { name: "Create Vendor" })).toBeVisible();
  await expect(page.locator("#name")).toHaveClass(/crm-po-req/);
  await expect(page.locator("#ownerId")).not.toHaveValue("");
  await page.getByLabel("Vendor image").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await page.locator("#name").fill(`Ikeja Tyres ${stamp}`);
  await page.locator("#phone").fill("+2348011112222");
  await page.locator("#email").fill(`tyres${stamp}@example.test`);
  await page.locator("#website").fill("www.ikejatyres.example");
  await page.locator("#glAccount").selectOption("Purchases – Spare parts");
  await page.locator("#category").fill("Tyres");
  await page.locator("#emailOptOut").check();
  await page.locator("#address").fill("5 Oba Akran Avenue");
  await page.locator("#city").fill("Ikeja");
  await page.locator("#description").fill("Tyre supplier");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/vendors\/(?!new)[a-z0-9]+$/);
  await expect(page.locator('[data-field="GL Account"]')).toHaveText("Purchases – Spare parts");
  await expect(page.locator('[data-field="Email Opt Out"]')).toHaveText("Yes");
  await expect(page.locator('[data-field="Website"]')).toHaveText("https://www.ikejatyres.example");
  await expect(page.getByTestId("record-header").locator("img")).toBeVisible();

  await page.getByTestId("vendor-edit").click();
  await page.locator("#category").fill("Tyres and batteries");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator('[data-field="Category"]')).toHaveText("Tyres and batteries");
  await page.goto(`/vendors?q=${encodeURIComponent(`Ikeja Tyres ${stamp}`)}`);
  await expect(page.getByTestId("data-row")).toHaveCount(1);
});

test("sales users have no Vendors module", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  const res = await page.goto("/vendors");
  expect(res?.status()).toBe(403);
});
