import { FormSection, Required } from "@/components/crm/record";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { AUDIENCES, CAMPAIGN_TYPES } from "@/server/modules/messaging/campaigns";

export interface CampaignValues {
  id?: string;
  brandId?: string;
  name?: string;
  type?: string;
  channel?: string;
  budget?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  templateId?: string | null;
  audienceKind?: string;
  reportId?: string | null;
}

/** Campaign form (create + edit of a draft). The brand is fixed after creation. */
export function CampaignFields({
  values = {},
  brands,
  templates,
  reports,
}: {
  values?: CampaignValues;
  brands: Array<{ id: string; label: string }>;
  templates: Array<{ id: string; label: string }>;
  reports: Array<{ id: string; label: string }>;
}) {
  const edit = !!values.id;
  return (
    <FormSection title="Campaign">
      <div className="space-y-1">
        <Label htmlFor="name">
          Name
          <Required />
        </Label>
        <Input id="name" name="name" required maxLength={120} defaultValue={values.name ?? ""} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="brandId">
          Brand
          <Required />
        </Label>
        {edit ? (
          <>
            <input type="hidden" name="brandId" value={values.brandId} />
            <Input id="brandId" value={brands.find((b) => b.id === values.brandId)?.label ?? ""} readOnly disabled />
          </>
        ) : (
          <Select id="brandId" name="brandId" required className="w-full" defaultValue={values.brandId ?? (brands.length === 1 ? brands[0]!.id : "")}>
            <option value="">Choose brand…</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </Select>
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor="type">Type</Label>
        <Select id="type" name="type" className="w-full" defaultValue={values.type ?? "PROMO"}>
          {Object.entries(CAMPAIGN_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="channel">
          Channel
          <Required />
        </Label>
        <Select id="channel" name="channel" required className="w-full" defaultValue={values.channel ?? "EMAIL"}>
          <option value="EMAIL">Email</option>
          <option value="SMS">SMS</option>
          <option value="WHATSAPP">WhatsApp</option>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="budget">Budget (₦)</Label>
        <Input id="budget" name="budget" type="number" min={0} step="any" inputMode="decimal" defaultValue={values.budget ?? ""} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="startDate">Start</Label>
          <Input id="startDate" name="startDate" type="date" defaultValue={values.startDate ?? ""} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="endDate">End</Label>
          <Input id="endDate" name="endDate" type="date" defaultValue={values.endDate ?? ""} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="audienceKind">Audience</Label>
        <Select id="audienceKind" name="audienceKind" className="w-full" defaultValue={values.audienceKind ?? "ALL_LEADS"}>
          {Object.entries(AUDIENCES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <p className="text-xs text-text-muted">Only people you can see, with marketing consent for this brand, receive the campaign.</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="reportId">Saved report (for the report audience)</Label>
        <Select id="reportId" name="reportId" className="w-full" defaultValue={values.reportId ?? ""}>
          <option value="">—</option>
          {reports.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>
      {edit ? (
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="templateId">Template (of this brand and channel, or a group template)</Label>
          <Select id="templateId" name="templateId" className="w-full" defaultValue={values.templateId ?? ""}>
            <option value="">Choose template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
    </FormSection>
  );
}
