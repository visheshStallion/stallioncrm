import { beforeAll, describe, expect, it } from "vitest";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import * as email from "@/server/modules/email/service";
import * as templates from "@/server/modules/email/templates";
import { deliver, loadMessageRecord } from "@/server/modules/messaging/service";
import { sandboxOutbox } from "@/server/modules/messaging/providers";
import { ctxFor, ids, unsafeDb } from "./helpers";

/**
 * E-mail composer and template editor (prompt 20 Part C): brand sender, isolation of templates and merge data,
 * consent, sanitiser, PDF attachment on the right letterhead, audit.
 */
let admin: AccessContext;
let hmnlExec: AccessContext;
let snmnlExec: AccessContext;
let multiExec: AccessContext;
let bmHmnl: AccessContext;
let ba: AccessContext;
let id: Awaited<ReturnType<typeof ids>>;
let deal: { id: string; name: string };
let lead: { id: string };
const last = () => sandboxOutbox[sandboxOutbox.length - 1]!;
const text = (html: string) => ({ blocks: [{ type: "text", html }] });

beforeAll(async () => {
  process.env.PRINT_PDF_ENGINE = "basic";
  [admin, hmnlExec, snmnlExec, multiExec, bmHmnl, ba] = (await Promise.all(["admin", "exec.hmnl.1", "exec.snmnl.1", "exec.multi.1", "bm.hmnl", "ba.hmnl"].map(ctxFor))) as [AccessContext, AccessContext, AccessContext, AccessContext, AccessContext, AccessContext];
  id = await ids();
  await unsafeDb.brand.update({ where: { id: id.brand("HMNL") }, data: { fromEmail: "sales@hmnl.example", fromName: "Hyundai Sales", legalEntity: "Hyundai Motors Nigeria Ltd", address: "1 Marina Road, Lagos" } });
  await unsafeDb.brand.update({ where: { id: id.brand("SNMNL") }, data: { fromEmail: "sales@snmnl.example", fromName: "Nissan Sales", legalEntity: "Stallion Nissan Motors Nigeria Ltd" } });
  const d = await unsafeDb.deal.findFirstOrThrow({ where: { brandId: id.brand("HMNL"), region: { name: "Lagos" }, ownerId: hmnlExec.userId, contactId: { not: null } }, select: { id: true, name: true, contactId: true } });
  await unsafeDb.contact.update({ where: { id: d.contactId! }, data: { email: "customer@example.test", firstName: "Ngozi" } });
  deal = d;
  lead = await scopedDb(hmnlExec).lead.create({ data: { lastName: "Bello", firstName: "Musa", email: "musa@example.test", mobile: "+2348031230000", brandId: id.brand("HMNL"), regionId: id.region("Lagos"), ownerId: hmnlExec.userId }, select: { id: true } });
});

describe("composer", () => {
  it("sends from the record's brand, resolves merge fields with fallbacks, wraps the brand layout and logs on the record", async () => {
    const res = await email.sendEmail(hmnlExec, {
      parentType: "Deal",
      parentId: deal.id,
      to: ["customer@example.test"],
      cc: ["copy@example.test"],
      subject: "Your {{brand.name}} offer for {{deal.name}}",
      doc: text('<p>Dear {{contact.firstName | "Customer"}},</p><p>Offer from {{owner.name}} – {{nothing.here | "n/a"}}.</p><script>alert(1)</script><p onclick="x()">Regards</p><iframe src="https://evil.example"></iframe>'),
      followUpDays: 3,
    });
    expect(res.status).toBe("SENT");
    expect(res.from).toBe("sales@hmnl.example");
    const sent = last();
    expect(sent.from).toMatchObject({ address: "sales@hmnl.example", name: "Hyundai Sales" });
    expect(sent.to).toBe("customer@example.test");
    expect(sent.cc).toEqual(["copy@example.test"]);
    expect(sent.replyTo).toBe(hmnlExec.user.email);
    expect(sent.subject).toBe(`Your Hyundai offer for ${deal.name}`);
    expect(sent.html).toContain("Dear Ngozi,");
    expect(sent.html).toContain("– n/a.");
    expect(sent.html).not.toMatch(/<script|onclick|<iframe|alert\(1\)/);
    // brand layout: header, colour bar, footer with the legal entity – 600 px, table based, inline styles only
    expect(sent.html).toContain('data-brand="HMNL"');
    expect(sent.html).toContain("Hyundai Motors Nigeria Ltd");
    expect(sent.html).toContain("max-width:600px");
    expect(sent.html).not.toMatch(/<style|<link/);
    expect(sent.text).toContain("Dear Ngozi,");

    const message = await scopedDb(hmnlExec).message.findUniqueOrThrow({ where: { id: res.id } });
    expect(message).toMatchObject({ parentType: "Deal", parentId: deal.id, brandId: id.brand("HMNL"), cc: "copy@example.test", status: "SENT" });
    expect(message.bodyHtml).toContain("Dear Ngozi,");
    // brand-scoped: an SNMNL exec does not find the message or the activity
    expect(await scopedDb(snmnlExec).message.findUnique({ where: { id: res.id } })).toBeNull();
    expect(await scopedDb(snmnlExec).activity.findUnique({ where: { id: res.activityId } })).toBeNull();
    const task = await scopedDb(hmnlExec).activity.findUniqueOrThrow({ where: { id: res.taskId! } });
    expect(task).toMatchObject({ type: "TASK", status: "OPEN", parentId: deal.id });

    const entry = await unsafeDb.auditLog.findFirstOrThrow({ where: { entity: "Email", entityId: res.id } });
    expect(entry.userId).toBe(hmnlExec.userId);
    expect(entry.after).toMatchObject({ status: "SENT", from: "sales@hmnl.example", to: ["customer@example.test"], record: `Deal:${deal.id}` });
  });

  it("a record of another brand cannot be mailed, and a shared customer only as one of the sender's own brands", async () => {
    await expect(email.sendEmail(snmnlExec, { parentType: "Deal", parentId: deal.id, to: ["x@example.test"], subject: "Hi", doc: text("<p>x</p>") })).rejects.toThrow(/not found/i);
    await expect(email.composerData(snmnlExec, "Deal", deal.id)).rejects.toThrow(/not found/i);
    await expect(email.sendEmail(hmnlExec, { parentType: "Deal", parentId: deal.id, to: ["not-an-address"], subject: "Hi", doc: text("<p>x</p>") })).rejects.toThrow(/not a valid e-mail/);

    const contact = await unsafeDb.contact.findFirstOrThrow({ where: { email: "customer@example.test" }, select: { id: true } });
    const before = sandboxOutbox.length;
    await expect(email.sendEmail(hmnlExec, { parentType: "Contact", parentId: contact.id, brandId: id.brand("SNMNL"), to: ["customer@example.test"], subject: "Hi", doc: text("<p>x</p>") })).rejects.toThrow(/not found/i);
    await expect(email.sendEmail(hmnlExec, { parentType: "Contact", parentId: contact.id, to: ["customer@example.test"], subject: "Hi", doc: text("<p>x</p>") })).rejects.toThrow(/Choose the brand/);
    expect(sandboxOutbox.length).toBe(before);
    expect((await email.composerData(multiExec, "Contact", contact.id)).brands.map((b) => b.label.slice(0, 5).trim())).toEqual(["HMNL", "SNMNL"]);
    const res = await email.sendEmail(multiExec, { parentType: "Contact", parentId: contact.id, brandId: id.brand("SNMNL"), to: ["customer@example.test"], subject: "From Nissan", doc: text("<p>Hello {{contact.firstName}}</p>") });
    expect(res.from).toBe("sales@snmnl.example");
    expect(last().html).toContain('data-brand="SNMNL"');
    expect((await unsafeDb.message.findUniqueOrThrow({ where: { id: res.id } })).brandId).toBe(id.brand("SNMNL"));
  });

  it("attaches the record's PDF printout on the record's letterhead; the print is audited", async () => {
    const res = await email.sendEmail(hmnlExec, { parentType: "Deal", parentId: deal.id, to: ["customer@example.test"], subject: "Your documents", doc: text("<p>Attached.</p>"), attachPrint: "default" });
    expect(res.attachments).toBe(1);
    const pdf = last().attachments!.find((a) => a.contentType === "application/pdf")!;
    expect(pdf.filename).toMatch(/^Deal-.*\.pdf$/);
    expect(Buffer.from(pdf.content.slice(0, 5)).toString()).toBe("%PDF-");
    const print = await unsafeDb.auditLog.findFirstOrThrow({ where: { entity: "Print", entityId: `deals:${deal.id}` }, orderBy: { at: "desc" } });
    expect(print.after).toMatchObject({ via: "email", letterhead: "HMNL" });
    expect((await unsafeDb.message.findUniqueOrThrow({ where: { id: res.id } })).attachments).toEqual([{ name: pdf.filename, size: pdf.content.byteLength }]);
    // an attachment id of another record is refused
    const foreign = await unsafeDb.attachment.findFirst({ where: { NOT: { entityId: deal.id } }, select: { id: true } });
    if (foreign) await expect(email.sendEmail(hmnlExec, { parentType: "Deal", parentId: deal.id, to: ["customer@example.test"], subject: "x", doc: text("<p>x</p>"), attachmentIds: [foreign.id] })).rejects.toThrow(/not found/i);
  });

  it("embedded images travel as inline attachments, not as data: URIs", async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    await email.sendEmail(hmnlExec, { parentType: "Lead", parentId: lead.id, to: ["musa@example.test"], subject: "Picture", doc: text(`<p>Look:</p><img src="data:image/png;base64,${png}" alt="A dot">`) });
    const sent = last();
    expect(sent.html).toContain('src="cid:img1@stallioncrm"');
    expect(sent.html).not.toContain("data:image");
    expect(sent.attachments).toEqual([expect.objectContaining({ cid: "img1@stallioncrm", contentType: "image/png" })]);
    const preview = await email.previewEmail(hmnlExec, { parentType: "Lead", parentId: lead.id, to: ["musa@example.test"], subject: "Picture for {{contact.firstName}}", doc: text(`<img src="data:image/png;base64,${png}" alt="A dot">`) });
    expect(preview.subject).toBe("Picture for Musa");
    expect(preview.html).toContain(`data:image/png;base64,${png}`);
  });

  it("signature per brand is sanitised and added; a test goes to the sender only", async () => {
    await email.saveSignature(hmnlExec, id.brand("HMNL"), '<p>Ada Okafor<br>Sales Executive</p><script>x</script>');
    await expect(email.saveSignature(hmnlExec, id.brand("SNMNL"), "<p>x</p>")).rejects.toThrow(/not found/i);
    expect((await email.mySignatures(hmnlExec)).map((s) => [s.code, s.html])).toEqual([["HMNL", "<p>Ada Okafor<br />Sales Executive</p>"]]);
    await email.sendEmail(hmnlExec, { parentType: "Lead", parentId: lead.id, to: ["musa@example.test"], subject: "Signed", doc: text("<p>Hello</p>") });
    expect(last().html).toContain("Sales Executive");
    await email.sendEmail(hmnlExec, { parentType: "Lead", parentId: lead.id, to: ["musa@example.test"], subject: "Unsigned", doc: text("<p>Hello</p>"), includeSignature: false });
    expect(last().html).not.toContain("Sales Executive");

    const messages = await unsafeDb.message.count({ where: { parentId: lead.id } });
    expect(await email.sendTestEmail(hmnlExec, { parentType: "Lead", parentId: lead.id, to: ["musa@example.test"], subject: "Try", doc: text("<p>Hello</p>") })).toBe(hmnlExec.user.email);
    expect(last()).toMatchObject({ to: hmnlExec.user.email, subject: "[Test] Try" });
    expect(await unsafeDb.message.count({ where: { parentId: lead.id } })).toBe(messages); // not logged on the record
  });

  it("a scheduled e-mail is sent by the job queue as its author", async () => {
    await expect(email.saveDraft(hmnlExec, null, { parentType: "Lead", parentId: lead.id, to: ["musa@example.test"], subject: "Later", doc: text("<p>x</p>") }, new Date(Date.now() - 1000))).rejects.toThrow(/at least a minute/);
    const sendAt = new Date(Date.now() + 5 * 60_000);
    const draft = await email.saveDraft(hmnlExec, null, { parentType: "Lead", parentId: lead.id, to: ["musa@example.test"], subject: "Later, {{contact.firstName}}", doc: text("<p>Scheduled</p>") }, sendAt);
    expect(draft.status).toBe("SCHEDULED");
    expect((await email.myDrafts(hmnlExec, "Lead", lead.id)).map((d) => d.status)).toContain("SCHEDULED");
    expect(await email.myDrafts(bmHmnl, "Lead", lead.id)).toEqual([]); // drafts are personal
    const before = sandboxOutbox.length;
    // a job for an older time does nothing; the current one sends
    expect(await email.runScheduledEmail({ payload: { draftId: draft.id, userId: hmnlExec.userId, sendAt: new Date(0).toISOString() } })).toHaveProperty("skipped");
    expect(await email.runScheduledEmail({ payload: { draftId: draft.id, userId: hmnlExec.userId, sendAt: sendAt.toISOString() } })).toHaveProperty("sent");
    expect(sandboxOutbox.length).toBe(before + 1);
    expect(last().subject).toBe("Later, Musa");
    expect(await email.runScheduledEmail({ payload: { draftId: draft.id, userId: hmnlExec.userId, sendAt: sendAt.toISOString() } })).toHaveProperty("skipped"); // never twice
  });
});

describe("templates", () => {
  let hmnlTemplate: string;
  let marketing: string;

  it("lint blocks broken merge fields; versions are kept, compared and restored", async () => {
    const base = { brandId: id.brand("HMNL"), name: "Offer follow-up", module: "deals", folder: "Sales", category: "Sales" as const, subject: "About {{deal.name}}", active: true };
    await expect(templates.saveRichTemplate(bmHmnl, null, { ...base, doc: text("<p>Hello {{contact firstName}}</p>") })).rejects.toThrow(/cannot be read/);
    await expect(templates.saveRichTemplate(bmHmnl, null, { ...base, doc: { blocks: [{ type: "hero", url: "https://example.test/a.png", alt: "" }] } })).rejects.toThrow(/alternative text/);
    const v1 = await templates.saveRichTemplate(bmHmnl, null, { ...base, doc: text('<p>Hello {{contact.firstName | "Customer"}}, first version. {{custom.thing}}</p><script>x</script>') });
    hmnlTemplate = v1.id;
    expect(v1.version).toBe(1);
    expect(v1.lint.warnings.join(" ")).toContain("custom.thing");
    const v2 = await templates.saveRichTemplate(bmHmnl, v1.id, { ...base, subject: "About your {{deal.name}}", doc: text("<p>Hello {{contact.firstName}}, second version.</p>") });
    expect(v2.version).toBe(2);
    const t = await templates.richTemplate(bmHmnl, v1.id);
    expect(t.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(JSON.stringify(t.doc)).not.toContain("script");
    const diff = await templates.templateDiff(bmHmnl, v1.id, 1);
    expect(diff.filter((d) => d.kind === "removed").map((d) => d.line).join(" ")).toContain("first version");
    expect(diff.filter((d) => d.kind === "added").map((d) => d.line).join(" ")).toContain("second version");
    const restored = await templates.restoreTemplateVersion(bmHmnl, v1.id, 1);
    expect(restored.version).toBe(3);
    expect(JSON.stringify((await templates.richTemplate(bmHmnl, v1.id)).doc)).toContain("first version");
  });

  it("only the brand's manager, its Brand Admin or an administrator edits a brand's templates; other brands' are invisible", async () => {
    const input = { brandId: id.brand("HMNL"), name: "By brand admin", module: null, folder: null, category: "Service" as const, subject: "Service", doc: text("<p>Hi</p>"), active: true };
    const own = await templates.saveRichTemplate(ba, null, input);
    await expect(templates.saveRichTemplate(ba, null, { ...input, brandId: id.brand("SNMNL") })).rejects.toThrow(/not found/i);
    await expect(templates.saveRichTemplate(hmnlExec, null, input)).rejects.toThrow(/Only the brand's manager/);
    await expect(templates.saveRichTemplate(bmHmnl, null, { ...input, brandId: null })).rejects.toThrow(/Group templates/);
    const snmnl = await templates.saveRichTemplate(admin, null, { ...input, brandId: id.brand("SNMNL"), name: "Nissan only" });
    await expect(templates.richTemplate(bmHmnl, snmnl.id)).rejects.toThrow(/not found/i);
    await expect(templates.saveRichTemplate(bmHmnl, snmnl.id, input)).rejects.toThrow(/not found/i);
    expect((await templates.templateBrands(ba)).brands.map((b) => b.label.slice(0, 4))).toEqual(["HMNL"]);

    // the composer offers the brand's and group templates only, and refuses another brand's by id
    const offered = (await email.composerData(hmnlExec, "Deal", deal.id)).templates.map((t) => t.name);
    expect(offered).toEqual(expect.arrayContaining(["Offer follow-up", "By brand admin"]));
    expect(offered).not.toContain("Nissan only");
    await expect(email.sendEmail(hmnlExec, { parentType: "Deal", parentId: deal.id, to: ["customer@example.test"], subject: "x", doc: text("<p>x</p>"), templateId: snmnl.id })).rejects.toThrow(/not available for the record's brand/);
    expect(own.id).toBeTruthy();
  });

  it("a marketing template is not sent to a customer who opted out of the brand", async () => {
    const m = await templates.saveRichTemplate(bmHmnl, null, { brandId: id.brand("HMNL"), name: "Launch", module: null, folder: null, category: "Marketing", subject: "New model", doc: text("<p>News</p>"), active: true });
    marketing = m.id;
    const send = () => email.sendEmail(hmnlExec, { parentType: "Lead", parentId: lead.id, to: ["musa@example.test"], subject: "New model", doc: text("<p>News</p>"), templateId: marketing });
    expect((await send()).status).toBe("SENT"); // consent unknown: allowed
    await unsafeDb.lead.update({ where: { id: lead.id }, data: { consentMarketing: false, consentAt: new Date() } });
    await expect(send()).rejects.toThrow(/opted out of this brand's marketing/);
    // a service e-mail about their own enquiry is still possible
    expect((await email.sendEmail(hmnlExec, { parentType: "Lead", parentId: lead.id, to: ["musa@example.test"], subject: "Your enquiry", doc: text("<p>Info</p>"), templateId: hmnlTemplate })).status).toBe("SENT");
  });

  it("workflow and campaign e-mails use the same templates and renderer", async () => {
    const record = await loadMessageRecord(hmnlExec, "Deal", deal.id);
    const res = await deliver(hmnlExec, { channel: "EMAIL", record, subject: "Automated", body: "plain text version", templateId: hmnlTemplate, unsubscribeUrl: "https://crm.example/api/public/unsubscribe/tok" });
    expect(res.status).toBe("SENT");
    const sent = last();
    expect(sent.html).toContain('data-brand="HMNL"');
    expect(sent.html).toContain("Hello Ngozi, first version.");
    expect(sent.html).toContain("https://crm.example/api/public/unsubscribe/tok");
    // a template of another brand is never rendered for this record: the plain text goes out instead
    const other = await unsafeDb.template.findFirstOrThrow({ where: { name: "Nissan only" } });
    await deliver(hmnlExec, { channel: "EMAIL", record, subject: "Automated", body: "plain text version", templateId: other.id });
    expect(last().html ?? null).toBeNull();
  });

  it("starters are valid templates; the preview renders at 600 px in the brand layout", async () => {
    for (const s of templates.EMAIL_STARTERS) {
      const lint = templates.lintTemplate({ category: s.category, subject: s.subject, doc: s.doc });
      expect(lint.errors, s.key).toEqual([]);
      expect(lint.warnings.filter((w) => w.includes("Unknown merge fields")), s.key).toEqual([]);
    }
    expect(templates.EMAIL_STARTERS).toHaveLength(10);
    const html = await templates.previewTemplate(bmHmnl, { brandId: id.brand("HMNL"), category: "Marketing", doc: templates.starter("new-model-launch")!.doc });
    expect(html).toContain("max-width:600px");
    expect(html).toContain("Dear Ada,");
    expect(html).toContain("Unsubscribe");
    expect(html).toContain("Hyundai Motors Nigeria Ltd");
  });
});
