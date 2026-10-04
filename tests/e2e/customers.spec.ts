import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("shared customer: HMNL exec sees only HMNL deals and tier-masked fields; API matches the UI", async ({ page }) => {
  await login(page, "exec.hmnl.1");

  // Find a customer the exec has a record with, and one they have none with (via the API list).
  const list = (await (await page.request.get("/api/v1/accounts?per=50")).json()) as { data: Array<{ id: string; name: string; tier: string; phone: string | null; email: string | null }> };
  const linked = list.data.find((a) => a.tier === "CONTACT");
  const basic = list.data.find((a) => a.tier === "BASIC");
  expect(linked, "a customer with an HMNL-Lagos deal").toBeTruthy();
  expect(basic, "a customer without one").toBeTruthy();

  // Contact tier: details visible, related deals are HMNL only, no sensitive fields
  await page.goto(`/accounts/${linked!.id}`);
  await expect(page.getByTestId("customer-tier")).toHaveAttribute("data-tier", "CONTACT");
  await expect(page.locator('[data-field="Email"]')).toHaveText(linked!.email!);
  await expect(page.locator('[data-field="Credit limit"]')).toHaveCount(0);
  const dealBadges = await page.getByTestId("related-deal").getByTestId("brand-badge").allInnerTexts();
  expect(dealBadges.length).toBeGreaterThan(0);
  expect(new Set(dealBadges.map((b) => b.trim()))).toEqual(new Set(["HMNL"]));
  await expect(page.getByTestId("customer-brands")).toContainText("HMNL");
  await expect(page.getByTestId("customer-brands")).not.toContainText("SNMNL");

  // Basic tier: masked phone, no email – and the API payload is identical to what the page shows
  await page.goto(`/accounts/${basic!.id}`);
  await expect(page.getByTestId("customer-tier")).toHaveAttribute("data-tier", "BASIC");
  await expect(page.locator('[data-field="Email"]')).toHaveCount(0);
  const api = (await (await page.request.get(`/api/v1/accounts/${basic!.id}`)).json()) as { data: { phone: string; email: string | null; creditLimit: number | null; deals: unknown[] } };
  expect(api.data.email).toBeNull();
  expect(api.data.creditLimit).toBeNull();
  expect(api.data.phone).toMatch(/\*{4}/);
  await expect(page.locator('[data-field="Phone"]')).toContainText(api.data.phone);
  expect(api.data.deals).toEqual([]);
  await expect(page.getByTestId("related-deal")).toHaveCount(0);

  // No export and no merge for a sales exec
  expect((await page.request.get("/api/v1/accounts/export")).status()).toBe(403);
  expect((await page.goto("/accounts/duplicates"))?.status()).toBe(404);
});

test("management sees the full record; administrator can open the merge wizard", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/accounts");
  await page.getByTestId("data-row").first().getByRole("link").first().click();
  await expect(page.getByTestId("customer-tier")).toHaveAttribute("data-tier", "SENSITIVE");
  await expect(page.locator('[data-field="Credit limit"]')).toBeVisible();
  await page.goto("/accounts/duplicates");
  await expect(page.getByRole("heading", { name: "Find & merge duplicate accounts" })).toBeVisible();
});

test("consent is recorded per brand", async ({ page }) => {
  await login(page, "exec.multi.1"); // sells HMNL and SNMNL
  await page.goto("/contacts");
  await page.getByTestId("data-row").first().getByRole("link").first().click();
  const rows = page.getByTestId("consent-row");
  await expect(rows).toHaveCount(2);
  await rows.filter({ hasText: "HMNL" }).getByRole("button", { name: "Opt out" }).click();
  await expect(rows.filter({ hasText: "HMNL" })).toContainText("Opted out");
  await expect(rows.filter({ hasText: "SNMNL" })).not.toContainText("Opted out");
});
