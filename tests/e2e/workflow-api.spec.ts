import { expect, test, type Locator, type Page } from "@playwright/test";
import { login, signOut } from "./helpers";

const stamp = Date.now();

async function newSecrets(page: Page | Locator): Promise<string[]> {
  const box = page.getByTestId("new-secret");
  await expect(box).toBeVisible();
  return box.locator("input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
}

test("personal token: the API returns what the UI shows; idempotent POST; delete needs permission; docs are public", async ({ page, playwright, baseURL }) => {
  await login(page, "exec.hmnl.1");
  const ui = (await (await page.request.get("/api/v1/deals?limit=200")).json()) as { data: Array<{ id: string; brandId: string }> };
  await page.goto("/tokens");
  await page.waitForLoadState("networkidle");
  await page.locator("#name").fill(`E2E script ${stamp}`);
  await page.getByRole("button", { name: "Create token" }).click();
  const [token] = await newSecrets(page);
  expect(token).toMatch(/^scrm_/);
  await expect(page.getByTestId("tokens")).toContainText(`E2E script ${stamp}`);
  await expect(page.getByTestId("tokens")).not.toContainText(token!); // only the prefix is listed

  // a client without any session cookie
  const api = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  const anon = await playwright.request.newContext({ baseURL });
  const list = await api.get("/api/v1/deals?limit=200");
  expect(list.status()).toBe(200);
  const viaToken = (await list.json()) as { data: Array<{ id: string; brandId: string }>; meta: { nextCursor: string | null } };
  expect(viaToken.data.map((d) => d.id).sort()).toEqual(ui.data.map((d) => d.id).sort());
  expect(new Set(viaToken.data.map((d) => d.brandId)).size).toBe(1);
  const me = (await (await api.get("/api/v1/me")).json()) as { data: { user: { name: string } } };
  expect(me.data.user.name).toBe("Ada Okafor");

  // cursor paging
  const page1 = (await (await api.get("/api/v1/deals?limit=2")).json()) as { data: unknown[]; meta: { nextCursor: string | null; total: number } };
  expect(page1.data).toHaveLength(2);
  if (page1.meta.total > 2) {
    const page2 = (await (await api.get(`/api/v1/deals?limit=2&cursor=${page1.meta.nextCursor}`)).json()) as { data: Array<{ id: string }> };
    expect(page2.data[0]!.id).not.toBe((page1.data[0] as { id: string }).id);
  }

  // no / wrong token
  expect((await anon.get("/api/v1/deals")).status()).toBe(401);
  expect((await anon.get("/api/v1/deals", { headers: { Authorization: "Bearer scrm_wrong" } })).status()).toBe(401);
  // a token is for the API only – pages still need a session
  expect((await api.get("/deals", { maxRedirects: 0 })).status()).toBeGreaterThanOrEqual(300);

  // idempotent create
  const meCtx = (await (await api.get("/api/v1/me")).json()) as { data: { memberships: Array<{ brandId: string; regionId: string }> } };
  const m = meCtx.data.memberships[0]!;
  const body = { firstName: "Api", lastName: `Idem ${stamp}`, mobile: `+23480${String(stamp).slice(-8)}`, source: "WEBSITE", brandId: m.brandId, regionId: m.regionId };
  const first = await api.post("/api/v1/leads", { data: body, headers: { "Idempotency-Key": `k-${stamp}` } });
  expect(first.status()).toBe(201);
  const again = await api.post("/api/v1/leads", { data: body, headers: { "Idempotency-Key": `k-${stamp}` } });
  expect(again.status()).toBe(201);
  expect(again.headers()["idempotent-replay"]).toBe("true");
  const leadId = ((await first.json()) as { data: { id: string } }).data.id;
  expect(((await again.json()) as { data: { id: string } }).data.id).toBe(leadId);
  expect((await api.post("/api/v1/leads", { data: { ...body, lastName: "Different" }, headers: { "Idempotency-Key": `k-${stamp}` } })).status()).toBe(422);
  // executives have no delete permission
  expect((await api.delete(`/api/v1/leads/${leadId}`)).status()).toBe(403);

  // OpenAPI document
  const docs = await anon.get("/api/v1/docs");
  expect(docs.status()).toBe(200);
  const spec = (await docs.json()) as { openapi: string; paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } };
  expect(spec.openapi).toBe("3.1.0");
  expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(["/leads", "/deals/{id}", "/invoices/{id}/payment-links"]));
  expect(spec.components.schemas.LeadsCreate).toBeTruthy();

  // revoke
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("tokens").getByRole("button", { name: "Revoke" }).first().click();
  await expect(page.getByTestId("tokens")).toContainText("Revoked");
  expect((await api.get("/api/v1/deals")).status()).toBe(401);
  await api.dispose();
  await anon.dispose();
});

test("admin: integration principal limited to SNMNL, token and OAuth client cannot read HMNL; webhook subscription", async ({ page, playwright, baseURL }) => {
  await login(page, "exec.hmnl.1");
  const hmnl = (await (await page.request.get("/api/v1/deals?limit=1")).json()) as { data: Array<{ id: string }> };
  const hmnlDealId = hmnl.data[0]!.id;
  expect((await page.goto("/admin/api"))!.status()).toBe(404);
  await page.goto("/");
  await signOut(page);

  await login(page, "admin");
  await page.goto("/admin/api");
  await page.waitForLoadState("networkidle");
  const name = `E2E SNMNL connector ${stamp}`;
  const principals = page.getByTestId("principals");
  await principals.locator("#p-name").fill(name);
  await principals.locator("#p-role").selectOption({ label: "Brand Manager" });
  await principals.locator("#p-profile").selectOption({ label: "Brand Manager" });
  await principals.getByLabel("SNMNL").check();
  await principals.getByRole("button", { name: "Create principal" }).click();
  await expect(principals.locator("table")).toContainText(name);

  // integration token
  const form = page.getByTestId("integration-token-form");
  await form.locator("#t-user").selectOption({ label: name });
  await form.locator("#t-name").fill("E2E sync");
  await form.getByRole("button", { name: "Create token" }).click();
  const [token] = await newSecrets(form);
  const api = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  const deals = (await (await api.get("/api/v1/deals?limit=200")).json()) as { data: Array<{ brandId: string }> };
  expect(deals.data.length).toBeGreaterThan(0);
  expect(new Set(deals.data.map((d) => d.brandId)).size).toBe(1);
  expect((await api.get(`/api/v1/deals/${hmnlDealId}`)).status()).toBe(404);
  await api.dispose();

  // OAuth2 client credentials
  const clients = page.getByTestId("oauth-clients");
  await clients.locator("#c-user").selectOption({ label: name });
  await clients.locator("#c-name").fill("E2E OAuth");
  await clients.getByRole("button", { name: "Create client" }).click();
  const [clientId, clientSecret] = await newSecrets(clients);
  const anon = await playwright.request.newContext({ baseURL });
  expect((await anon.post("/api/public/oauth/token", { form: { grant_type: "client_credentials", client_id: clientId!, client_secret: "nope" } })).status()).toBe(401);
  const grant = await anon.post("/api/public/oauth/token", { form: { grant_type: "client_credentials", client_id: clientId!, client_secret: clientSecret! } });
  expect(grant.status()).toBe(200);
  const { access_token, token_type } = (await grant.json()) as { access_token: string; token_type: string };
  expect(token_type).toBe("Bearer");
  expect((await anon.get(`/api/v1/deals/${hmnlDealId}`, { headers: { Authorization: `Bearer ${access_token}` } })).status()).toBe(404);
  expect((await anon.get("/api/v1/deals", { headers: { Authorization: `Bearer ${access_token}` } })).status()).toBe(200);
  await anon.dispose();

  // webhook subscription (signing secret shown once), then removed again
  await page.goto("/admin/webhooks");
  await page.waitForLoadState("networkidle");
  const hook = page.getByTestId("webhook-form");
  await hook.locator("#name").fill(`E2E hook ${stamp}`);
  await hook.locator("#url").fill("https://127.0.0.1:9/hook");
  await hook.getByLabel("case.resolved").check();
  await hook.locator("#userId").selectOption({ label: name });
  await hook.getByRole("button", { name: "Create subscription" }).click();
  const [secret] = await newSecrets(hook);
  expect(secret).toMatch(/^whsec_/);
  await expect(page.getByTestId("webhooks")).toContainText(`E2E hook ${stamp}`);
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("webhooks").getByRole("button", { name: "Delete" }).first().click();
  await expect(page.getByTestId("webhooks")).not.toContainText(`E2E hook ${stamp}`);
});
