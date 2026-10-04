"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { available, outbox, wipe } from "@/lib/offline/store";
import { flushOutbox, refreshSnapshot } from "@/lib/offline/sync";

/**
 * Mounted in the signed-in shell: registers the service worker, keeps the offline cache of the user's own
 * records fresh, sends the outbox when the connection is back and shows the offline / pending banner.
 */
export function PwaClient() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const count = async () => {
      if (!available()) return;
      const items = await outbox().catch(() => []);
      if (cancelled) return;
      setPending(items.filter((i) => !i.failed).length);
      setFailed(items.filter((i) => i.failed).length);
    };
    const sync = async () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine || !available()) return count();
      await flushOutbox().catch(() => undefined);
      await refreshSnapshot().catch(() => undefined); // wipes the cache when the user's access changed
      await count();
    };
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => navigator.serviceWorker.ready)
        .then((reg) => reg.active?.postMessage({ type: "warm" }))
        .catch(() => undefined);
    }
    void sync();
    const offline = () => setOnline(false);
    window.addEventListener("online", sync);
    window.addEventListener("offline", offline);
    window.addEventListener("stallion:outbox", count);
    return () => {
      cancelled = true;
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", offline);
      window.removeEventListener("stallion:outbox", count);
    };
  }, []);

  if (online && pending === 0 && failed === 0) return null;
  return (
    <div role="status" className="border-b border-border bg-warning/15 px-4 py-1.5 text-center text-[13px]" data-testid="offline-banner">
      {online ? null : "You are offline – showing what was saved on this device. "}
      {pending ? `${pending} action${pending === 1 ? "" : "s"} waiting to be sent. ` : null}
      {failed ? `${failed} action${failed === 1 ? "" : "s"} could not be applied. ` : null}
      <Link href="/quick" className="font-semibold underline">
        Quick actions
      </Link>
    </div>
  );
}

/** On the sign-in page: whoever is here is signed out, so nothing of the previous user may stay on the device. */
export function WipeOfflineData() {
  useEffect(() => {
    void wipe().catch(() => undefined);
  }, []);
  return null;
}
