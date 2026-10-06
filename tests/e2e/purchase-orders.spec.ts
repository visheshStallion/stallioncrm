import { expect, test, type Page } from "@playwright/test";
import { login, signOut } from "./helpers";

/** The Create Purchase Order page (prompt 25 §9) in the browser. */
const stamp = Date.now();
const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};
async function pickVendor(page: Page, index = 0) {
  await page.getByTestId("po-form").getByRole("button", { name: "Look up vendor name" }).click();
  await page.getByRole("listbox", { name: "Vendor Name options" }).getByRole("option").nth(index).click();
}
async function addItem(page: Page, qty: string, price: string) {
  const form = page.getByTestId("po-form");
  await form.getByLabel("Row 1, Product Name").click();
  await page.getByTestId("product-options").getByRole("option").first().click();
  await form.getByLabel("Row 1, Quantity").fill(qty);
  await form.getByLabel("Row 1, List Price").fill(price);
}
async function chooseBrand(page: Page, code: string) {
  const value = await page.locator("#po-brand option", { hasText: `${code} –` }).first().getAttribute("value");
  await page.locator("#po-brand").selectOption(value!);
  await expect(page.getByRole("button", { name: "Look up vendor name" })).toBeEnabled();
}

test("defaults, mandatory fields, Save and New keeps brand / vendor / currency / carrier, Cancel asks when the form is dirty", async ({ page }) => {
  await login(page, "logistics.hmnl");
  await page.goto("/purchaseOrders/new");
  const form = page.getByTestId("po-form");
  await expect(form.getByRole("heading", { name: "Create Purchase Order" })).toBeVisible();
  await expect(page.locator("#po-owner")).not.toHaveValue("");
  await expect(page.locator("#po-date")).toHaveValue(today());
  await expect(page.locator("#po-status option:checked")).toHaveText("Created");
  await expect(page.locator("#po-currency")).toHaveValue("NGN");
  await expect(page.locator("#po-rate")).toHaveValue("1");
  await expect(page.locator("#po-rate")).toHaveAttribute("readonly", "");
  await expect(page.locator("#billing-country")).toHaveValue("Nigeria");
  await expect(page.locator("#po-carrier")).toHaveValue("FedEx");
  // red bars: Subject, Vendor Name and the Purchase Items title; no layout links for a logistics officer
  await expect(page.locator("#po-subject")).toHaveClass(/crm-po-req/);
  await expect(page.locator("#po-vendor")).toHaveClass(/crm-po-req/);
  await expect(page.getByRole("heading", { name: "Purchase Items" })).toHaveClass(/crm-grid-title-required/);
  await expect(page.getByTestId("edit-page-layout")).toHaveCount(0);
  await expect(page.getByTestId("create-form-page")).toHaveCount(0);

  await page.getByTestId("po-save").click();
  await expect(form.getByText("Enter the subject")).toBeVisible();
  await expect(form.getByText("Choose the vendor")).toBeVisible();

  await form.getByLabel("Subject").fill(`Parts restock ${stamp}`);
  await pickVendor(page);
  const vendorName = await page.locator("#po-vendor").inputValue();
  await page.locator("#po-carrier").selectOption("DHL");
  await addItem(page, "3", "25000");
  await page.getByTestId("po-save-new").click();
  await expect(page).toHaveURL(/\/purchaseOrders\/new\?.*vendor=/);
  await expect(page.locator("#po-vendor")).toHaveValue(vendorName);
  await expect(page.locator("#po-carrier")).toHaveValue("DHL");
  await expect(page.locator("#po-subject")).toHaveValue("");

  // dirty form: Cancel asks; dismissing keeps the form
  await form.getByLabel("Subject").fill("Not saved");
  page.once("dialog", (d) => d.dismiss());
  await page.getByTestId("po-cancel").click();
  await expect(page).toHaveURL(/\/purchaseOrders\/new/);
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("po-cancel").click();
  await expect(page).toHaveURL(/\/inventory\/documents\?type=PO/);
});

test("currency: USD fills the rate from Setup → Currencies and recalculates the naira total; only finance edits the rate", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/setup/currencies");
  await page.locator("#s-rates").fill("USD = 1500.00\nEUR = 1650.00");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();
  // the administrator may type a rate
  await page.goto("/purchaseOrders/new");
  await chooseBrand(page, "HMNL");
  await page.locator("#po-currency").selectOption("USD");
  await expect(page.locator("#po-rate")).toHaveValue("1500");
  await expect(page.locator("#po-rate")).not.toHaveAttribute("readonly", "");
  await signOut(page);

  await login(page, "logistics.hmnl");
  await page.goto("/purchaseOrders/new");
  await addItem(page, "2", "1000");
  await page.locator("#po-currency").selectOption("USD");
  await expect(page.locator("#po-rate")).toHaveValue("1500");
  await expect(page.locator("#po-rate")).toHaveAttribute("readonly", "");
  await expect(page.getByRole("columnheader", { name: "List Price($)" })).toBeVisible();
  // 2 × 1,000 + 7.5 % = 2,150 USD ≈ ₦3,225,000
  await expect(page.getByTestId("po-ngn-total")).toContainText("3,225,000.00");
});

test("Copy Address: billing to shipping, from the warehouse and from the vendor; country picklist with Nigerian states", async ({ page }) => {
  await login(page, "logistics.hmnl");
  await page.goto("/purchaseOrders/new");
  await expect(page.locator("#billing-street")).not.toHaveValue("");
  await page.locator("#billing-state").selectOption("Lagos");
  await page.locator("#billing-city").fill("Ikeja");
  await page.getByTestId("copy-address").click();
  await page.getByRole("menuitem", { name: "Copy Billing to Shipping" }).click();
  await expect(page.locator("#shipping-city")).toHaveValue("Ikeja");
  await expect(page.locator("#shipping-state")).toHaveValue("Lagos");
  await page.getByTestId("copy-address").click();
  await page.getByRole("menuitem", { name: "Shipping from warehouse…" }).click();
  await page.getByRole("menu", { name: "Warehouses" }).getByRole("menuitem").first().click();
  await expect(page.locator("#shipping-city")).toHaveValue("");
  await pickVendor(page);
  const vendorName = await page.locator("#po-vendor").inputValue();
  await page.getByTestId("copy-address").click();
  await page.getByRole("menuitem", { name: "Billing from vendor" }).click();
  expect((await page.locator("#billing-street").inputValue()).startsWith(vendorName)).toBe(true);
  // another country: the state is free text
  await page.locator("#shipping-country").fill("Japan");
  await expect(page.locator("#shipping-state")).toHaveJSProperty("tagName", "INPUT");
});

test("vendor lookup shows only the brand's vendors; above the threshold → Pending Approval; locked after approval; Brand Manager reopens", async ({ page }) => {
  await login(page, "logistics.hmnl");
  const vendors = ((await (await page.request.get("/api/v1/inventory/vendors")).json()) as { data: Array<{ name: string; active: boolean }> }).data.filter((v) => v.active).map((v) => v.name);
  await page.goto("/purchaseOrders/new");
  await page.getByTestId("po-form").getByRole("button", { name: "Look up vendor name" }).click();
  const options = await page.getByRole("listbox", { name: "Vendor Name options" }).getByRole("option").allTextContents();
  expect(options.every((o) => vendors.some((v) => o.startsWith(v)))).toBe(true);
  await page.keyboard.press("Escape");

  await page.getByTestId("po-form").getByLabel("Subject").fill(`Big order ${stamp}`);
  await pickVendor(page);
  await addItem(page, "2", "60000000");
  await page.getByTestId("po-save").click();
  await expect(page).toHaveURL(/\/purchaseOrders\/(?!new)[a-z0-9]+$/);
  const url = page.url();
  await expect(page.getByTestId("doc-status")).toHaveText("Created");
  await page.getByTestId("doc-actions").getByRole("button", { name: "Submit" }).click();
  await expect(page.getByTestId("doc-status")).toHaveText("Pending Approval");
  await expect(page.getByTestId("doc-actions").getByRole("link", { name: "Edit" })).toHaveCount(0);
  await signOut(page);

  await login(page, "bm.hmnl");
  await page.goto(url);
  await page.getByTestId("doc-actions").getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("doc-status")).toHaveText("Approved");
  await expect(page.getByTestId("doc-actions").getByRole("link", { name: "Edit" })).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("doc-actions").getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByTestId("doc-status")).toHaveText("Created");
  await expect(page.getByTestId("doc-actions").getByRole("link", { name: "Edit" })).toBeVisible();
});

test("Edit Page Layout and custom form pages: administrators only; a custom view hides fields and saves the same record", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/purchaseOrders/new");
  await chooseBrand(page, "HMNL");
  await expect(page.getByTestId("edit-page-layout")).toBeVisible();
  await page.getByTestId("create-form-page").click();
  await expect(page).toHaveURL(/\/setup\/purchase-orders/);
  const name = `Import PO view ${stamp}`;
  await page.getByLabel(/Create a custom form page – name/).fill(name);
  await page.getByTestId("po-form-views").getByLabel("Sales Commission").check();
  await page.getByRole("button", { name: "Create view" }).click();
  await expect(page.getByTestId("po-form-view").filter({ hasText: name })).toBeVisible();

  await page.goto("/purchaseOrders/new");
  await chooseBrand(page, "HMNL");
  await expect(page.locator("#po-commission")).toBeVisible();
  await page.locator("#po-view").selectOption({ label: name });
  await expect(page.locator("#po-commission")).toHaveCount(0);
  await page.getByTestId("po-form").getByLabel("Subject").fill(`Import ${stamp}`);
  await pickVendor(page);
  await addItem(page, "1", "5000");
  await page.keyboard.press("Control+s");
  await expect(page).toHaveURL(/\/purchaseOrders\/(?!new)[a-z0-9]+$/);
  await expect(page.locator('[data-field="Form view"]')).toHaveText(name);
  await expect(page.locator('[data-field="Sales Commission"]')).toHaveCount(0);
  // clone keeps the lines, gets a new number on save
  await page.getByTestId("po-clone").click();
  await expect(page.getByRole("heading", { name: "Clone Purchase Order" })).toBeVisible();
  await expect(page.locator("#po-subject")).toHaveValue(`Import ${stamp} (copy)`);
  await expect(page.getByTestId("grid-row")).toHaveCount(1);
});
