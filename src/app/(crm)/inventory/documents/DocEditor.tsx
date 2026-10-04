"use client";

import { useMemo, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { saveInvDocumentAction } from "@/server/modules/inventory/actions";
import type { InvDocConfig } from "@/server/modules/inventory/config";

export interface EditorLine {
  productId: string;
  vehicleUnitId: string;
  vin: string;
  description: string;
  qty: string;
  unitCost: string;
  batchNo: string;
  colour: string;
  action: string;
  chargeType: string;
}
export interface EditorLookups {
  products: Array<{ id: string; name: string; serial: boolean }>;
  units: Array<{ id: string; label: string; warehouseId: string | null }>;
  warehouses: Array<{ id: string; name: string }>;
  vendors: Array<{ id: string; name: string; currency: string }>;
  otherBrands: Array<{ id: string; code: string }>;
  parents: Array<{ id: string; label: string }>;
  chargeTypes: string[];
  currencies: string[];
  adjustmentActions: string[];
  reasons: string[];
}
export interface EditorValues {
  id?: string;
  vendorId: string;
  warehouseId: string;
  toWarehouseId: string;
  toBrandId: string;
  parentId: string;
  currency: string;
  exchangeRate: string;
  docDate: string;
  expectedDate: string;
  reference: string;
  notes: string;
  data: Record<string, unknown>;
  lines: EditorLine[];
}

const blank = (): EditorLine => ({ productId: "", vehicleUnitId: "", vin: "", description: "", qty: "1", unitCost: "", batchNo: "", colour: "", action: "WRITE_OFF", chargeType: "" });
const ACTION_LABEL: Record<string, string> = { WRITE_OFF: "Write off", REVALUE: "Change value by", HOLD: "Put on hold", RELEASE: "Release from hold" };

/**
 * Editor of an inventory document: header fields per type, lines per line kind. Costs are only shown when
 * the user may see them (`showCost`); the server ignores cost input from everyone else anyway.
 */
export function DocEditor({ cfg, brandId, lookups, values, showCost, cancelHref }: { cfg: InvDocConfig; brandId: string; lookups: EditorLookups; values: EditorValues; showCost: boolean; cancelHref: string }) {
  const [lines, setLines] = useState<EditorLine[]>(values.lines.length ? values.lines : cfg.lines === "NONE" ? [] : [blank()]);
  const [currency, setCurrency] = useState(values.currency || "NGN");
  const [method, setMethod] = useState(String(values.data.method ?? "VALUE"));
  const [unitIds, setUnitIds] = useState<string[]>(Array.isArray(values.data.unitIds) ? (values.data.unitIds as string[]) : []);
  const [manual, setManual] = useState<Record<string, string>>((values.data.manual as Record<string, string>) ?? {});
  const [extra, setExtra] = useState<Record<string, string>>({ vessel: String(values.data.vessel ?? ""), container: String(values.data.container ?? ""), port: String(values.data.port ?? "") });
  const set = (i: number, patch: Partial<EditorLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const has = (f: InvDocConfig["fields"][number]) => cfg.fields.includes(f);
  const costLabel = cfg.type === "INTER_BRAND" ? "Transfer price (₦)" : cfg.type === "ADJUSTMENT" ? "Value change / unit cost" : `Unit cost (${currency})`;
  const withCost = cfg.type === "INTER_BRAND" || (showCost && cfg.costed);
  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0), [lines]);

  const payload = JSON.stringify(
    lines
      .filter((l) => l.productId || l.vehicleUnitId || l.description || l.vin)
      .map((l) => ({
        productId: cfg.lines === "UNIT" && l.vehicleUnitId ? "" : l.productId,
        vehicleUnitId: l.vehicleUnitId,
        vin: l.vin,
        description: cfg.lines === "CHARGE" ? l.description || l.chargeType : l.description,
        qty: l.qty,
        unitCost: l.unitCost,
        batchNo: l.batchNo,
        data: { ...(l.colour ? { colour: l.colour } : {}), ...(cfg.type === "ADJUSTMENT" && l.vehicleUnitId ? { action: l.action } : {}), ...(l.chargeType ? { chargeType: l.chargeType } : {}) },
      })),
  );
  const data = JSON.stringify({ ...(cfg.type === "LANDED_COST" ? { method, unitIds, manual } : {}), ...(cfg.type === "SHIPMENT" ? extra : {}) });

  return (
    <ActionForm action={saveInvDocumentAction} className="space-y-4">
      <input type="hidden" name="id" value={values.id ?? ""} />
      <input type="hidden" name="type" value={cfg.type} />
      <input type="hidden" name="brandId" value={brandId} />
      <input type="hidden" name="lines" value={payload} />
      <input type="hidden" name="data" value={data} />
      <section className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3" data-testid="doc-header">
        {has("vendorId") ? (
          <div className="space-y-1">
            <Label htmlFor="vendorId">Vendor</Label>
            <Select id="vendorId" name="vendorId" defaultValue={values.vendorId} className="w-full" onChange={(e) => { const v = lookups.vendors.find((x) => x.id === e.target.value); if (v && has("currency")) setCurrency(v.currency); }}>
              <option value="">—</option>
              {lookups.vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {has("warehouseId") ? (
          <div className="space-y-1">
            <Label htmlFor="warehouseId">{cfg.type === "TRANSFER" ? "From warehouse" : "Warehouse"}</Label>
            <Select id="warehouseId" name="warehouseId" defaultValue={values.warehouseId} className="w-full">
              <option value="">—</option>
              {lookups.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {has("toWarehouseId") ? (
          <div className="space-y-1">
            <Label htmlFor="toWarehouseId">To warehouse</Label>
            <Select id="toWarehouseId" name="toWarehouseId" defaultValue={values.toWarehouseId} className="w-full">
              <option value="">—</option>
              {lookups.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {has("toBrandId") ? (
          <div className="space-y-1">
            <Label htmlFor="toBrandId">Receiving brand</Label>
            <Select id="toBrandId" name="toBrandId" defaultValue={values.toBrandId} required className="w-full">
              <option value="">Choose…</option>
              {lookups.otherBrands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {has("parent") && lookups.parents.length ? (
          <div className="space-y-1">
            <Label htmlFor="parentId">Based on</Label>
            <Select id="parentId" name="parentId" defaultValue={values.parentId} className="w-full">
              <option value="">—</option>
              {lookups.parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <input type="hidden" name="parentId" value={values.parentId} />
        )}
        <div className="space-y-1">
          <Label htmlFor="docDate">Date</Label>
          <Input id="docDate" name="docDate" type="date" defaultValue={values.docDate} />
        </div>
        {has("expectedDate") ? (
          <div className="space-y-1">
            <Label htmlFor="expectedDate">{cfg.type === "BILL" ? "Due date" : cfg.type === "SHIPMENT" ? "ETA" : "Expected"}</Label>
            <Input id="expectedDate" name="expectedDate" type="date" defaultValue={values.expectedDate} />
          </div>
        ) : null}
        {has("currency") ? (
          <>
            <div className="space-y-1">
              <Label htmlFor="currency">Currency</Label>
              <Select id="currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full">
                {lookups.currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            {currency !== "NGN" ? (
              <div className="space-y-1">
                <Label htmlFor="exchangeRate">Exchange rate (₦ per {currency})</Label>
                <Input id="exchangeRate" name="exchangeRate" type="number" step="0.000001" min={0} defaultValue={values.exchangeRate} required />
              </div>
            ) : null}
          </>
        ) : null}
        {has("reference") ? (
          <div className="space-y-1">
            <Label htmlFor="reference">{cfg.referenceLabel ?? "Reference"}</Label>
            {cfg.type === "ADJUSTMENT" ? (
              <Select id="reference" name="reference" defaultValue={values.reference || lookups.reasons[0]} className="w-full">
                {lookups.reasons.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            ) : (
              <Input id="reference" name="reference" defaultValue={values.reference} maxLength={120} />
            )}
          </div>
        ) : null}
        {cfg.type === "SHIPMENT"
          ? (["vessel", "container", "port"] as const).map((k) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={k}>{k === "vessel" ? "Vessel" : k === "container" ? "Container / Ro-Ro" : "Port"}</Label>
                <Input id={k} value={extra[k]} onChange={(e) => setExtra((x) => ({ ...x, [k]: e.target.value }))} maxLength={80} />
              </div>
            ))
          : null}
        <div className="space-y-1 sm:col-span-3">
          <Label htmlFor="notes">Notes</Label>
          <Input id="notes" name="notes" defaultValue={values.notes} maxLength={2000} />
        </div>
      </section>

      {cfg.lines !== "NONE" ? (
        <section className="rounded-lg border border-border bg-surface p-4" data-testid="doc-lines">
          <h2 className="mb-2 text-[13px] font-semibold">{cfg.lines === "CHARGE" ? "Charges" : "Lines"}</h2>
          <div className="space-y-2">
            {lines.map((l, i) => {
              const product = lookups.products.find((p) => p.id === l.productId);
              return (
                <div key={i} className="flex flex-wrap items-end gap-2 border-b border-border pb-2" data-testid="doc-line">
                  {cfg.lines === "CHARGE" ? (
                    <>
                      <div className="space-y-1">
                        <Label htmlFor={`ct-${i}`}>Charge</Label>
                        <Select id={`ct-${i}`} value={l.chargeType} onChange={(e) => set(i, { chargeType: e.target.value, description: l.description || e.target.value })} className="h-8 w-44">
                          <option value="">—</option>
                          {lookups.chargeTypes.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`d-${i}`}>Description</Label>
                        <Input id={`d-${i}`} value={l.description} onChange={(e) => set(i, { description: e.target.value })} className="h-8 w-64" />
                      </div>
                    </>
                  ) : null}
                  {cfg.lines === "UNIT" ? (
                    <div className="space-y-1">
                      <Label htmlFor={`u-${i}`}>Vehicle</Label>
                      <Select id={`u-${i}`} value={l.vehicleUnitId} onChange={(e) => set(i, { vehicleUnitId: e.target.value, productId: "" })} className="h-8 w-80">
                        <option value="">—</option>
                        {lookups.units.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ) : null}
                  {(cfg.lines === "ITEM" || cfg.lines === "ITEM_VIN" || (cfg.lines === "UNIT" && cfg.type !== "INTER_BRAND" && !l.vehicleUnitId)) && (
                    <div className="space-y-1">
                      <Label htmlFor={`p-${i}`}>{cfg.lines === "UNIT" ? "…or part / accessory" : "Item"}</Label>
                      <Select id={`p-${i}`} value={l.productId} onChange={(e) => set(i, { productId: e.target.value })} className="h-8 w-64">
                        <option value="">—</option>
                        {lookups.products
                          .filter((p) => cfg.lines !== "UNIT" || !p.serial)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </Select>
                    </div>
                  )}
                  {cfg.lines === "ITEM_VIN" && product?.serial ? (
                    <>
                      <div className="space-y-1">
                        <Label htmlFor={`v-${i}`}>VIN</Label>
                        <Input id={`v-${i}`} value={l.vin} onChange={(e) => set(i, { vin: e.target.value.toUpperCase() })} maxLength={17} className="h-8 w-52 font-mono" placeholder="17 characters" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`c-${i}`}>Colour</Label>
                        <Input id={`c-${i}`} value={l.colour} onChange={(e) => set(i, { colour: e.target.value })} className="h-8 w-28" />
                      </div>
                    </>
                  ) : null}
                  {cfg.type === "ADJUSTMENT" && l.vehicleUnitId ? (
                    <div className="space-y-1">
                      <Label htmlFor={`a-${i}`}>Adjustment</Label>
                      <Select id={`a-${i}`} value={l.action} onChange={(e) => set(i, { action: e.target.value })} className="h-8 w-44">
                        {lookups.adjustmentActions.map((a) => (
                          <option key={a} value={a}>
                            {ACTION_LABEL[a] ?? a}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ) : null}
                  {(cfg.lines === "ITEM" || (cfg.lines === "ITEM_VIN" && product && !product.serial) || (cfg.lines === "UNIT" && !l.vehicleUnitId && l.productId)) && (
                    <>
                      <div className="space-y-1">
                        <Label htmlFor={`q-${i}`}>{cfg.type === "ADJUSTMENT" ? "Qty change (±)" : "Qty"}</Label>
                        <Input id={`q-${i}`} type="number" step="0.01" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} className="h-8 w-24 text-right" />
                      </div>
                      {cfg.lines !== "ITEM" ? (
                        <div className="space-y-1">
                          <Label htmlFor={`b-${i}`}>Batch</Label>
                          <Input id={`b-${i}`} value={l.batchNo} onChange={(e) => set(i, { batchNo: e.target.value })} className="h-8 w-24" />
                        </div>
                      ) : null}
                    </>
                  )}
                  {(cfg.lines === "CHARGE" || (withCost && (cfg.lines !== "UNIT" || cfg.type === "INTER_BRAND" || !l.vehicleUnitId || l.action === "REVALUE"))) && cfg.type !== "VENDOR_CREDIT" && cfg.type !== "TRANSFER" ? (
                    <div className="space-y-1">
                      <Label htmlFor={`uc-${i}`}>{cfg.lines === "CHARGE" ? `Amount (${currency})` : costLabel}</Label>
                      <Input id={`uc-${i}`} type="number" step="0.01" value={l.unitCost} onChange={(e) => set(i, { unitCost: e.target.value })} className="h-8 w-40 text-right" />
                    </div>
                  ) : null}
                  <Button type="button" size="sm" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`}>
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, blank()])}>
              + Add line
            </Button>
            {withCost || cfg.lines === "CHARGE" ? (
              <span className="text-[13px]">
                Total{" "}
                <strong className="tabular-nums" data-testid="doc-editor-total">
                  {cfg.type === "INTER_BRAND" ? "₦" : currency} {total.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </strong>
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      {cfg.type === "LANDED_COST" ? (
        <section className="rounded-lg border border-border bg-surface p-4" data-testid="landed-cost-targets">
          <h2 className="mb-2 text-[13px] font-semibold">Allocate to vehicles</h2>
          <div className="mb-3 flex items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="method">Method</Label>
              <Select id="method" value={method} onChange={(e) => setMethod(e.target.value)} className="h-8 w-56">
                <option value="VALUE">By value (purchase cost)</option>
                <option value="QUANTITY">Equally per vehicle</option>
                <option value="MANUAL">Manual amounts</option>
              </Select>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setUnitIds(lookups.units.map((u) => u.id))}>
              Select all
            </Button>
          </div>
          <ul className="grid gap-1 text-[13px] sm:grid-cols-2">
            {lookups.units.map((u) => (
              <li key={u.id} className="flex items-center gap-2">
                <label className="flex flex-1 items-center gap-2">
                  <input type="checkbox" checked={unitIds.includes(u.id)} onChange={(e) => setUnitIds((ids) => (e.target.checked ? [...ids, u.id] : ids.filter((x) => x !== u.id)))} />
                  <span className="font-mono text-xs">{u.label}</span>
                </label>
                {method === "MANUAL" && unitIds.includes(u.id) ? <Input type="number" step="0.01" aria-label={`Amount for ${u.label}`} value={manual[u.id] ?? ""} onChange={(e) => setManual((m) => ({ ...m, [u.id]: e.target.value }))} className="h-7 w-32 text-right" /> : null}
              </li>
            ))}
          </ul>
          {lookups.units.length === 0 ? <p className="text-[13px] text-text-muted">No received vehicles to allocate to.</p> : null}
        </section>
      ) : null}

      <div className="flex items-center gap-3">
        <SubmitButton>{values.id ? "Save" : `Create ${cfg.label.toLowerCase()}`}</SubmitButton>
        <a href={cancelHref} className="text-sm text-primary underline">
          Cancel
        </a>
      </div>
    </ActionForm>
  );
}
