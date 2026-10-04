/**
 * Offline store of the PWA (IndexedDB, browser only). It holds
 *   • the last snapshot of the user's OWN leads, deals and activities (read cache), and
 *   • the outbox of quick actions recorded while offline.
 * The cache belongs to one user with one access scope: `needsWipe` says when it must be thrown away – another
 * user on the device, or the same user with changed territories / permissions. Logout wipes it as well.
 */
export interface OfflineMeta {
  userId: string;
  scopeHash: string;
  generatedAt: string;
}
export interface OfflineSnapshot extends OfflineMeta {
  leads: Array<Record<string, unknown>>;
  deals: Array<Record<string, unknown>>;
  activities: Array<Record<string, unknown>>;
}
export interface OutboxItem {
  key: string;
  type: "lead.create" | "call.log" | "note.add";
  payload: Record<string, unknown>;
  at: string;
  /** set when the server refused it (conflict / error): kept for the user to see, not retried automatically */
  failed?: string;
  label: string;
  userId: string;
}

/** Pure: must the cached records be discarded before `next` is stored? */
export function needsWipe(current: OfflineMeta | null | undefined, next: Pick<OfflineMeta, "userId" | "scopeHash">): boolean {
  return !!current && (current.userId !== next.userId || current.scopeHash !== next.scopeHash);
}

const DB = "stallion-offline";
const STORES = ["meta", "records", "outbox"] as const;
type Store = (typeof STORES)[number];

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(stores: Store[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(stores, mode);
      const req = fn(t);
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export const available = () => typeof indexedDB !== "undefined";

export async function getMeta(): Promise<OfflineMeta | null> {
  return ((await tx<OfflineMeta>(["meta"], "readonly", (t) => t.objectStore("meta").get("meta"))) as OfflineMeta | undefined) ?? null;
}

/** Stores a fresh snapshot; a snapshot of another user or another access scope replaces everything, including the outbox. */
export async function saveSnapshot(snap: OfflineSnapshot): Promise<{ wiped: boolean }> {
  const wiped = needsWipe(await getMeta(), snap);
  if (wiped) await wipe();
  await tx(["meta", "records"], "readwrite", (t) => {
    t.objectStore("meta").put({ userId: snap.userId, scopeHash: snap.scopeHash, generatedAt: snap.generatedAt } satisfies OfflineMeta, "meta");
    const records = t.objectStore("records");
    records.put(snap.leads, "leads");
    records.put(snap.deals, "deals");
    records.put(snap.activities, "activities");
  });
  return { wiped };
}

export async function readRecords(kind: "leads" | "deals" | "activities"): Promise<Array<Record<string, unknown>>> {
  return ((await tx<Array<Record<string, unknown>>>(["records"], "readonly", (t) => t.objectStore("records").get(kind))) as Array<Record<string, unknown>> | undefined) ?? [];
}

export async function queue(item: OutboxItem): Promise<void> {
  await tx(["outbox"], "readwrite", (t) => t.objectStore("outbox").put(item, item.key));
}

export async function outbox(): Promise<OutboxItem[]> {
  return ((await tx<OutboxItem[]>(["outbox"], "readonly", (t) => t.objectStore("outbox").getAll())) as OutboxItem[] | undefined) ?? [];
}

export async function settle(key: string, failed?: string): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(["outbox"], "readwrite");
      const store = t.objectStore("outbox");
      if (!failed) store.delete(key);
      else {
        const get = store.get(key);
        get.onsuccess = () => {
          if (get.result) store.put({ ...(get.result as OutboxItem), failed }, key);
        };
      }
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

/** Removes everything: on logout, on a change of user, when the access scope changed, when the session ended. */
export async function wipe(): Promise<void> {
  if (!available()) return;
  await tx(["meta", "records", "outbox"], "readwrite", (t) => {
    for (const s of STORES) t.objectStore(s).clear();
  });
}

export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
