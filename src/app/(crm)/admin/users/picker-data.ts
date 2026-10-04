import type { adminLookups } from "@/server/modules/admin/queries";
import type { PickerBrand, PickerTerritory } from "./TerritoryPicker";

type Lookups = Awaited<ReturnType<typeof adminLookups>>;

/** Serializable props for <TerritoryPicker> from the admin lookups. */
export function pickerData(lookups: Lookups) {
  const brandCode = new Map(lookups.brands.map((b) => [b.id, b.code]));
  const regionName = new Map(lookups.regions.map((r) => [r.id, r.name]));
  const territories: PickerTerritory[] = lookups.territories.map((t) => ({
    id: t.id,
    level: t.level,
    brandCode: t.brandId ? brandCode.get(t.brandId) ?? null : null,
    regionName: t.regionId ? regionName.get(t.regionId) ?? null : null,
  }));
  const brands: PickerBrand[] = lookups.brands.map((b) => ({ code: b.code, name: b.name, color: b.color, status: b.status }));
  return { territories, brands, regions: lookups.activeRegions.map((r) => r.name) };
}
