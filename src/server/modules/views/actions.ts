"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { NotFoundError } from "@/server/access/errors";
import { isModuleKey } from "@/server/access/modules";
import { safeAction } from "@/server/api";
import { scopedDb } from "@/server/db";
import { BadRequestError } from "@/server/errors";
import { requireContext } from "@/server/request";

/** Saves the current list state (view base, search, field conditions …) as a custom view of the signed-in user. */
export async function saveViewAction(input: { module: string; name: string; filters: Record<string, unknown> }) {
  return safeAction(async () => {
    const ctx = await requireContext();
    const name = input.name.trim();
    if (!isModuleKey(input.module)) throw new BadRequestError("Unknown module");
    if (!name || name.length > 60) throw new BadRequestError("View name must be 1–60 characters");
    const filters = JSON.parse(JSON.stringify(input.filters ?? {})) as Prisma.InputJsonValue;
    if (JSON.stringify(filters).length > 4000) throw new BadRequestError("Too many filters to save");
    const view = await scopedDb(ctx).savedView.upsert({
      where: { userId_module_name: { userId: ctx.userId, module: input.module, name } },
      update: { filters },
      create: { userId: ctx.userId, module: input.module, name, filters },
    });
    revalidatePath(`/${input.module}`);
    return { id: view.id };
  });
}

export async function deleteViewAction(id: string) {
  return safeAction(async () => {
    const ctx = await requireContext();
    const res = await scopedDb(ctx).savedView.deleteMany({ where: { id, userId: ctx.userId } });
    if (res.count === 0) throw new NotFoundError();
    return { message: "View deleted" };
  });
}
