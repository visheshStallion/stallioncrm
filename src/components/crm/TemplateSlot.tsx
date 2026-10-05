import { notFound } from "next/navigation";
import { isAccessError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { resolveForUse } from "@/server/modules/rectpl/service";
import { TemplateApplier } from "./TemplateApplier";

/**
 * Inside a create form: when the page was opened with `?template=<id>`, the template's values for this user.
 * A template the user may not use (another brand's, someone's personal one, unpublished) does not exist: 404.
 */
export async function TemplateSlot({ ctx, module, templateId, clearHref }: { ctx: AccessContext; module: string; templateId: string | undefined; clearHref: string }) {
  if (!templateId) return null;
  const t = await resolveForUse(ctx, templateId, module).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  return <TemplateApplier template={{ id: t.id, name: t.name, values: t.values, locked: t.locked, hidden: t.hidden }} clearHref={clearHref} />;
}
