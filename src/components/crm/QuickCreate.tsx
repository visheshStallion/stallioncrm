"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createDealFormAction } from "@/server/modules/deals/actions";
import { createLeadAction } from "@/server/modules/leads/actions";
import type { QuickCreateItem } from "./nav-config";
import { Drawer, DropdownMenu, MenuItem } from "./overlays";

export interface QuickCreateLookups {
  brands: Array<{ id: string; code: string; name: string }>;
  regions: Array<{ id: string; name: string }>;
  defaultBrandId: string | null;
  defaultRegionId: string | null;
}

function Req({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children} <span className="text-danger">*</span>
    </>
  );
}

function BrandRegion({ lookups }: { lookups: QuickCreateLookups }) {
  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="qc-brand">
          <Req>Brand</Req>
        </Label>
        <Select id="qc-brand" name="brandId" required defaultValue={lookups.defaultBrandId ?? ""} className="w-full">
          <option value="">Choose…</option>
          {lookups.brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} – {b.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="qc-region">
          <Req>Region</Req>
        </Label>
        <Select id="qc-region" name="regionId" required defaultValue={lookups.defaultRegionId ?? ""} className="w-full">
          <option value="">Choose…</option>
          {lookups.regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </div>
    </>
  );
}

/** "+" Quick Create menu; Lead and Deal open a drawer with mandatory fields only. */
export function QuickCreateMenu({ items, lookups }: { items: QuickCreateItem[]; lookups: QuickCreateLookups }) {
  const [drawer, setDrawer] = useState<string | null>(null);
  if (items.length === 0) return null;
  return (
    <>
      <DropdownMenu
        label="Quick create"
        trigger={({ toggle, open, id }) => (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={id}
            aria-label="Quick create"
            className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary-hover"
            data-testid="quick-create"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase text-text-muted">Quick create</div>
            {items.map((i) =>
              i.mode === "drawer" ? (
                <MenuItem
                  key={i.key}
                  onClick={() => {
                    close();
                    setDrawer(i.key);
                  }}
                >
                  {i.label}
                </MenuItem>
              ) : (
                <MenuItem key={i.key} href={i.href}>
                  {i.label}
                </MenuItem>
              ),
            )}
          </>
        )}
      </DropdownMenu>

      <Drawer open={drawer === "lead"} onClose={() => setDrawer(null)} title="Quick create: Lead">
        <ActionForm action={createLeadAction} className="space-y-3">
          <BrandRegion lookups={lookups} />
          <div className="space-y-1">
            <Label htmlFor="qc-lastName">
              <Req>Last name</Req>
            </Label>
            <Input id="qc-lastName" name="lastName" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="qc-firstName">First name</Label>
            <Input id="qc-firstName" name="firstName" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="qc-mobile">
              <Req>Mobile</Req> <span className="text-xs text-text-muted">(or email)</span>
            </Label>
            <Input id="qc-mobile" name="mobile" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="qc-email">Email</Label>
            <Input id="qc-email" name="email" type="email" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="autoAssign" /> Assign automatically
          </label>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>

      <Drawer open={drawer === "deal"} onClose={() => setDrawer(null)} title="Quick create: Deal">
        <ActionForm action={createDealFormAction} className="space-y-3">
          <BrandRegion lookups={lookups} />
          <div className="space-y-1">
            <Label htmlFor="qc-dealName">
              <Req>Deal name</Req>
            </Label>
            <Input id="qc-dealName" name="name" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="qc-customer">Customer</Label>
            <Input id="qc-customer" name="customerName" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="qc-amount">Amount (₦)</Label>
            <Input id="qc-amount" name="amount" type="number" min={0} step="1000" />
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}
