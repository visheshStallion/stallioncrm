"use server";

import { revalidatePath } from "next/cache";
import { safeAction } from "@/server/api";
import { requireContext } from "@/server/request";
import type { CreateDealInput, UpdateDealInput } from "./schema";
import { createDeal, updateDeal } from "./service";

export async function createDealAction(input: CreateDealInput) {
  return safeAction(async () => {
    const ctx = await requireContext();
    const deal = await createDeal(ctx, input);
    revalidatePath("/deals");
    return deal;
  });
}

export async function updateDealAction(id: string, input: UpdateDealInput) {
  return safeAction(async () => {
    const ctx = await requireContext();
    const deal = await updateDeal(ctx, id, input);
    revalidatePath(`/deals/${id}`);
    return deal;
  });
}

/** Form variant (Quick Create drawer). */
export async function createDealFormAction(_prev: unknown, fd: FormData) {
  const str = (k: string) => (fd.get(k) ?? "").toString().trim();
  return safeAction(async () => {
    const ctx = await requireContext();
    const deal = await createDeal(ctx, {
      name: str("name"),
      customerName: str("customerName") || undefined,
      amount: str("amount") ? Number(str("amount")) : undefined,
      brandId: str("brandId"),
      regionId: str("regionId"),
    });
    revalidatePath("/deals");
    return { message: "Deal created", redirect: `/deals/${deal.id}` };
  });
}
