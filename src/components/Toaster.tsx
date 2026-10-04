"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Toast = { id: number; message: string; variant: "error" | "success" | "info" };
const EVENT = "crm:toast";

/** Fire a toast from any client component, for example after a server action returned an error. */
export function toast(message: string, variant: Toast["variant"] = "info") {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, variant } }));
}

/** Shows an ActionResult error (a ForbiddenError becomes "You do not have permission…"). */
export function toastResult(result: { ok: boolean; error?: { message: string } }, success?: string) {
  if (!result.ok) toast(result.error?.message ?? "Something went wrong", "error");
  else if (success) toast(success, "success");
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    let id = 0;
    const onToast = (e: Event) => {
      const t = { id: ++id, ...(e as CustomEvent).detail } as Toast;
      setToasts((xs) => [...xs, t]);
      setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== t.id)), 5000);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto rounded-md border px-4 py-3 text-sm shadow-lg",
            t.variant === "error" && "border-red-200 bg-red-50 text-red-800",
            t.variant === "success" && "border-emerald-200 bg-emerald-50 text-emerald-800",
            t.variant === "info" && "border-border bg-card",
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
