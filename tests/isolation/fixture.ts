/**
 * Isolation fixture (prompt 15): a dedicated, fictitious organisation generated for every test run –
 * 2 brands × 2 regions, one persona per row of the visibility matrix, and records of every brand-owned model
 * in every brand–region. Nothing here refers to real brands or people.
 *
 *   brand A ("the HMNL of the matrix"), brand B ("SNMNL"); region R1 ("Lagos"), region R2 ("the regional office")
 */
import { randomBytes } from "node:crypto";
import { loadAccessContext } from "@/server/access/context";
import type { AccessContext } from "@/server/access/types";
import { createActivity } from "@/server/modules/activities/service";
import { createBrand, createRegion, createUser } from "@/server/modules/admin/service";
import { createCase } from "@/server/modules/cases/service";
import { createDeal } from "@/server/modules/deals/service";
import * as docs from "@/server/modules/documents/service";
import { createLead } from "@/server/modules/leads/service";
import { addAttachment, addNote } from "@/server/modules/notes/service";
import { PROFILES, ROLES } from "../../prisma/seed-data";
import { ctxFor, unsafeDb } from "../integration/helpers";

export interface Persona {
  key: string;
  ctx: AccessContext;
  /** what the persona stands for in the matrix */
  label: string;
}
export interface Cell {
  brand: "A" | "B";
  region: "R1" | "R2";
  brandId: string;
  regionId: string;
  leadId: string;
  dealId: string;
  dealName: string;
  quoteId: string;
  orderId: string;
  invoiceId: string;
  activityId: string;
  caseId: string;
  noteId: string;
  vin: string;
}
export interface Fixture {
  tag: string;
  brands: { A: { id: string; code: string }; B: { id: string; code: string } };
  regions: { R1: { id: string; name: string }; R2: { id: string; name: string } };
  personas: Record<"execA1" | "execA1b" | "execA2" | "execB1" | "multi" | "regional" | "rsm" | "bmA" | "bmB" | "hos" | "admin", Persona>;
  cells: Cell[];
  cell: (brand: "A" | "B", region: "R1" | "R2") => Cell;
  productA: string;
  productB: string;
  accountId: string;
}

export async function buildFixture(): Promise<Fixture> {
  const tag = randomBytes(3).toString("hex").toUpperCase();
  const admin = await ctxFor("admin");
  const [A, B] = await Promise.all([createBrand(admin, { code: `IA${tag}`, name: `Isolation A ${tag}`, docPrefix: `IA${tag}`, color: "#1d4ed8" } as never), createBrand(admin, { code: `IB${tag}`, name: `Isolation B ${tag}`, docPrefix: `IB${tag}`, color: "#b91c1c" } as never)]);
  const R1 = await createRegion(admin, { name: `Iso City ${tag}` });
  const R2 = await createRegion(admin, { name: `Iso Regional ${tag}` });
  const territories = await unsafeDb.territory.findMany({ where: { brandId: { in: [A.id, B.id] } } });
  const t = (brandId: string, regionId: string | null) => territories.find((x) => x.brandId === brandId && x.regionId === regionId)!.id;
  const [roles, profiles] = await Promise.all([unsafeDb.role.findMany(), unsafeDb.profile.findMany()]);
  const role = (name: string) => roles.find((r) => r.name === name)!.id;
  const profile = (name: string) => profiles.find((p) => p.name === name)!.id;

  const mk = async (key: string, label: string, roleName: string, profileName: string, territoryIds: string[]): Promise<Persona> => {
    const user = await createUser(admin, { name: `${label} ${tag}`, email: `${key.toLowerCase()}.${tag.toLowerCase()}@isolation.test`, roleId: role(roleName), profileId: profile(profileName), managerId: null, password: null }, territoryIds);
    return { key, label, ctx: (await loadAccessContext(user.id))! };
  };
  const personas = {
    execA1: await mk("execA1", "Brand A city exec", ROLES.LAGOS_EXEC, PROFILES.EXEC, [t(A.id, R1.id)]),
    execA1b: await mk("execA1b", "Brand A city exec 2", ROLES.LAGOS_EXEC, PROFILES.EXEC, [t(A.id, R1.id)]),
    execA2: await mk("execA2", "Brand A regional-office exec", ROLES.REGIONAL_EXEC, PROFILES.EXEC, [t(A.id, R2.id)]),
    execB1: await mk("execB1", "Brand B city exec", ROLES.LAGOS_EXEC, PROFILES.EXEC, [t(B.id, R1.id)]),
    multi: await mk("multi", "Multi-brand city rep (A + B)", ROLES.LAGOS_EXEC, PROFILES.EXEC, [t(A.id, R1.id), t(B.id, R1.id)]),
    regional: await mk("regional", "Regional exec (all fixture brands, R2)", ROLES.REGIONAL_EXEC, PROFILES.EXEC, [t(A.id, R2.id), t(B.id, R2.id)]),
    rsm: await mk("rsm", "Regional Sales Manager (R2)", ROLES.RSM, PROFILES.RSM, [t(A.id, R2.id), t(B.id, R2.id)]),
    bmA: await mk("bmA", "Brand Manager A", ROLES.BM, PROFILES.BM, [t(A.id, null)]),
    bmB: await mk("bmB", "Brand Manager B", ROLES.BM, PROFILES.BM, [t(B.id, null)]),
    hos: await mk("hos", "Head of Sales", ROLES.HOS, PROFILES.MANAGEMENT, []),
    // reloaded: an access context is built per request, so it knows the brands created above
    admin: { key: "admin", label: "Administrator", ctx: (await loadAccessContext(admin.userId))! },
  };
  // approvals go to the brand's manager
  await unsafeDb.brand.update({ where: { id: A.id }, data: { brandManagerId: personas.bmA.ctx.userId } });
  await unsafeDb.brand.update({ where: { id: B.id }, data: { brandManagerId: personas.bmB.ctx.userId } });

  // catalogue: one model per brand with a price
  const product = async (brandId: string, code: string) => {
    const p = await unsafeDb.product.create({ data: { brandId, code: `${code}-SEDAN`, name: `${code} Sedan`, model: `${code} Sedan`, category: "VEHICLE", listPrice: 30_000_000 } });
    const book = await unsafeDb.priceBook.create({ data: { brandId, name: `${code} list`, validFrom: new Date(Date.UTC(2020, 0, 1)), isDefault: true } });
    await unsafeDb.priceBookEntry.create({ data: { priceBookId: book.id, productId: p.id, price: 30_000_000, maxDiscountPct: 3 } });
    return p.id;
  };
  const [productA, productB] = [await product(A.id, A.code), await product(B.id, B.code)];
  // one shared customer with deals in both brands (VT-03)
  const account = await unsafeDb.account.create({ data: { name: `Shared Customer ${tag}`, phone: `+2348030${tag.replace(/\D/g, "7").padEnd(6, "1").slice(0, 6)}`, email: `shared.${tag.toLowerCase()}@example.test`, ownerId: personas.execA1.ctx.userId } });

  // records of every brand-owned model in every brand–region, created by the exec of that territory
  const owners: Record<string, AccessContext> = { "A|R1": personas.execA1.ctx, "A|R2": personas.execA2.ctx, "B|R1": personas.execB1.ctx, "B|R2": personas.regional.ctx };
  const cells: Cell[] = [];
  let n = 0;
  for (const brand of ["A", "B"] as const) {
    for (const region of ["R1", "R2"] as const) {
      const ctx = owners[`${brand}|${region}`]!;
      const b = brand === "A" ? A : B;
      const r = region === "R1" ? R1 : R2;
      const label = `${b.code}-${region}`;
      const vin = `ISO${tag}${brand}${region}`.toUpperCase().padEnd(17, "0").slice(0, 17);
      const lead = (await createLead(ctx, { firstName: "Iso", lastName: `Lead ${label}`, mobile: `0803${String(7000000 + n++ * 13 + parseInt(tag, 16) % 900000).slice(-7)}`, source: "WALK_IN", brandId: b.id, regionId: r.id } as never)) as { id: string };
      const deal = await createDeal(ctx, { name: `Deal ${label}`, customerName: `Customer ${label}`, brandId: b.id, regionId: r.id, amount: 30_000_000, modelId: brand === "A" ? productA : productB, accountId: account.id, vinChassisNo: vin } as never);
      const quote = await docs.createQuoteFromDeal(ctx, deal.id);
      await docs.submitQuote(ctx, quote.id);
      await docs.acceptQuote(ctx, quote.id);
      const order = await docs.convertQuoteToOrder(ctx, quote.id);
      await docs.confirmOrder(ctx, order.id);
      const invoice = await docs.convertOrderToInvoice(ctx, order.id);
      const activity = (await createActivity(ctx, { type: "TASK", parentType: "Deal", parentId: deal.id, subject: `Task ${label}`, dueAt: new Date(Date.now() + 86_400_000).toISOString() })) as { id: string };
      const kase = (await createCase(ctx, { subject: `Case ${label}`, type: "COMPLAINT", priority: "MEDIUM", brandId: b.id, regionId: r.id, dealId: deal.id, customerName: `Customer ${label}` } as never)) as { id: string };
      const note = (await addNote(ctx, "Deal", deal.id, `Note ${label}`)) as { id: string };
      await addAttachment(ctx, "Deal", deal.id, { name: `file-${label}.txt`, type: "text/plain", bytes: new TextEncoder().encode(`attachment ${label}`) });
      // a logged message (the row is what matters here; sending is covered by the messaging tests)
      await unsafeDb.message.create({ data: { channel: "SMS", direction: "OUT", status: "SENT", parentType: "Lead", parentId: lead.id, fromAddress: b.code, toAddress: "+2348030000000", body: `Hello from ${label}`, brandId: b.id, regionId: r.id, ownerId: ctx.userId } });
      cells.push({ brand, region, brandId: b.id, regionId: r.id, leadId: lead.id, dealId: deal.id, dealName: `Deal ${label}`, quoteId: quote.id, orderId: order.id, invoiceId: invoice.id, activityId: activity.id, caseId: kase.id, noteId: note.id, vin });
    }
  }
  // a discount above the brand's threshold in A–R1: an approval request for Brand Manager A (VT-11 / VT-12)
  const discounted = await docs.createQuoteFromDeal(owners["A|R1"]!, cells[0]!.dealId).catch(() => null);
  if (discounted) {
    const d = await unsafeDb.documentLine.findFirst({ where: { quoteId: discounted.id } });
    if (d) {
      await docs.saveDocument(owners["A|R1"]!, "quote", discounted.id, { lines: [{ productId: d.productId, description: d.description, qty: 1, unitPrice: 30_000_000, discountPct: 5, taxRate: 7.5 }] } as never); // above the 3 % threshold, below escalation
      await docs.submitQuote(owners["A|R1"]!, discounted.id);
    }
  }
  return { tag, brands: { A: { id: A.id, code: A.code }, B: { id: B.id, code: B.code } }, regions: { R1: { id: R1.id, name: R1.name }, R2: { id: R2.id, name: R2.name } }, personas, cells, cell: (brand, region) => cells.find((c) => c.brand === brand && c.region === region)!, productA, productB, accountId: account.id };
}
