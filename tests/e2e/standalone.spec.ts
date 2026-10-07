import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/**
 * Standalone documents (prompt 23) through the screens and the API: an invoice from nothing, a quote from Quick
 * Create, link later, unlinked views – and brand isolation for records without links.
 */
const stamp = Date.now();
let invoiceUrl = "";

test.describe.configure({ mode: "serial" });

test("Create Invoice from the list with only the customer's name and one free-text line", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  await page.goto("/invoices");
  await page.getByRole("link", { name: "Create Invoice" }).click();
  await expect(page).toHaveURL(/\/invoices\/new$/);
  // the Create Invoice page (prompt 26): brand pre-filled for a user of one brand; a typed customer is enough
  const form = page.getByTestId("invoice-form");
  await expect(page.locator("#inv-brand")).not.toHaveValue("");
  await expect(page.locator("#inv-date")).not.toHaveValue("");
  await form.getByLabel("Subject").fill(`Floor mats ${stamp}`);
  await page.locator("#inv-account").fill(`Standalone Buyer ${stamp}`);
  await page.locator("#inv-phone").fill(`+23480${String(stamp).slice(-8)}`);
  await form.getByLabel("Row 1, Product Name").fill("Floor mats");
  await form.getByLabel("Row 1, Quantity").fill("2");
  await form.getByLabel("Row 1, List Price").fill("50000");
  await expect(page.getByTestId("grand-total")).toHaveText("107,500.00");
  await page.getByTestId("inv-save").click();
  await expect(page).toHaveURL(/\/invoices\/(?!new$)[a-z0-9]+$/);
  invoiceUrl = new URL(page.url()).pathname;
  await expect(page.getByTestId("record-header")).toContainText(/-INV-\d{4}-\d{5}/);
  await expect(page.getByTestId("doc-bill-to")).toContainText(`+23480${String(stamp).slice(-8)}`);
  await expect(page.locator("main")).toContainText(`Standalone Buyer ${stamp}`);
  await expect(page.locator("main")).toContainText("Unlinked");

  // it is in the "Unlinked" view
  await page.goto("/invoices?view=unlinked");
  await expect(page.getByTestId("data-row").filter({ hasText: `Standalone Buyer ${stamp}` })).toHaveCount(1);
});

test("link later: ⋯ → Create customer from this document links an account; the link is shown", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  await page.goto(invoiceUrl);
  await page.getByTestId("doc-more").click();
  await page.getByTestId("create-customer").click();
  await expect(page.getByText(/Customer .* (created and linked|Linked to the existing customer)/).first()).toBeVisible();
  await expect(page.locator("main").getByRole("link", { name: `Standalone Buyer ${stamp}` })).toBeVisible();
  await expect(page.locator("main")).toContainText("Linked");
  // the PDF prints from the snapshot
  const id = invoiceUrl.split("/").pop();
  const pdf = await page.request.get(`/api/v1/invoices/${id}/pdf`);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
});

test("Quick Create → Quote opens the standalone form; a product line takes the price-book price", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  await page.goto("/");
  await page.getByTestId("quick-create").click();
  await page.getByRole("menuitem", { name: "Quote", exact: true }).click();
  await expect(page).toHaveURL(/\/quotes\/new$/);
  // the Create Quote page: a typed customer, the required phone and e-mail
  const form = page.getByTestId("quote-form");
  await page.locator("#inv-account").fill(`Quote Buyer ${stamp}`);
  await page.locator("#q-phone").fill("+2348031234567");
  await page.locator("#q-email").fill(`buyer${stamp}@example.test`);
  // the product search of row 1 lists the brand's products; picking one takes its price-book price
  await form.getByLabel("Row 1, Product Name").click();
  await page.getByTestId("product-options").getByRole("option").first().click();
  await expect(form.getByLabel("Row 1, List Price")).not.toHaveValue("");
  await page.getByTestId("q-save").click();
  await expect(page).toHaveURL(/\/quotes\/(?!new$)[a-z0-9]+$/);
  await expect(page.getByTestId("grand-total")).not.toHaveText("0.00");
});

test("API: minimal quote, sales order and invoice; link later is refused across brands; another brand gets 404", async ({ page, browser }) => {
  await login(page, "exec.multi.1");
  const me = (await (await page.request.get("/api/v1/me")).json()) as { data: { memberships: Array<{ brandId: string; regionId: string | null }> } };
  const hmnl = (await page.getByTestId("brand-switcher").locator("option", { hasText: /^HMNL/ }).getAttribute("value"))!;
  const snmnl = (await page.getByTestId("brand-switcher").locator("option", { hasText: /^SNMNL/ }).getAttribute("value"))!;
  const regionId = me.data.memberships.find((m) => m.brandId === hmnl && m.regionId)!.regionId;
  const body = (brandId: string) => ({ brandId, regionId, billTo: { name: `API Buyer ${stamp}` }, lines: [{ description: "Service pack", qty: 1, unitPrice: 150000 }] });
  const made: Record<string, string> = {};
  for (const [path, key] of [["quotes", "quote"], ["sales-orders", "order"], ["invoices", "invoice"]] as const) {
    const res = await page.request.post(`/api/v1/${path}`, { data: body(hmnl) });
    expect(res.status(), path).toBe(201);
    const data = ((await res.json()) as { data: { id: string; number: string; linkStatus: string; total: number } }).data;
    expect(data.linkStatus).toBe("Unlinked");
    expect(data.total).toBe(161250);
    made[key] = data.id;
  }
  // an SNMNL deal cannot be linked to an HMNL quote
  const snDeals = (await (await page.request.get(`/api/v1/deals?brandId=${snmnl}`)).json()) as { data: Array<{ id: string }> };
  const refused = await page.request.post(`/api/v1/quotes/${made.quote}/link`, { data: { dealId: snDeals.data[0]!.id } });
  expect(refused.status()).toBe(403);
  // a quote as the source of the order works
  const linked = await page.request.post(`/api/v1/sales-orders/${made.order}/link`, { data: { sourceDocumentId: made.quote } });
  expect(linked.status()).toBe(200);
  expect(((await linked.json()) as { data: { linkStatus: string } }).data.linkStatus).toBe("Linked");

  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await login(other, "exec.snmnl.1");
  expect((await other.request.get(`/api/v1/invoices/${made.invoice}`)).status()).toBe(404);
  expect((await other.request.post(`/api/v1/invoices/${made.invoice}/link`, { data: { accountId: null } })).status()).toBe(404);
  expect((await other.goto(`/invoices/${made.invoice}`))?.status()).toBe(404);
  await ctx.close();
});

test("Setup → Dependencies: 'Require a sales order before an invoice' blocks a standalone invoice of that brand", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/setup/document-dependencies");
  const brandSelect = page.locator('main select[name="brand"]');
  const hmnl = (await brandSelect.locator("option", { hasText: /^HMNL/ }).getAttribute("value"))!;
  await page.goto(`/setup/document-dependencies?brand=${hmnl}`);
  const rule = page.getByLabel("Require a sales order before an invoice");
  try {
    await rule.check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Dependencies saved").first()).toBeVisible();
    // the administrator has no region of their own: take the region of one of the brand's deals
    const regionId = ((await (await page.request.get(`/api/v1/deals?brandId=${hmnl}`)).json()) as { data: Array<{ regionId: string }> }).data[0]!.regionId;
    const res = await page.request.post("/api/v1/invoices", { data: { brandId: hmnl, regionId, billTo: { name: "Blocked" }, lines: [{ description: "X", qty: 1, unitPrice: 1 }] } });
    expect(res.status()).toBe(403);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain("from sales orders only");
  } finally {
    await page.goto(`/setup/document-dependencies?brand=${hmnl}`);
    await page.getByLabel("Require a sales order before an invoice").uncheck();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Dependencies saved").first()).toBeVisible();
  }
});

test("a lead can be a company enquiry without a last name", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  await page.goto("/leads/new");
  await page.locator('input[name="company"]').fill(`Company Lead ${stamp}`);
  await page.locator('input[name="mobile"]').fill(`+23481${String(stamp).slice(-8)}`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/leads\/(?!new$)[a-z0-9]+$/);
  await expect(page.getByTestId("record-header")).toContainText(`Company Lead ${stamp}`);
});
