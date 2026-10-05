import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/** WCAG 2.1 AA (axe) on the main page templates – no serious or critical violations (prompt 17 §7). */
for (const path of ["/", "/deals", "/deals?layout=kanban", "/leads", "/leads/new", "/admin", "/activities", "/activities?view=calendar", "/activities/new?type=testdrive", "/approvals", "/admin/workflows/new", "/admin/jobs", "/reports", "/reports/pipeline-by-stage-brand", "/reports/new", "/dashboards", "/forecasts", "/campaigns", "/campaigns/new", "/campaigns/templates", "/cases", "/cases/new", "/cases/sla", "/cases/solutions", "/imports", "/exports", "/admin/customization", "/tokens", "/admin/api", "/admin/webhooks", "/inventory", "/inventory/units", "/inventory/documents", "/inventory/documents/new?type=GRN&brand=HMNL", "/inventory/parts", "/inventory/journals", "/inventory/reports", "/inventory/settings", "/inventory/scan", "/notifications", "/quick", "/offline", "/search?q=sedan", "/security", "/admin/access-review", "/setup", "/setup/personal", "/setup/admin-tiers", "/setup/validation-rules", "/setup/data-sharing", "/setup/recycle-bin", "/setup/mass-operations", "/setup/approvals", "/setup/audit-trail", "/setup/health", "/setup/brand-members", "/setup/password-policy", "/setup/sandbox"]) {
  test(`a11y: ${path}`, async ({ page }) => {
    await login(page, "admin");
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  });
}

test("shell: rail only shows readable modules; Ctrl+K search; quick create; preferences", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  const rail = page.getByTestId("module-nav");
  await expect(rail.getByRole("link", { name: "Leads" })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Campaigns" })).toHaveCount(0); // no read permission
  await expect(page.getByTestId("setup-gear")).toHaveCount(0);

  // Ctrl+K palette searches through the scoped API
  await page.keyboard.press("Control+k");
  await page.getByLabel("Search query").fill("HMNL");
  await expect(page.getByTestId("search-palette-results")).toContainText("Deals");
  await page.keyboard.press("Escape");

  // Quick create offers Lead and Deal for a sales exec
  await page.getByTestId("quick-create").click();
  await expect(page.getByRole("menuitem", { name: "Lead" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Lead" }).click();
  await expect(page.getByRole("dialog", { name: "Quick create: Lead" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Dark theme + compact density are saved per user
  await page.getByTestId("avatar-menu").click();
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("keyboard: c opens create, / focuses the filter search", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  await page.goto("/leads");
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("/");
  await expect(page.getByLabel("Search records")).toBeFocused();
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("c");
  await expect(page).toHaveURL(/\/leads\/new/);
});

test("single brand selected → its badge sits at the top of the rail", async ({ page }) => {
  await login(page, "md");
  await page.getByTestId("brand-switcher").selectOption({ label: "SMGL – MG" });
  await expect(page.getByTestId("rail-brand")).toContainText("SMGL");
  await page.getByTestId("brand-switcher").selectOption({ label: "All my brands" });
  await expect(page.getByTestId("rail-brand")).toHaveCount(0);
});

test("the top bar shows the logos of the signed-in user's brands only", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  const logos = page.getByTestId("brand-logos").getByTestId("brand-logo");
  await expect(logos).toHaveCount(1);
  await expect(logos.first()).toHaveAttribute("data-brand", "HMNL");
  await expect(page.getByTestId("rail-brand")).toContainText("Hyundai");
  await page.goto("/deals");
  await expect(page.getByTestId("brand-logos").getByTestId("brand-logo")).toHaveCount(1);

});

test("a multi-brand user sees each of their brands' logos, narrowed by the brand switcher", async ({ page }) => {
  await login(page, "exec.multi.1");
  const codes = await page.getByTestId("brand-logos").getByTestId("brand-logo").evaluateAll((els) => els.map((e) => e.getAttribute("data-brand")).sort());
  expect(codes).toEqual(["HMNL", "SNMNL"]);
  await page.getByTestId("brand-switcher").selectOption({ label: "SNMNL – Nissan" });
  await expect(page.getByTestId("brand-logos").getByTestId("brand-logo")).toHaveCount(1);
  await expect(page.getByTestId("brand-logos").getByTestId("brand-logo").first()).toHaveAttribute("data-brand", "SNMNL");
  await page.getByTestId("brand-switcher").selectOption({ label: "All my brands" });
});

test("classic navigation: module tabs under the header instead of the sidebar, saved per user", async ({ page }) => {
  await login(page, "exec.hmnl.2");
  await expect(page.getByTestId("module-rail")).toBeVisible();
  await page.getByTestId("avatar-menu").click();
  await page.getByRole("radio", { name: "Classic tabs" }).click();
  await expect(page.getByTestId("classic-nav")).toBeVisible();
  await expect(page.getByTestId("module-rail")).toHaveCount(0);
  await page.getByTestId("classic-nav").getByRole("link", { name: "Deals" }).click();
  await expect(page).toHaveURL(/\/deals/);
  await expect(page.getByTestId("classic-nav").getByRole("link", { name: "Deals" })).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(page.getByTestId("classic-nav")).toBeVisible();
  // back to the default for the other tests
  await page.getByTestId("avatar-menu").click();
  await page.getByRole("radio", { name: "Sidebar" }).click();
  await expect(page.getByTestId("module-rail")).toBeVisible();
});

test("the filter panel toggle of a list is remembered per module", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  await page.goto("/leads");
  await expect(page.getByTestId("filter-panel")).toBeVisible();
  await page.getByTestId("filter-toggle").click();
  await expect(page.getByTestId("filter-panel")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("data-row").first()).toBeVisible();
  await expect(page.getByTestId("filter-panel")).toHaveCount(0);
  await page.goto("/deals");
  await expect(page.getByTestId("filter-panel")).toBeVisible();
});

test("the layout tokens are applied: 48px header, 60px sidebar, 13px base, 40px rows", async ({ page }) => {
  await login(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/deals?view=all");
  await expect(page.getByTestId("data-row").first()).toBeVisible();
  const box = async (testId: string) => (await page.getByTestId(testId).first().boundingBox())!;
  expect((await box("top-bar")).height).toBe(48);
  expect((await box("module-rail")).width).toBe(60);
  expect((await box("filter-panel")).width).toBe(260);
  expect((await box("data-row")).height).toBe(40);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("13px");
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?Lato/);
});
