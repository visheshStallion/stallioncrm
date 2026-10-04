"use client";

import { useRouter } from "next/navigation";
import { toast } from "@/components/Toaster";
import { deleteViewAction, saveViewAction } from "@/server/modules/views/actions";
import { MenuItem } from "./overlays";

/** "Actions" menu entries for list views: save the current state as a custom view, delete the current custom view. */
export function ViewActions({ module, filters, savedViewId }: { module: string; filters: Record<string, unknown>; savedViewId: string | null }) {
  const router = useRouter();
  return (
    <>
      <MenuItem
        onClick={async () => {
          const name = window.prompt("Name for this view");
          if (!name) return;
          const res = await saveViewAction({ module, name, filters });
          if (!res.ok) return toast(res.error.message, "error");
          toast(`View “${name}” saved`, "success");
          router.push(`/${module}?view=${res.data.id}`);
        }}
      >
        Save as custom view
      </MenuItem>
      {savedViewId ? (
        <MenuItem
          onClick={async () => {
            if (!window.confirm("Delete this custom view?")) return;
            const res = await deleteViewAction(savedViewId);
            toast(res.ok ? "View deleted" : res.error.message, res.ok ? "success" : "error");
            router.push(`/${module}`);
          }}
        >
          Delete this view
        </MenuItem>
      ) : null}
    </>
  );
}
