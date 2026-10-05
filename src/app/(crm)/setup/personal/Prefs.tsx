"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toastResult } from "@/components/Toaster";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { setPreferenceAction } from "@/server/modules/preferences/actions";

const FIELDS: Array<{ key: "theme" | "density" | "nav" | "dateFormat"; label: string; options: Array<[string, string]> }> = [
  { key: "theme", label: "Theme", options: [["light", "Light"], ["dark", "Dark"], ["system", "Follow the device"]] },
  { key: "density", label: "Density", options: [["standard", "Standard"], ["comfortable", "Comfortable (larger)"], ["compact", "Compact rows"]] },
  { key: "nav", label: "Navigation", options: [["sidebar", "Sidebar"], ["classic", "Classic tabs"]] },
  { key: "dateFormat", label: "Date format", options: [["DD/MM/YYYY", "DD/MM/YYYY"], ["MM/DD/YYYY", "MM/DD/YYYY"], ["YYYY-MM-DD", "YYYY-MM-DD"]] },
];

/** The signed-in user's own display preferences; each change is saved at once. */
export function Prefs({ values }: { values: Record<"theme" | "density" | "nav" | "dateFormat", string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-busy={pending}>
      {FIELDS.map((f) => (
        <div key={f.key} className="space-y-1">
          <Label htmlFor={`pref-${f.key}`}>{f.label}</Label>
          <Select
            id={`pref-${f.key}`}
            className="w-full"
            defaultValue={values[f.key]}
            disabled={pending}
            onChange={(e) =>
              start(async () => {
                toastResult(await setPreferenceAction(f.key, e.target.value), "Saved");
                router.refresh();
              })
            }
          >
            {f.options.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      ))}
    </div>
  );
}
