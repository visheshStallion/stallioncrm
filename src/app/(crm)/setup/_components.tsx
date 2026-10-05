import type { ReactNode } from "react";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { SetupEntry, SetupTier } from "@/server/modules/setup/catalogue";
import { saveSettingAction } from "@/server/modules/setup/actions";
import { SETTINGS, formatRates, type SettingKey } from "@/server/modules/setup/settings";

const TIER_LABEL: Record<SetupTier, string> = { SA: "Super Admin", ADMIN: "Administrator", BRAND_ADMIN: "Brand Admin (own brand)", ALL: "Everyone" };

/** Who may open the function, as declared in the catalogue (`setupPermission`). */
export function tiersText(entry: SetupEntry): string {
  const tiers = entry.tiers.filter((t) => t !== "BRAND_ADMIN" || entry.brandAdminReady);
  return tiers.map((t) => TIER_LABEL[t]).join(" · ");
}

/** Title row of a Setup page: function name, who may open it, and what is missing when it is only partly built. */
export function SetupHeader({ entry, actions }: { entry: SetupEntry; actions?: ReactNode }) {
  return (
    <div className="mb-4">
      <PageTitleRow
        title={entry.label}
        left={
          <>
            <span className="text-xs text-text-muted" data-testid="setup-tier">
              {tiersText(entry)}
            </span>
            {entry.status === "PARTIAL" ? <StatusPill tone="warning">Partly built</StatusPill> : null}
          </>
        }
        actions={actions}
      />
      <p className="-mt-2 text-sm text-text-muted">{entry.description}.</p>
      {entry.status === "PARTIAL" && entry.statusNote ? (
        <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm" data-testid="setup-note">
          Not built yet: {entry.statusNote}.
        </p>
      ) : null}
    </div>
  );
}

export function Section({ title, hint, children, testId }: { title: string; hint?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="crm-section mb-4" data-testid={testId}>
      <h2 className="crm-section-title">{title}</h2>
      <div className="space-y-3 p-4 text-sm">
        {hint ? <p className="text-text-muted">{hint}</p> : null}
        {children}
      </div>
    </section>
  );
}

/**
 * Re-authentication for a destructive operation: the password of the signed-in user (accounts without a password
 * use their authenticator code).
 */
export function ReauthFields({ note = "This is a destructive operation: confirm it is you. It runs only after a second Super Admin approved it.", id = "reauth" }: { note?: string; /** unique per form on the page */ id?: string }) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-alt p-3" data-testid="reauth">
      <p className="text-xs text-text-muted">{note}</p>
      <div className="flex flex-wrap gap-3">
        <div className="space-y-1">
          <Label htmlFor={`${id}-password`}>Your password</Label>
          <Input id={`${id}-password`} name="reauthPassword" type="password" autoComplete="current-password" className="w-56" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-code`}>Authenticator code (accounts without a password)</Label>
          <Input id={`${id}-code`} name="reauthCode" inputMode="numeric" autoComplete="one-time-code" maxLength={7} className="w-32" />
        </div>
      </div>
    </div>
  );
}

/** Form of one organisation setting, built from its field list. Security policies ask for re-authentication. */
export function SettingForm({ settingKey, value, profiles = [] }: { settingKey: SettingKey; value: Record<string, unknown>; profiles?: Array<{ id: string; name: string; users: number }> }) {
  const def = SETTINGS[settingKey];
  return (
    <ActionForm action={saveSettingAction} className="space-y-4">
      <input type="hidden" name="_key" value={settingKey} />
      <div className="grid gap-4 sm:grid-cols-2">
        {def.fields.map((f) => {
          const id = `s-${f.name}`;
          const v = value[f.name];
          if (f.type === "checkbox") {
            return (
              <label key={f.name} className="flex items-center gap-2 self-end text-sm">
                <input type="checkbox" name={f.name} defaultChecked={v === true} /> {f.label}
              </label>
            );
          }
          if (f.type === "multi") {
            const chosen = new Set(Array.isArray(v) ? (v as string[]) : []);
            return (
              <fieldset key={f.name} className="space-y-1 sm:col-span-2">
                <legend className="crm-label">{f.label}</legend>
                <div className="grid gap-1 sm:grid-cols-2">
                  {profiles.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name={f.name} value={p.id} defaultChecked={chosen.has(p.id)} /> {p.name} <span className="text-xs text-text-muted">({p.users} users)</span>
                    </label>
                  ))}
                </div>
                {f.hint ? <p className="text-xs text-text-muted">{f.hint}</p> : null}
              </fieldset>
            );
          }
          return (
            <div key={f.name} className={f.type === "textarea" || f.type === "rates" ? "space-y-1 sm:col-span-2" : "space-y-1"}>
              <Label htmlFor={id}>{f.label}</Label>
              {f.type === "select" ? (
                <Select id={id} name={f.name} defaultValue={String(v ?? "")} className="w-full">
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : f.type === "textarea" || f.type === "rates" ? (
                <textarea id={id} name={f.name} rows={f.type === "rates" ? 6 : 3} defaultValue={f.type === "rates" ? formatRates((v ?? {}) as Record<string, number>) : String(v ?? "")} className="crm-input font-mono" />
              ) : (
                <Input id={id} name={f.name} type={f.type === "number" ? "number" : f.type === "email" ? "email" : "text"} defaultValue={String(v ?? "")} {...(f.type === "number" ? { min: f.min, max: f.max } : {})} />
              )}
              {f.hint ? <p className="text-xs text-text-muted">{f.hint}</p> : null}
            </div>
          );
        })}
      </div>
      {def.fourEyes ? <ReauthFields note="This changes how people sign in. Confirm it is you; the change applies only after a second Super Admin approved it (Setup → Two-person approvals)." /> : null}
      <div className="flex justify-end">
        <SubmitButton>{def.fourEyes ? "Request the change" : "Save"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export const fmtDateTime = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(d) : "—");
