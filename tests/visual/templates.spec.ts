/**
 * Visual regression baselines for the page templates (prompt 17 §8), light and dark.
 * Dynamic content (dates relative to today, counters) is masked.
 */
import { expect, test, type Page } from "@playwright/test";
import { login } from "../e2e/helpers";

const PAGES: Array<{ name: string; path: string; ready: (p: Page) => Promise<void>; mask?: (p: Page) => ReturnType<Page["locator"]>[] }> = [
  { name: "list-view", path: "/deals?view=all", ready: async (p) => void (await expect(p.getByTestId("data-row").first()).toBeVisible()) },
  { name: "kanban", path: "/deals?view=all&layout=kanban", ready: async (p) => void (await expect(p.getByTestId("kanban-card").first()).toBeVisible()) },
  {
    name: "record-detail",
    path: "/leads",
    ready: async (p) => {
      await p.getByTestId("data-row").first().getByRole("link").first().click();
      await expect(p.getByTestId("record-header")).toBeVisible();
    },
    mask: (p) => [p.locator('[data-field="Created"]')],
  },
  { name: "form", path: "/leads/new", ready: async (p) => void (await expect(p.getByTestId("form-footer")).toBeVisible()) },
  { name: "home", path: "/", ready: async (p) => void (await expect(p.getByTestId("home-widgets")).toBeVisible()), mask: (p) => [p.getByTestId("home-widget")] },
  { name: "setup", path: "/admin", ready: async (p) => void (await expect(p.getByTestId("setup-landing")).toBeVisible()) },
];

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    for (const pg of PAGES) {
      test(pg.name, async ({ page }) => {
        // Deterministic data: the admin sees everything and the setup gear.
        await login(page, "admin");
        await page.goto(pg.path);
        await pg.ready(page);
        await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
        await page.mouse.move(0, 0);
        await expect(page).toHaveScreenshot(`${pg.name}-${theme}.png`, { fullPage: false, mask: pg.mask?.(page) ?? [] });
      });
    }
  });
}
