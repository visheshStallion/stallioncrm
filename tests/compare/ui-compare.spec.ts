/**
 * `pnpm ui:compare` – layout calibration (docs/ZOHO_LAYOUT_SPEC.md §1).
 *
 * Renders our screens with the seed data at 1440×900 (light theme) into private/reference/ours/<screen>.png and,
 * for every reference screenshot private/reference/<screen>.png you saved, writes an overlay diff and one line in
 * private/reference/report.html (reference · ours · diff). The goal is the same structure and alignment – regions,
 * columns and controls in the same place – not identical pixels: text and data differ.
 *
 * The whole private/ folder is git-ignored; reference screenshots never leave this machine.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import { login } from "../e2e/helpers";

const DIR = path.resolve(__dirname, "../../private/reference");
const OURS = path.join(DIR, "ours");
const DIFF = path.join(DIR, "diff");

const firstDeal = async (p: Page) => {
  await p.goto("/deals?view=all");
  await p.getByTestId("data-row").first().getByRole("link").first().click();
  await expect(p.getByTestId("record-header")).toBeVisible();
};

/** Screen name = file name of the reference screenshot. */
const SCREENS: Array<{ name: string; open: (p: Page) => Promise<void> }> = [
  { name: "home", open: async (p) => void (await p.goto("/")) },
  {
    name: "deals-list",
    open: async (p) => {
      await p.goto("/deals?view=all");
      await expect(p.getByTestId("filter-panel")).toBeVisible();
    },
  },
  {
    name: "deals-kanban",
    open: async (p) => {
      await p.goto("/deals?view=all&layout=kanban");
      await expect(p.getByTestId("kanban-column").first()).toBeVisible();
    },
  },
  { name: "deal-detail-overview", open: firstDeal },
  // the empty one-row Ordered Items grid (prompt 24 §8)
  {
    name: "ordered-items",
    open: async (p) => {
      await p.goto("/salesOrders/new");
      await expect(p.getByTestId("line-items-grid")).toBeVisible();
    },
  },
  {
    name: "deal-detail-timeline",
    open: async (p) => {
      await firstDeal(p);
      await p.getByRole("link", { name: "Timeline" }).click();
      await expect(p).toHaveURL(/tab=timeline/);
    },
  },
  {
    name: "deal-create",
    open: async (p) => {
      await p.goto("/deals/new");
      await expect(p.getByTestId("form-footer")).toBeVisible();
    },
  },
  {
    name: "quick-create",
    open: async (p) => {
      await p.goto("/deals?view=all");
      await p.getByTestId("quick-create").click();
      await p.getByRole("menuitem", { name: "Deal" }).click();
      await expect(p.getByTestId("modal")).toBeVisible();
    },
  },
  {
    name: "setup-home",
    open: async (p) => {
      await p.goto("/admin");
      await expect(p.getByTestId("setup-landing")).toBeVisible();
    },
  },
  {
    name: "report",
    open: async (p) => {
      await p.goto("/reports");
      await p.getByTestId("folder-standard").getByRole("link").first().click();
      await p.waitForLoadState("networkidle");
    },
  },
  {
    name: "dashboard",
    open: async (p) => {
      await p.goto("/dashboards");
      await p.waitForLoadState("networkidle");
    },
  },
  {
    name: "user-menu",
    open: async (p) => {
      await p.goto("/");
      await p.getByTestId("avatar-menu").click();
    },
  },
  {
    name: "notifications",
    open: async (p) => {
      await p.goto("/");
      await p.getByRole("button", { name: /^Notifications/ }).click();
    },
  },
  {
    name: "global-search",
    open: async (p) => {
      await p.goto("/");
      await p.getByTestId("global-search").click();
      await p.getByLabel("Search query").fill("ZANL");
      await expect(p.getByTestId("search-palette-results").getByRole("option").first()).toBeVisible();
    },
  },
];

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  fs.mkdirSync(OURS, { recursive: true });
  fs.mkdirSync(DIFF, { recursive: true });
});

for (const screen of SCREENS) {
  test(`render ${screen.name}`, async ({ page }) => {
    await login(page, "admin");
    await screen.open(page);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: path.join(OURS, `${screen.name}.png`), animations: "disabled", caret: "hide" });
  });
}

test("write private/reference/report.html", async () => {
  const { default: pixelmatch } = await import("pixelmatch");
  const rows: string[] = [];
  for (const { name } of SCREENS) {
    const ours = path.join(OURS, `${name}.png`);
    const ref = path.join(DIR, `${name}.png`);
    if (!fs.existsSync(ours)) continue;
    let diffCell = `<td class="missing">no reference – save <code>private/reference/${name}.png</code> (1440×900, 100% zoom, light theme)</td>`;
    let refCell = `<td class="missing">—</td>`;
    let note = "";
    if (fs.existsSync(ref)) {
      const a = PNG.sync.read(fs.readFileSync(ref));
      const b = PNG.sync.read(fs.readFileSync(ours));
      refCell = `<td><img src="${name}.png" alt="reference"></td>`;
      if (a.width !== b.width || a.height !== b.height) {
        diffCell = `<td class="missing">reference is ${a.width}×${a.height}, ours is ${b.width}×${b.height} – retake the reference at 1440×900</td>`;
      } else {
        const out = new PNG({ width: a.width, height: a.height });
        // threshold 0.2 and anti-aliasing ignored: text and data differ, structure is what counts
        const changed = pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: 0.2, includeAA: false, alpha: 0.4 });
        fs.writeFileSync(path.join(DIFF, `${name}.png`), PNG.sync.write(out));
        note = `${((100 * changed) / (a.width * a.height)).toFixed(1)}% of pixels differ`;
        diffCell = `<td><img src="diff/${name}.png" alt="overlay diff"></td>`;
      }
    }
    rows.push(`<tr><th colspan="3">${name}${note ? ` – ${note}` : ""}</th></tr><tr>${refCell}<td><img src="ours/${name}.png" alt="ours"></td>${diffCell}</tr>`);
  }
  const html = `<!doctype html><meta charset="utf-8"><title>Layout comparison</title>
<style>body{font:13px system-ui;margin:16px;background:#f3f5f8;color:#313949}table{border-collapse:collapse;width:100%}th{text-align:left;padding:16px 4px 6px;font-size:15px}td{width:33.3%;padding:4px;vertical-align:top}img{width:100%;border:1px solid #cfd6de;background:#fff}.missing{color:#5b6472;font-style:italic}thead th{font-size:12px;color:#5b6472;padding:4px}</style>
<h1>Layout comparison (1440×900)</h1>
<p>Look for regions, columns and controls in the same position (±4 px). Text and data differ – identical pixels are not the goal.</p>
<table><thead><tr><th>Reference</th><th>Ours</th><th>Overlay diff</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  fs.writeFileSync(path.join(DIR, "report.html"), html);
  console.log(`Report: ${path.join(DIR, "report.html")}`);
});
