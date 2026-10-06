"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createDealFormAction } from "@/server/modules/deals/actions";
import { createLeadAction } from "@/server/modules/leads/actions";
import type { QuickCreateItem } from "./nav-config";
import { DropdownMenu, MenuItem, Modal } from "./overlays";

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

/** "+" Quick Create menu; Lead and Deal open a centred popup with mandatory fields only. */
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
            className="crm-quick-create"
            data-testid="quick-create"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="crm-menu-title">Quick create</div>
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

      <Modal
        open={drawer === "lead"}
        onClose={() => setDrawer(null)}
        title="Quick create: Lead"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setDrawer(null)}>
              Cancel
            </Button>
            <SubmitButton form="qc-lead-form">Save</SubmitButton>
          </>
        }
      >
        <ActionForm id="qc-lead-form" action={createLeadAction} className="space-y-3">
          <BrandRegion lookups={lookups} />
          <div className="space-y-1">
            <Label htmlFor="qc-lastName">
              <Req>Last name</Req> <span className="text-xs font-normal text-text-muted">(or company)</span>
            </Label>
            <Input id="qc-lastName" name="lastName" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="qc-company">Company</Label>
            <Input id="qc-company" name="company" />
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
        </ActionForm>
      </Modal>

      <Modal
        open={drawer === "deal"}
        onClose={() => setDrawer(null)}
        title="Quick create: Deal"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setDrawer(null)}>
              Cancel
            </Button>
            <SubmitButton form="qc-deal-form">Save</SubmitButton>
          </>
        }
      >
        <ActionForm id="qc-deal-form" action={createDealFormAction} className="space-y-3">
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
        </ActionForm>
      </Modal>
    </>
  );
}
