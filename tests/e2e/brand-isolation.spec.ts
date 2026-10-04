import { expect, test, type Page } from "@playwright/test";
import { SEED_PASSWORD, email } from "../../prisma/seed-data";

async function login(page: Page, key: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email(key));
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

async function badgeTexts(page: Page) {
  return [...new Set(await page.getByTestId("data-row").getByTestId("brand-badge").allInnerTexts())]
    .map((t) => t.trim())
    .sort();
}

test("unauthenticated users are sent to /login; API returns 401", async ({ page, request }) => {
  await page.goto("/deals");
  await expect(page).toHaveURL(/\/login/);
  const res = await request.get("/api/v1/deals");
  expect(res.status()).toBe(401);
});

test("wrong password is rejected", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email("exec.hmnl.1"));
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
});

test("HMNL Lagos exec sees only HMNL deals; brand switcher lists only HMNL", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  await page.goto("/deals");
  await expect(page.getByTestId("deal-total")).toHaveText("5 deal(s) in your scope");
  expect(await badgeTexts(page)).toEqual(["HMNL"]);

  const options = await page.getByTestId("brand-switcher").locator("option").allInnerTexts();
  expect(options).toEqual(["All my brands", "HMNL – Hyundai"]);
  // Setup is not in the nav for a sales exec.
  await expect(page.getByTestId("module-nav")).not.toContainText("Setup");
});

test("HMNL exec cannot open an SNMNL deal (404) via UI or API, nor find it by search", async ({ page }) => {
  await login(page, "md");
  await page.goto("/search?q=SNMNL");
  const href = await page.getByTestId("search-hit").first().getAttribute("href");
  expect(href).toMatch(/^\/deals\//);
  const dealId = href!.split("/").pop()!;

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByText("Sign in to continue")).toBeVisible();
  await expect
    .poll(async () => (await page.context().cookies()).some((c) => c.name.includes("session-token")))
    .toBe(false);

  await login(page, "exec.hmnl.1");
  const res = await page.goto(`/deals/${dealId}`);
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Not found")).toBeVisible();

  const api = await page.request.get(`/api/v1/deals/${dealId}`);
  expect(api.status()).toBe(404);

  await page.goto("/search?q=SNMNL");
  await expect(page.getByTestId("search-results")).toContainText("No results in your scope");
});

test("Abuja exec sees all brands, Abuja only", async ({ page }) => {
  await login(page, "exec.abuja");
  await page.goto("/deals");
  await expect(page.getByTestId("deal-total")).toHaveText("25 deal(s) in your scope");
  expect(await badgeTexts(page)).toEqual(["HMNL", "SMGL", "SNMNL", "THPL", "ZANL"]);
  const regions = [...new Set(await page.getByTestId("data-row").getByTestId("region-badge").allInnerTexts())];
  expect(regions.map((r) => r.trim())).toEqual(["Abuja"]);
});

test("brand switcher narrows results (MD, filter to ZANL)", async ({ page }) => {
  await login(page, "md");
  await page.goto("/deals");
  await expect(page.getByTestId("deal-total")).toHaveText("100 deal(s) in your scope");
  await page.getByTestId("brand-switcher").selectOption({ label: "ZANL – ZANL" });
  await expect(page.getByTestId("deal-total")).toHaveText("20 deal(s) in your scope");
  await page.getByTestId("brand-switcher").selectOption({ label: "All my brands" });
  await expect(page.getByTestId("deal-total")).toHaveText("100 deal(s) in your scope");
});

test("sales exec gets 403 on setup", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  await page.goto("/setup");
  await expect(page.getByText("Access denied")).toBeVisible();
});
