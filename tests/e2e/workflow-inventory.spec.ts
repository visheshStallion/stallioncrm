import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { makeVin } from "../../src/server/modules/inventory/vin";
import { login, signOut } from "./helpers";

const stamp = Date.now();
const vin1 = makeVin(`E2EXMD01RA${String(stamp).slice(-6)}`);
const vin2 = makeVin(`E2EYMD01RA${String(stamp).slice(-6)}`);

const data = async <T>(res: APIResponse) => ((await res.json()) as { data: T }).data;
async function relogin(page: Page, key: string) {
  await page.goto("/");
  await signOut(page);
  await login(page, key);
}
const act = (page: Page, id: string, action: string) => page.request.post(`/api/v1/inventory/documents/${id}/transition`, { data: { action } });

test("procurement to available stock: PO → shipment → clearing → receipt with VINs → landed cost → PDI; reserve from the sales view", async ({ page }) => {
  test.setTimeout(180_000);
  // ── logistics: purchase order in the editor
  await login(page, "logistics.hmnl");
  const me = await data<{ brandIds: string[] }>(await page.request.get("/api/v1/me"));
  const brandId = me.brandIds[0]!;
  const items = await data<Array<{ id: string; name: string; trackingType: string; code: string }>>(await page.request.get("/api/v1/inventory/items?limit=200"));
  const model = items.filter((i) => i.trackingType === "SERIAL").sort((a, b) => a.code.localeCompare(b.code))[0]!;
  const warehouses = await data<Array<{ id: string; code: string; name: string }>>(await page.request.get("/api/v1/inventory/warehouses"));
  const yard = warehouses.find((w) => w.code === "LAG-YARD")!;

  // the Create Purchase Order page (prompt 25): vendor, subject, ship to the yard, one line of 2 units
  await page.goto("/purchaseOrders/new");
  const form = page.getByTestId("po-form");
  await form.getByLabel("Subject").fill(`Two units ${stamp}`);
  await form.getByRole("button", { name: "Look up vendor name" }).click();
  await page.getByRole("listbox", { name: "Vendor Name options" }).getByRole("option").first().click();
  await page.locator("#po-currency").selectOption("NGN"); // the vendor invoices in its own currency; this order is in naira
  await page.getByTestId("copy-address").click();
  await page.getByRole("menuitem", { name: "Shipping from warehouse…" }).click();
  await page.getByRole("menuitem", { name: yard.name }).click();
  await form.getByLabel("Row 1, Product Name").click();
  await page.getByTestId("product-options").getByRole("option", { name: new RegExp(model.name) }).first().click();
  await form.getByLabel("Row 1, Quantity").fill("2");
  await form.getByLabel("Row 1, List Price").fill("30000000");
  await page.getByTestId("po-save").click();
  await expect(page).toHaveURL(/\/purchaseOrders\/c[a-z0-9]{20,}$/);
  const poId = page.url().split("/").pop()!;
  await expect(page.getByTestId("doc-number")).toHaveText(/^HMNL-PO-\d{4}-\d{5}$/);
  await expect(page.getByTestId("doc-total")).toContainText("64,500,000.00"); // 60m + 7.5 % VAT
  await page.getByTestId("doc-actions").getByRole("button", { name: "Submit" }).click();
  await expect(page.getByTestId("doc-status")).toHaveText("Approved"); // below the approval limit
  expect((await page.request.get(`/api/v1/inventory/documents/${poId}/pdf`)).headers()["content-type"]).toBe("application/pdf");

  // ── shipment with the VINs, through the port
  const shipment = await data<{ id: string }>(await page.request.post("/api/v1/inventory/shipments", { data: { brandId, parentId: poId, reference: `BL-E2E-${stamp}`, data: { vessel: "MV E2E" }, lines: [{ productId: model.id, vin: vin1, data: { colour: "Blue" } }, { productId: model.id, vin: vin2 }] } }));
  for (const expected of ["SHIPPED", "AT_PORT", "CLEARING", "CLEARED"]) expect((await data<{ status: string }>(await act(page, shipment.id, "advance"))).status).toBe(expected);
  await page.goto(`/inventory/units?q=${vin1}`);
  await expect(page.getByTestId("units-table")).toContainText("In clearing");

  // ── receipt and landed cost voucher (logistics enters, finance allocates)
  const bad = await page.request.post("/api/v1/inventory/receives", { data: { brandId, warehouseId: yard.id, lines: [{ productId: model.id, vin: "1M8GDM9A1KP042788", unitCost: 1 }] } });
  expect(bad.status()).toBe(400);
  const grn = await data<{ id: string }>(await page.request.post("/api/v1/inventory/receives", { data: { brandId, warehouseId: yard.id, parentId: shipment.id, currency: "USD", exchangeRate: 1500, lines: [{ productId: model.id, vin: vin1, unitCost: 20000 }, { productId: model.id, vin: vin2, unitCost: 20000 }] } }));
  expect((await data<{ status: string }>(await act(page, grn.id, "receive"))).status).toBe("RECEIVED");
  type Unit = { id: string; vin: string; status: string; purchaseCost: number };
  const u1 = await data<Unit>(await page.request.get(`/api/v1/inventory/lookup?vin=${vin1}`));
  const u2 = await data<Unit>(await page.request.get(`/api/v1/inventory/lookup?vin=${vin2}`));
  expect([u1.status, u1.purchaseCost]).toEqual(["PDI_PENDING", 30_000_000]);
  const lc = await data<{ id: string }>(await page.request.post("/api/v1/inventory/landed-costs", { data: { brandId, parentId: shipment.id, data: { method: "VALUE", unitIds: [u1.id, u2.id] }, lines: [{ description: "Customs duty", unitCost: 4_000_000 }] } }));
  expect((await act(page, lc.id, "allocate")).status()).toBe(403); // posting to the books is the accountant's

  await relogin(page, "acct.hmnl");
  await page.goto(`/inventory/documents/${lc.id}`);
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("doc-actions").getByRole("button", { name: "Allocate to vehicles" }).click();
  await expect(page.getByTestId("doc-status")).toHaveText("Allocated");
  await expect(page.getByTestId("doc-journals")).toContainText("1400 Inventory");
  await page.goto(`/inventory/units/${u1.id}`);
  await expect(page.getByTestId("unit-purchase-cost")).toContainText("30,000,000");
  await expect(page.getByTestId("unit-landed-cost")).toContainText("2,000,000");
  await page.goto("/inventory/journals");
  await expect(page.getByTestId("journals")).toContainText("Landed cost");

  // ── stock controller: PDI on the phone-sized checklist; sees no cost anywhere
  await relogin(page, "stock.hmnl");
  await page.goto(`/inventory/units/${u1.id}`);
  await expect(page.getByTestId("unit-status")).toHaveText("In stock – PDI pending");
  await expect(page.getByTestId("unit-purchase-cost")).toHaveCount(0);
  expect((await page.goto("/inventory/journals"))!.status()).toBe(403);
  await page.goto(`/inventory/units/${u1.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Start PDI" }).click();
  await expect(page.getByTestId("pdi-checklist")).toBeVisible();
  for (const box of await page.getByTestId("pdi-checklist").getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "Complete inspection" }).click();
  await expect(page.getByTestId("doc-status")).toHaveText("Passed");
  await page.goto(`/inventory/units/${u1.id}`);
  await expect(page.getByTestId("unit-status")).toHaveText("In stock – available");
  await expect(page.getByTestId("unit-history")).toContainText("PDI passed");

  // scanner lookup: own VIN is found, a VIN of another brand is "not found"
  await page.goto("/inventory/scan");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("VIN").fill(vin1);
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByTestId("scan-result")).toContainText(model.name);

  // ── sales executive: available to sell, VIN masked, no cost; reserve for a deal
  await relogin(page, "exec.hmnl.1");
  const unitApi = await page.request.get(`/api/v1/inventory/vehicle-units/${u1.id}`);
  const seen = await data<Record<string, unknown>>(unitApi);
  expect(seen.vin).toBe(`${"•".repeat(11)}${vin1.slice(-6)}`);
  expect(seen).not.toHaveProperty("totalCost");
  expect((await page.request.get(`/api/v1/inventory/vehicle-units/${u2.id}`)).status()).toBe(404); // still waiting for PDI: not for sale
  expect((await page.request.get("/api/v1/inventory/receives")).status()).toBe(403);
  expect((await page.request.get("/api/v1/inventory/journals")).status()).toBe(403);
  await page.goto(`/inventory/units?q=${vin1.slice(-6)}`);
  await expect(page.getByRole("heading", { name: "Available to sell" })).toBeVisible();
  await expect(page.getByTestId("units-table")).toContainText(vin1.slice(-6));
  await expect(page.getByTestId("units-table")).not.toContainText(vin1);
  await expect(page.getByTestId("units-table").getByText("Cost")).toHaveCount(0);

  const meExec = await data<{ memberships: Array<{ brandId: string; regionId: string }> }>(await page.request.get("/api/v1/me"));
  const deal = await data<{ id: string }>(await page.request.post("/api/v1/deals", { data: { name: `E2E stock deal ${stamp}`, brandId: meExec.memberships[0]!.brandId, regionId: meExec.memberships[0]!.regionId } }));
  await page.goto(`/inventory/units/${u1.id}`);
  await page.waitForLoadState("networkidle");
  await page.locator("#dealId").selectOption(deal.id);
  await page.getByRole("button", { name: "Reserve" }).click();
  await expect(page.getByTestId("unit-status")).toHaveText("Reserved");
  await expect(page.getByTestId("record-header")).toContainText(vin1); // their own unit now: full VIN
  await page.goto(`/deals/${deal.id}`);
  await expect(page.getByText(vin1).first()).toBeVisible();
  // a colleague can no longer reserve it
  expect((await page.request.post(`/api/v1/inventory/vehicle-units/${u1.id}/reserve`, { data: { dealId: deal.id } })).status()).toBe(400);
});

test("another brand's stock does not exist: SNMNL staff get 404 for HMNL units, documents and VIN lookups", async ({ page }) => {
  await login(page, "stock.hmnl");
  const hmnl = await data<Array<{ id: string; vin: string }>>(await page.request.get("/api/v1/inventory/vehicle-units?limit=5"));
  const docs = await data<Array<{ id: string }>>(await page.request.get("/api/v1/inventory/shipments?limit=5"));
  await relogin(page, "stock.snmnl");
  const own = await data<Array<{ brandId: string }>>(await page.request.get("/api/v1/inventory/vehicle-units?limit=200"));
  expect(own.length).toBeGreaterThan(0);
  expect(new Set(own.map((u) => u.brandId)).size).toBe(1);
  expect((await page.request.get(`/api/v1/inventory/vehicle-units/${hmnl[0]!.id}`)).status()).toBe(404);
  expect((await page.request.get(`/api/v1/inventory/lookup?vin=${hmnl[0]!.vin}`)).status()).toBe(404);
  expect((await page.request.get(`/api/v1/inventory/shipments/${docs[0]!.id}`)).status()).toBe(404);
  expect((await page.request.post(`/api/v1/inventory/documents/${docs[0]!.id}/transition`, { data: { action: "advance" } })).status()).toBe(404);
  expect((await page.goto(`/inventory/units/${hmnl[0]!.id}`))!.status()).toBe(404);
  expect((await page.goto(`/inventory/documents/${docs[0]!.id}`))!.status()).toBe(404);
  await page.goto("/inventory/scan");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("VIN").fill(hmnl[0]!.vin);
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByTestId("scan-message")).toContainText("Not found");
  // dashboard and settings show the own brand only
  await page.goto("/inventory");
  await expect(page.getByTestId("stock-kpi").first()).toBeVisible();
  await expect(page.getByTestId("stock-value")).toHaveCount(0); // no cost tier for the stock controller
  await page.goto("/inventory/settings");
  await expect(page.getByTestId("warehouses")).toContainText("SNMNL");
  await expect(page.getByTestId("warehouses")).not.toContainText("HMNL");
});
