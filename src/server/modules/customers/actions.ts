"use server";

import { revalidatePath } from "next/cache";
import { normalizePhone } from "@/lib/phone";
import { safeAction, type ActionResult } from "@/server/api";
import { requireContext } from "@/server/request";
import { findAccountMatches } from "./queries";
import { accountSchema, contactSchema } from "./schema";
import * as svc from "./service";

type Outcome = { message?: string; redirect?: string };
const str = (fd: FormData, k: string) => (fd.get(k) ?? "").toString().trim();

/** Only the fields present in the form are sent, so read-only (masked) fields are never overwritten. */
function fromForm(fd: FormData, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.filter((k) => fd.has(k)).map((k) => [k, str(fd, k)]));
}
const ACCOUNT_KEYS = Object.keys(accountSchema.shape);
const CONTACT_KEYS = Object.keys(contactSchema.shape);

export async function createAccountAction(_p: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const { createWithTemplate } = await import("@/server/modules/rectpl/service");
    const made = await createWithTemplate(ctx, "accounts", str(fd, "_templateId"), fromForm(fd, ACCOUNT_KEYS) as Record<string, unknown>, (input) => svc.createAccount(ctx, input as never));
    const acc = made.record;
    revalidatePath("/accounts");
    return { message: `${made.templateName ? `Account created from “${made.templateName}”${made.tasks ? ` · ${made.tasks} task(s) added` : ""}` : "Account created"}`, redirect: made.next ?? (fd.get("_saveAndNew") ? "/accounts/new" : `/accounts/${acc.id}`) };
  });
}

export async function updateAccountAction(_p: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const id = str(fd, "id");
    await svc.updateAccount(ctx, id, fromForm(fd, ACCOUNT_KEYS) as never);
    revalidatePath(`/accounts/${id}`);
    return { message: "Account updated successfully", redirect: `/accounts/${id}` };
  });
}

export async function createContactAction(_p: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const { createWithTemplate } = await import("@/server/modules/rectpl/service");
    const made = await createWithTemplate(ctx, "contacts", str(fd, "_templateId"), fromForm(fd, CONTACT_KEYS) as Record<string, unknown>, (input) => svc.createContact(ctx, input as never));
    const c = made.record;
    revalidatePath("/contacts");
    return { message: `${made.templateName ? `Contact created from “${made.templateName}”${made.tasks ? ` · ${made.tasks} task(s) added` : ""}` : "Contact created"}`, redirect: made.next ?? (fd.get("_saveAndNew") ? "/contacts/new" : `/contacts/${c.id}`) };
  });
}

export async function updateContactAction(_p: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const id = str(fd, "id");
    await svc.updateContact(ctx, id, fromForm(fd, CONTACT_KEYS) as never);
    revalidatePath(`/contacts/${id}`);
    return { message: "Contact updated successfully", redirect: `/contacts/${id}` };
  });
}

export async function setConsentAction(_p: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const contactId = str(fd, "contactId");
    await svc.setBrandConsent(ctx, contactId, str(fd, "brandId"), str(fd, "consent") === "true");
    revalidatePath(`/contacts/${contactId}`);
    return { message: "Consent updated" };
  });
}

export async function mergeAccountsAction(_p: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const masterId = str(fd, "masterId");
    const res = await svc.mergeAccounts(ctx, masterId, fd.getAll("ids").map(String));
    revalidatePath("/accounts");
    return { message: `${res.merged} duplicate(s) merged`, redirect: `/accounts/${masterId}` };
  });
}

/** Duplicate hint while typing in the account form (masked per the viewer's tier). */
export async function checkAccountMatchesAction(input: { name: string; city: string; phone: string; email: string; rcNumber: string; excludeId?: string }) {
  return safeAction(async () => {
    const ctx = await requireContext();
    if (!input.name.trim()) return [];
    const matches = await findAccountMatches(ctx, {
      name: input.name,
      city: input.city || null,
      phone: normalizePhone(input.phone),
      email: input.email.trim().toLowerCase() || null,
      rcNumber: input.rcNumber.trim() || null,
      excludeId: input.excludeId,
    });
    return matches.map((m) => ({ id: m.account.id, name: m.account.name, city: m.account.city, phone: m.account.phone, reasons: m.reasons }));
  });
}
