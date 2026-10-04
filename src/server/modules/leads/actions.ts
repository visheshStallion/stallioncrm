"use server";

import { revalidatePath } from "next/cache";
import { safeAction, type ActionResult } from "@/server/api";
import { BadRequestError } from "@/server/errors";
import { requireContext } from "@/server/request";
import * as rules from "./assignment-admin";
import { findDuplicates } from "./queries";
import type { CreateLeadInput, LeadFilters, UpdateLeadInput } from "./schema";
import { normalizePhone } from "@/lib/phone";
import * as svc from "./service";

type Outcome = { message?: string; redirect?: string };

const str = (fd: FormData, k: string) => (fd.get(k) ?? "").toString().trim();
const leadInput = (fd: FormData) => ({
  firstName: str(fd, "firstName"),
  lastName: str(fd, "lastName"),
  mobile: str(fd, "mobile"),
  email: str(fd, "email"),
  city: str(fd, "city"),
  source: (str(fd, "source") || "WALK_IN") as CreateLeadInput["source"],
  sourceDetail: str(fd, "sourceDetail"),
  modelOfInterestId: str(fd, "modelOfInterestId"),
  budget: str(fd, "budget") as unknown as number,
  paymentIntent: str(fd, "paymentIntent") as CreateLeadInput["paymentIntent"],
  tradeIn: fd.get("tradeIn") === "on",
  tradeInNotes: str(fd, "tradeInNotes"),
  expectedPurchaseWindow: str(fd, "expectedPurchaseWindow") as CreateLeadInput["expectedPurchaseWindow"],
  rating: str(fd, "rating") as CreateLeadInput["rating"],
  consentMarketing: fd.get("consentMarketing") === "on",
  regionId: str(fd, "regionId"),
  status: (str(fd, "status") || "NEW") as CreateLeadInput["status"],
  unqualifiedReason: str(fd, "unqualifiedReason"),
});

export async function createLeadAction(_p: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const lead = await svc.createLead(
      ctx,
      { ...leadInput(fd), brandId: str(fd, "brandId"), ownerId: str(fd, "ownerId") || undefined },
      { autoAssign: fd.get("autoAssign") === "on" },
    );
    revalidatePath("/leads");
    return { message: "Lead created", redirect: fd.get("_saveAndNew") ? "/leads/new" : `/leads/${lead.id}` };
  });
}

export async function updateLeadAction(_p: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const id = str(fd, "id");
    await svc.updateLead(ctx, id, leadInput(fd) as UpdateLeadInput);
    revalidatePath(`/leads/${id}`);
    return { message: "Lead updated successfully", redirect: `/leads/${id}` };
  });
}

export async function changeOwnerAction(_p: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const id = str(fd, "id");
    await svc.changeLeadOwner(ctx, id, str(fd, "ownerId"));
    revalidatePath(`/leads/${id}`);
    return { message: "Owner changed" };
  });
}

export async function massOwnerAction(ids: string[], ownerId: string) {
  return safeAction(async () => {
    const res = await svc.massChangeOwner(await requireContext(), ids, ownerId);
    revalidatePath("/leads");
    return { message: `${res.count} lead(s) reassigned` };
  });
}

export async function massStatusAction(ids: string[], status: string, reason?: string) {
  return safeAction(async () => {
    const res = await svc.massUpdateStatus(await requireContext(), ids, status as never, reason);
    revalidatePath("/leads");
    return { message: `${res.count} lead(s) updated` };
  });
}

export async function checkDuplicatesAction(input: { brandId: string; mobile: string; email: string; excludeId?: string }) {
  return safeAction(async () => {
    const ctx = await requireContext();
    if (!input.brandId) return { sameBrand: [], existsElsewhere: false, contacts: [] };
    return findDuplicates(ctx, {
      brandId: input.brandId,
      mobile: normalizePhone(input.mobile),
      email: input.email.trim().toLowerCase() || null,
      excludeId: input.excludeId,
    });
  });
}

export async function convertLeadAction(_p: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const id = str(fd, "id");
    const accountMode = str(fd, "accountMode");
    const contactId = str(fd, "contactId");
    const res = await svc.convertLead(ctx, id, {
      account:
        accountMode === "existing"
          ? { mode: "existing", accountId: str(fd, "accountId") }
          : { mode: "new", type: accountMode === "company" ? "COMPANY" : "INDIVIDUAL", name: str(fd, "companyName") },
      contact: contactId ? { mode: "existing", contactId } : { mode: "new" },
      deal: {
        name: str(fd, "dealName"),
        amount: str(fd, "amount") ? Number(str(fd, "amount")) : null,
        closeDate: str(fd, "closeDate") || null,
      },
    });
    revalidatePath("/leads");
    return { message: "Lead converted", redirect: `/deals/${res.dealId}` };
  });
}

export async function saveViewAction(input: { name: string; filters: LeadFilters & { f?: string[]; sys?: string }; columns?: string[] | null }) {
  return safeAction(async () => {
    const view = await svc.saveView(await requireContext(), input);
    revalidatePath("/leads");
    return { id: view.id };
  });
}

export async function deleteViewAction(id: string) {
  return safeAction(async () => {
    await svc.deleteView(await requireContext(), id);
    revalidatePath("/leads");
    return { message: "View deleted" };
  });
}

// ── Assignment rules (admin) ──
const ruleInput = (fd: FormData): rules.RuleInput => ({
  name: str(fd, "name"),
  active: fd.get("active") === "on",
  brandId: str(fd, "brandId"),
  regionId: str(fd, "regionId"),
  source: str(fd, "source") as rules.RuleInput["source"],
  productId: str(fd, "productId"),
  action: (str(fd, "action") || "ROUND_ROBIN") as rules.RuleInput["action"],
  userId: str(fd, "userId"),
});

async function adminRun(fn: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<string>): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const message = await fn(await requireContext());
    revalidatePath("/admin/assignment-rules/leads");
    return { message };
  });
}

export async function createRuleAction(_p: unknown, fd: FormData) {
  return adminRun(async (ctx) => (await rules.createRule(ctx, ruleInput(fd)), "Rule created"));
}
export async function updateRuleAction(_p: unknown, fd: FormData) {
  return adminRun(async (ctx) => (await rules.updateRule(ctx, str(fd, "id"), ruleInput(fd)), "Rule saved"));
}
export async function deleteRuleAction(_p: unknown, fd: FormData) {
  return adminRun(async (ctx) => (await rules.deleteRule(ctx, str(fd, "id")), "Rule deleted"));
}
export async function moveRuleAction(_p: unknown, fd: FormData) {
  return adminRun(async (ctx) => {
    const dir = str(fd, "direction");
    if (dir !== "up" && dir !== "down") throw new BadRequestError("Invalid direction");
    await rules.moveRule(ctx, str(fd, "id"), dir);
    return "Rule moved";
  });
}

/** Inline cell edit from the list (double-click). Only a few safe fields; full rules apply in updateLead. */
const INLINE_FIELDS = new Set(["status", "rating", "city", "source"]);
export async function inlineEditLeadAction(id: string, field: string, value: string) {
  return safeAction(async () => {
    if (!INLINE_FIELDS.has(field)) throw new BadRequestError("This field cannot be edited inline");
    const ctx = await requireContext();
    await svc.updateLead(ctx, id, { [field]: value || null } as UpdateLeadInput);
    revalidatePath("/leads");
    return { message: "Lead updated successfully" };
  });
}
