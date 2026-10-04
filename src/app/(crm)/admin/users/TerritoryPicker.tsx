"use client";

import { useState } from "react";
import { BrandBadge } from "@/components/BrandBadge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  ROLE_KIND_LABELS,
  quickAssign,
  territoryKeyString,
  type RoleKind,
} from "@/server/access/quick-assign";

export interface PickerTerritory {
  id: string;
  level: number;
  brandCode: string | null;
  regionName: string | null;
}
export interface PickerBrand {
  code: string;
  name: string;
  color: string | null;
  status: string;
}

/**
 * Territory multi-select grouped by brand (rows) × brand-level / regions (columns), with the
 * quick-assign helper: role + region + brands → territories (BUSINESS_CONTEXT §6).
 * Submits `territoryIds` checkboxes inside the surrounding form.
 */
export function TerritoryPicker({
  territories,
  brands,
  regions,
  initial,
}: {
  territories: PickerTerritory[];
  brands: PickerBrand[];
  regions: string[];
  initial: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  const [kind, setKind] = useState<RoleKind>("LAGOS_EXEC");
  const [region, setRegion] = useState(regions.find((r) => r !== "Lagos") ?? "");
  const [qaBrands, setQaBrands] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<string[]>([]);

  const byKey = new Map(
    territories.map((t) => [territoryKeyString({ brandCode: t.level === 0 ? null : t.brandCode, regionName: t.regionName }), t]),
  );
  const root = territories.find((t) => t.level === 0);
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = () => {
    const pickable = brands.filter((b) => b.status !== "INACTIVE").map((b) => b.code);
    const qa = quickAssign({
      kind,
      regionName: region,
      brandCodes: [...qaBrands],
      allBrandCodes: pickable,
      allRegionNames: regions,
    });
    setErrors(qa.errors);
    if (qa.errors.length) return;
    setSelected(new Set(qa.territories.map((k) => byKey.get(territoryKeyString(k))?.id).filter((x): x is string => !!x)));
  };

  return (
    <div className="space-y-4" data-testid="territory-picker">
      <fieldset className="rounded-md border border-dashed border-border p-3">
        <legend className="px-1 text-xs font-semibold uppercase text-muted-foreground">Quick assign</legend>
        <div className="flex flex-wrap items-end gap-2">
          <Select aria-label="Role" value={kind} onChange={(e) => setKind(e.target.value as RoleKind)}>
            {Object.entries(ROLE_KIND_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
          {kind === "REGIONAL_EXEC" ? (
            <Select aria-label="Region" value={region} onChange={(e) => setRegion(e.target.value)}>
              {regions.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          ) : null}
          {kind === "BRAND_MANAGER" || kind === "LAGOS_EXEC" || kind === "REGIONAL_EXEC" ? (
            <div className="flex flex-wrap gap-2">
              {brands
                .filter((b) => b.status !== "INACTIVE")
                .map((b) => (
                  <label key={b.code} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={qaBrands.has(b.code)}
                      onChange={() =>
                        setQaBrands((s) => {
                          const n = new Set(s);
                          if (n.has(b.code)) n.delete(b.code);
                          else n.add(b.code);
                          return n;
                        })
                      }
                    />
                    {b.code}
                  </label>
                ))}
            </div>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={apply}>
            Apply
          </Button>
        </div>
        {errors.length ? <p className="mt-2 text-xs text-red-600">{errors.join(" · ")}</p> : null}
      </fieldset>

      {root ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="territoryIds" value={root.id} checked={selected.has(root.id)} onChange={() => toggle(root.id)} />
          Group – All Brands <span className="text-xs text-muted-foreground">(management / admin)</span>
        </label>
      ) : null}

      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="pr-3 text-left font-medium">Brand</th>
              <th className="px-2 font-medium">Whole brand</th>
              {regions.map((r) => (
                <th key={r} className="px-2 font-medium">
                  {r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {brands.map((b) => {
              const brandT = byKey.get(b.code);
              return (
                <tr key={b.code} className="border-t border-border">
                  <td className="py-1.5 pr-3">
                    <BrandBadge brand={b} />
                  </td>
                  <td className="px-2 text-center">
                    {brandT ? (
                      <input
                        type="checkbox"
                        name="territoryIds"
                        value={brandT.id}
                        aria-label={`${b.code} brand level`}
                        checked={selected.has(brandT.id)}
                        onChange={() => toggle(brandT.id)}
                      />
                    ) : null}
                  </td>
                  {regions.map((r) => {
                    const t = byKey.get(`${b.code}|${r}`);
                    return (
                      <td key={r} className="px-2 text-center">
                        {t ? (
                          <input
                            type="checkbox"
                            name="territoryIds"
                            value={t.id}
                            aria-label={`${b.code} – ${r}`}
                            checked={selected.has(t.id)}
                            onChange={() => toggle(t.id)}
                          />
                        ) : (
                          "–"
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{selected.size} territory membership(s) selected</p>
    </div>
  );
}
