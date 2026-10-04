"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toastResult } from "@/components/Toaster";
import { Select } from "@/components/ui/select";
import { setFiltersAction } from "./actions";

interface Option {
  id: string;
  label: string;
}

/** Brand switcher + region filter. Only lists the user's own brands/regions; narrows, never widens. */
export function FilterBar({
  brands,
  regions,
  brandId,
  regionId,
}: {
  brands: Option[];
  regions: Option[];
  brandId: string | null;
  regionId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const update = (next: { brandId: string | null; regionId: string | null }) =>
    start(async () => {
      const result = await setFiltersAction(next);
      toastResult(result);
      router.refresh();
    });

  return (
    <div className="flex items-center gap-2" aria-busy={pending}>
      <Select
        aria-label="Brand"
        data-testid="brand-switcher"
        value={brandId ?? ""}
        onChange={(e) => update({ brandId: e.target.value || null, regionId })}
      >
        <option value="">All my brands</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Region"
        data-testid="region-filter"
        value={regionId ?? ""}
        onChange={(e) => update({ brandId, regionId: e.target.value || null })}
      >
        <option value="">All my regions</option>
        {regions.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
