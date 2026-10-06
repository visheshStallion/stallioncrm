import Link from "next/link";
import { forbidden } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow } from "@/components/crm/primitives";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/server/access/can";
import { saveSettingsAction, saveVendorAction, saveWarehouseAction } from "@/server/modules/inventory/actions";
import { CURRENCIES, DEFAULT_PDI, VENDOR_TYPES, WAREHOUSE_TYPES, statusLabel } from "@/server/modules/inventory/config";
import { ACCOUNT_KEYS, ACCOUNT_LABELS, accountMap } from "@/server/modules/inventory/journal";
import { canSeeCost, getSettings, isSalesView, listVendors, listWarehouses } from "@/server/modules/inventory/queries";
import { getDirectory } from "@/server/modules/org/queries";
import { getUiFilters, requireContext } from "@/server/request";

export const metadata = { title: "Inventory settings" };

/** Warehouses, vendors and the inventory settings of ONE brand (each brand is its own legal entity). */
export default async function InventorySettingsPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (isSalesView(ctx)) forbidden();
  const [dir, ui] = await Promise.all([getDirectory(ctx), getUiFilters(ctx)]);
  const brands = dir.myBrands.filter((b) => b.status !== "INACTIVE");
  const brand = brands.find((b) => b.code === sp.brand) ?? brands.find((b) => b.id === ui.brandId) ?? brands[0];
  if (!brand) forbidden();
  const [warehouses, vendors, settings] = await Promise.all([listWarehouses(ctx, brand.id), listVendors(ctx, brand.id), getSettings(ctx, brand.id)]);
  const canEdit = hasPermission(ctx, "inventory", "edit");
  const finance = canSeeCost(ctx);
  const canSettings = hasPermission(ctx, "inventoryFinance", "edit");
  const accounts = accountMap(settings.accounts);
  return (
    <div className="space-y-4">
      <PageTitleRow title="Inventory settings" left={<span className="text-[13px] text-text-muted">{brand.name}</span>} />
      {brands.length > 1 ? (
        <nav className="flex flex-wrap gap-1" aria-label="Brand">
          {brands.map((b) => (
            <Link key={b.id} href={`/inventory/settings?brand=${b.code}`} className={cn("rounded-full border px-3 py-1 text-[13px]", b.id === brand.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:bg-muted")}>
              {b.code}
            </Link>
          ))}
        </nav>
      ) : null}

      <section className="rounded-lg border border-border bg-surface" data-testid="warehouses">
        <h2 className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">Warehouses</h2>
        <table className="w-full text-[13px]">
          <tbody>
            {warehouses.map((w) => (
              <tr key={w.id} className="border-b border-border">
                <td className="px-4 py-2 font-mono text-xs">{w.code}</td>
                <td className="px-4 py-2">{w.name}</td>
                <td className="px-4 py-2">{statusLabel(w.type)}</td>
                <td className="px-4 py-2">{dir.regions.find((r) => r.id === w.regionId)?.name ?? "—"}</td>
                <td className="px-4 py-2 text-text-muted">{w.active ? "" : "inactive"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit ? (
          <ActionForm action={saveWarehouseAction} className="flex flex-wrap items-end gap-2 p-4">
            <input type="hidden" name="brandId" value={brand.id} />
            <div className="space-y-1">
              <Label htmlFor="w-code">Code</Label>
              <Input id="w-code" name="code" required maxLength={20} className="h-8 w-28 font-mono" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="w-name">Name</Label>
              <Input id="w-name" name="name" required maxLength={100} className="h-8 w-64" placeholder={`e.g. Lagos Yard – ${brand.code}`} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="w-type">Type</Label>
              <Select id="w-type" name="type" defaultValue="MAIN_YARD" className="h-8">
                {WAREHOUSE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {statusLabel(t)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="w-region">Region</Label>
              <Select id="w-region" name="regionId" defaultValue="" className="h-8">
                <option value="">—</option>
                {dir.regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
            <SubmitButton size="sm" variant="outline">
              Add warehouse
            </SubmitButton>
          </ActionForm>
        ) : null}
        <p className="px-4 pb-3 text-xs text-text-muted">A yard shared by several brands is one warehouse per brand: stock of two legal entities is never kept in one warehouse record.</p>
      </section>

      <section className="rounded-lg border border-border bg-surface" data-testid="vendors">
        <h2 className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">Vendors</h2>
        <table className="w-full text-[13px]">
          <tbody>
            {vendors.map((v) => (
              <tr key={v.id} className="border-b border-border">
                <td className="px-4 py-2">{v.name}</td>
                <td className="px-4 py-2">{statusLabel(v.type)}</td>
                <td className="px-4 py-2">{v.currency}</td>
                <td className="px-4 py-2">{v.paymentTerms ?? "—"}</td>
                {finance ? <td className="px-4 py-2 text-text-muted">{v.bankDetails ?? ""}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit ? (
          <ActionForm action={saveVendorAction} className="flex flex-wrap items-end gap-2 p-4">
            <input type="hidden" name="brandId" value={brand.id} />
            <div className="space-y-1">
              <Label htmlFor="v-name">Name</Label>
              <Input id="v-name" name="name" required maxLength={120} className="h-8 w-64" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="v-type">Type</Label>
              <Select id="v-type" name="type" defaultValue="OEM" className="h-8">
                {VENDOR_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {statusLabel(t)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="v-currency">Currency</Label>
              <Select id="v-currency" name="currency" defaultValue="NGN" className="h-8">
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="v-terms">Payment terms</Label>
              <Input id="v-terms" name="paymentTerms" maxLength={120} className="h-8 w-40" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="v-address">Address</Label>
              <Input id="v-address" name="address" maxLength={300} className="h-8 w-64" />
            </div>
            {finance ? (
              <div className="space-y-1">
                <Label htmlFor="v-bank">Bank details (finance only)</Label>
                <Input id="v-bank" name="bankDetails" maxLength={500} className="h-8 w-64" />
              </div>
            ) : null}
            <SubmitButton size="sm" variant="outline">
              Add vendor
            </SubmitButton>
          </ActionForm>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4" data-testid="inventory-settings">
        <h2 className="mb-2 text-[13px] font-semibold">Rules and accounts – {brand.code}</h2>
        {canSettings ? (
          <ActionForm action={saveSettingsAction} className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="brandId" value={brand.id} />
            <div className="space-y-1">
              <Label htmlFor="reservationDays">Reservation expires after (days)</Label>
              <Input id="reservationDays" name="reservationDays" type="number" min={1} max={90} defaultValue={settings.reservationDays} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="adjustmentApprovalLimit">Adjustments above need approval (₦)</Label>
              <Input id="adjustmentApprovalLimit" name="adjustmentApprovalLimit" type="number" min={0} step="0.01" defaultValue={Number(settings.adjustmentApprovalLimit)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="poApprovalLimit">Purchase orders above need approval (₦)</Label>
              <Input id="poApprovalLimit" name="poApprovalLimit" type="number" min={0} step="0.01" defaultValue={Number(settings.poApprovalLimit)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lockDate">Period closed up to (lock date)</Label>
              <Input id="lockDate" name="lockDate" type="date" defaultValue={settings.lockDate?.toISOString().slice(0, 10) ?? ""} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="partsValuation">Valuation of parts</Label>
              <Select id="partsValuation" name="partsValuation" defaultValue={settings.partsValuation} className="w-full">
                <option value="WEIGHTED_AVERAGE">Weighted average</option>
                <option value="FIFO">FIFO</option>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-3">
              <Label htmlFor="pdiTemplate">PDI checklist – one item per line</Label>
              <textarea id="pdiTemplate" name="pdiTemplate" rows={5} defaultValue={(settings.pdiTemplate.length ? settings.pdiTemplate : DEFAULT_PDI).join("\n")} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px]" />
            </div>
            {ACCOUNT_KEYS.map((k) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={`acc-${k}`}>{ACCOUNT_LABELS[k]}</Label>
                <Input id={`acc-${k}`} name={`account:${k}`} defaultValue={accounts[k]} maxLength={120} />
              </div>
            ))}
            <div className="flex items-end">
              <SubmitButton>Save settings</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-3">
            <dt className="text-text-muted">Reservation expires after</dt>
            <dd className="sm:col-span-2">{settings.reservationDays} days</dd>
            <dt className="text-text-muted">Period closed up to</dt>
            <dd className="sm:col-span-2">{settings.lockDate?.toISOString().slice(0, 10) ?? "—"}</dd>
          </dl>
        )}
        <p className="mt-2 text-xs text-text-muted">Vehicles are always valued at their own cost (specific identification). Nothing can be posted on or before the lock date. The accounts are the brand&apos;s own chart of accounts – journals go to this brand&apos;s ERP company.</p>
      </section>
    </div>
  );
}
