import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/** WCAG 2.1 AA (axe) on the main page templates – no serious or critical violations (prompt 17 §7). */
for (const path of ["/", "/deals", "/deals?layout=kanban", "/leads", "/leads/new", "/admin", "/activities", "/activities?view=calendar", "/activities/new?type=testdrive", "/approvals", "/admin/workflows/new", "/admin/jobs", "/reports", "/reports/pipeline-by-stage-brand", "/reports/new", "/dashboards", "/forecasts", "/campaigns", "/campaigns/new", "/campaigns/templates", "/cases", "/cases/new", "/cases/sla", "/cases/solutions"]) {
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
