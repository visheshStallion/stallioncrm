"use client";

import { useRouter } from "next/navigation";
import { MenuItem } from "@/components/crm/overlays";
import { toast } from "@/components/Toaster";
import { deleteViewAction, saveViewAction } from "@/server/modules/leads/actions";
import type { LeadFilters } from "@/server/modules/leads/schema";

type ViewFilters = LeadFilters & { f?: string[]; sys?: string };

/** "Actions" menu entries for views: save current as a custom view, delete the current custom view. */
export function ViewActions({ filters, savedViewId }: { filters: ViewFilters; savedViewId: string | null }) {
  const router = useRouter();
  return (
    <>
      <MenuItem
        onClick={async () => {
          const name = window.prompt("Name for this view");
          if (!name) return;
          const res = await saveViewAction({ name, filters });
          if (!res.ok) return toast(res.error.message, "error");
          toast(`View “${name}” saved`, "success");
          router.push(`/leads?view=${res.data.id}`);
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
            router.push("/leads");
          }}
        >
          Delete this view
        </MenuItem>
      ) : null}
    </>
  );
}
