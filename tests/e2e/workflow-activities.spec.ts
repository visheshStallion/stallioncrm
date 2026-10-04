import { expect, test, type Page } from "@playwright/test";
import { login, signOut } from "./helpers";

async function newDeal(page: Page, name: string) {
  const me = (await (await page.request.get("/api/v1/me")).json()) as { data: { memberships: Array<{ brandId: string; regionId: string }> } };
  const { brandId, regionId } = me.data.memberships[0]!;
  const created = await page.request.post("/api/v1/deals", { data: { name, brandId, regionId } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { data: { id: string } }).data.id;
}
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

test("test drive: booked from the deal, double booking rejected, completing it moves the deal to Test Drive", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  const dealId = await newDeal(page, `E2E Drive ${Date.now()}`);
  const vin = `E2EDEMO${Date.now()}`;

  await page.goto(`/deals/${dealId}`);
  await page.getByTestId("activity-panel").getByRole("link", { name: "+ Test Drive" }).click();
  await expect(page.getByRole("heading", { name: "Book Test Drive" })).toBeVisible();
  await page.getByLabel("Model").selectOption({ index: 1 });
  await page.getByLabel("Demo vehicle VIN").fill(vin);
  await page.getByLabel("Licence checked").check();
  await page.getByRole("button", { name: "Book Test Drive" }).click();
  await expect(page).toHaveURL(new RegExp(`/deals/${dealId}$`));
  const upcoming = page.getByTestId("activities-upcoming");
  await expect(upcoming.getByTestId("activity-row")).toHaveCount(1);

  // the same vehicle cannot be booked twice for an overlapping time (API → 400)
  const list = (await (await page.request.get(`/api/v1/activities?parentType=Deal&parentId=${dealId}`)).json()) as { data: Array<{ id: string; startAt: string; endAt: string }> };
  const booked = list.data[0]!;
  const clash = await page.request.post("/api/v1/activities", {
    data: { type: "TEST_DRIVE", parentType: "Deal", parentId: dealId, subject: "Clash", startAt: booked.startAt, endAt: booked.endAt, vehicleVin: vin },
  });
  expect(clash.status()).toBe(400);
  expect(((await clash.json()) as { error: { message: string } }).error.message).toContain("already booked");

  // complete it → deal stage moves and the stage history records it
  await upcoming.getByRole("link", { name: "Test drive" }).click();
  await page.getByLabel("Odometer start (km)").fill("120");
  await page.getByLabel("Odometer end (km)").fill("135");
  await page.getByLabel("Customer feedback (1–5)").fill("4");
  await page.getByRole("button", { name: "Complete Test Drive" }).click();
  await expect(page.getByTestId("status-pill").first()).toHaveText("Completed");
  await page.goto(`/deals/${dealId}`);
  await expect(page.getByTestId("stage-progress").locator('[aria-current="step"]')).toHaveText("Test Drive");
  await expect(page.getByTestId("activities-history").getByTestId("activity-row")).toHaveCount(1);
  await page.goto(`/deals/${dealId}?tab=timeline`);
  await expect(page.getByTestId("timeline")).toContainText("Stage: Enquiry → Test Drive");
});

test("brand isolation: an SNMNL activity is invisible to an HMNL exec in calendar, list, search and API", async ({ page }) => {
  await login(page, "exec.snmnl.1");
  const dealId = await newDeal(page, `E2E SNMNL act ${Date.now()}`);
  const subject = `SNMNL-only meeting ${Date.now()}`;
  const created = await page.request.post("/api/v1/activities", { data: { type: "MEETING", parentType: "Deal", parentId: dealId, subject, startAt: hours(1), endAt: hours(2) } });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { data: { id: string } }).data.id;
  const snmnlUser = ((await (await page.request.get("/api/v1/me")).json()) as { data: { userId: string } }).data.userId;
  // the owner sees it in the calendar (day view of the meeting's day)
  await page.goto("/activities?view=calendar&mode=week");
  await expect(page.getByTestId("calendar")).toContainText(subject);
  await signOut(page);

  await login(page, "exec.hmnl.1");
  // calendar – also when the other user's id is forced into the overlay parameter
  await page.goto(`/activities?view=calendar&mode=week&users=${snmnlUser}`);
  await expect(page.getByTestId("calendar")).toBeVisible();
  await expect(page.getByTestId("calendar")).not.toContainText(subject);
  await expect(page.getByTestId("team-overlay")).toHaveCount(0); // an exec manages nobody
  // list
  await page.goto("/activities?view=all");
  await expect(page.locator("main")).not.toContainText(subject);
  // detail page and API: 404
  expect((await page.goto(`/activities/${id}`))?.status()).toBe(404);
  expect((await page.request.get(`/api/v1/activities/${id}`)).status()).toBe(404);
  expect((await page.request.post(`/api/v1/activities/${id}/complete`, { data: {} })).status()).toBe(404);
  const api = (await (await page.request.get(`/api/v1/activities?view=all&q=${encodeURIComponent(subject)}`)).json()) as { data: unknown[] };
  expect(api.data).toEqual([]);
  const byOwner = (await (await page.request.get(`/api/v1/activities?view=all&ownerId=${snmnlUser}`)).json()) as { data: unknown[] };
  expect(byOwner.data).toEqual([]);
  // creating an activity on the hidden deal: 404
  expect((await page.request.post("/api/v1/activities", { data: { type: "TASK", parentType: "Deal", parentId: dealId, subject: "sneak", dueAt: hours(1) } })).status()).toBe(404);
  // global search
  const search = (await (await page.request.get(`/api/v1/search?q=${encodeURIComponent(subject)}`)).json()) as { data: unknown[] };
  expect(search.data).toEqual([]);
});

test("tasks: overdue badge in the rail, complete from the record, call log, manager team calendar and notification", async ({ page }) => {
  await login(page, "exec.hmnl.2");
  const dealId = await newDeal(page, `E2E Tasks ${Date.now()}`);
  const subject = `Overdue task ${Date.now()}`;
  const res = await page.request.post("/api/v1/activities", { data: { type: "TASK", parentType: "Deal", parentId: dealId, subject, dueAt: hours(-2) } });
  expect(res.status()).toBe(201);
  await page.goto(`/deals/${dealId}`);
  await expect(page.getByTestId("rail-badge-activities")).toBeVisible();
  await expect(page.getByTestId("activities-overdue")).toContainText(subject);

  // log a call from the record
  await page.getByTestId("activity-panel").getByRole("link", { name: "Log Call" }).click();
  await page.getByLabel("Duration (seconds)").fill("75");
  await page.getByLabel("Outcome").fill("Customer will visit on Saturday");
  await page.getByRole("button", { name: "Log Call" }).click();
  await expect(page).toHaveURL(new RegExp(`/deals/${dealId}$`));
  await expect(page.getByTestId("activities-history")).toContainText("Call");

  // complete the overdue task in place
  await page.getByRole("button", { name: `Complete ${subject}` }).click();
  await expect(page.getByTestId("activities-overdue")).toHaveCount(0);
  await expect(page.getByTestId("activities-history")).toContainText(subject);

  // a meeting with the brand manager as participant → notification for the manager
  const me = ((await (await page.request.get("/api/v1/me")).json()) as { data: { userId: string } }).data.userId;
  const meeting = `Team review ${Date.now()}`;
  await page.goto(`/activities/new?type=meeting&parentType=Deal&parentId=${dealId}`);
  await page.getByLabel("Subject").fill(meeting);
  await page.getByTestId("form-footer").scrollIntoViewIfNeeded();
  await page.getByText("Bola Hassan", { exact: true }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("activities-upcoming")).toContainText(meeting);
  await signOut(page);

  await login(page, "bm.hmnl");
  await page.getByRole("button", { name: /Notifications \(\d+\)/ }).click();
  await expect(page.getByTestId("notifications")).toContainText(meeting);
  // the manager overlays the exec's calendar
  await page.goto(`/activities?view=calendar&mode=week&users=${me}`);
  await expect(page.getByTestId("team-overlay")).toBeVisible();
  await expect(page.getByTestId("calendar")).toContainText(meeting);
  await page.getByRole("tab", { name: "month" }).click();
  await expect(page.getByTestId("calendar-title")).toBeVisible();
});
