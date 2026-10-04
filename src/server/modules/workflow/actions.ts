"use server";

import { revalidatePath } from "next/cache";
import { NotFoundError } from "@/server/access/errors";
import { safeAction, type ActionResult } from "@/server/api";
import { retryJob } from "@/server/db/jobs";
import { deleteRule, saveRule, setRuleActive } from "@/server/db/workflow-store";
import { BadRequestError } from "@/server/errors";
import { requireContext } from "@/server/request";
import { tick } from "./engine";
import { ruleSchema } from "./schema";

type Outcome = { message?: string; redirect?: string };
const str = (fd: FormData, k: string) => (fd.get(k) ?? "").toString().trim();

async function requireAdmin() {
  const ctx = await requireContext();
  if (!ctx.isAdmin) throw new NotFoundError();
  return ctx;
}

/** The rule builder posts the whole rule as JSON in `payload`; it is validated against the module schema. */
export async function saveRuleAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireAdmin();
    let raw: unknown;
    try {
      raw = JSON.parse(str(fd, "payload"));
    } catch {
      throw new BadRequestError("The rule could not be read");
    }
    const rule = ruleSchema.parse(raw);
    await saveRule(ctx, str(fd, "id") || null, { ...rule, triggerConfig: rule.triggerConfig, criteria: rule.criteria as never, actions: rule.actions as never });
    revalidatePath("/admin/workflows");
    return { message: "Workflow rule saved", redirect: "/admin/workflows" };
  });
}

export async function toggleRuleAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const active = str(fd, "active") === "true";
    await setRuleActive(await requireAdmin(), str(fd, "id"), active);
    revalidatePath("/admin/workflows");
    return { message: active ? "Rule activated" : "Rule deactivated" };
  });
}

export async function deleteRuleAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await deleteRule(await requireAdmin(), str(fd, "id"));
    revalidatePath("/admin/workflows");
    return { message: "Rule deleted", redirect: "/admin/workflows" };
  });
}

export async function retryJobAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await requireAdmin();
    if (!(await retryJob(str(fd, "id")))) throw new BadRequestError("Only failed jobs can be retried");
    revalidatePath("/admin/jobs");
    return { message: "Job queued again" };
  });
}

/** Runs one scheduler tick now (scheduled rules, due jobs, reminders, auto-approvals). */
export async function runSchedulerAction(_prev: unknown, _fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await requireAdmin();
    const res = await tick();
    revalidatePath("/admin/jobs");
    return { message: `Scheduler ran: ${res.scheduled} queued, ${res.done} done, ${res.failed} failed` };
  });
}
