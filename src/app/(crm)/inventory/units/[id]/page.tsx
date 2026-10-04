import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BrandBadge } from "@/components/BrandBadge";
import { StatusPill } from "@/components/crm/primitives";
import { Field, FieldSection, RelatedListCard } from "@/components/crm/record";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { scopedDb } from "@/server/db";
import { startPdiAction, unitAction } from "@/server/modules/inventory/actions";
import { canSeeCost, getUnit, isSalesView } from "@/server/modules/inventory/queries";
import { STATUS_LABELS, type VehicleStatus } from "@/server/modules/inventory/status";
import { getDirectory } from "@/server/modules/org/queries";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireContext } from "@/server/request";
import { STATUS_TONE } from "../../tones";

export const metadata = { title: "Vehicle" };

/** One vehicle: what it is, where it is, its history and ledger. Costs only for inventory finance. */
export default async function UnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  // another brand's unit – or, for sales users, a unit that is neither available nor theirs – is a 404
  const u = await getUnit(ctx, id).catch((e) => {
    if (isAccessError(e)) notFound();
    throw e;
  });
  const [dir, prefs] = await Promise.all([getDirectory(ctx), getPreferences(ctx)]);
  const df = prefs.dateFormat;
  const brand = dir.brands.find((b) => b.id === u.brandId);
  const sales = isSalesView(ctx);
  const canEdit = hasPermission(ctx, "inventory", "edit");
  const canApprove = hasPermission(ctx, "inventory", "approve");
  const cost = canSeeCost(ctx);
  // open deals of the unit's brand the user may edit – to reserve the unit for one of them
  const deals = u.status === "AVAILABLE" && hasPermission(ctx, "deals", "edit") ? await scopedDb(ctx).deal.findMany({ where: { brandId: u.brandId, stage: { type: "OPEN" } }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" }, take: 100 }) : [];

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3" data-testid="record-header">
        <Link href="/inventory/units" className="text-sm text-primary hover:underline">
          ← Stock
        </Link>
        {brand ? <BrandBadge brand={brand} /> : null}
        <h1 className="font-mono text-lg font-semibold">{u.vin}</h1>
        <span className="text-[13px] text-text-muted">{u.productName}</span>
        <StatusPill tone={STATUS_TONE[u.status]}>
          <span data-testid="unit-status">{u.statusLabel}</span>
        </StatusPill>
        {sales ? null : (
          <a href={`/api/v1/inventory/labels?unitId=${u.id}`} className="ml-auto text-sm text-primary underline">
            Print VIN label
          </a>
        )}
      </header>

      <FieldSection title="Vehicle" id="info">
        <Field label="Model" value={u.productName} />
        <Field label="Colour" value={u.colour} />
        <Field label="Interior" value={u.colourInterior} />
        <Field label="Model year" value={u.modelYear} />
        <Field label="Location" value={u.warehouseName} />
        <Field label="Price" value={formatMoney(u.sellingPrice)} />
        <Field label="Received" value={u.receivedAt ? formatDate(u.receivedAt, df) : null} />
        {sales ? null : <Field label="Age in stock" value={u.ageDays !== null ? `${u.ageDays} days` : null} />}
        <Field label="PDI passed" value={u.pdiPassedAt ? formatDate(u.pdiPassedAt, df) : null} />
        <Field label="Plate no." value={u.plateNo} />
        {sales ? null : <Field label="Engine no." value={u.engineNo} />}
        {sales ? null : <Field label="Key no." value={u.keyNo} />}
        {sales ? null : <Field label="Customs document" value={u.customsDocNo ? `${u.customsDocNo}${u.importDutyPaid ? " · duty paid" : ""}` : u.importDutyPaid ? "Duty paid" : null} />}
        {u.isDemo || u.mileage !== null ? <Field label="Mileage" value={u.mileage !== null ? `${u.mileage} km` : null} /> : null}
        {u.damageNotes ? <Field label="Damage / hold notes" value={u.damageNotes} /> : null}
        <Field
          label="Deal"
          value={
            u.dealId ? (
              <Link href={`/deals/${u.dealId}`} className="text-primary hover:underline">
                Open deal
              </Link>
            ) : null
          }
        />
        {u.status === "RESERVED" ? <Field label="Reserved until" value={u.reservedUntil ? formatDate(u.reservedUntil, df) : "No expiry (deal won)"} /> : null}
        <Field label="Delivered" value={u.deliveredAt ? formatDate(u.deliveredAt, df) : null} />
      </FieldSection>

      {cost ? (
        <FieldSection title="Cost (inventory finance)" id="cost">
          <Field label="Purchase cost" value={<span data-testid="unit-purchase-cost">{formatMoney(u.purchaseCost)}</span>} />
          <Field label="Landed cost" value={<span data-testid="unit-landed-cost">{formatMoney(u.landedCost)}</span>} />
          <Field label="Total cost" value={formatMoney(u.totalCost)} />
          <Field label="Margin at list price" value={u.sellingPrice !== null && u.totalCost ? formatMoney(u.sellingPrice - u.totalCost) : null} />
        </FieldSection>
      ) : null}

      <section className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-surface p-4" data-testid="unit-actions">
        {deals.length ? (
          <ActionForm action={unitAction} className="flex items-end gap-2">
            <input type="hidden" name="unitId" value={u.id} />
            <input type="hidden" name="op" value="reserve" />
            <div className="space-y-1">
              <Label htmlFor="dealId">Reserve for my deal</Label>
              <Select id="dealId" name="dealId" required defaultValue="" className="w-64">
                <option value="">Choose deal…</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>
            <SubmitButton size="sm">Reserve</SubmitButton>
          </ActionForm>
        ) : null}
        {canEdit && u.status === "PDI_PENDING" ? (
          <ActionForm action={startPdiAction}>
            <input type="hidden" name="unitId" value={u.id} />
            <SubmitButton size="sm">Start PDI</SubmitButton>
          </ActionForm>
        ) : null}
        {canEdit && (u.status === "AVAILABLE" || u.status === "DEMO") ? (
          <ActionForm action={unitAction} className="flex items-end gap-2">
            <input type="hidden" name="unitId" value={u.id} />
            <input type="hidden" name="op" value={u.status === "DEMO" ? "demo-off" : "demo-on"} />
            <div className="space-y-1">
              <Label htmlFor="mileage">Mileage (km)</Label>
              <Input id="mileage" name="mileage" type="number" min={0} defaultValue={u.mileage ?? ""} className="h-8 w-28" />
            </div>
            <SubmitButton size="sm" variant="outline">
              {u.status === "DEMO" ? "Back to sellable stock" : "Move to demo fleet"}
            </SubmitButton>
          </ActionForm>
        ) : null}
        {canApprove && u.status === "RESERVED" && u.reservedUntil ? (
          <ActionForm action={unitAction} className="flex items-end gap-2">
            <input type="hidden" name="unitId" value={u.id} />
            <input type="hidden" name="op" value="extend" />
            <div className="space-y-1">
              <Label htmlFor="days">Extend reservation (days)</Label>
              <Input id="days" name="days" type="number" min={1} max={90} defaultValue={7} className="h-8 w-24" />
            </div>
            <SubmitButton size="sm" variant="outline">
              Extend
            </SubmitButton>
          </ActionForm>
        ) : null}
        {sales && deals.length === 0 && u.status === "AVAILABLE" ? <p className="text-[13px] text-text-muted">Open a deal for this brand to reserve the vehicle.</p> : null}
      </section>

      {canEdit ? (
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 text-[13px] font-semibold">Details</h2>
          <ActionForm action={unitAction} className="grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="unitId" value={u.id} />
            <input type="hidden" name="op" value="update" />
            {(
              [
                ["colour", "Colour", u.colour],
                ["colourInterior", "Interior", u.colourInterior],
                ["engineNo", "Engine no.", u.engineNo],
                ["keyNo", "Key no.", u.keyNo],
                ["plateNo", "Plate no.", u.plateNo],
                ["customsDocNo", "Customs document no.", u.customsDocNo],
                ["sellingPrice", "Selling price (₦)", u.sellingPrice],
                ["damageNotes", "Damage / hold notes", u.damageNotes],
              ] as const
            ).map(([name, label, value]) => (
              <div key={name} className="space-y-1">
                <Label htmlFor={`f-${name}`}>{label}</Label>
                <Input id={`f-${name}`} name={name} defaultValue={value ?? ""} className="h-8" />
              </div>
            ))}
            <div className="flex items-end">
              <SubmitButton size="sm" variant="outline">
                Save details
              </SubmitButton>
            </div>
          </ActionForm>
          <p className="mt-2 text-xs text-text-muted">Status, location and cost change through documents only (receipt, transfer, adjustment, landed cost).</p>
        </section>
      ) : null}

      {sales ? null : (
        <>
          <RelatedListCard id="history" title="Status history" count={u.history.length}>
            {u.history.length ? (
              <ul className="space-y-1 text-[13px]" data-testid="unit-history">
                {u.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap gap-3">
                    <span className="w-36 text-text-muted">{formatDateTime(h.at, df)}</span>
                    <span className="w-64">
                      {h.from ? `${STATUS_LABELS[h.from as VehicleStatus]} → ` : ""}
                      {STATUS_LABELS[h.to as VehicleStatus]}
                    </span>
                    <span className="flex-1 text-text-muted">
                      {h.note}
                      {h.userName ? ` · ${h.userName}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : undefined}
          </RelatedListCard>
          <RelatedListCard id="ledger" title="Stock ledger" count={u.movements.length}>
            {u.movements.length ? (
              <table className="w-full text-[13px]" data-testid="unit-ledger">
                <thead>
                  <tr className="text-left text-[11px] uppercase text-text-muted">
                    <th className="py-1">Date</th>
                    <th>Movement</th>
                    <th>Warehouse</th>
                    <th className="text-right">In</th>
                    <th className="text-right">Out</th>
                    {cost ? <th className="text-right">Value</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {u.movements.map((m) => (
                    <tr key={m.id} className="border-t border-border">
                      <td className="py-1">{formatDate(m.at, df)}</td>
                      <td>{m.sourceDocId && m.sourceDocType !== "INVOICE" && m.sourceDocType !== "SEED" ? <Link href={`/inventory/documents/${m.sourceDocId}`} className="text-primary hover:underline">{m.movementType.toLowerCase().replace(/_/g, " ")}</Link> : m.movementType.toLowerCase().replace(/_/g, " ")}</td>
                      <td>{m.warehouseName}</td>
                      <td className="text-right tabular-nums">{m.qtyIn || ""}</td>
                      <td className="text-right tabular-nums">{m.qtyOut || ""}</td>
                      {cost ? <td className="text-right tabular-nums">{formatMoney(m.totalCost)}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : undefined}
          </RelatedListCard>
        </>
      )}
    </div>
  );
}
