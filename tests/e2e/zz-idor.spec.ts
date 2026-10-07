import fs from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { login } from "./helpers";

/**
 * IDOR scan (prompt 15 §2): every `/api/v1/**` route with an `[id]` segment is called by an HMNL executive with
 * the id of a record of ANOTHER brand. The answer must be 404 – or a refusal that is identical for an id that does
 * not exist at all (403 because the profile lacks the permission, 400 because the body is invalid), so that no
 * response confirms the record exists. It must never be a success.
 *
 * The routes are discovered from the file system: a new route must either be scanned (give it an id source
 * below) or be listed in EXEMPT with the reason – otherwise this test fails.
 */
const API = path.join(process.cwd(), "src", "app", "api", "v1");

function discover(dir = API, prefix = "/api/v1"): Array<{ route: string; methods: string[] }> {
  const out: Array<{ route: string; methods: string[] }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...discover(path.join(dir, entry.name), `${prefix}/${entry.name}`));
    else if (entry.name === "route.ts" && prefix.includes("[id]")) {
      const src = fs.readFileSync(path.join(dir, entry.name), "utf8");
      out.push({ route: prefix, methods: [...src.matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => m[1]!) });
    }
  }
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

/** Where a foreign id for each route family comes from: a list endpoint read as group management, filtered to SNMNL. */
const SOURCES: Record<string, string> = {
  activities: "/api/v1/activities?limit=200",
  campaigns: "/api/v1/campaigns?limit=200",
  cases: "/api/v1/cases?queue=all&limit=200",
  deals: "/api/v1/deals?limit=200",
  invoices: "/api/v1/invoices?limit=200",
  leads: "/api/v1/leads?limit=200",
  priceBooks: "/api/v1/priceBooks?limit=200",
  products: "/api/v1/products?limit=200",
  quotes: "/api/v1/quotes?limit=200",
  salesOrders: "/api/v1/salesOrders?limit=200",
  vendors: "/api/v1/inventory/vendors",
};
/** Inventory: the generic `[resource]/[id]` route is scanned once per resource. */
const INVENTORY = ["vehicle-units", "shipments", "landed-costs", "journals"];

const EXEMPT: Record<string, string> = {
  "/api/v1/[module]/from-template/[id]": "the id is a record template (not brand-owned data); a template of another brand is a 404 and creating in a foreign brand is refused – tests/integration/templates-hub.test.ts",
  "/api/v1/generated-documents/[id]": "a stored copy is only made by sending or downloading a document with a template; reading one loads its record with the caller's access first – another brand's copy is a 404 in tests/integration/doctpl.test.ts",
  "/api/v1/accounts/[id]": "customers are shared between brands by design (BUSINESS_CONTEXT §8); masking by tier is covered by the customer tests",
  "/api/v1/contacts/[id]": "customers are shared between brands by design; masking by tier is covered by the customer tests",
  "/api/v1/brands/[id]/logo": "brand names and logos are a shared directory",
  "/api/v1/reports/[id]": "report definitions are per user / shared – not brand-owned; their RESULTS are scoped (isolation suite)",
  "/api/v1/reports/[id]/export": "see reports/[id]",
  "/api/v1/exports/[id]/download": "export jobs belong to one user (own rows by RLS) – covered by the data-tools tests",
  "/api/v1/salesOrders/[id]": "orders exist only by converting a quote in the UI; the route is the same handler factory as /quotes/[id] (scanned) and SalesOrder visibility is asserted in tests/isolation",
  "/api/v1/salesOrders/[id]/pdf": "see salesOrders/[id]",
  "/api/v1/invoices/[id]": "see salesOrders/[id]; Invoice visibility is asserted in tests/isolation",
  "/api/v1/invoices/[id]/pdf": "see salesOrders/[id]",
  "/api/v1/invoices/[id]/link": "link later (prompt 23): another brand's invoice → 404 in tests/e2e/standalone.spec.ts and tests/integration/standalone.test.ts",
  "/api/v1/salesOrders/[id]/link": "see invoices/[id]/link",
  "/api/v1/sales-orders/[id]": "alias of salesOrders/[id] (same handler)",
  "/api/v1/sales-orders/[id]/link": "alias of salesOrders/[id]/link (same handler)",
  "/api/v1/invoices/[id]/payment-links": "asserted in tests/integration/api-integrations.test.ts (another brand → 404)",
  "/api/v1/attachments/[id]": "no API creates an attachment for the scan; download of a hidden attachment is asserted in tests/isolation/matrix.test.ts",
};

async function foreignIds(md: APIRequestContext, snmnl: string): Promise<Record<string, string | undefined>> {
  const ids: Record<string, string | undefined> = {};
  for (const [family, url] of Object.entries(SOURCES)) {
    const res = await md.get(url);
    const rows = res.ok() ? (((await res.json()) as { data: Array<{ id: string; brandId?: string | null }> }).data ?? []) : [];
    ids[family] = rows.find((r) => r.brandId === snmnl)?.id;
  }
  for (const resource of INVENTORY) {
    const res = await md.get(`/api/v1/inventory/${resource}?limit=200`);
    const rows = res.ok() ? (((await res.json()) as { data: Array<{ id: string; brandId?: string }> }).data ?? []) : [];
    ids[`inventory:${resource}`] = rows.find((r) => r.brandId === snmnl)?.id;
  }
  return ids;
}

test("IDOR scan: ids of another brand answer 404 on every /api/v1 route with an id", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const routes = discover();
  expect(routes.length).toBeGreaterThan(15);

  // group management collects ids of SNMNL records
  const mdCtx = await browser.newContext();
  const mdPage = await mdCtx.newPage();
  await login(mdPage, "md");
  const md = mdPage.request;
  const brands = ((await (await md.get("/api/v1/me")).json()) as { data: { brandIds: string[] } }).data.brandIds;
  const deals = ((await (await md.get("/api/v1/deals?limit=200")).json()) as { data: Array<{ id: string; brandId: string }> }).data;
  // SNMNL = the brand of exec.snmnl.1
  const snCtx = await browser.newContext();
  const snPage = await snCtx.newPage();
  await login(snPage, "exec.snmnl.1");
  const snmnl = ((await (await snPage.request.get("/api/v1/me")).json()) as { data: { memberships: Array<{ brandId: string }> } }).data.memberships[0]!.brandId;
  expect(brands).toContain(snmnl);
  expect(deals.some((d) => d.brandId === snmnl)).toBe(true);
  // SNMNL records that the seed does not contain are created by SNMNL users through the API
  const snMe = ((await (await snPage.request.get("/api/v1/me")).json()) as { data: { memberships: Array<{ brandId: string; regionId: string }> } }).data.memberships[0]!;
  const snDeal = ((await (await snPage.request.get("/api/v1/deals?limit=1")).json()) as { data: Array<{ id: string }> }).data[0]!; // a deal the SNMNL executive can work on
  const created = async (res: Awaited<ReturnType<typeof snPage.request.post>>) => {
    expect(res.status(), await res.text()).toBe(201);
    return ((await res.json()) as { data: { id: string } }).data.id;
  };
  const made: Record<string, string> = {
    quotes: await created(await snPage.request.post("/api/v1/quotes", { data: { dealId: snDeal.id } })),
    cases: await created(await snPage.request.post("/api/v1/cases", { data: { subject: "IDOR scan case", type: "ENQUIRY", priority: "LOW", brandId: snMe.brandId, regionId: snMe.regionId, customerName: "Scan" } })),
    activities: await created(await snPage.request.post("/api/v1/activities", { data: { type: "TASK", parentType: "Deal", parentId: snDeal.id, subject: "IDOR scan task", dueAt: new Date(Date.now() + 86_400_000).toISOString() } })),
  };
  const bmCtx = await browser.newContext();
  const bmPage = await bmCtx.newPage();
  await login(bmPage, "bm.snmnl");
  made.campaigns = await created(await bmPage.request.post("/api/v1/campaigns", { data: { name: "IDOR scan campaign", brandId: snmnl, channel: "EMAIL", type: "PROMO" } }));
  await bmCtx.close();
  const ids = { ...(await foreignIds(md, snmnl)), ...made };
  await snCtx.close();

  // the HMNL executive tries every route
  await login(page, "exec.hmnl.1");
  const findings: string[] = [];
  const unclassified: string[] = [];
  let scanned = 0;
  const probe = async (label: string, url: string, methods: string[], foreignId: string) => {
    for (const method of methods) {
      const call = (u: string) => page.request.fetch(u, { method, ...(method === "GET" || method === "DELETE" ? {} : { data: {} }) });
      const status = (await call(url)).status();
      scanned++;
      if (status === 404) continue;
      // Anything else must (a) never be a success and (b) be exactly what a NON-EXISTENT id gets – a refusal that
      // comes before the record is looked up (missing permission → 403, invalid body → 400) tells nothing about it.
      const ghost = (await call(url.replace(foreignId, "cnonexistentid0000000000000"))).status();
      if (![400, 403].includes(status) || ghost !== status) findings.push(`${method} ${label} → ${status} (a non-existent id → ${ghost})`);
    }
  };
  for (const { route, methods } of routes) {
    if (EXEMPT[route]) continue;
    if (route.startsWith("/api/v1/inventory/[resource]/[id]")) {
      for (const resource of INVENTORY) {
        const id = ids[`inventory:${resource}`];
        expect(id, `an SNMNL ${resource} id to scan with`).toBeTruthy();
        await probe(route.replace("[resource]", resource), route.replace("[resource]", resource).replace("[id]", id!), methods, id!);
      }
      continue;
    }
    const family = route.startsWith("/api/v1/inventory/documents/") ? "inventory:shipments" : route.startsWith("/api/v1/inventory/vehicle-units/") ? "inventory:vehicle-units" : route.split("/")[3]!;
    const id = ids[family];
    if (!id) {
      unclassified.push(route);
      continue;
    }
    await probe(route, route.replace("[id]", id), methods, id);
  }
  expect(unclassified, "routes with an [id] that are neither scanned nor exempt – add an id source or an exemption with its reason").toEqual([]);
  expect(findings, "IDOR findings").toEqual([]);
  expect(scanned).toBeGreaterThan(30);

  // sanity: the same requests succeed for the brand's own records (the scan is not passing because everything is 404)
  const own = ((await (await page.request.get("/api/v1/deals?limit=1")).json()) as { data: Array<{ id: string }> }).data[0]!;
  expect((await page.request.get(`/api/v1/deals/${own.id}`)).status()).toBe(200);
  await mdCtx.close();
});

test("security headers, health check and cross-site request refusal", async ({ page, playwright, baseURL }) => {
  const res = await page.goto("/login");
  const h = res!.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).toContain("default-src 'self'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-powered-by"]).toBeUndefined();

  const health = await page.request.get("/api/public/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: "ok", database: true });

  // a signed-in browser session cannot be used from another site
  await login(page, "exec.hmnl.1");
  const cookies = await page.context().cookies();
  const evil = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: "https://evil.example", Cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") } });
  const forged = await evil.post("/api/v1/leads", { data: { lastName: "Forged", mobile: "08030000000" } });
  expect(forged.status()).toBe(403);
  expect(((await forged.json()) as { error: { message: string } }).error.message).toMatch(/Cross-site/);
  const crossSite = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "Sec-Fetch-Site": "cross-site", Cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") } });
  expect((await crossSite.delete("/api/v1/leads/whatever")).status()).toBe(403);
  // reading is unaffected, and same-origin writes still work
  expect((await evil.get("/api/v1/me")).status()).toBe(200);
  await evil.dispose();
  await crossSite.dispose();
});
