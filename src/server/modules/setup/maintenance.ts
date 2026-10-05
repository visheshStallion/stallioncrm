/**
 * Setup housekeeping run by the scheduler tick: the recycle-bin retention (Setup → Recycle Bin) and expiry of
 * four-eyes requests nobody decided.
 */
import "server-only";
import { audit } from "@/server/db";
import * as store from "@/server/db/setup-store";
import { getSetting } from "./service";

export async function setupMaintenance(now = new Date()): Promise<number> {
  await store.expireApprovals();
  const { purgeAfterDays } = await getSetting("recycleBin");
  if (!purgeAfterDays) return 0;
  const olderThan = new Date(now.getTime() - purgeAfterDays * 86_400_000);
  let purged = 0;
  for (const model of store.RECYCLABLE_MODELS) purged += (await store.purgeDeleted(model, { olderThan })).purged;
  if (purged) await audit({ action: "DELETE", entity: "RecycleBin", after: { purged, retentionDays: purgeAfterDays, by: "scheduler" } });
  return purged;
}
