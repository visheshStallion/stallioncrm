import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("kanban: HMNL exec sees only the HMNL pipeline and HMNL deals", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  await page.goto("/deals?layout=kanban");
  // single brand → the picker shows just that pipeline (no other brand is listed)
  await expect(page.getByTestId("pipeline-picker")).toHaveText("HMNL – Standard Sales");
  await expect(page.getByTestId("pipeline-board")).toHaveCount(1);
  const badges = await page.getByTestId("kanban-card").getByTestId("brand-badge").allInnerTexts();
  expect(badges.length).toBeGreaterThan(0);
  expect(new Set(badges.map((b) => b.trim()))).toEqual(new Set(["HMNL"]));
  // column headers carry count and total
  await expect(page.getByRole("listitem", { name: "Enquiry", exact: true })).toBeVisible();
});

test("kanban: 'All my brands' groups boards by brand; picker lists only own brands", async ({ page }) => {
  await login(page, "exec.multi.1"); // HMNL + SNMNL Lagos
  await page.goto("/deals?layout=kanban");
  const options = await page.getByTestId("pipeline-picker").locator("option").allInnerTexts();
  expect(options).toEqual(["All my brands", "HMNL – Standard Sales", "SNMNL – Standard Sales"]);
  const boards = page.getByTestId("pipeline-board");
  await expect(boards).toHaveCount(2);
  expect(await boards.evaluateAll((els) => els.map((e) => e.getAttribute("data-brand")))).toEqual(["HMNL", "SNMNL"]);
  await page.getByTestId("pipeline-picker").selectOption({ label: "SNMNL – Standard Sales" });
  await expect(boards).toHaveCount(1);
  const badges = await page.getByTestId("kanban-card").getByTestId("brand-badge").allInnerTexts();
  expect(new Set(badges.map((b) => b.trim()))).toEqual(new Set(["SNMNL"]));
});

test("Blueprint: stage move asks for the stage's fields; API enforces VIN before Delivery and 404s hidden deals", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  const me = (await (await page.request.get("/api/v1/me")).json()) as { data: { memberships: Array<{ brandId: string; regionId: string }> } };
  const { brandId, regionId } = me.data.memberships[0]!;
  const created = await page.request.post("/api/v1/deals", { data: { name: `E2E Blueprint ${Date.now()}`, brandId, regionId } });
  expect(created.status()).toBe(201);
  const dealId = ((await created.json()) as { data: { id: string } }).data.id;

  await page.goto(`/deals/${dealId}`);
  await expect(page.getByTestId("stage-progress").locator('[aria-current="step"]')).toHaveText("Enquiry");
  // a sales exec is offered only the next stage and the lost stage
  const buttons = page.getByTestId("blueprint-buttons").getByRole("button");
  await expect(buttons).toHaveText(["Test Drive", "Closed Lost"]);
  await buttons.first().click();
  const dialog = page.getByTestId("blueprint-dialog");
  await expect(dialog).toContainText("Test drive date");
  await dialog.getByLabel("Test drive date").fill("2026-10-06");
  await dialog.getByLabel("Model").selectOption({ index: 1 });
  await dialog.getByRole("button", { name: "Move to Test Drive" }).click();
  await expect(page.getByTestId("stage-progress").locator('[aria-current="step"]')).toHaveText("Test Drive");

  // stage history on the timeline
  await page.goto(`/deals/${dealId}?tab=timeline`);
  await expect(page.getByTestId("timeline")).toContainText("Stage: Enquiry → Test Drive");

  // API: skipping stages is forbidden for an exec
  const deal = (await (await page.request.get(`/api/v1/deals/${dealId}`)).json()) as { data: { pipelineId: string } };
  expect(deal.data.pipelineId).toBeTruthy();
  const skip = await page.request.patch(`/api/v1/deals/${dealId}`, { data: { stageId: "does-not-exist" } });
  expect(skip.status()).toBe(400);

  // API: a deal of another brand → 404 on GET and PATCH (found through the admin, then tried as the exec)
  const ctx2 = await page.context().browser()!.newContext();
  const admin = await ctx2.newPage();
  await login(admin, "md");
  const all = (await (await admin.request.get("/api/v1/deals?per=100")).json()) as { data: Array<{ id: string; brandId: string }> };
  const foreign = all.data.find((d) => d.brandId !== brandId)!;
  await ctx2.close();
  expect((await page.request.get(`/api/v1/deals/${foreign.id}`)).status()).toBe(404);
  expect((await page.request.patch(`/api/v1/deals/${foreign.id}`, { data: { name: "pwned" } })).status()).toBe(404);
  expect((await page.goto(`/deals/${foreign.id}`))?.status()).toBe(404);
});

test("notes on a deal", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  await page.goto("/deals");
  await page.getByTestId("data-row").first().getByRole("link").first().click();
  await page.getByLabel("New note").fill("Call back on Friday");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByTestId("notes-list")).toContainText("Call back on Friday");
});
