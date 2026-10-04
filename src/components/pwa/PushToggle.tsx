"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const toKey = (base64: string) => {
  const raw = atob((base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Switches web push on or off for THIS browser. Hidden while the server has no VAPID keys. */
export function PushToggle() {
  const [state, setState] = useState<"loading" | "unsupported" | "off" | "on" | "denied">("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setState("unsupported");
      const res = await fetch("/api/v1/push/subscribe").catch(() => null);
      const key = res?.ok ? ((await res.json()) as { data: { publicKey: string | null } }).data.publicKey : null;
      setPublicKey(key);
      if (!key) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    if (!publicKey) return;
    if ((await Notification.requestPermission()) !== "granted") return setState("denied");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) });
    await fetch("/api/v1/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
    setState("on");
  }
  async function disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/v1/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState("off");
  }

  if (state === "loading") return null;
  if (state === "unsupported") return <p className="text-xs text-text-muted">Push notifications are not available in this browser or not switched on for this installation.</p>;
  if (state === "denied") return <p className="text-xs text-text-muted">Notifications are blocked for this site in the browser settings.</p>;
  return (
    <Button type="button" variant="outline" size="sm" onClick={state === "on" ? disable : enable} data-testid="push-toggle">
      {state === "on" ? "Turn off push on this device" : "Turn on push on this device"}
    </Button>
  );
}
