import { expect, test } from "@playwright/test";
import { login, signOut } from "./helpers";

/**
 * Templates hub and record templates (prompt 22) through the screens: the hub with its tabs and views, "New Template →
 * Select Module → Next", create-from-template with locked fields and tasks, brand isolation, "template required".
 */
const stamp = Date.now();
const SHARED = `HMNL showroom lead ${stamp}`;
let sharedUrl = "";

test.describe.configure({ mode: "serial" });

test("hub: tabs, a favourite, and New Template → Select Module (searchable, keyboard) → Next opens the editor", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  await page.goto("/templates");
  await expect(page.getByTestId("hub-tabs").getByRole("tab")).toHaveText([/^Email/, /^Document \/ Print/, /^Record/, /^SMS/, /^WhatsApp/]);
  await page.getByTestId("hub-tabs").getByRole("tab", { name: /^Record/ }).click();
  const row = page.getByTestId("hub-row").filter({ hasText: "Walk-in showroom enquiry" });
  await expect(row).toContainText("Leads");
  await expect(row).toContainText("Public");
  await expect(row).toContainText("Published");

  // ☆ favourite → the Favorites view of this user
  await row.getByTestId("hub-star").click();
  await expect(row.getByTestId("hub-star")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("hub-panel").getByRole("link", { name: /Favorites/ }).click();
  await expect(page.getByTestId("hub-row")).toHaveCount(1);
  await expect(page.getByTestId("hub-row")).toContainText("Walk-in showroom enquiry");
  // the row menu of a template the exec cannot change has no Delete
  await page.getByTestId("hub-row-menu").click();
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Clone" })).toBeVisible();
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // New Template: the type follows the tab; the module list has what the user can read; type to search, Enter to choose
  await page.getByTestId("new-template").click();
  const dialog = page.getByRole("dialog", { name: "Create Record Template" });
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("module-select").click();
  await expect(dialog.getByTestId("module-options").getByRole("option")).toHaveText(["Leads", "Contacts", "Accounts", "Deals", "Quotes", "Sales Orders", "Invoices", "Cases"]);
  await dialog.getByTestId("module-select").fill("dea");
  await expect(dialog.getByTestId("module-options").getByRole("option")).toHaveText(["Deals"]);
  await page.keyboard.press("Enter");
  await expect(dialog.getByTestId("module-select")).toHaveValue("Deals");
  await dialog.getByTestId("module-select").click();
  await expect(dialog.getByTestId("module-options").getByRole("option", { name: "Deals" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await dialog.getByLabel("Start from").selectOption({ label: "Fleet / corporate deal" });
  await dialog.getByTestId("new-template-next").click();
  await expect(page).toHaveURL(/\/templates\/records\/new\?module=deals&starter=fleet-deal/);
  await expect(page.getByTestId("record-template-editor").getByLabel("Template name")).toHaveValue("Fleet / corporate deal");
  await expect(page.getByTestId("rt-children").getByLabel("Subject").first()).toHaveValue("Credit check");

  // document tab: the dialog offers the printable modules, and Next goes to the document template builder
  await page.goto("/templates?tab=document");
  await page.getByTestId("new-template").click();
  const doc = page.getByRole("dialog", { name: "Create Document Template" });
  await doc.getByTestId("module-select").click();
  await doc.getByTestId("module-options").getByRole("option", { name: "Invoices" }).click();
  await doc.getByTestId("new-template-next").click();
  await expect(page).toHaveURL(/\/templates\/documents\/new\?module=invoices/);
});

test("a Brand Admin creates and publishes a shared record template with a locked field and a task", async ({ page }) => {
  await login(page, "ba.hmnl");
  await page.goto("/templates/records/new?module=leads");
  const editor = page.getByTestId("record-template-editor");
  await editor.getByLabel("Template name").fill(SHARED);
  await editor.getByLabel("Who uses the template").selectOption("SHARED_BRAND");
  await expect(editor.getByLabel("Brand / Company")).toContainText("HMNL");
  await editor.getByLabel("Source", { exact: true }).selectOption("EVENT");
  await editor.getByLabel("Lock Source", { exact: true }).check();
  await editor.getByLabel("Rating", { exact: true }).selectOption("HOT");
  await editor.getByLabel("Hide Rating", { exact: true }).check();
  await page.getByRole("button", { name: "+ Add task" }).click();
  await page.getByTestId("rt-children").getByLabel("Subject").fill("Call the visitor");
  await page.getByTestId("rt-save").click();
  await expect(page).toHaveURL(/\/templates\/records\/[a-z0-9]+$/);
  sharedUrl = new URL(page.url()).pathname;
  await expect(page.getByTestId("rt-status")).toContainText("Draft");
  await page.getByTestId("rt-actions").getByRole("button", { name: "Publish" }).click();
  await expect(page.getByTestId("rt-status")).toContainText("Published");
  await expect(page.getByTestId("rt-use")).toBeVisible();
});

test("Create Lead ▾ Create from template: pre-filled, the locked field cannot be changed, the task and the template link are stored", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  await page.goto("/leads");
  await page.getByRole("button", { name: "More create options" }).click();
  await page.getByRole("menuitem", { name: "Create from template" }).click();
  await expect(page).toHaveURL(/\/templates\/pick\?module=leads/);
  // the favourite of the first test comes first
  await expect(page.getByTestId("pick-row").first()).toContainText("★ Walk-in showroom enquiry");
  await page.getByTestId("pick-row").filter({ hasText: SHARED }).getByTestId("pick-use").click();
  await expect(page).toHaveURL(/\/leads\/new\?template=/);
  await expect(page.getByTestId("template-banner")).toContainText(SHARED);
  const source = page.locator('select[name="source"]');
  await expect(source).toHaveValue("EVENT");
  await expect(source).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator('[name="rating"]')).toBeHidden(); // hidden field: applied without being shown

  await page.locator('input[name="lastName"]').fill(`Templated ${stamp}`);
  await page.locator('input[name="mobile"]').fill(`+23480${String(stamp).slice(-8)}`);
  // even a tampered form cannot change a locked field: the server applies the template's value
  await source.evaluate((el: HTMLSelectElement) => {
    el.value = "FACEBOOK";
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/leads\/[a-z0-9]+$/);
  const id = page.url().split("/").pop()!;
  const lead = (await (await page.request.get(`/api/v1/leads/${id}`)).json()) as { data: { source: string; rating: string; lastName: string } };
  expect(lead.data).toMatchObject({ source: "EVENT", rating: "HOT", lastName: `Templated ${stamp}` });
  await expect(page.getByTestId("activity-panel")).toContainText("Call the visitor");
  await page.goto(sharedUrl);
  await expect(page.getByTestId("rt-usage")).toContainText("1 record created from it");
  await expect(page.getByTestId("rt-save")).toHaveCount(0); // the exec can use it, not change it

  // the API creates from a template too, and lists the hub
  const me = (await (await page.request.get("/api/v1/me")).json()) as { data: { memberships: Array<{ regionId: string | null }> } };
  const regionId = me.data.memberships.find((m) => m.regionId)!.regionId;
  const api = await page.request.post(`/api/v1/leads/from-template/${sharedUrl.split("/").pop()}`, { data: { lastName: `Api ${stamp}`, mobile: `+23481${String(stamp).slice(-8)}`, source: "PHONE", regionId } });
  expect(api.status()).toBe(201);
  const made = (await api.json()) as { data: { id: string; tasks: number; templateVersion: number } };
  expect(made.data).toMatchObject({ tasks: 1, templateVersion: 1 });
  expect(((await (await page.request.get(`/api/v1/leads/${made.data.id}`)).json()) as { data: { source: string } }).data.source).toBe("EVENT");
  const list = (await (await page.request.get("/api/v1/templates?type=record&module=leads")).json()) as { data: Array<{ name: string; type: string }> };
  expect(list.data.map((t) => t.name)).toEqual(expect.arrayContaining([SHARED, "Walk-in showroom enquiry"]));
  expect(list.data.every((t) => t.type === "record")).toBe(true);
});

test("another brand: the HMNL template is not in the hub, not in the picker, and its address is a 404", async ({ page }) => {
  await login(page, "exec.snmnl.1");
  await page.goto("/templates?tab=record");
  await expect(page.getByTestId("hub-list")).not.toContainText(SHARED);
  await expect(page.getByTestId("hub-list")).toContainText("Walk-in showroom enquiry"); // public templates are for everyone
  await page.goto("/templates/pick?module=leads");
  await expect(page.locator("main")).not.toContainText(SHARED);
  const id = sharedUrl.split("/").pop()!;
  expect((await page.goto(sharedUrl))?.status()).toBe(404);
  expect((await page.goto(`/leads/new?template=${id}`))?.status()).toBe(404);
  expect((await page.request.post(`/api/v1/leads/from-template/${id}`, { data: { lastName: "X", mobile: "+2348030001234" } })).status()).toBe(404);
  const list = (await (await page.request.get("/api/v1/templates?type=record")).json()) as { data: Array<{ name: string }> };
  expect(list.data.map((t) => t.name)).not.toContain(SHARED);
});

test("Setup: with 'template required' for leads the blank create is refused; from a template it works", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/setup/record-template-policy");
  const leads = page.getByLabel("Leads must be created from a template");
  try {
    await leads.check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Record template policy saved").first()).toBeVisible();
    const blank = await page.request.post("/api/v1/leads", { data: { lastName: "Blank", mobile: "+2348030009999", brandId: "x", regionId: "y" } });
    expect(blank.status()).toBe(403);
    expect(((await blank.json()) as { error: { message: string } }).error.message).toContain("created from a template");
    const id = sharedUrl.split("/").pop()!;
    const viaTemplate = await page.request.post(`/api/v1/leads/from-template/${id}`, { data: { lastName: `Required ${stamp}`, mobile: `+23482${String(stamp).slice(-8)}`, regionId: (await (await page.request.get("/api/v1/me")).json()).data.memberships.find((m: { regionId: string | null }) => m.regionId)?.regionId } });
    expect([201, 400]).toContain(viaTemplate.status()); // 400 only if the administrator has no region of their own – never the policy's 403
  } finally {
    await page.goto("/setup/record-template-policy");
    await page.getByLabel("Leads must be created from a template").uncheck();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Record template policy saved").first()).toBeVisible();
  }
  // the rule is off again: whatever this request answers, it is no longer the policy speaking
  const after = await page.request.post("/api/v1/leads", { data: { lastName: "Blank", mobile: "+2348030009999", brandId: "x", regionId: "y" } });
  expect(JSON.stringify(await after.json())).not.toContain("created from a template");
  await signOut(page);
});
