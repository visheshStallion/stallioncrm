import { expect, test, type Page } from "@playwright/test";
import { login, signOut } from "./helpers";

/** The Create Invoice page (prompt 26 §9) in the browser. */
const stamp = Date.now();
const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};
async function item(page: Page, row: number, name: string, qty: string, price: string) {
  const form = page.getByTestId("invoice-form");
  await form.getByLabel(`Row ${row}, Product Name`).fill(name);
  await form.getByLabel(`Row ${row}, Quantity`).fill(qty);
  await form.getByLabel(`Row ${row}, List Price`).fill(price);
}
const saved = (page: Page) => expect(page).toHaveURL(/\/invoices\/(?!new)[a-z0-9]+$/);

test("defaults, red bars, a typed new customer, Other Charges in the total, amount in words; Save and New keeps the brand", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  await page.goto("/invoices/new");
  const form = page.getByTestId("invoice-form");
  await expect(form.getByRole("heading", { name: "Create Invoice" })).toBeVisible();
  await expect(page.locator("#inv-owner")).not.toHaveValue("");
  await expect(page.locator("#inv-date")).toHaveValue(today());
  await expect(page.locator("#inv-status option:checked")).toHaveText("Created");
  await expect(page.locator("#inv-currency")).toHaveValue("NGN");
  await expect(page.locator("#inv-rate")).toHaveValue("1");
  await expect(page.locator("#inv-rate")).toHaveAttribute("readonly", "");
  await expect(page.locator("#billing-country")).toHaveValue("Nigeria");
  for (const id of ["#inv-subject", "#inv-account"]) await expect(page.locator(id)).toHaveClass(/crm-po-req/);
  await expect(page.getByRole("heading", { name: "Invoiced Items" })).toHaveClass(/crm-grid-title-required/);
  await expect(page.getByTestId("edit-page-layout")).toHaveCount(0);

  await page.getByTestId("inv-save").click();
  await expect(form.getByText("Enter the subject")).toBeVisible();
  await expect(form.getByText("Pick an account or type the customer's name")).toBeVisible();

  await form.getByLabel("Subject").fill(`Accessories – Ojo ${stamp}`);
  await page.locator("#inv-account").fill(`Bisi Ojo ${stamp}`);
  await expect(page.getByTestId("inv-account-state")).toHaveText(/New customer/);
  await page.locator("#inv-po-ref").fill("CUST-PO-77");
  await item(page, 1, "Floor mats", "2", "50000");
  await page.locator("#inv-other").fill("25000");
  await expect(page.getByTestId("total-other-charges")).toContainText("25,000.00");
  // 2 × 50,000 + 7.5 % VAT = 107,500 + 25,000 other charges
  await expect(page.getByTestId("grand-total")).toHaveText("132,500.00");
  await expect(page.getByTestId("amount-in-words")).toHaveText("One Hundred and Thirty-Two Thousand, Five Hundred Naira Only");
  await page.getByTestId("inv-save").click();
  await saved(page);
  await expect(page.locator('[data-field="Purchase Order"]')).toHaveText("CUST-PO-77");
  await expect(page.getByTestId("grand-total")).toHaveText("132,500.00");

  // Save and New from a fresh form keeps the brand and the currency
  await page.goto("/invoices/new");
  await form.getByLabel("Subject").fill(`Second ${stamp}`);
  await page.locator("#inv-account").fill(`Second customer ${stamp}`);
  await item(page, 1, "Wiper blades", "1", "8000");
  await page.getByTestId("inv-save-new").click();
  await expect(page).toHaveURL(/\/invoices\/new\?.*brand=/);
  await expect(page.locator("#inv-subject")).toHaveValue("");
  // a dirty form asks before cancelling
  await form.getByLabel("Subject").fill("Not saved");
  page.once("dialog", (d) => d.dismiss());
  await page.getByTestId("inv-cancel").click();
  await expect(page).toHaveURL(/\/invoices\/new/);
});

test("from a sales order: the details and only the uninvoiced quantities; a second invoice gets the remainder", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  const so = ((await (await page.request.post("/api/v1/salesOrders", { data: { billTo: { name: `SO customer ${stamp}`, address: "4 Marina", city: "Lagos" }, lines: [{ description: "Tyres", qty: 4, unitPrice: 80000, taxRate: 7.5 }] } })).json()) as { data: { id: string } }).data;
  await page.goto(`/salesOrders/${so.id}`);
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByTestId("status-pill").first()).toHaveText("Confirmed");

  await page.goto("/invoices/new");
  await page.getByRole("button", { name: "Look up sales order" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("listbox", { name: "Sales Order options" }).getByRole("option", { name: new RegExp(`SO customer ${stamp}`) }).click();
  await expect(page.locator("#inv-account")).toHaveValue(`SO customer ${stamp}`);
  await expect(page.locator("#billing-street")).toHaveValue("4 Marina");
  const form = page.getByTestId("invoice-form");
  await expect(form.getByLabel("Row 1, Quantity")).toHaveValue("4");
  await form.getByLabel("Row 1, Quantity").fill("3");
  await page.getByTestId("inv-save").click();
  await saved(page);

  await page.goto("/invoices/new");
  await page.getByRole("button", { name: "Look up sales order" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("listbox", { name: "Sales Order options" }).getByRole("option", { name: new RegExp(`SO customer ${stamp}`) }).click();
  await expect(form.getByLabel("Row 1, Quantity")).toHaveValue("1");
});

test("issue, record a payment, credit note, void with a reason – Brand Manager", async ({ page }) => {
  await login(page, "bm.hmnl");
  await page.goto("/invoices/new");
  const form = page.getByTestId("invoice-form");
  await form.getByLabel("Subject").fill(`Service ${stamp}`);
  await page.locator("#inv-account").fill(`Service customer ${stamp}`);
  await item(page, 1, "Service package", "1", "200000");
  await page.getByTestId("inv-save").click();
  await saved(page);
  await page.getByRole("button", { name: "Issue" }).click();
  await expect(page.getByTestId("status-pill").first()).toHaveText("Issued");
  await expect(page.getByTestId("inv-edit")).toHaveCount(0); // locked
  await page.getByLabel("Payment amount").fill("100000");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByTestId("status-pill").first()).toHaveText("Partially Paid");
  await page.getByTestId("credit-note").click();
  const dlg = page.getByTestId("credit-note-dialog");
  await dlg.getByLabel("Amount").fill("15000");
  await dlg.getByLabel("Reason").fill("Goodwill discount agreed");
  await page.getByTestId("credit-note-save").click();
  await expect(page.getByTestId("credit-notes")).toContainText(/HMNL-CN-\d{4}-\d{5}/);
  // 215,000 − 100,000 paid − 15,000 credited
  await expect(page.getByTestId("invoice-balance")).toContainText("100,000.00");

  // a second invoice is voided with a reason
  await page.goto("/invoices/new");
  await form.getByLabel("Subject").fill(`To void ${stamp}`);
  await page.locator("#inv-account").fill(`Void customer ${stamp}`);
  await item(page, 1, "Item", "1", "1000");
  await page.getByTestId("inv-save").click();
  await saved(page);
  page.once("dialog", (d) => d.accept("Raised twice by mistake"));
  await page.getByRole("button", { name: "Void" }).click();
  await expect(page.getByTestId("status-pill").first()).toHaveText("Void");
  await expect(page.getByTestId("void-reason")).toHaveText("Raised twice by mistake");
  await signOut(page);
});

test("Edit Page Layout and custom form views for administrators; a view hides fields; Clone copies the invoice", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/setup/invoice-settings?brand=HMNL&newView=1");
  const name = `Fleet invoice ${stamp}`;
  await page.getByLabel(/Create a custom form page – name/).fill(name);
  await page.getByTestId("invoice-form-views").getByLabel("Sales Commission").check();
  await page.getByRole("button", { name: "Create view" }).click();
  await expect(page.getByTestId("invoice-form-view").filter({ hasText: name })).toBeVisible();

  await page.goto("/invoices/new?brand=HMNL");
  await expect(page.getByTestId("edit-page-layout")).toBeVisible();
  await expect(page.locator("#inv-commission")).toBeVisible();
  await page.locator("#inv-view").selectOption({ label: name });
  await expect(page.locator("#inv-commission")).toHaveCount(0);
  const form = page.getByTestId("invoice-form");
  await form.getByLabel("Subject").fill(`Fleet ${stamp}`);
  await page.locator("#inv-account").fill(`Fleet customer ${stamp}`);
  await item(page, 1, "Fleet service", "3", "10000");
  await page.keyboard.press("Control+s");
  await saved(page);
  await page.getByTestId("inv-clone").click();
  await expect(page.getByRole("heading", { name: "Clone Invoice" })).toBeVisible();
  await expect(page.locator("#inv-subject")).toHaveValue(`Fleet ${stamp} (copy)`);
  await expect(page.getByTestId("grid-row")).toHaveCount(1);
});
