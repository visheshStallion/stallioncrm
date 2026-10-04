import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("quote: create from a deal, discount needs approval, Brand Manager approves, PDF; other brands get 404", async ({ page, browser }) => {
  await login(page, "exec.hmnl.1");
  const me = (await (await page.request.get("/api/v1/me")).json()) as { data: { memberships: Array<{ brandId: string; regionId: string }> } };
  const { brandId, regionId } = me.data.memberships[0]!;
  const products = (await (await page.request.get("/api/v1/products?per=50")).json()) as { data: Array<{ id: string }> };
  const created = await page.request.post("/api/v1/deals", { data: { name: `E2E Quote deal ${Date.now()}`, brandId, regionId, modelId: products.data[0]!.id } });
  const dealId = ((await created.json()) as { data: { id: string } }).data.id;

  await page.goto(`/deals/${dealId}`);
  await page.getByRole("button", { name: "Create Quote" }).click();
  // the first hit compiles the quote page on the dev server – allow for a loaded machine
  await expect(page).toHaveURL(/\/quotes\//, { timeout: 20_000 });
  const quoteUrl = page.url();
  const quoteId = quoteUrl.split("/").pop()!;
  await expect(page.getByTestId("record-header")).toContainText(/HMNL-QT-\d{4}-\d{5}/);
  await expect(page.getByTestId("doc-line")).toHaveCount(1);

  // 5 % discount is above the 3 % brand threshold → warning, then Pending Approval on submit
  await page.getByLabel("Discount % line 1").fill("5");
  await expect(page.getByTestId("discount-warnings")).toContainText("needs approval");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByTestId("approval-banner")).toContainText("Pending approval");
  await expect(page.getByRole("button", { name: "Mark as Sent" })).toHaveCount(0);

  // PDF on the brand template
  const pdf = await page.request.get(`/api/v1/quotes/${quoteId}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  // The HMNL Brand Manager approves
  const bmCtx = await browser.newContext();
  const bm = await bmCtx.newPage();
  await login(bm, "bm.hmnl");
  await bm.goto(quoteUrl);
  await bm.getByRole("button", { name: "Approve" }).click();
  await expect(bm.getByTestId("status-pill").first()).toHaveText("Approved");
  await bmCtx.close();

  // Another brand's exec: 404 for page, API and PDF
  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await login(other, "exec.snmnl.1");
  expect((await other.goto(quoteUrl))?.status()).toBe(404);
  expect((await other.request.get(`/api/v1/quotes/${quoteId}`)).status()).toBe(404);
  expect((await other.request.get(`/api/v1/quotes/${quoteId}/pdf`)).status()).toBe(404);
  await otherCtx.close();

  // Back as the exec: now it can be sent and accepted, then converted
  await page.reload();
  await page.getByRole("button", { name: "Mark as Sent" }).click();
  await page.getByRole("button", { name: "Accepted by customer" }).click();
  await page.getByRole("button", { name: "Create Sales Order" }).click();
  await expect(page).toHaveURL(/\/salesOrders\//);
  await expect(page.getByTestId("record-header")).toContainText(/HMNL-SO-\d{4}-\d{5}/);

  // the deal lists its documents
  await page.goto(`/deals/${dealId}`);
  await expect(page.getByTestId("deal-documents")).toContainText("HMNL-QT-");
  await expect(page.getByTestId("deal-documents")).toContainText("HMNL-SO-");
});
