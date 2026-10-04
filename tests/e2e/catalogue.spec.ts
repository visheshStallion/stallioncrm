import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("HMNL exec: catalogue and product picker API show HMNL only; read-only", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  await page.goto("/products");
  const cards = page.getByTestId("product-card");
  await expect(cards.first()).toBeVisible(); // 6 vehicles + 20 parts and accessories (prompt 16), paged
  expect(new Set((await cards.getByTestId("brand-badge").allInnerTexts()).map((t) => t.trim()))).toEqual(new Set(["HMNL"]));
  await expect(page.getByRole("link", { name: "Create Product" })).toHaveCount(0);

  const api = (await (await page.request.get("/api/v1/products?per=100")).json()) as { data: Array<{ id: string; brandId: string }>; meta: { total: number } };
  expect(api.meta.total).toBe(26);
  expect(new Set(api.data.map((p) => p.brandId)).size).toBe(1);

  // another brand's product: found via management, 404 for the exec (UI + API); creating is forbidden
  const ctx2 = await page.context().browser()!.newContext();
  const md = await ctx2.newPage();
  await login(md, "md");
  const all = (await (await md.request.get("/api/v1/products?per=100")).json()) as { data: Array<{ id: string; brandId: string }>; meta: { total: number } };
  expect(all.meta.total).toBe(130);
  const foreign = all.data.find((p) => p.brandId !== api.data[0]!.brandId)!;
  await ctx2.close();
  expect((await page.request.get(`/api/v1/products/${foreign.id}`)).status()).toBe(404);
  expect((await page.goto(`/products/${foreign.id}`))?.status()).toBe(404);
  expect((await page.request.post("/api/v1/products", { data: { brandId: api.data[0]!.brandId, code: "X-1", model: "X" } })).status()).toBe(403);

  // price resolution endpoint
  const price = (await (await page.request.get(`/api/v1/products/price?productId=${(api.data as Array<{ id: string; category?: string }>).find((p) => p.category === "VEHICLE")!.id}&date=2026-10-04`)).json()) as { data: { source: string; price: number } };
  expect(price.data.source).toBe("priceBook");
});

test("Brand Manager manages own brand's price book", async ({ page }) => {
  await login(page, "bm.hmnl");
  await page.goto("/priceBooks");
  await expect(page.getByTestId("data-row")).toHaveCount(1);
  await page.getByTestId("data-row").getByRole("link").click();
  await expect(page.getByTestId("price-entries").locator("tbody tr")).toHaveCount(6);
  await page.getByLabel("Price CSV text").fill("code,price\nHMNL-SUV-STA,40000000\nNOPE-1,5");
  await page.getByRole("button", { name: "Dry run" }).click();
  await expect(page.getByTestId("price-import-preview")).toContainText("Unknown product code for this brand");
  await page.getByRole("button", { name: "Import 1 price(s)" }).click();
  await expect(page.getByLabel("Price for HMNL-SUV-STA")).toHaveValue("40000000");
});
