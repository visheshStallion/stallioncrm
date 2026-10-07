import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/** Create Sales Order page: the screenshot's sections and fields; copy from a quote; edit and clone. */
test("create a sales order with the page fields, other charges in the total; copy from a quote; edit; clone", async ({ page }) => {
  const stamp = Date.now();
  await login(page, "exec.hmnl.1");
  await page.goto("/salesOrders/new");
  const form = page.getByTestId("order-form");
  await expect(page.getByRole("heading", { name: "Create Sales Order" })).toBeVisible();
  await expect(page.locator("#so-status option:checked")).toHaveText("Created");
  await expect(page.locator("#so-carrier")).toHaveValue("FedEx");
  await expect(page.locator("#so-rate")).toHaveValue("1");
  await expect(page.locator("#so-owner")).not.toHaveValue("");
  for (const id of ["#so-subject", "#inv-account"]) await expect(page.locator(id)).toHaveClass(/crm-po-req/);
  await expect(page.getByRole("heading", { name: "Ordered Items" })).toHaveClass(/crm-grid-title-required/);
  await expect(page.getByRole("heading", { name: "Address Information" })).toBeVisible();

  await page.getByTestId("so-save").click();
  await expect(form.getByText("Enter the subject")).toBeVisible();

  await page.locator("#so-subject").fill(`Order ${stamp}`);
  await page.locator("#so-customer-no").fill("C-1001");
  await page.locator("#so-pending").fill("Deposit");
  await page.locator("#so-po-ref").fill("PO-77");
  await page.locator("#inv-account").fill(`Order customer ${stamp}`);
  await page.locator("#billing-city").fill("Ikeja");
  await page.getByTestId("copy-address").click();
  await page.getByRole("menuitem", { name: "Copy Billing to Shipping" }).click();
  await expect(page.locator("#shipping-city")).toHaveValue("Ikeja");
  await form.getByLabel("Row 1, Product Name").fill("Floor mats");
  await form.getByLabel("Row 1, Quantity").fill("2");
  await form.getByLabel("Row 1, List Price").fill("50000");
  await page.locator("#so-other").fill("25000");
  await expect(page.getByTestId("grand-total")).toHaveText("132,500.00");
  await page.getByTestId("so-save").click();
  await expect(page).toHaveURL(/\/salesOrders\/(?!new)[a-z0-9]+$/);
  await expect(page.locator('[data-field="Customer No."]')).toHaveText("C-1001");
  await expect(page.locator('[data-field="Pending"]')).toHaveText("Deposit");
  await expect(page.getByTestId("grand-total")).toHaveText("132,500.00");

  await page.getByTestId("so-edit").click();
  await page.locator("#so-subject").fill(`Order ${stamp} – revised`);
  await page.getByTestId("so-save").click();
  await expect(page.locator('[data-field="Subject"]')).toHaveText(`Order ${stamp} – revised`);
  await page.getByTestId("so-clone").click();
  await expect(page.getByRole("heading", { name: "Clone Sales Order" })).toBeVisible();
  await expect(page.locator("#so-subject")).toHaveValue(`Order ${stamp} – revised (copy)`);
});
