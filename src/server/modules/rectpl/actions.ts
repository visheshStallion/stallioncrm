"use server";

import { revalidatePath } from "next/cache";
import { safeAction, type ActionResult } from "@/server/api";
import { requireContext } from "@/server/request";
import { createFromTemplate } from "./service";

const str = (fd: FormData, key: string) => (fd.get(key) ?? "").toString().trim();

/** "Quote from template" on a deal: the quotation with the template's line items at today's prices. */
export async function createQuoteFromTemplateAction(_p: unknown, fd: FormData): Promise<ActionResult<{ message?: string; redirect?: string }>> {
  return safeAction(async () => {
    const res = await createFromTemplate(await requireContext(), "quotes", str(fd, "templateId"), { dealId: str(fd, "dealId") });
    revalidatePath("/quotes");
    return { message: "Quotation created from the template", redirect: res.next ?? res.href };
  });
}
