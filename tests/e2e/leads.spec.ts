import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const stamp = Date.now().toString(36);

test("web-to-lead → round-robin assignment → conversion; other brands cannot open it", async ({ page, request, browser }) => {
  // 1. Two leads from the public HMNL form, Abuja (no session; brand comes from the URL only)
  for (const n of [1, 2]) {
    const res = await request.post("/api/public/leads/HMNL", {
      data: { firstName: "E2E", lastName: `RR${n} ${stamp}`, mobile: `0809${stamp.length}00${n}${Math.floor(Math.random() * 1e4)}`, region: "Abuja", brandId: "forged" },
    });
    expect(res.status()).toBe(201);
  }

  // 2. Round-robin: each Abuja HMNL rep received exactly one
  for (const key of ["exec.abuja", "exec.abuja.2"]) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, key);
    await p.goto(`/leads?view=mine&q=${stamp}`);
    await expect(p.getByTestId("data-row")).toHaveCount(1);
    await ctx.close();
  }

  // 3. Convert as the owner
  await login(page, "exec.abuja");
  await page.goto(`/leads?view=mine&q=${stamp}`);
  await page.getByTestId("data-row").first().getByRole("link").first().click();
  await expect(page.getByTestId("record-header")).toContainText("HMNL");
  const leadUrl = page.url();
  await page.getByRole("link", { name: "Convert" }).click();
  await page.getByRole("button", { name: "Convert lead" }).click();
  await expect(page).toHaveURL(/\/deals\//);
  await expect(page.getByTestId("record-header")).toContainText("HMNL");

  // 4. An HMNL Lagos exec cannot open the Abuja lead (404 UI + API)
  const leadId = leadUrl.split("/").pop()!;
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByText("Sign in to continue")).toBeVisible();
  await login(page, "exec.hmnl.1");
  const res = await page.goto(`/leads/${leadId}`);
  expect(res?.status()).toBe(404);
  expect((await page.request.get(`/api/v1/leads/${leadId}`)).status()).toBe(404);
});

test("lead list: views, kanban and permission-aware actions", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  await page.goto("/leads");
  await expect(page.getByTestId("lead-views")).toContainText("My open leads");
  await expect(page.getByTestId("lead-views")).toContainText("Hot leads this week");
  const badges = await page.getByTestId("data-row").getByTestId("brand-badge").allInnerTexts();
  expect(new Set(badges.map((b) => b.trim()))).toEqual(new Set(["HMNL"]));
  // Sales Exec has no export / mass update
  await expect(page.getByRole("link", { name: "Export" })).toHaveCount(0);
  await page.goto("/leads?layout=kanban");
  await expect(page.getByTestId("kanban-column").filter({ hasText: "Contacted" })).toBeVisible();
  // Export forbidden via API too
  expect((await page.request.get("/api/v1/leads/export")).status()).toBe(403);
});

test("public form rejects unknown brands and honours the honeypot", async ({ request }) => {
  expect((await request.post("/api/public/leads/NOPE", { data: { lastName: "X", mobile: "08031110000", region: "Lagos" } })).status()).toBe(400);
  expect((await request.post("/api/public/leads/HMNL", { data: { lastName: "Bot", mobile: "08031110001", region: "Lagos", website: "x" } })).status()).toBe(201);
  const pre = await request.fetch("/api/public/leads/HMNL", { method: "OPTIONS" });
  expect(pre.headers()["access-control-allow-origin"]).toBe("*");
});
