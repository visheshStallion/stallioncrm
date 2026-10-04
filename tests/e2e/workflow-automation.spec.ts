import { expect, test, type Page } from "@playwright/test";
import { login, signOut } from "./helpers";

type Me = { data: { userId: string; memberships: Array<{ brandId: string; regionId: string }> } };
const me = async (page: Page) => ((await (await page.request.get("/api/v1/me")).json()) as Me).data;

test("brand change: requested on the deal, locked while pending, approved by both Brand Managers, then moved", async ({ page }) => {
  await login(page, "exec.multi.1"); // HMNL + SNMNL Lagos
  const { memberships } = await me(page);
  // the brand switcher lists the user's brands (option value = brand id)
  const hmnl = (await page.getByTestId("brand-switcher").locator("option", { hasText: /^HMNL/ }).getAttribute("value")) ?? "";
  expect(hmnl).not.toBe("");
  const name = `E2E Brand change ${Date.now()}`;
  const created = await page.request.post("/api/v1/deals", { data: { name, brandId: hmnl, regionId: memberships[0]!.regionId } });
  expect(created.status()).toBe(201);
  const dealId = ((await created.json()) as { data: { id: string } }).data.id;

  await page.goto(`/deals/${dealId}`);
  await page.getByTestId("move-record").locator("summary").click();
  const newBrand = page.locator("#newBrandId");
  await newBrand.selectOption((await newBrand.locator("option", { hasText: /^SNMNL/ }).getAttribute("value"))!);
  await page.locator("#bc-reason").fill("Customer switched brand");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Request brand change" }).click();
  const banner = page.getByTestId("approval-banner");
  await expect(banner).toContainText("Brand change pending");
  await expect(banner).toContainText("HMNL → SNMNL");
  // locked: no edit, no move form; the API refuses changes too
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("move-record")).toHaveCount(0);
  const patch = await page.request.patch(`/api/v1/deals/${dealId}`, { data: { colour: "Blue" } });
  expect(patch.status()).toBe(409);
  await signOut(page);

  // the NEW brand's manager sees the request in the inbox (and in the rail badge) although the deal is HMNL's
  await login(page, "bm.snmnl");
  await expect(page.getByTestId("rail-badge-approvals")).toBeVisible();
  await page.goto("/approvals");
  const task = page.getByTestId("approval-task").filter({ hasText: name });
  await expect(task).toContainText("Brand change");
  expect((await page.request.get(`/api/v1/deals/${dealId}`)).status()).toBe(404);
  await task.getByLabel("Decision comment").fill("Fine with us");
  await task.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("approval-task").filter({ hasText: name })).toHaveCount(0);
  expect((await page.request.get(`/api/v1/deals/${dealId}`)).status()).toBe(404); // still waiting for HMNL
  await signOut(page);

  // another brand's manager has nothing to decide
  await login(page, "bm.thpl");
  await page.goto("/approvals");
  await expect(page.locator("main")).not.toContainText(name);
  await signOut(page);

  await login(page, "bm.hmnl");
  await page.goto(`/deals/${dealId}`);
  await page.getByTestId("approval-banner").getByRole("button", { name: "Approve" }).click();
  // the deal now belongs to SNMNL: the HMNL manager loses it
  await expect.poll(async () => (await page.request.get(`/api/v1/deals/${dealId}`)).status()).toBe(404);
  await page.goto("/"); // the deal page itself is now a 404 for this user
  await signOut(page);

  await login(page, "exec.multi.1");
  await page.goto(`/deals/${dealId}`);
  await expect(page.getByTestId("record-header").getByTestId("brand-badge")).toHaveText("SNMNL");
  await expect(page.getByTestId("approval-banner")).toHaveCount(0);
  await page.goto("/approvals?tab=submitted");
  await expect(page.getByTestId("approval-submitted")).toContainText("Approved");
});

test("admin: rule builder creates a rule that runs for new records; run log; processes; non-admins get 404", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/admin/workflows");
  const rules = page.getByTestId("workflow-rules");
  await expect(rules).toContainText("Deal not updated for 7 days");
  await expect(rules).toContainText("Hot lead not contacted in 2 hours");
  await expect(rules).toContainText("Deal Closed Won follow-up");

  const ruleName = `E2E lead rule ${Date.now()}`;
  await page.getByRole("link", { name: "Create Rule" }).click();
  await page.getByLabel("Name", { exact: true }).fill(ruleName);
  await page.getByLabel("Module", { exact: true }).selectOption("leads");
  await page.getByLabel("Brand scope").selectOption({ index: 0 });
  // criteria: source is WALK_IN
  const criteria = page.getByTestId("criteria-builder");
  await criteria.getByRole("button", { name: "Add condition" }).first().click();
  await criteria.getByLabel("Field").selectOption("source");
  await criteria.getByLabel("Value").selectOption("WALK_IN");
  // action: notify the owner
  const actions = page.getByTestId("actions-builder");
  await actions.getByLabel("Add action").selectOption("SEND_NOTIFICATION");
  await actions.getByLabel("Notification title").fill("Rule fired for {{name}}");
  await page.getByRole("button", { name: "Save Rule" }).click();
  await expect(page).toHaveURL(/\/admin\/workflows$/);
  await expect(page.getByTestId("workflow-rules")).toContainText(ruleName);

  await page.goto("/admin/approval-processes");
  await expect(page.getByTestId("process-DISCOUNT")).toContainText("Head of Sales");
  await expect(page.getByTestId("process-BRAND_CHANGE")).toContainText("Brand Manager of the NEW brand");
  await signOut(page);

  // a sales exec creates a walk-in lead → the rule notifies them
  await login(page, "exec.hmnl.1");
  for (const path of ["/admin/workflows", "/admin/workflows/new", "/admin/jobs", "/admin/approval-processes"]) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
  const { memberships } = await me(page);
  const last = `Workflow ${Date.now()}`;
  const lead = await page.request.post("/api/v1/leads", { data: { firstName: "E2E", lastName: last, mobile: `+23480${String(Date.now()).slice(-8)}`, source: "WALK_IN", brandId: memberships[0]!.brandId, regionId: memberships[0]!.regionId } });
  expect(lead.status()).toBe(201);
  await expect
    .poll(
      async () => {
        await page.goto("/");
        await page.getByRole("button", { name: /Notifications \(\d+\)/ }).click();
        return page.getByTestId("notifications").innerText().catch(() => "");
      },
      { timeout: 20_000 },
    )
    .toContain(`Rule fired for E2E ${last}`);
  await signOut(page);

  await login(page, "admin");
  await page.goto("/admin/jobs");
  await expect(page.getByTestId("job-log")).toContainText(ruleName);
  await expect(page.getByTestId("job-log")).toContainText("SEND_NOTIFICATION: notified 1");
  await page.getByRole("button", { name: "Run scheduler now" }).click();
  await expect(page.getByText(/Scheduler ran:/)).toBeVisible();
  // clean up: deactivate the rule
  await page.goto("/admin/workflows");
  await page.getByRole("row", { name: new RegExp(ruleName) }).getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByRole("row", { name: new RegExp(ruleName) })).toContainText("Inactive");
});
