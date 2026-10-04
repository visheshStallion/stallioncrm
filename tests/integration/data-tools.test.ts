import { beforeAll, describe, expect, it } from "vitest";
import { decryptBackup } from "@/lib/backup-crypto";
import { parseCsv, toCsv } from "@/lib/csv";
import { toXlsx } from "@/lib/xlsx";
import { readXlsx } from "@/lib/xlsx-read";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { BadRequestError } from "@/server/errors";
import { conditionsToWhere, parseConditions } from "@/server/list/filters";
import * as custom from "@/server/modules/customization/service";
import { getDeal, listDeals } from "@/server/modules/deals/queries";
import { createDeal, updateDeal } from "@/server/modules/deals/service";
import * as exportsSvc from "@/server/modules/exports/service";
import * as imports from "@/server/modules/imports/service";
import { createLead } from "@/server/modules/leads/service";
import { runDueJobs } from "@/server/modules/workflow/engine";
import { ctxFor, ids, rawAsUser, unsafeDb } from "./helpers";

let I: Awaited<ReturnType<typeof ids>>;
let admin: AccessContext;
let bm: AccessContext; // HMNL Brand Manager
let bmSnmnl: AccessContext;
let exec: AccessContext; // HMNL Lagos exec
let snmnl: AccessContext;
let hos: AccessContext;
const rnd = () => Math.random().toString(36).slice(2, 8);
const csv = (rows: string[][]) => ({ name: "upload.csv", bytes: new TextEncoder().encode(toCsv(rows[0]!, rows.slice(1))) });
async function drain() {
  for (let i = 0; i < 20; i++) {
    const { done, failed } = await runDueJobs(100);
    if (done + failed === 0) break;
  }
}

beforeAll(async () => {
  I = await ids();
  [admin, bm, bmSnmnl, exec, snmnl, hos] = (await Promise.all(["admin", "bm.hmnl", "bm.snmnl", "exec.hmnl.1", "exec.snmnl.1", "hos"].map((k) => ctxFor(k)))) as [AccessContext, AccessContext, AccessContext, AccessContext, AccessContext, AccessContext];
  await unsafeDb.brandCodeAlias.upsert({ where: { alias: "HYU" }, update: {}, create: { alias: "HYU", brandId: I.brand("HMNL") } });
});

describe("import", () => {
  const tag = rnd();
  // a Zoho "Potentials" export with Zoho stage names and legacy company codes
  const zohoDeals = [
    ["Potential Name", "Stage", "Amount", "Closing Date", "Company Code", "Region", "Deal Owner", "Zoho Id"],
    [`Zoho fleet ${tag}`, "Negotiation/Review", "250,000,000", "31/12/2026", "HYU", "Lagos", "", "zcrm_1"],
    [`Zoho won ${tag}`, "Closed Won", "45000000", "2026-09-30", "HMNL", "Abuja", "", "zcrm_2"],
    [`Zoho other brand ${tag}`, "Qualification", "1", "2026-10-01", "SNMNL", "Lagos", "", "zcrm_3"],
    [`Zoho bad ${tag}`, "Some Custom Stage", "abc", "2026-10-01", "HMNL", "Lagos", "", "zcrm_4"],
  ];

  it("Zoho deals export: stage and brand mapping in the dry run, commit as a job, history and undo", async () => {
    await expect(imports.createImport(exec, "deals", csv(zohoDeals))).rejects.toBeInstanceOf(ForbiddenError); // sales execs do not import
    const job = await imports.createImport(bm, "deals", csv(zohoDeals));
    const dry = await imports.dryRun(bm, job.id);
    expect(dry.mapping.columns).toMatchObject({ "Potential Name": "name", Stage: "stage", "Company Code": "brand", "Zoho Id": "" });
    const [fleet, won, other, bad] = dry.plan.rows;
    expect(fleet).toMatchObject({ brand: "HMNL", action: "create", errors: [], values: { stage: "BOOKING", amount: 250_000_000, closeDate: "2026-12-31" } }); // HYU → HMNL, Negotiation/Review → Booking
    expect(won).toMatchObject({ brand: "HMNL", action: "create", values: { stage: "CLOSED_WON" } });
    // the Brand Manager's row for another brand is rejected
    expect(other).toMatchObject({ action: "skip", errors: ["You cannot import into brand SNMNL"] });
    expect(bad!.errors.length).toBe(2);
    expect(dry.plan.summary).toMatchObject({ total: 4, create: 2, errors: 2, byBrand: { HMNL: 2 } });
    // nothing was written by the dry run
    expect(await unsafeDb.deal.count({ where: { name: { contains: tag } } })).toBe(0);

    // a value mapping fixes the custom stage; saved as a template
    const fixed = await imports.dryRun(bm, job.id, { ...dry.mapping, values: { stage: { "some custom stage": "Quotation" }, amount: { abc: "5000000" } } });
    expect(fixed.plan.rows[3]).toMatchObject({ action: "create", errors: [], values: { stage: "QUOTATION", amount: 5_000_000 } });
    await imports.saveMapping(bm, job.id, "Zoho Deals export", false);
    expect((await imports.listMappings(bm, "deals")).map((m) => m.name)).toEqual(["Zoho Deals export"]);
    expect(await imports.listMappings(bmSnmnl, "deals")).toEqual([]); // private template

    const summary = await imports.commitImport(bm, job.id);
    expect(summary).toMatchObject({ create: 3, errors: 1 });
    await expect(imports.commitImport(bm, job.id)).rejects.toThrow(/already started/);
    await drain();
    const done = await imports.getImport(bm, job.id);
    expect(done.status).toBe("DONE");
    expect(done.data).toBeNull(); // the uploaded rows are deleted after the job
    expect(done.summary).toMatchObject({ total: 4, created: 3, failed: 1, byBrand: { HMNL: 3 } });
    expect(done.problems).toEqual([{ line: 4, message: "You cannot import into brand SNMNL" }]);
    const created = await unsafeDb.deal.findMany({ where: { name: { contains: tag } }, include: { stage: true, region: true, brand: true }, orderBy: { name: "asc" } });
    expect(created.map((d) => [d.name.split(" ")[1], d.brand.code, d.region.name, d.stage!.key, Number(d.amount), d.ownerId === bm.userId])).toEqual([
      ["bad", "HMNL", "Lagos", "QUOTATION", 5_000_000, true],
      ["fleet", "HMNL", "Lagos", "BOOKING", 250_000_000, true],
      ["won", "HMNL", "Abuja", "CLOSED_WON", 45_000_000, true],
    ]);
    expect(created.some((d) => d.brand.code === "SNMNL")).toBe(false);

    // history: own imports; other importers do not see it; management may read the history
    expect((await imports.listImports(bm)).map((j) => j.id)).toContain(job.id);
    await expect(imports.getImport(bmSnmnl, job.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await rawAsUser(bmSnmnl, `SELECT id FROM "ImportJob" WHERE id = '${job.id}'`)).toEqual([]);
    expect((await imports.getImport(admin, job.id)).fileName).toBe("upload.csv");

    // importing the same file again: duplicates are skipped
    const again = await imports.createImport(bm, "deals", csv(zohoDeals));
    await imports.applyMapping(bm, again.id, (await imports.listMappings(bm, "deals"))[0]!.id);
    const second = await imports.dryRun(bm, again.id);
    expect(second.plan.summary).toMatchObject({ create: 0, skip: 3, errors: 1 });
    await expect(imports.commitImport(bm, again.id)).rejects.toThrow(/nothing to import/);
    await imports.discardImport(bm, again.id);

    // undo soft-deletes what the import created
    await expect(imports.undoImport(admin, job.id)).rejects.toBeInstanceOf(ForbiddenError); // only the importer
    expect((await imports.undoImport(bm, job.id)).removed).toBe(3);
    expect(await unsafeDb.deal.count({ where: { name: { contains: tag }, deletedAt: null } })).toBe(0);
    expect((await imports.getImport(bm, job.id)).status).toBe("UNDONE");
    await expect(imports.undoImport(bm, job.id)).rejects.toBeInstanceOf(BadRequestError);
  });

  it("administrators import into any brand; XLSX files; leads with dedupe by mobile", async () => {
    const mobile = `0803${String(1000000 + Math.floor(Math.random() * 8999999))}`;
    const rows = [["Last Name", "First Name", "Phone", "Lead Source", "Brand", "Region", "Rating"], [`Okoro ${rnd()}`, "Ngozi", mobile, "Walk in", "SNMNL", "Lagos", "Hot"], ["Dup", "Same", mobile, "Referral", "SNMNL", "Lagos", ""], ["Hmnl", "Lead", "", "", "HMNL", "Lagos", ""]];
    const xlsx = { name: "leads.xlsx", bytes: toXlsx("Leads", rows[0]!, rows.slice(1)) };
    expect(readXlsx(xlsx.bytes)[1]![2]).toBe(mobile);
    const job = await imports.createImport(admin, "leads", xlsx);
    const dry = await imports.dryRun(admin, job.id);
    expect(dry.plan.rows.map((r) => [r.brand, r.action, r.errors.length])).toEqual([["SNMNL", "create", 0], ["SNMNL", "skip", 0], ["HMNL", "skip", 1]]);
    await imports.commitImport(admin, job.id);
    await drain();
    const lead = await unsafeDb.lead.findFirstOrThrow({ where: { mobile: `+234${mobile.slice(1)}` } });
    expect(lead).toMatchObject({ brandId: I.brand("SNMNL"), source: "WALK_IN", rating: "HOT", firstName: "Ngozi" });
    // unreadable / oversized / empty uploads are rejected before anything is stored
    await expect(imports.createImport(admin, "leads", { name: "x.xlsx", bytes: new Uint8Array([1, 2, 3]) })).rejects.toThrow(/could not be read/);
    await expect(imports.createImport(admin, "leads", { name: "x.csv", bytes: new TextEncoder().encode("only,a,header\n") })).rejects.toThrow(/header row and at least one/);
    await expect(imports.createImport(admin, "nope", csv(rows))).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe("export", () => {
  it("needs the export permission, is scoped and masked like the list, and is audited", async () => {
    await expect(exportsSvc.exportList(exec, "deals", "csv", {})).rejects.toBeInstanceOf(ForbiddenError); // Sales Exec: no export
    const from = new Date();
    const res = await exportsSvc.exportList(bm, "deals", "csv", {});
    if (res.kind !== "file") throw new Error("expected a file");
    const rows = parseCsv(new TextDecoder().decode(res.body));
    expect(rows[0]!.slice(0, 5)).toEqual(["Deal name", "Customer", "Account", "Brand", "Region"]);
    expect(new Set(rows.slice(1).map((r) => r[3]))).toEqual(new Set(["HMNL"])); // only the manager's brand
    expect(rows.length - 1).toBe(await unsafeDb.deal.count({ where: { brandId: I.brand("HMNL"), deletedAt: null } }));
    const entry = await unsafeDb.auditLog.findFirstOrThrow({ where: { action: "EXPORT", userId: bm.userId, at: { gte: from } }, orderBy: { at: "desc" } });
    expect(entry.after).toMatchObject({ module: "deals", format: "csv", rows: rows.length - 1 });

    // masked fields stay masked: a manager who has no record with a customer sees the phone masked in the export too
    const account = await unsafeDb.account.create({ data: { name: `Export mask ${rnd()}`, phone: "+2348031234521", email: "hidden.person@example.test" } });
    const exported = await exportsSvc.exportList(bmSnmnl, "accounts", "csv", { q: account.name });
    if (exported.kind !== "file") throw new Error("expected a file");
    const text = new TextDecoder().decode(exported.body);
    expect(text).toContain(account.name);
    expect(text).not.toContain("+2348031234521");
    expect(text).not.toContain("hidden.person@example.test");
    // profile field permissions apply on top
    const masked: AccessContext = { ...bm, profile: { ...bm.profile, fieldPermissions: { deals: { amount: "hidden", vinChassisNo: "masked" } } } };
    const m = await exportsSvc.exportList(masked, "deals", "csv", {});
    if (m.kind !== "file") throw new Error("expected a file");
    const mRows = parseCsv(new TextDecoder().decode(m.body));
    const amountCol = mRows[0]!.indexOf("Amount");
    expect(mRows.slice(1).every((r) => r[amountCol] === "")).toBe(true);
    // xlsx
    const x = await exportsSvc.exportList(hos, "leads", "xlsx", {});
    if (x.kind !== "file") throw new Error("expected a file");
    expect(readXlsx(x.body)[0]![0]).toBe("Name");
    await expect(exportsSvc.exportList(bm, "users", "csv", {})).rejects.toBeInstanceOf(BadRequestError);
  });

  it("large exports run as a job with an expiring, owner-only download link", async () => {
    const before = process.env.EXPORT_SYNC_LIMIT;
    const res = await exportsSvc.exportList(hos, "deals", "csv", {});
    expect(res.kind).toBe("file");
    // force the job path: more rows than the (lowered) synchronous limit
    const total = res.rows;
    const job = await unsafeDb.exportJob.create({ data: { userId: hos.userId, module: "deals", format: "csv", params: {} } });
    await exportsSvc.runExport({ payload: { exportId: job.id, userId: hos.userId } });
    const done = (await exportsSvc.listExports(hos)).find((e) => e.id === job.id)!;
    expect(done).toMatchObject({ status: "DONE", rowCount: total, available: true });
    const file = await exportsSvc.downloadExport(hos, job.id);
    expect(parseCsv(new TextDecoder().decode(file.body)).length - 1).toBe(total);
    await expect(exportsSvc.downloadExport(bm, job.id)).rejects.toBeInstanceOf(NotFoundError); // not the owner
    expect(await rawAsUser(bm, `SELECT id FROM "ExportJob" WHERE id = '${job.id}'`)).toEqual([]);
    // expired links are gone, and the file is removed
    await unsafeDb.exportJob.update({ where: { id: job.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(exportsSvc.downloadExport(hos, job.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await unsafeDb.exportJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("EXPIRED");
    expect(process.env.EXPORT_SYNC_LIMIT).toBe(before);
  });

  it("full backup: administrators only, encrypted, without secrets", async () => {
    await expect(exportsSvc.fullBackup(hos, "a-long-enough-passphrase")).rejects.toBeInstanceOf(NotFoundError);
    await expect(exportsSvc.fullBackup(admin, "short")).rejects.toBeInstanceOf(BadRequestError);
    const backup = await exportsSvc.fullBackup(admin, "a-long-enough-passphrase");
    expect(backup.fileName).toMatch(/\.zip\.enc$/);
    expect(Buffer.from(backup.body).toString("latin1")).not.toContain("Deal.csv"); // encrypted: not even file names are readable
    expect(() => decryptBackup(backup.body, "the-wrong-passphrase")).toThrow(/Wrong passphrase/);
    const zip = Buffer.from(decryptBackup(backup.body, "a-long-enough-passphrase")).toString("latin1");
    for (const name of ["Brand.csv", "Deal.csv", "Lead.csv", "User.csv", "README.txt"]) expect(zip).toContain(name);
    expect(zip).toContain("SNMNL"); // every brand
    expect(zip).not.toContain("passwordHash");
    expect(zip).not.toMatch(/\$2[aby]\$\d\d\$/); // no bcrypt hashes
    const entry = await unsafeDb.auditLog.findFirstOrThrow({ where: { action: "EXPORT", entity: "Backup", userId: admin.userId } });
    expect(entry.after).toMatchObject({ tables: backup.tables, rows: backup.rows });
  });
});

describe("custom fields and layouts", () => {
  const api = `fleetSize${rnd()}`.replace(/[^a-zA-Z0-9]/g, "");
  const hmnlApi = `warrantyPack${rnd()}`.replace(/[^a-zA-Z0-9]/g, "");

  it("only administrators define fields; definitions are validated", async () => {
    await expect(custom.saveCustomField(bm, null, { module: "deals", apiName: api, label: "Fleet size", type: "NUMBER" })).rejects.toBeInstanceOf(NotFoundError);
    await custom.saveCustomField(admin, null, { module: "deals", apiName: api, label: "Fleet size", type: "NUMBER" });
    await custom.saveCustomField(admin, null, { module: "deals", apiName: hmnlApi, label: "HMNL warranty pack", type: "PICKLIST", options: "Silver, Gold", brandId: I.brand("HMNL") });
    await custom.saveCustomField(admin, null, { module: "deals", apiName: `perUnit${api}`, label: "Amount per unit", type: "FORMULA", formula: `ROUND(amount / ${api}, 0)` });
    await expect(custom.saveCustomField(admin, null, { module: "deals", apiName: api, label: "Again", type: "TEXT" })).rejects.toThrow(/already exists/);
    await expect(custom.saveCustomField(admin, null, { module: "deals", apiName: "Bad Name", label: "x", type: "TEXT" })).rejects.toThrow();
    await expect(custom.saveCustomField(admin, null, { module: "deals", apiName: `f${rnd()}`, label: "x", type: "FORMULA", formula: "amount +" })).rejects.toThrow(/Formula/);
    await expect(custom.saveCustomField(admin, null, { module: "deals", apiName: `p${rnd()}`, label: "x", type: "PICKLIST" })).rejects.toThrow(/option/);
    await expect(custom.saveCustomField(admin, null, { module: "accounts", apiName: `a${rnd()}`, label: "x", type: "TEXT", brandId: I.brand("HMNL") })).rejects.toThrow(/shared/);
    await expect(rawAsUser(bm, `UPDATE "CustomField" SET label = 'x' RETURNING id`)).resolves.toEqual([]);
  });

  it("a brand-specific field exists only on that brand's records and is hidden from other brands", async () => {
    const h = await createDeal(exec, { name: `CF deal ${rnd()}`, brandId: I.brand("HMNL"), regionId: I.region("Lagos"), amount: 90_000_000, customFields: { [api]: "3", [hmnlApi]: "Gold", unknown: "x" } } as never);
    const stored = await unsafeDb.deal.findUniqueOrThrow({ where: { id: h.id } });
    expect(stored.customFields).toEqual({ [api]: 3, [hmnlApi]: "Gold" });
    const shown = await custom.presentCustomFields(exec, "deals", stored.brandId, stored);
    expect(Object.fromEntries(shown.map((f) => [f.label, f.value]))).toEqual({ "Fleet size": 3, "HMNL warranty pack": "Gold", "Amount per unit": 30_000_000 });

    // SNMNL: the HMNL field is not defined for them – invisible in definitions, dropped on write
    expect((await custom.listCustomFields(snmnl, "deals")).map((f) => f.apiName)).not.toContain(hmnlApi);
    expect(await rawAsUser(snmnl, `SELECT id FROM "CustomField" WHERE "apiName" = '${hmnlApi}'`)).toEqual([]);
    const s = await createDeal(snmnl, { name: `CF deal ${rnd()}`, brandId: I.brand("SNMNL"), regionId: I.region("Lagos"), customFields: { [api]: 2, [hmnlApi]: "Gold" } } as never);
    const sStored = await unsafeDb.deal.findUniqueOrThrow({ where: { id: s.id } });
    expect(sStored.customFields).toEqual({ [api]: 2 });
    expect((await custom.presentCustomFields(snmnl, "deals", sStored.brandId, sStored)).map((f) => f.label)).not.toContain("HMNL warranty pack");
    // management sees the brand field on the HMNL record only
    expect((await custom.presentCustomFields(hos, "deals", sStored.brandId, sStored)).map((f) => f.label)).not.toContain("HMNL warranty pack");
    expect((await custom.presentCustomFields(hos, "deals", stored.brandId, stored)).map((f) => f.label)).toContain("HMNL warranty pack");

    // validation and partial updates
    await expect(createDeal(exec, { name: "bad", brandId: I.brand("HMNL"), regionId: I.region("Lagos"), customFields: { [hmnlApi]: "Platinum" } } as never)).rejects.toThrow(/HMNL warranty pack/);
    await updateDeal(exec, h.id, { colour: "Blue" } as never); // untouched custom values survive
    await updateDeal(exec, h.id, { customFields: { [api]: 6 } } as never);
    expect((await unsafeDb.deal.findUniqueOrThrow({ where: { id: h.id } })).customFields).toEqual({ [api]: 6, [hmnlApi]: "Gold" });

    // field-level security per profile: hidden / masked custom fields
    const restricted: AccessContext = { ...exec, profile: { ...exec.profile, fieldPermissions: { deals: { [`cf_${hmnlApi}`]: "hidden", [`cf_${api}`]: "masked" } } } };
    const limited = await custom.presentCustomFields(restricted, "deals", stored.brandId, await unsafeDb.deal.findUniqueOrThrow({ where: { id: h.id } }));
    expect(limited.map((f) => f.label)).not.toContain("HMNL warranty pack");
    expect(limited.find((f) => f.label === "Fleet size")).toMatchObject({ value: "****", masked: true });
    expect((await custom.customFilterFields(restricted, "deals")).map((f) => f.key)).not.toContain(`cf_${api}`);

    // filtering on a custom field, with and without the expression index
    const fields = await custom.customFilterFields(exec, "deals");
    const where = conditionsToWhere(parseConditions([`cf_${api}~gt~5`], fields), fields);
    expect((await listDeals(exec, {}, { where, take: 50 })).rows.map((d) => d.id)).toEqual([h.id]);
    const field = await unsafeDb.customField.findFirstOrThrow({ where: { apiName: api } });
    await custom.setCustomFieldIndexed(admin, field.id, true);
    const idx = await unsafeDb.$queryRaw<Array<{ indexdef: string }>>`SELECT indexdef FROM pg_indexes WHERE indexname = ${`cf_Deal_${api}`}`;
    expect(idx[0]!.indexdef).toContain(`("customFields" ->> '${api}'`);
    await custom.setCustomFieldIndexed(admin, field.id, false);
    expect(await getDeal(exec, h.id)).toMatchObject({ id: h.id });
  });

  it("layout rules: show / require by value, per-brand layout variants", async () => {
    await expect(custom.saveLayout(bm, "deals", null, { rules: [] })).rejects.toBeInstanceOf(NotFoundError);
    // seeded default: the finance bank only shows for bank finance
    expect((await custom.getLayout(exec, "deals", I.brand("HMNL"))).rules[0]).toMatchObject({ when: { field: "paymentType", value: "BANK_FINANCE" }, action: "SHOW", fields: ["financeBank"] });
    // HMNL variant: bank finance REQUIRES the finance bank and the warranty pack
    await custom.saveLayout(admin, "deals", I.brand("HMNL"), {
      sections: [{ title: "Fleet", fields: [`cf_${api}`, `cf_${hmnlApi}`] }],
      rules: [
        { when: { field: "paymentType", op: "eq", value: "BANK_FINANCE" }, action: "SHOW", fields: ["financeBank"] },
        { when: { field: "paymentType", op: "eq", value: "BANK_FINANCE" }, action: "REQUIRE", fields: ["financeBank", `cf_${hmnlApi}`] },
      ],
    });
    const base = { brandId: I.brand("HMNL"), regionId: I.region("Lagos") };
    await expect(createDeal(exec, { ...base, name: "Financed", paymentType: "BANK_FINANCE" } as never)).rejects.toThrow(/Finance Bank is required; HMNL warranty pack is required|HMNL warranty pack is required; Finance Bank is required/);
    await createDeal(exec, { ...base, name: `Financed ${rnd()}`, paymentType: "BANK_FINANCE", financeBank: "Example Bank", customFields: { [hmnlApi]: "Silver" } } as never);
    await createDeal(exec, { ...base, name: `Cash ${rnd()}`, paymentType: "CASH" } as never); // rule does not apply
    // SNMNL keeps the default layout: no such requirement
    await createDeal(snmnl, { name: `SNMNL financed ${rnd()}`, brandId: I.brand("SNMNL"), regionId: I.region("Lagos"), paymentType: "BANK_FINANCE" } as never);
    expect((await custom.getLayout(snmnl, "deals", I.brand("SNMNL"))).sections).toEqual([]);
    expect(await rawAsUser(snmnl, `SELECT id FROM "Layout" WHERE "brandId" = '${I.brand("HMNL")}'`)).toEqual([]);
    // an empty variant removes it again
    await custom.saveLayout(admin, "deals", I.brand("HMNL"), {});
    expect(await unsafeDb.layout.count({ where: { module: "deals", brandId: I.brand("HMNL") } })).toBe(0);
    // leads carry custom fields too
    const leadApi = `hobby${rnd()}`.replace(/[^a-zA-Z0-9]/g, "");
    await custom.saveCustomField(admin, null, { module: "leads", apiName: leadApi, label: "Hobby", type: "TEXT", required: true });
    await expect(createLead(exec, { lastName: "NoHobby", mobile: `+23480${String(Date.now()).slice(-8)}`, ...base, source: "WALK_IN" } as never)).rejects.toThrow(/Hobby is required/);
    const lead = await createLead(exec, { lastName: "Golfer", mobile: `+23480${String(Date.now() + 1).slice(-8)}`, ...base, source: "WALK_IN", customFields: { [leadApi]: "Golf" } } as never);
    expect((await unsafeDb.lead.findUniqueOrThrow({ where: { id: lead.id } })).customFields).toEqual({ [leadApi]: "Golf" });
    await unsafeDb.customField.updateMany({ where: { apiName: leadApi }, data: { active: false } }); // keep other tests unaffected
  });
});
