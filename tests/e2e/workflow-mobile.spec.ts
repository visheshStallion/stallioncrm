import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

const stamp = Date.now();
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

/** Reads the offline store of the page (IndexedDB). */
const store = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ meta: { userId: string; scopeHash: string } | null; leads: number; outbox: Array<{ label: string; failed?: string }> }>((resolve, reject) => {
        const req = indexedDB.open("stallion-offline", 1);
        req.onupgradeneeded = () => ["meta", "records", "outbox"].forEach((s) => req.result.createObjectStore(s));
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const t = req.result.transaction(["meta", "records", "outbox"], "readonly");
          const meta = t.objectStore("meta").get("meta");
          const leads = t.objectStore("records").get("leads");
          const outbox = t.objectStore("outbox").getAll();
          t.oncomplete = () => {
            req.result.close();
            resolve({ meta: meta.result ?? null, leads: (leads.result ?? []).length, outbox: outbox.result });
          };
        };
      }),
  );

test("phone: bottom navigation, installable app, quick actions online and offline, outbox sync, cache wiped on logout", async ({ page, context }) => {
  test.setTimeout(120_000);
  // installable: manifest and worker are public and carry no data
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  expect(((await manifest.json()) as { display: string; icons: unknown[] }).display).toBe("standalone");
  expect((await page.request.get("/sw.js")).status()).toBe(200);
  expect((await page.request.get("/icons/icon-192.png")).headers()["content-type"]).toBe("image/png");

  await login(page, "exec.hmnl.1");
  const nav = page.getByTestId("mobile-nav");
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link")).toHaveText(["Home", "Leads", "Deals", "Activities"]);
  await expect(page.getByTestId("module-rail")).toBeHidden();
  const box = await nav.getByRole("link", { name: "Leads" }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(48); // tap target
  await nav.getByRole("button", { name: "More" }).click();
  await expect(page.getByTestId("mobile-more")).toContainText("Quick actions");
  await page.getByTestId("mobile-more").getByRole("link", { name: "Quick actions" }).click();
  await expect(page).toHaveURL(/\/quick$/);

  // the device now holds the user's own records – and only theirs
  await expect.poll(async () => (await store(page)).meta?.userId ?? null, { timeout: 20_000 }).not.toBeNull();
  const cached = await store(page);
  expect(cached.leads).toBeGreaterThan(0);
  const me = (await (await page.request.get("/api/v1/me")).json()) as { data: { userId: string } };
  expect(cached.meta!.userId).toBe(me.data.userId);
  const snap = (await (await page.request.get("/api/v1/offline/snapshot")).json()) as { data: { leads: Array<{ id: string; brandId: string }>; deals: Array<{ id: string; brandId: string }> } };
  expect(new Set([...snap.data.leads, ...snap.data.deals].map((r) => r.brandId)).size).toBe(1);

  // online: a call is logged at once
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.locator("#call-target").selectOption({ index: 1 });
  await page.locator("#call-outcome").fill(`Online call ${stamp}`);
  await page.getByRole("button", { name: "Save call" }).click();
  await expect(page.getByTestId("quick-message")).toHaveText("Call saved");

  // offline: the note is kept on the device
  await context.setOffline(true);
  await page.locator("#note-target").selectOption({ index: 1 });
  await page.locator("#note-body").fill(`Offline note ${stamp}`);
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByTestId("quick-message")).toContainText("saved on this device");
  await expect(page.getByTestId("outbox")).toContainText("Waiting for a connection");
  expect((await store(page)).outbox).toHaveLength(1);

  // back online: the outbox is sent and the note exists on the server
  await context.setOffline(false);
  await page.getByRole("button", { name: "Send now" }).click();
  await expect(page.getByTestId("outbox")).toHaveCount(0);
  expect((await store(page)).outbox).toHaveLength(0);
  const target = await page.locator("#note-target option").nth(1).getAttribute("value");
  const [kind, id] = target!.split(":");
  await page.goto(`/${kind === "Lead" ? "leads" : "deals"}/${id}`);
  await expect(page.getByText(`Offline note ${stamp}`).first()).toBeVisible();

  // logout: nothing of the user stays on the device
  await page.goto("/login").catch(() => undefined);
  await page.goto("/");
  await page.getByTestId("avatar-menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByText("Sign in to continue")).toBeVisible();
  await expect.poll(async () => (await store(page)).meta, { timeout: 10_000 }).toBeNull();
  expect((await store(page)).leads).toBe(0);
});

test("search and notification centre on the phone: another brand's VIN finds nothing; preferences are saved", async ({ page }) => {
  await login(page, "exec.snmnl.1");
  const sn = (await (await page.request.get("/api/v1/deals?limit=1")).json()) as { data: Array<{ id: string; name: string }> };
  const vin = `E2ESN${String(stamp).slice(-9)}`;
  expect((await page.request.patch(`/api/v1/deals/${sn.data[0]!.id}`, { data: { vinChassisNo: vin } })).status()).toBe(200);
  await page.goto(`/search?q=${vin}`);
  await expect(page.getByTestId("search-hit").first()).toContainText(sn.data[0]!.name);
  await page.getByTestId("avatar-menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByText("Sign in to continue")).toBeVisible();

  await login(page, "exec.hmnl.1");
  await page.goto(`/search?q=${vin}`);
  await expect(page.getByTestId("search-results")).toContainText("No results");
  await expect(page.getByTestId("search-hit")).toHaveCount(0);
  expect(((await (await page.request.get(`/api/v1/search?q=${vin}`)).json()) as { data: unknown[] }).data).toEqual([]);

  await page.goto("/notifications");
  await page.waitForLoadState("networkidle");
  const prefs = page.getByTestId("notification-prefs");
  await prefs.getByLabel("Mentions in notes – push").uncheck();
  await prefs.locator("#quietFrom").fill("21:00");
  await prefs.locator("#quietTo").fill("07:00");
  await prefs.getByLabel("Daily e-mail digest of unread notifications").check();
  await prefs.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Notification preferences saved")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("notification-prefs").getByLabel("Mentions in notes – push")).not.toBeChecked();
  await expect(page.getByTestId("notification-prefs").locator("#quietFrom")).toHaveValue("21:00");
  await expect(page.getByTestId("notification-prefs").getByLabel("Daily e-mail digest of unread notifications")).toBeChecked();
});
