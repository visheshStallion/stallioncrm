import { expect, test, type Page } from "@playwright/test";
import { login, signOut } from "./helpers";

const brandsInTable = async (page: Page) => [...new Set(await page.getByTestId("report-table").locator("tbody tr td:first-child").allInnerTexts())].sort();

test("standard report: each viewer sees their own data; export only with the export permission", async ({ page }) => {
  await login(page, "hos");
  await page.goto("/reports");
  await expect(page.getByTestId("folder-standard").getByRole("listitem")).toHaveCount(12);
  await page.getByRole("link", { name: "Pipeline by stage and brand" }).click();
  await expect(page.getByTestId("chart")).toBeVisible();
  expect(await brandsInTable(page)).toEqual(["HMNL", "SMGL", "SNMNL", "THPL", "ZANL"]);
  // export: CSV and XLSX for management
  const csv = await page.request.get(await page.getByTestId("export-csv").getAttribute("href").then((h) => h!));
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("Brand,Stage,Records");
  const xlsx = await page.request.get(await page.getByTestId("export-xlsx").getAttribute("href").then((h) => h!));
  expect(xlsx.status()).toBe(200);
  expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK");
  // the brand switcher narrows the report
  await page.getByTestId("brand-switcher").selectOption({ label: "ZANL – ZANL" });
  await expect.poll(() => brandsInTable(page)).toEqual(["ZANL"]);
  await page.getByTestId("brand-switcher").selectOption({ label: "All my brands" });
  await signOut(page);

  await login(page, "bm.hmnl");
  await page.goto("/reports/pipeline-by-stage-brand");
  expect(await brandsInTable(page)).toEqual(["HMNL"]);
  await expect(page.getByTestId("export-csv")).toBeVisible();
  await signOut(page);

  await login(page, "exec.abuja");
  const api = (await (await page.request.get("/api/v1/reports/won-by-brand-region-month?preset=ALL")).json()) as { data: { rows: Array<Array<string | number>> } };
  expect([...new Set(api.data.rows.map((r) => r[1]))].every((region) => region === "Abuja")).toBe(true);
  // Sales Exec profile: no export buttons, and the API refuses
  await page.goto("/reports/pipeline-by-stage-brand");
  await expect(page.getByTestId("report-table")).toBeVisible();
  await expect(page.getByTestId("export-csv")).toHaveCount(0);
  expect((await page.request.get("/api/v1/reports/pipeline-by-stage-brand/export?format=csv")).status()).toBe(403);
  expect((await page.request.get("/api/v1/reports/pipeline-by-stage-brand/export?format=xlsx")).status()).toBe(403);
});

test("report builder: a report shared by the Head of Sales shows an exec only the exec's data", async ({ page }) => {
  const name = `E2E deals by brand ${Date.now()}`;
  await login(page, "hos");
  await page.goto("/reports");
  await page.getByRole("link", { name: "Create Report" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Folder").selectOption("GROUP");
  // filter: stage type is OPEN
  const filters = page.getByTestId("report-filters");
  await filters.getByRole("button", { name: "Add filter" }).click();
  await filters.getByLabel("Filter field").selectOption("stageType");
  await filters.getByLabel("Filter value").selectOption("OPEN");
  // grouping: brand → region, summaries: count + sum of amount, bar chart
  const grouping = page.getByTestId("report-grouping");
  await grouping.getByRole("button", { name: "Add grouping level" }).click();
  await grouping.getByLabel("Group level 1").selectOption("brand");
  await grouping.getByRole("button", { name: "Add grouping level" }).click();
  await grouping.getByLabel("Group level 2").selectOption("region");
  await grouping.getByRole("button", { name: "Add summary" }).click();
  await grouping.getByLabel("Summary field").selectOption("amount");
  await page.getByRole("button", { name: "Save and Run" }).click();
  await expect(page).toHaveURL(/\/reports\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByTestId("chart")).toBeVisible();
  expect(await brandsInTable(page)).toEqual(["HMNL", "SMGL", "SNMNL", "THPL", "ZANL"]);
  const url = page.url();
  await signOut(page);

  // the exec opens the shared report: same definition, only their brand and region
  await login(page, "exec.snmnl.1");
  await page.goto("/reports");
  await page.getByTestId("folder-group").getByRole("link", { name }).click();
  await expect(page).toHaveURL(url);
  await expect(page.getByTestId("report-scope")).toContainText("shared by");
  expect(await brandsInTable(page)).toEqual(["SNMNL"]);
  expect([...new Set(await page.getByTestId("report-table").locator("tbody tr td:nth-child(2)").allInnerTexts())]).toEqual(["Lagos"]);
  // not the owner: no Edit, the edit page is forbidden
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  expect((await page.goto(`${url}/edit`))?.status()).toBe(403);
  await page.goto("/");
  await signOut(page);

  // private reports of others are a 404
  await login(page, "bm.hmnl");
  const created = await page.request.post("/api/v1/reports", { data: { name: `Private ${Date.now()}`, definition: { module: "leads", groupBy: [{ field: "status" }], filters: [] } } });
  expect(created.status()).toBe(201);
  const privateId = ((await created.json()) as { data: { id: string } }).data.id;
  await signOut(page);
  await login(page, "hos");
  expect((await page.goto(`/reports/${privateId}`))?.status()).toBe(404);
  expect((await page.request.get(`/api/v1/reports/${privateId}`)).status()).toBe(404);
});

test("dashboards and forecasts follow the viewer", async ({ page }) => {
  await login(page, "hos");
  await page.goto("/dashboards");
  await expect(page.getByTestId("dashboard")).toHaveAttribute("data-dashboard", "group");
  await expect(page.getByTestId("widget-stages").getByTestId("chart")).toBeVisible();
  await expect(page.getByTestId("widget-target").getByTestId("target-meter")).toBeVisible();
  await expect(page.getByTestId("kpi-pipeline")).toContainText("₦");
  const groupPipeline = await page.getByTestId("kpi-pipeline").innerText();
  await signOut(page);

  await login(page, "bm.hmnl");
  await page.goto("/dashboards");
  await expect(page.getByTestId("dashboard")).toHaveAttribute("data-dashboard", "brand");
  expect(await page.getByTestId("kpi-pipeline").innerText()).not.toBe(groupPipeline);
  // the same Group dashboard shows the Brand Manager one brand
  await page.getByRole("link", { name: "Group", exact: true }).click();
  await expect(page.getByTestId("dashboard")).toHaveAttribute("data-dashboard", "group");
  await expect(page.getByTestId("widget-stages").getByTestId("chart").getByRole("img")).toHaveAttribute("aria-label", /HMNL/);
  await expect(page.getByTestId("widget-stages").getByTestId("chart").getByRole("img")).not.toHaveAttribute("aria-label", /SNMNL/);

  // forecasts: the Brand Manager sets the brand target
  await page.goto("/forecasts");
  const form = page.getByTestId("target-form");
  await form.getByLabel("Units").fill("12");
  await form.getByLabel("Revenue (₦)").fill("750000000");
  await form.getByRole("button", { name: "Save target" }).click();
  const brandRow = page.getByTestId("forecast-table").locator('tr[data-level="brand"]');
  await expect(brandRow).toHaveCount(1);
  await expect(brandRow).toContainText("HMNL");
  await expect(brandRow).toContainText("₦ 750M");
  // drill-down to a region and its execs
  await page.getByTestId("forecast-table").locator('tr[data-level="region"]').first().getByRole("link").click();
  await expect(page.getByTestId("forecast-table").locator('tr[data-level="user"]').first()).toBeVisible();
  await page.getByRole("link", { name: "Quarter" }).click();
  await expect(page.getByTestId("forecast-period")).toHaveText(/^Q[1-4] \d{4}$/);
  await signOut(page);

  await login(page, "exec.hmnl.1");
  await page.goto("/dashboards");
  await expect(page.getByTestId("dashboard")).toHaveAttribute("data-dashboard", "my");
  await page.goto("/forecasts");
  await expect(page.getByTestId("forecast-table")).toBeVisible();
  await expect(page.getByTestId("target-form")).toHaveCount(0); // execs do not set targets
  expect((await page.request.post("/api/v1/forecasts", { data: { period: "2026-10", brandId: "x", revenue: 1 } })).status()).toBe(403);
});
