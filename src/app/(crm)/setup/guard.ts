import "server-only";
import { notFound } from "next/navigation";
import { isAccessError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { assertSetup } from "@/server/modules/setup/access";
import type { SetupEntry } from "@/server/modules/setup/catalogue";
import { requireContext } from "@/server/request";

/**
 * First line of every Setup page: `const { ctx, entry } = await requireSetup("<catalogue key>")`.
 * The key is the page's `setupPermission` declaration – the tiers come from the catalogue entry. A user outside those
 * tiers gets 404, the same answer as for a page that does not exist.
 */
export async function requireSetup(key: string): Promise<{ ctx: AccessContext; entry: SetupEntry }> {
  const ctx = await requireContext();
  try {
    return { ctx, entry: assertSetup(ctx, key) };
  } catch (e) {
    if (isAccessError(e)) notFound();
    throw e;
  }
}
