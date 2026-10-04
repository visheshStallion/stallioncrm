import { createHmac } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { RateLimitError } from "@/server/errors";
import { reconcilePayment } from "@/server/integrations/erp";
import { createPaymentLink, handlePaymentWebhook } from "@/server/integrations/payments";
import { listDeliveries, saveSubscription } from "@/server/integrations/webhooks";
import { softDelete } from "@/server/modules/api/records";
import * as tokens from "@/server/modules/api/tokens";
import { getDeal, listDeals } from "@/server/modules/deals/queries";
import { createDeal } from "@/server/modules/deals/service";
import { getDocument } from "@/server/modules/documents/queries";
import * as docs from "@/server/modules/documents/service";
import { listLeads } from "@/server/modules/leads/queries";
import { createLead } from "@/server/modules/leads/service";
import { runDueJobs } from "@/server/modules/workflow/engine";
import { resetRateLimits } from "@/server/rate-limit";
import { PROFILES, ROLES } from "../../prisma/seed-data";
import { ctxFor, ids, rawAsUser, unsafeDb } from "./helpers";

let I: Awaited<ReturnType<typeof ids>>;
let admin: AccessContext;
let exec: AccessContext; // HMNL Lagos exec
let bm: AccessContext; // HMNL Brand Manager
let snmnlExec: AccessContext;
let md: AccessContext;
let model: { id: string };

/** Mock of the outside world: records every request, answers per path. */
const received: Array<{ path: string; headers: http.IncomingHttpHeaders; body: string }> = [];
let server: http.Server;
let base = "";
let failWebhooks = false;

beforeAll(async () => {
  I = await ids();
  [admin, exec, bm, snmnlExec, md] = await Promise.all([ctxFor("admin"), ctxFor("exec.hmnl.1"), ctxFor("bm.hmnl"), ctxFor("exec.snmnl.1"), ctxFor("md")]);
  model = await unsafeDb.product.findFirstOrThrow({ where: { brandId: I.brand("HMNL") }, orderBy: { code: "asc" } });
  await unsafeDb.brand.update({ where: { id: I.brand("HMNL") }, data: { erpCompanyCode: "ERP-HMNL" } });
  await unsafeDb.brand.update({ where: { id: I.brand("SNMNL") }, data: { erpCompanyCode: "ERP-SNMNL" } });
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const path = req.url ?? "";
      received.push({ path, headers: req.headers, body });
      res.setHeader("Content-Type", "application/json");
      if (path.startsWith("/hook") && failWebhooks) {
        res.statusCode = 500;
        return res.end("{}");
      }
      if (path.includes("/salesOrders") || path.includes("/salesInvoices")) return res.end(JSON.stringify({ id: `bc-${received.length}`, number: "BC-1" }));
      if (path.includes("/transaction/initialize")) return res.end(JSON.stringify({ status: true, data: { authorization_url: `https://checkout.example.test/${JSON.parse(body).reference}` } }));
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.WEBHOOK_ALLOW_PRIVATE = "1";
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  for (const k of ["WEBHOOK_ALLOW_PRIVATE", "ERP_ADAPTER_HMNL", "ERP_BASE_URL", "ERP_TOKEN", "PAYSTACK_SECRET_KEY_HMNL", "PAYSTACK_SECRET_KEY_SNMNL", "PAYSTACK_BASE_URL"]) delete process.env[k];
});

const newDeal = (ctx: AccessContext, brand = "HMNL", over: Record<string, unknown> = {}) =>
  createDeal(ctx, { name: `API deal ${Math.random().toString(36).slice(2, 8)}`, brandId: I.brand(brand), regionId: I.region("Lagos"), amount: 41_000_000, ...(brand === "HMNL" ? { modelId: model.id } : {}), ...over } as never);
const drain = async () => {
  for (let i = 0; i < 5; i++) if ((await runDueJobs(100)).done === 0) break;
};
const sorted = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();

async function principal(name: string, brands: string[], profileName: string = PROFILES.BM) {
  const [role, profile] = await Promise.all([unsafeDb.role.findFirstOrThrow({ where: { name: ROLES.BM } }), unsafeDb.profile.findFirstOrThrow({ where: { name: profileName } })]);
  return tokens.createPrincipal(admin, { name, roleId: role.id, profileId: profile.id, brandIds: brands.map((b) => I.brand(b)) });
}

describe("API tokens", () => {
  it("a personal token of an HMNL exec returns exactly the rows the UI shows", async () => {
    await newDeal(exec);
    await newDeal(snmnlExec, "SNMNL");
    const { token } = await tokens.createPersonalToken(exec, { name: "My script" });
    expect(token).toMatch(/^scrm_/);
    const api = await tokens.authenticateToken(token);
    expect(api.userId).toBe(exec.userId);
    expect(api.tokenId).toBeTruthy();
    const [ui, viaToken] = await Promise.all([listDeals(exec, {}, { take: 500 }), listDeals(api, {}, { take: 500 })]);
    expect(sorted(viaToken.rows)).toEqual(sorted(ui.rows));
    expect(viaToken.rows.every((r) => r.brandId === I.brand("HMNL"))).toBe(true);
    const [uiLeads, apiLeads] = await Promise.all([listLeads(exec, {} as never, { take: 500 }), listLeads(api, {} as never, { take: 500 })]);
    expect(sorted(apiLeads.rows)).toEqual(sorted(uiLeads.rows));
    // only the hash is stored; user sessions cannot read the table at all
    const row = await unsafeDb.apiToken.findFirstOrThrow({ where: { userId: exec.userId }, orderBy: { createdAt: "desc" } });
    expect(row.tokenHash).toBe(tokens.sha256(token));
    expect(JSON.stringify(row)).not.toContain(token);
    await expect(rawAsUser(exec, `SELECT id FROM "ApiToken"`)).rejects.toThrow(/permission denied/);
  });

  it("revoked, expired and unknown tokens are rejected; a token cannot mint tokens; rate limit per token", async () => {
    const { id, token } = await tokens.createPersonalToken(exec, { name: "Short lived", rateLimit: 3 });
    const api = await tokens.authenticateToken(token);
    await expect(tokens.createPersonalToken(api, { name: "Nested" })).rejects.toBeInstanceOf(ForbiddenError);
    await tokens.authenticateToken(token);
    await tokens.authenticateToken(token);
    await expect(tokens.authenticateToken(token)).rejects.toBeInstanceOf(RateLimitError);
    resetRateLimits();
    await unsafeDb.apiToken.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(tokens.authenticateToken(token)).rejects.toBeInstanceOf(UnauthenticatedError);
    await unsafeDb.apiToken.update({ where: { id }, data: { expiresAt: null } });
    await expect(tokens.revokeToken(snmnlExec, id)).rejects.toBeInstanceOf(NotFoundError); // not their token
    await tokens.revokeToken(exec, id);
    await expect(tokens.authenticateToken(token)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(tokens.authenticateToken("scrm_does-not-exist")).rejects.toBeInstanceOf(UnauthenticatedError);
    // a token of a deactivated user stops working
    const other = await tokens.createPersonalToken(snmnlExec, { name: "probe" });
    await unsafeDb.user.update({ where: { id: snmnlExec.userId }, data: { active: false } });
    await expect(tokens.authenticateToken(other.token)).rejects.toBeInstanceOf(UnauthenticatedError);
    await unsafeDb.user.update({ where: { id: snmnlExec.userId }, data: { active: true } });
  });

  it("an integration principal limited to SNMNL cannot read or write HMNL", async () => {
    const hmnlDeal = await newDeal(exec);
    const snmnlDeal = await newDeal(snmnlExec, "SNMNL");
    const p = await principal("SNMNL connector", ["SNMNL"]);
    await expect(tokens.createIntegrationToken(bm, p.id, { name: "probe" })).rejects.toBeInstanceOf(NotFoundError); // administrators only
    await expect(tokens.createIntegrationToken(admin, p.id, { name: "probe", brandIds: [I.brand("HMNL")] })).rejects.toThrow(/brands its user can see/);
    const { token } = await tokens.createIntegrationToken(admin, p.id, { name: "SNMNL sync" });
    const api = await tokens.authenticateToken(token);
    expect(api.brandIds).toEqual([I.brand("SNMNL")]);
    const { rows } = await listDeals(api, {}, { take: 500 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.brandId === I.brand("SNMNL"))).toBe(true);
    expect((await getDeal(api, snmnlDeal.id)).id).toBe(snmnlDeal.id);
    await expect(getDeal(api, hmnlDeal.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createLead(api, { lastName: "Smuggled", mobile: "08031234567", source: "WALK_IN", brandId: I.brand("HMNL"), regionId: I.region("Lagos") } as never)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await rawAsUser(api, `SELECT id FROM "Deal" WHERE id = '${hmnlDeal.id}'`)).toEqual([]); // RLS agrees
    // the principal cannot sign in
    const user = await unsafeDb.user.findUniqueOrThrow({ where: { id: p.id }, select: { isIntegration: true, passwordHash: true, email: true } });
    expect(user).toMatchObject({ isIntegration: true, passwordHash: null });
    expect(user.email).toMatch(/@integration\.invalid$/);
  });

  it("a brand-limited token of a group-wide user is narrowed to those brands and loses admin rights", async () => {
    const { token } = await tokens.createPersonalToken(md, { name: "SNMNL report feed", brandIds: [I.brand("SNMNL")] });
    const api = await tokens.authenticateToken(token);
    expect(api).toMatchObject({ scope: "TERRITORY", brandIds: [I.brand("SNMNL")], isAdmin: false });
    const { rows } = await listDeals(api, {}, { take: 500 });
    expect(rows.every((r) => r.brandId === I.brand("SNMNL"))).toBe(true);
    const hmnlDeal = await newDeal(exec);
    await expect(getDeal(api, hmnlDeal.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(tokens.restrictToBrands(admin, [I.brand("HMNL")]).isAdmin).toBe(false);
    await expect(tokens.createPersonalToken(exec, { name: "wider", brandIds: [I.brand("SNMNL")] })).rejects.toThrow(/brands its user can see/);
  });

  it("OAuth2 client credentials issue a one-hour token for the client's principal", async () => {
    const p = await principal("HMNL ERP connector", ["HMNL"]);
    const client = await tokens.createClient(admin, { name: "ERP", userId: p.id, brandIds: [] });
    await expect(tokens.issueClientToken(client.clientId, "wrong-secret")).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(tokens.issueClientToken("scrm_client_unknown", client.clientSecret)).rejects.toBeInstanceOf(UnauthenticatedError);
    const grant = await tokens.issueClientToken(client.clientId, client.clientSecret);
    expect(grant).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    const api = await tokens.authenticateToken(grant.access_token);
    expect(api.userId).toBe(p.id);
    expect(api.brandIds).toEqual([I.brand("HMNL")]);
    // disabling the client revokes what it issued
    const row = (await tokens.listClients(admin)).find((c) => c.clientId === client.clientId)!;
    await tokens.setClientActive(admin, row.id, false);
    await expect(tokens.authenticateToken(grant.access_token)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(tokens.issueClientToken(client.clientId, client.clientSecret)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(tokens.createClient(admin, { name: "People", userId: exec.userId })).rejects.toThrow(/integration principal/);
  });

  it("soft delete needs the delete permission and hides the record", async () => {
    const deal = await newDeal(exec);
    await expect(softDelete(snmnlExec, "deals", deal.id)).rejects.toSatisfy((e) => e instanceof NotFoundError || e instanceof ForbiddenError);
    const canDelete = exec.profile.permissions.deals?.delete === true;
    if (!canDelete) await expect(softDelete(exec, "deals", deal.id)).rejects.toBeInstanceOf(ForbiddenError);
    await softDelete(md.profile.permissions.deals?.delete ? md : admin, "deals", deal.id);
    await expect(getDeal(exec, deal.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await unsafeDb.deal.findUniqueOrThrow({ where: { id: deal.id } })).deletedAt).not.toBeNull();
  });
});

describe("webhooks", () => {
  it("delivers signed payloads that contain only what the subscription's principal may see", async () => {
    // a principal whose profile hides the deal amount, limited to HMNL
    const bmProfile = await unsafeDb.profile.findFirstOrThrow({ where: { name: PROFILES.BM } });
    const masked = await unsafeDb.profile.create({ data: { name: `Webhook masked ${Date.now()}`, scope: "TERRITORY", permissions: bmProfile.permissions as object, fieldPermissions: { deals: { amount: "hidden" } } } });
    const hmnl = await principal("HMNL event feed", ["HMNL"], masked.name);
    const snmnl = await principal("SNMNL event feed", ["SNMNL"]);
    await expect(saveSubscription(bm, null, { name: "probe", url: `${base}/hook/x`, events: ["deal.created"], userId: hmnl.id })).rejects.toBeInstanceOf(NotFoundError); // administrators only
    await expect(saveSubscription(admin, null, { name: "probe", url: `${base}/hook/x`, events: ["deal.created"], userId: hmnl.id, brandIds: [I.brand("SNMNL")] })).rejects.toThrow(/principal cannot see/);
    const a = await saveSubscription(admin, null, { name: "HMNL deals", url: `${base}/hook/hmnl`, events: ["deal.created", "deal.stage_changed"], userId: hmnl.id });
    await saveSubscription(admin, null, { name: "SNMNL only filter", url: `${base}/hook/filtered`, events: ["deal.created"], userId: md.userId, brandIds: [I.brand("SNMNL")] });
    const c = await saveSubscription(admin, null, { name: "SNMNL principal, no filter", url: `${base}/hook/snmnl-principal`, events: ["deal.created"], userId: snmnl.id });
    expect(a.secret).toMatch(/^whsec_/);

    received.length = 0;
    const deal = await newDeal(exec);
    await drain();

    const hook = received.filter((r) => r.path === "/hook/hmnl");
    expect(hook).toHaveLength(1);
    const payload = JSON.parse(hook[0]!.body) as { event: string; brandId: string; data: Record<string, unknown> };
    expect(payload).toMatchObject({ event: "deal.created", brandId: I.brand("HMNL"), entity: "Deal" });
    expect(payload.data.id).toBe(deal.id);
    expect(payload.data.name).toBe((await getDeal(exec, deal.id)).name);
    expect(payload.data.amount ?? null).toBeNull(); // hidden for the principal's profile
    expect(hook[0]!.body).not.toContain("41000000");
    // signature: t=<ts>,v1=<hmac of "<ts>.<body>">
    const sig = String(hook[0]!.headers["x-stallion-signature"]);
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig)!;
    expect(v1).toBe(createHmac("sha256", a.secret!).update(`${t}.${hook[0]!.body}`).digest("hex"));
    expect(hook[0]!.headers["x-stallion-event"]).toBe("deal.created");

    // the brand filter keeps HMNL events away; a principal without access gets nothing (logged as skipped)
    expect(received.some((r) => r.path === "/hook/filtered")).toBe(false);
    expect(received.some((r) => r.path === "/hook/snmnl-principal")).toBe(false);
    const log = await listDeliveries(admin, c.id);
    expect(log[0]).toMatchObject({ status: "SKIPPED", entityId: deal.id });
    expect((await listDeliveries(admin, a.id))[0]).toMatchObject({ status: "DELIVERED", responseStatus: 200 });
    // the secret is never listed again
    expect(JSON.stringify(await (await import("@/server/integrations/webhooks")).listSubscriptions(admin))).not.toContain(a.secret!);
  });

  it("a failing receiver is retried with back-off and shows in the delivery log", async () => {
    const p = await principal("Retry feed", ["HMNL"]);
    const sub = await saveSubscription(admin, null, { name: "Flaky", url: `${base}/hook/flaky`, events: ["lead.created"], userId: p.id });
    failWebhooks = true;
    await createLead(exec, { lastName: `Hook ${Date.now()}`, mobile: `0803${String(Date.now()).slice(-7)}`, source: "WALK_IN", brandId: I.brand("HMNL"), regionId: I.region("Lagos") } as never);
    await drain();
    const [first] = await listDeliveries(admin, sub.id);
    expect(first).toMatchObject({ status: "FAILED", responseStatus: 500, attempts: 1 });
    const job = await unsafeDb.job.findFirstOrThrow({ where: { type: "webhook.deliver", payload: { path: ["deliveryId"], equals: first!.id } } });
    expect(job.status).toBe("FAILED");
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now()); // back-off
    failWebhooks = false;
    await unsafeDb.job.update({ where: { id: job.id }, data: { runAt: new Date() } });
    await drain();
    expect((await listDeliveries(admin, sub.id))[0]).toMatchObject({ status: "DELIVERED", attempts: 2 });
  });
});

describe("ERP and payments", () => {
  async function confirmedOrder(ctx: AccessContext, brand: string) {
    const deal = await newDeal(ctx, brand);
    const quote = await docs.createQuoteFromDeal(ctx, deal.id);
    if (brand !== "HMNL") await docs.saveDocument(ctx, "quote", quote.id, { lines: [{ description: "Vehicle", qty: 1, unitPrice: 30_000_000, discountPct: 0, taxRate: 7.5 }] } as never);
    await docs.submitQuote(ctx, quote.id);
    await docs.acceptQuote(ctx, quote.id);
    const order = await docs.convertQuoteToOrder(ctx, quote.id);
    await docs.confirmOrder(ctx, order.id);
    return order.id;
  }

  it("posts an HMNL sales order to the HMNL company only; other brands stay off; payments reconcile back", async () => {
    process.env.ERP_ADAPTER_HMNL = "business-central";
    process.env.ERP_BASE_URL = `${base}/bc`;
    process.env.ERP_TOKEN = "erp-test-token";
    received.length = 0;
    const hmnlOrder = await confirmedOrder(exec, "HMNL");
    const snmnlOrder = await confirmedOrder(snmnlExec, "SNMNL");
    await drain();

    const posts = received.filter((r) => r.path.startsWith("/bc/"));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe("/bc/companies(ERP-HMNL)/salesOrders");
    expect(posts[0]!.headers.authorization).toBe("Bearer erp-test-token");
    const so = await getDocument(exec, "salesOrder", hmnlOrder);
    expect(JSON.parse(posts[0]!.body)).toMatchObject({ externalDocumentNumber: so.number });
    const ref = await unsafeDb.externalRef.findFirstOrThrow({ where: { entity: "SalesOrder", entityId: hmnlOrder } });
    expect(ref).toMatchObject({ system: "erp:business-central", companyCode: "ERP-HMNL", brandId: I.brand("HMNL") });
    expect(await unsafeDb.externalRef.count({ where: { entityId: snmnlOrder } })).toBe(0); // no adapter for SNMNL
    // posting is idempotent
    await (await import("@/server/integrations/events")).dispatchEvent("salesorder.confirmed", hmnlOrder);
    await drain();
    expect(received.filter((r) => r.path.startsWith("/bc/"))).toHaveLength(1);

    // invoice → ERP → payment comes back
    const invoice = await docs.convertOrderToInvoice(exec, hmnlOrder);
    await docs.issueInvoice(exec, invoice.id);
    await drain();
    const invRef = await unsafeDb.externalRef.findFirstOrThrow({ where: { entity: "Invoice", entityId: invoice.id } });
    expect(received.at(-1)!.path).toBe("/bc/companies(ERP-HMNL)/salesInvoices");
    await expect(reconcilePayment({ externalId: invRef.externalId, companyCode: "ERP-SNMNL", amount: 1000, reference: "RCPT-1" })).rejects.toThrow(/Unknown invoice/); // another company's feed
    const res = await reconcilePayment({ externalId: invRef.externalId, companyCode: "ERP-HMNL", amount: 1_000_000, reference: "RCPT-1" });
    expect(res).toMatchObject({ duplicate: false, status: "PART_PAID" });
    expect(await reconcilePayment({ externalId: invRef.externalId, companyCode: "ERP-HMNL", amount: 1_000_000, reference: "RCPT-1" })).toMatchObject({ duplicate: true });
    expect((await getDocument(exec, "invoice", invoice.id)).amountPaid).toBe(1_000_000);
    // user sessions cannot see integration tables
    await expect(rawAsUser(exec, `SELECT id FROM "ExternalRef"`)).rejects.toThrow(/permission denied/);
  });

  it("a brand without an ERP company code fails loudly instead of posting somewhere else", async () => {
    process.env.ERP_ADAPTER_HMNL = "business-central";
    await unsafeDb.brand.update({ where: { id: I.brand("HMNL") }, data: { erpCompanyCode: null } });
    received.length = 0;
    const order = await confirmedOrder(exec, "HMNL");
    await drain();
    expect(received.filter((r) => r.path.startsWith("/bc/"))).toHaveLength(0);
    const job = await unsafeDb.job.findFirstOrThrow({ where: { type: "erp.post", payload: { path: ["entityId"], equals: order } } });
    expect(job.lastError).toMatch(/no ERP company code/);
    await unsafeDb.brand.update({ where: { id: I.brand("HMNL") }, data: { erpCompanyCode: "ERP-HMNL" } });
  });

  it("payment links use the brand's own merchant key; a verified webhook books the receipt once", async () => {
    delete process.env.ERP_ADAPTER_HMNL;
    const orderId = await confirmedOrder(exec, "HMNL");
    const invoice = await docs.convertOrderToInvoice(exec, orderId);
    await docs.issueInvoice(exec, invoice.id);
    await expect(createPaymentLink(exec, invoice.id, { email: "buyer@example.test" })).rejects.toThrow(/not configured/); // feature flag off
    process.env.PAYSTACK_SECRET_KEY_HMNL = "sk_test_hmnl";
    process.env.PAYSTACK_SECRET_KEY_SNMNL = "sk_test_snmnl";
    process.env.PAYSTACK_BASE_URL = `${base}/paystack`;
    await expect(createPaymentLink(snmnlExec, invoice.id, { email: "buyer@example.test" })).rejects.toBeInstanceOf(NotFoundError); // other brand
    await expect(createPaymentLink(exec, invoice.id, { amount: 1e12, email: "buyer@example.test" })).rejects.toThrow(/outstanding balance/);
    received.length = 0;
    const link = await createPaymentLink(exec, invoice.id, { amount: 2_000_000, email: "buyer@example.test" });
    expect(link.url).toBe(`https://checkout.example.test/${link.reference}`);
    const init = received.find((r) => r.path === "/paystack/transaction/initialize")!;
    expect(init.headers.authorization).toBe("Bearer sk_test_hmnl");
    expect(JSON.parse(init.body)).toMatchObject({ amount: 200_000_000, currency: "NGN", reference: link.reference }); // kobo

    const body = JSON.stringify({ event: "charge.success", data: { reference: link.reference, amount: 200_000_000, status: "success" } });
    const sign = (key: string) => new Headers({ "x-paystack-signature": createHmac("sha512", key).update(body).digest("hex") });
    expect((await handlePaymentWebhook("paystack", body, new Headers())).status).toBe(401);
    expect((await handlePaymentWebhook("paystack", body, sign("sk_test_snmnl"))).status).toBe(401); // another brand's key
    expect((await getDocument(exec, "invoice", invoice.id)).amountPaid).toBe(0);
    expect(await handlePaymentWebhook("paystack", body, sign("sk_test_hmnl"))).toEqual({ status: 200, result: "paid" });
    expect(await handlePaymentWebhook("paystack", body, sign("sk_test_hmnl"))).toEqual({ status: 200, result: "duplicate" });
    const paid = await getDocument(exec, "invoice", invoice.id);
    expect(paid).toMatchObject({ amountPaid: 2_000_000, status: "PART_PAID" });
    expect(paid.payments).toHaveLength(1);
    expect(paid.payments[0]).toMatchObject({ method: "ONLINE", reference: link.reference });
    // unknown reference: nothing to verify against
    const unknown = JSON.stringify({ event: "charge.success", data: { reference: "NOPE", amount: 1, status: "success" } });
    expect((await handlePaymentWebhook("paystack", unknown, new Headers({ "x-paystack-signature": "x" }))).status).toBe(401);
  });
});
