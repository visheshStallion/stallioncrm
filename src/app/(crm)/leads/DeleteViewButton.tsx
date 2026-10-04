"use client";

import { useRouter } from "next/navigation";
import { toastResult } from "@/components/Toaster";

export function DeleteViewButton({
  id,
  action,
}: {
  id: string;
  action: (id: string) => Promise<{ ok: true; data: { message?: string } } | { ok: false; error: { code: string; message: string } }>;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="ml-1 text-xs text-muted-foreground underline"
      onClick={async () => {
        if (!window.confirm("Delete this saved view?")) return;
        const res = await action(id);
        toastResult(res, res.ok ? res.data.message : undefined);
        router.push("/leads");
      }}
    >
      delete view
    </button>
  );
}
