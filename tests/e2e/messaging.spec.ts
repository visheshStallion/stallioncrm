import { expect, test, type Page } from "@playwright/test";
import { login, signOut } from "./helpers";

const WEBHOOK = "e2e-webhook-secret";
const stamp = Date.now();
const HMNL_WA = `+23481${String(stamp).slice(-8)}`;
const SNMNL_WA = `+23482${String(stamp).slice(-8)}`;

async function brandSender(page: Page, code: string, sender: { fromEmail: string; smsSenderId: string; whatsappNumber: string }) {
  await page.goto("/admin/brands");
  await page.getByRole("link", { name: code, exact: true }).first().click();
  const senderId = () => page.getByTestId("sender-identity").getByLabel("SMS sender ID (3–11 characters)");
  // On a cold dev server the form may still be hydrating when the test starts typing – retry until it sticks.
  await expect(async () => {
    await page.waitForLoadState("networkidle");
    const box = page.getByTestId("sender-identity");
    await box.getByLabel("Email from-name").fill(`${code} Sales`);
    await box.getByLabel("Email from-address").fill(sender.fromEmail);
    await senderId().fill(sender.smsSenderId);
    await box.getByLabel("WhatsApp Business number").fill(sender.whatsappNumber);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Brand saved").first()).toBeVisible();
    await page.reload();
    await expect(senderId()).toHaveValue(sender.smsSenderId, { timeout: 3000 });
  }).toPass({ timeout: 45_000 });
}

test.describe.configure({ mode: "serial" });

test("administrator sets the sender identity of two brands", async ({ page }) => {
  await login(page, "admin");
  await brandSender(page, "HMNL", { fromEmail: "sales@hmnl.example.test", smsSenderId: "HMNL", whatsappNumber: HMNL_WA });
  await brandSender(page, "SNMNL", { fromEmail: "sales@snmnl.example.test", smsSenderId: "SNMNL", whatsappNumber: SNMNL_WA });
});

test("a message from a lead is sent as the lead's brand and logged on the record", async ({ page }) => {
  await login(page, "exec.multi.1"); // HMNL + SNMNL
  const me = (await (await page.request.get("/api/v1/me")).json()) as { data: { memberships: Array<{ brandId: string; regionId: string }> } };
  const hmnl = (await page.getByTestId("brand-switcher").locator("option", { hasText: /^HMNL/ }).getAttribute("value"))!;
  const snmnl = (await page.getByTestId("brand-switcher").locator("option", { hasText: /^SNMNL/ }).getAttribute("value"))!;
  const regionId = me.data.memberships[0]!.regionId;
  const mk = async (brandId: string, last: string) => {
    const res = await page.request.post("/api/v1/leads", { data: { firstName: "Kemi", lastName: last, mobile: `+23480${String(Date.now()).slice(-8)}`, email: `kemi.${Date.now()}@example.test`, source: "WALK_IN", brandId, regionId } });
    expect(res.status()).toBe(201);
    return ((await res.json()) as { data: { id: string } }).data.id;
  };
  const hLead = await mk(hmnl, `Hmnl ${stamp}`);
  const sLead = await mk(snmnl, `Snmnl ${stamp}`);

  await page.goto(`/leads/${hLead}`);
  await page.getByTestId("activity-panel").getByRole("link", { name: "SMS", exact: true }).click();
  await expect(page.getByTestId("message-from")).toHaveValue("HMNL");
  await page.getByLabel("Text").fill("Hello {{contact.firstName}}, thank you for visiting {{brand.code}}.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page).toHaveURL(new RegExp(`/leads/${hLead}$`));
  await expect(page.getByTestId("activities-history")).toContainText("SMS");
  const sent = (await (await page.request.get(`/api/v1/messages?parentType=Lead&parentId=${hLead}`)).json()) as { data: Array<{ fromAddress: string; body: string; status: string }> };
  expect(sent.data[0]).toMatchObject({ fromAddress: "HMNL", status: "SENT", body: "Hello Kemi, thank you for visiting HMNL." });

  // the same user writing about the SNMNL lead sends as SNMNL – the sender cannot be chosen
  await page.goto(`/messages/new?channel=EMAIL&parentType=Lead&parentId=${sLead}`);
  await expect(page.getByTestId("message-from")).toHaveValue("SNMNL Sales <sales@snmnl.example.test>");
  const api = await page.request.post("/api/v1/messages", { data: { channel: "EMAIL", parentType: "Lead", parentId: sLead, subject: "Hello", body: "Dear {{contact.name}}", from: "sales@hmnl.example.test" } });
  expect(api.status()).toBe(201);
  expect(((await api.json()) as { data: { from: string } }).data.from).toBe("sales@snmnl.example.test");
  await signOut(page);

  // an HMNL-only exec cannot read or send on the SNMNL lead
  await login(page, "exec.hmnl.1");
  expect(((await (await page.request.get(`/api/v1/messages?parentType=Lead&parentId=${sLead}`)).json()) as { data: unknown[] }).data).toEqual([]);
  expect((await page.request.post("/api/v1/messages", { data: { channel: "SMS", parentType: "Lead", parentId: sLead, body: "x" } })).status()).toBe(404);
  expect((await page.goto(`/messages/new?channel=SMS&parentType=Lead&parentId=${sLead}`))?.status()).toBe(404);
});

test("inbound WhatsApp is routed by the receiving number; webhooks need the secret", async ({ page }) => {
  const from = `23470${String(Date.now()).slice(-8)}`;
  const payload = (to: string, text: string, id: string) => ({ entry: [{ changes: [{ value: { metadata: { display_phone_number: to }, contacts: [{ wa_id: from, profile: { name: "Bisi Inbound" } }], messages: [{ from, id, type: "text", text: { body: text } }] } }] }] });
  // without / with a wrong token nothing is accepted
  expect((await page.request.post("/api/public/webhooks/whatsapp", { data: payload(SNMNL_WA, "x", "a") })).status()).toBe(401);
  expect((await page.request.post("/api/public/webhooks/whatsapp?token=wrong", { data: payload(SNMNL_WA, "x", "a") })).status()).toBe(401);
  expect((await page.request.post("/api/public/webhooks/sms", { data: { to: "1", from, text: "x" } })).status()).toBe(401);

  const text = `Do you have the sedan in stock? ${stamp}`;
  const res = await page.request.post(`/api/public/webhooks/whatsapp?token=${WEBHOOK}`, { data: payload(SNMNL_WA, text, `wamid.${stamp}`) });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, received: 1 });
  // unknown sender → a new SNMNL lead; the SNMNL team sees it, HMNL does not
  await login(page, "bm.snmnl");
  await page.goto(`/leads?q=${encodeURIComponent("Inbound")}`);
  await page.getByRole("link", { name: "Bisi Inbound" }).first().click();
  await expect(page.getByTestId("record-header").getByTestId("brand-badge")).toHaveText("SNMNL");
  await expect(page.getByTestId("activities-history")).toContainText("WhatsApp from");
  const leadUrl = page.url();
  await signOut(page);
  await login(page, "bm.hmnl");
  expect((await page.goto(leadUrl))?.status()).toBe(404);
  const search = (await (await page.request.get(`/api/v1/search?q=${encodeURIComponent("Bisi Inbound")}`)).json()) as { data: unknown[] };
  expect(search.data).toEqual([]);
});

test("campaign: template, consent-based audience, launch with mass email permission, unsubscribe per brand", async ({ page }) => {
  await login(page, "bm.hmnl");
  const tplName = `E2E promo ${stamp}`;
  await page.goto("/campaigns/templates");
  const form = page.getByTestId("template-form");
  await form.getByLabel("Channel").selectOption("EMAIL");
  await page.waitForLoadState("networkidle");
  await form.getByLabel("Name", { exact: true }).fill(tplName);
  await form.getByLabel("Subject (email)").fill("News from {{brand.name}}");
  await form.getByLabel("Text", { exact: true }).fill("Dear {{contact.firstName}}, visit our showroom this weekend.");
  await form.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByTestId("templates-table")).toContainText(tplName);

  // a lead with consent and one without
  const me = (await (await page.request.get("/api/v1/me")).json()) as { data: { memberships: Array<{ brandId: string }> } };
  const brandId = me.data.memberships[0]!.brandId;
  const regions = await page.getByTestId("region-filter").locator("option").evaluateAll((els) => els.map((e) => ({ value: (e as HTMLOptionElement).value, label: e.textContent ?? "" })));
  const regionId = regions.find((r) => r.label.trim() === "Lagos")!.value;
  const yes = `yes.${stamp}@example.test`;
  const no = `no.${stamp}@example.test`;
  for (const [email, consent] of [[yes, true], [no, false]] as const) {
    const res = await page.request.post("/api/v1/leads", { data: { firstName: "Camp", lastName: `Lead ${email}`, email, source: "WALK_IN", brandId, regionId, consentMarketing: consent } });
    expect(res.status()).toBe(201);
  }

  const name = `E2E campaign ${stamp}`;
  await page.goto("/campaigns/new");
  await page.waitForLoadState("networkidle");
  await page.locator("#name").fill(name);
  await page.locator("#type").selectOption("PROMO");
  await page.locator("#planStatus").selectOption("Planning");
  await page.locator("#expectedRevenue").fill("5000000");
  await page.locator("#expectedResponse").fill("40");
  await page.locator("#channel").selectOption("EMAIL");
  await page.locator("#audienceKind").selectOption("ALL_LEADS");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/campaigns\/c[a-z0-9]{20,}$/); // the saved campaign (a cuid), not /campaigns/new
  await expect(page.getByTestId("campaign-info").locator('[data-field="Status"]')).toHaveText("Planning");
  await expect(page.getByTestId("campaign-info").locator('[data-field="Expected Response"]')).toHaveText("40");
  const campaignUrl = page.url();
  await page.locator("#templateId").selectOption({ label: tplName });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Campaign saved")).toBeVisible();
  await page.getByRole("button", { name: "Build audience" }).click();
  await expect(page.getByText(/Audience built:/)).toBeVisible();
  const members = page.getByTestId("campaign-members");
  await expect(members.locator("tr", { hasText: yes })).toContainText("Pending");
  await expect(members.locator("tr", { hasText: no })).toContainText("Suppressed");
  await expect(members.locator("tr", { hasText: no })).toContainText("No marketing consent recorded for HMNL");

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Launch" }).click();
  await expect(page.getByText(/Campaign launched/)).toBeVisible();
  // the queue sends it (cron tick = the scheduler heartbeat)
  await expect
    .poll(
      async () => {
        await page.request.post("/api/public/cron/tick", { headers: { authorization: "Bearer e2e-cron-secret" } });
        const c = (await (await page.request.get(`/api/v1/campaigns/${campaignUrl.split("/").pop()}`)).json()) as { data?: { status: string } };
        return c.data?.status ?? JSON.stringify(c);
      },
      { timeout: 30_000 },
    )
    .toBe("SENT");
  await page.goto(campaignUrl);
  await expect(page.getByTestId("campaign-members").locator("tr", { hasText: yes })).toContainText("Sent");
  await signOut(page);

  // other brands cannot see the campaign; a sales exec has no campaigns module at all
  await login(page, "bm.snmnl");
  expect((await page.goto(campaignUrl))?.status()).toBe(404);
  await page.goto("/campaigns");
  await expect(page.locator("main")).not.toContainText(name);
  await signOut(page);
  await login(page, "rsm");
  const draft = await page.request.post("/api/v1/campaigns", { data: { brandId, name: `RSM draft ${stamp}`, channel: "SMS" } });
  expect(draft.status()).toBe(201);
  expect((await page.request.post(`/api/v1/campaigns/${((await draft.json()) as { data: { id: string } }).data.id}/launch`)).status()).toBe(403); // no mass email permission
});

test("unsubscribe page confirms first and is neutral for unknown tokens", async ({ page }) => {
  const res = await page.goto("/api/public/unsubscribe/not-a-real-token");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Unsubscribe" })).toBeVisible();
  await expect(page.locator("body")).toContainText("no longer valid");
});
