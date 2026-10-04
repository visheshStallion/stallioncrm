/**
 * Client side of the offline sync (browser only): refresh the snapshot, flush the outbox, submit a quick
 * action (directly when online, into the outbox when not).
 */
import { available, getMeta, newKey, outbox, queue, saveSnapshot, settle, wipe, type OfflineSnapshot, type OutboxItem } from "./store";

export type SubmitOutcome = { state: "done"; id?: string } | { state: "queued" } | { state: "refused"; message: string };
interface Result {
  key: string;
  status: "ok" | "duplicate" | "conflict" | "error";
  message?: string;
  id?: string;
}

async function post(ops: Array<Pick<OutboxItem, "key" | "type" | "payload" | "at">>): Promise<Result[] | "offline" | "signed-out"> {
  try {
    const res = await fetch("/api/v1/offline/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ops }) });
    if (res.status === 401) return "signed-out";
    if (!res.ok) return "offline"; // server trouble: keep the actions for the next attempt
    return ((await res.json()) as { data: Result[] }).data;
  } catch {
    return "offline";
  }
}

/** Sends the outbox. Conflicts and errors stay in the outbox, marked, for the user to read and discard. */
export async function flushOutbox(): Promise<{ sent: number; failed: number; pending: number }> {
  if (!available()) return { sent: 0, failed: 0, pending: 0 };
  const items = (await outbox()).filter((i) => !i.failed);
  if (items.length === 0) return { sent: 0, failed: 0, pending: 0 };
  const results = await post(items.map(({ key, type, payload, at }) => ({ key, type, payload, at })));
  if (results === "offline" || results === "signed-out") return { sent: 0, failed: 0, pending: items.length };
  let sent = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "ok" || r.status === "duplicate") {
      await settle(r.key);
      sent++;
    } else {
      await settle(r.key, r.message ?? (r.status === "conflict" ? "Conflict" : "Rejected"));
      failed++;
    }
  }
  return { sent, failed, pending: 0 };
}

/** Fetches the user's snapshot. The cache is wiped when the user or their access changed, or the session ended. */
export async function refreshSnapshot(): Promise<"updated" | "wiped" | "offline" | "signed-out"> {
  if (!available()) return "offline";
  try {
    const res = await fetch("/api/v1/offline/snapshot", { headers: { Accept: "application/json" } });
    if (res.status === 401) {
      await wipe();
      return "signed-out";
    }
    if (!res.ok) return "offline";
    const snap = ((await res.json()) as { data: OfflineSnapshot }).data;
    return (await saveSnapshot(snap)).wiped ? "wiped" : "updated";
  } catch {
    return "offline";
  }
}

/** One quick action: applied now when the server can be reached, otherwise kept in the outbox. */
export async function submitAction(type: OutboxItem["type"], payload: Record<string, unknown>, label: string): Promise<SubmitOutcome> {
  const item = { key: newKey(), type, payload, at: new Date().toISOString() };
  const results = navigator.onLine ? await post([item]) : "offline";
  if (results === "signed-out") return { state: "refused", message: "You are signed out – sign in and try again" };
  if (results === "offline") {
    const meta = await getMeta();
    if (!meta) return { state: "refused", message: "You are offline and this device has no offline data yet" };
    await queue({ ...item, label, userId: meta.userId });
    return { state: "queued" };
  }
  const r = results[0];
  if (r && (r.status === "ok" || r.status === "duplicate")) return { state: "done", id: r.id };
  return { state: "refused", message: r?.message ?? "The action was refused" };
}
