import { expect, test } from "@playwright/test";
import { login, signOut } from "./helpers";

const stamp = Date.now();

test("cases: create, per-brand number, work to resolution; another brand gets 404 everywhere", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  await page.goto("/cases/new");
  await page.waitForLoadState("networkidle");
  const subject = `E2E noisy brakes ${stamp}`;
  await page.locator("#subject").fill(subject);
  await page.locator("#type").selectOption("COMPLAINT");
  await page.locator("#priority").selectOption("HIGH");
  await page.locator("#customerName").fill("Ifeanyi Test");
  await page.locator("#customerEmail").fill(`ifeanyi.${stamp}@example.test`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/cases\/c[a-z0-9]{20,}$/);
  const caseUrl = page.url();
  const header = page.getByTestId("record-header");
  await expect(header).toContainText(/HMNL-CS-\d{4}-\d{5}/);
  await expect(header.getByTestId("brand-badge")).toHaveText("HMNL");
  await expect(page.getByTestId("sla-state")).toHaveText("SLA: On time");
  const number = (await header.innerText()).match(/HMNL-CS-\d{4}-\d{5}/)![0];

  // it is in "My Cases"
  await page.goto("/cases");
  await expect(page.getByTestId("cases-table")).toContainText(number);
  // resolving needs a resolution
  await page.goto(caseUrl);
  await page.waitForLoadState("networkidle");
  await page.locator("#status").selectOption("RESOLVED");
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByText(/Describe the resolution/)).toBeVisible();
  await page.waitForTimeout(500); // the toast appears just before React re-renders the form
  await expect(page.locator("#status")).toHaveValue("RESOLVED"); // a failed submit keeps what the user chose
  await page.locator("#resolution").fill("Brake pads replaced under warranty");
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByTestId("record-header")).toContainText("Resolved");
  await expect(page.getByTestId("sla-state")).toHaveText("SLA: Met");
  // a note on the case
  await page.getByLabel("New note").fill("Customer confirmed by phone");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByTestId("notes-list")).toContainText("Customer confirmed by phone");
  await signOut(page);

  // another brand: page, API, list and search know nothing about it
  await login(page, "exec.snmnl.1");
  expect((await page.goto(caseUrl))?.status()).toBe(404);
  expect((await page.request.get(`/api/v1/cases/${caseUrl.split("/").pop()}`)).status()).toBe(404);
  expect((await page.request.get(`/api/v1/cases/${number}`)).status()).toBe(404);
  const list = (await (await page.request.get(`/api/v1/cases?queue=all&q=${encodeURIComponent(number)}`)).json()) as { data: unknown[] };
  expect(list.data).toEqual([]);
  const search = (await (await page.request.get(`/api/v1/search?q=${encodeURIComponent(subject)}`)).json()) as { data: unknown[] };
  expect(search.data).toEqual([]);
  await page.goto("/cases?queue=all");
  await expect(page.locator("main")).not.toContainText(number);
  // SNMNL cases get SNMNL numbers
  const own = await page.request.post("/api/v1/cases", { data: { subject: `SNMNL case ${stamp}`, brandId: ((await (await page.request.get("/api/v1/me")).json()) as { data: { memberships: Array<{ brandId: string; regionId: string }> } }).data.memberships[0]!.brandId, regionId: ((await (await page.request.get("/api/v1/me")).json()) as { data: { memberships: Array<{ regionId: string }> } }).data.memberships[0]!.regionId } });
  expect(own.status()).toBe(201);
  expect(((await own.json()) as { data: { number: string } }).data.number).toMatch(/^SNMNL-CS-\d{4}-\d{5}$/);
});

test("public case form, queues and the satisfaction survey", async ({ page }) => {
  const subject = `Web complaint ${stamp}`;
  const created = await page.request.post("/api/public/cases/HMNL", { data: { name: "Web Customer", email: `web.${stamp}@example.test`, subject, message: "The delivery date was missed", type: "DELIVERY_ISSUE" } });
  expect(created.status()).toBe(201);
  const reference = ((await created.json()) as { reference: string }).reference;
  expect(reference).toMatch(/^HMNL-CS-/);
  expect((await page.request.post("/api/public/cases/NOPE", { data: { name: "x", subject: "x", message: "x" } })).status()).toBe(400);
  expect((await page.request.post("/api/public/cases/HMNL", { data: { name: "" } })).status()).toBe(400);

  // the Brand Manager sees it among all open HMNL cases, takes it and closes it
  await login(page, "bm.hmnl");
  await page.goto(`/cases?queue=open&q=${encodeURIComponent(reference)}`);
  await page.getByTestId("cases-table").getByRole("link", { name: reference }).click();
  await expect(page.getByTestId("record-header")).toContainText(subject);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Take case" }).click();
  await expect(page.getByText("The case is yours")).toBeVisible();
  await page.locator("#status").selectOption("CLOSED");
  await page.locator("#resolution").fill("Vehicle delivered, apology call made");
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByText(/Case closed/)).toBeVisible();
  await expect(page.getByTestId("record-header")).toContainText("Closed");

  // SLA settings: the manager edits the own brand only; the knowledge base
  await page.goto("/cases/sla");
  await expect(page.getByTestId("sla-HMNL").getByRole("button", { name: "Save" }).first()).toBeVisible();
  await expect(page.getByTestId("business-calendar")).toContainText("Independence Day");
  await expect(page.getByTestId("business-calendar").getByRole("button", { name: "Save hours" })).toHaveCount(0); // administrators only
  const title = `HMNL delivery checklist ${stamp}`;
  await page.goto("/cases/solutions?new=1");
  await page.waitForLoadState("networkidle");
  await page.locator("#s-brand").selectOption({ label: "HMNL users only" });
  await page.locator("#s-title").fill(title);
  await page.locator("#s-body").fill("1. Confirm the delivery date with the customer.");
  await page.locator("#s-tags").fill("delivery issue, delivery");
  await page.getByRole("button", { name: "Save article" }).click();
  await expect(page.getByTestId("solution-pane")).toContainText("1. Confirm the delivery date");
  const articleUrl = page.url();
  await signOut(page);

  await login(page, "exec.hmnl.2");
  await page.goto("/cases/solutions");
  await expect(page.getByTestId("solutions-list")).toContainText(title);
  await signOut(page);
  await login(page, "exec.snmnl.1");
  await page.goto("/cases/solutions");
  await expect(page.locator("main")).not.toContainText(title);
  expect((await page.goto(articleUrl))?.status()).toBe(404);

  // survey page: neutral for unknown tokens
  const res = await page.goto("/api/public/csat/not-a-real-token");
  expect(res?.status()).toBe(404);
  await expect(page.locator("body")).toContainText("no longer valid");
});
