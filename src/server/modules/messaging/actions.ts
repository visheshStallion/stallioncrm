"use server";

import { revalidatePath } from "next/cache";
import { safeAction, type ActionResult } from "@/server/api";
import { BadRequestError } from "@/server/errors";
import { requireContext } from "@/server/request";
import * as campaigns from "./campaigns";
import { sendMessage } from "./service";

type Outcome = { message?: string; redirect?: string };
const str = (fd: FormData, k: string) => (fd.get(k) ?? "").toString().trim();
const PATH: Record<string, string> = { Lead: "/leads", Deal: "/deals" };

export async function sendMessageAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const res = await sendMessage(ctx, { channel: str(fd, "channel"), parentType: str(fd, "parentType"), parentId: str(fd, "parentId"), templateId: str(fd, "templateId"), subject: str(fd, "subject"), body: str(fd, "body") });
    if (res.status === "FAILED") throw new BadRequestError(`The message could not be sent: ${res.error}`);
    revalidatePath("/", "layout");
    return { message: `Sent as ${res.from}`, redirect: `${PATH[str(fd, "parentType")] ?? "/activities"}/${str(fd, "parentId")}` };
  });
}

export async function saveTemplateAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const res = await campaigns.saveTemplate(ctx, str(fd, "id") || null, {
      brandId: str(fd, "brandId") || null,
      channel: str(fd, "channel"),
      name: str(fd, "name"),
      subject: str(fd, "subject"),
      body: str(fd, "body"),
      whatsappStatus: str(fd, "whatsappStatus") || "NOT_SUBMITTED",
      whatsappName: str(fd, "whatsappName"),
      active: fd.has("_edit") ? fd.get("active") === "on" : true,
    });
    revalidatePath("/campaigns/templates");
    return { message: res.unknownFields.length ? `Template saved – unknown merge fields: ${res.unknownFields.join(", ")}` : "Template saved", redirect: "/campaigns/templates" };
  });
}

export async function deleteTemplateAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await campaigns.deleteTemplate(await requireContext(), str(fd, "id"));
    revalidatePath("/campaigns/templates");
    return { message: "Template removed", redirect: "/campaigns/templates" };
  });
}

const campaignInput = (fd: FormData) => ({
  brandId: str(fd, "brandId"),
  name: str(fd, "name"),
  type: str(fd, "type") || "PROMO",
  channel: str(fd, "channel"),
  budget: str(fd, "budget"),
  startDate: str(fd, "startDate"),
  endDate: str(fd, "endDate"),
  templateId: str(fd, "templateId"),
  audience: { kind: str(fd, "audienceKind") || "ALL_LEADS", reportId: str(fd, "reportId") || null },
});

export async function saveCampaignAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const ctx = await requireContext();
    const id = str(fd, "id");
    const saved = id ? await campaigns.updateCampaign(ctx, id, campaignInput(fd)) : await campaigns.createCampaign(ctx, campaignInput(fd));
    revalidatePath("/campaigns");
    return { message: "Campaign saved", redirect: `/campaigns/${saved.id}` };
  });
}

export async function buildAudienceAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const res = await campaigns.buildAudience(await requireContext(), str(fd, "id"));
    revalidatePath(`/campaigns/${str(fd, "id")}`);
    return { message: `Audience built: ${res.pending} with consent, ${res.suppressed} suppressed, ${res.noAddress} without an address` };
  });
}

export async function launchCampaignAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const res = await campaigns.launchCampaign(await requireContext(), str(fd, "id"));
    revalidatePath(`/campaigns/${str(fd, "id")}`);
    return { message: `Campaign launched: ${res.pending} messages queued` };
  });
}

export async function cancelCampaignAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await campaigns.cancelCampaign(await requireContext(), str(fd, "id"));
    revalidatePath(`/campaigns/${str(fd, "id")}`);
    return { message: "Campaign cancelled" };
  });
}
