"use client";

import { Check, ChevronDown, MoreHorizontal, Plus, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState, useTransition } from "react";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { DropdownMenu, MenuItem, Modal } from "@/components/crm/overlays";
import { toast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { archiveTemplateAction, cloneTemplateAction, defaultTemplateAction, deleteTemplateAction, favoriteAction, moveToFolderAction } from "@/server/modules/templates/actions";

export interface HubRowProps {
  kind: string;
  id: string;
  name: string;
  href: string | null;
  favorite: boolean;
  folderId: string | null;
  isDefault: boolean;
  archived: boolean;
  editable: boolean;
  cloneable: boolean;
  canDefault: boolean;
  canArchive: boolean;
  associated: string[];
}

/** ☆ – a favourite of the signed-in user only. */
export function StarButton({ kind, id, on, name }: { kind: string; id: string; on: boolean; name: string }) {
  return (
    <ActionForm action={favoriteAction}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="on" value={on ? "0" : "1"} />
      <button type="submit" className="crm-icon-btn" aria-pressed={on} aria-label={on ? `Remove ${name} from favourites` : `Add ${name} to favourites`} data-testid="hub-star">
        <Star className={on ? "fill-[#f5a623] text-[#b45309]" : ""} />
      </button>
    </ActionForm>
  );
}

/** ⋯ – Edit, Clone, Preview, Move to folder, Share, Set as default, Archive, Delete, View versions. */
export function RowMenu({ row, folders, back }: { row: HubRowProps; folders: Array<{ id: string; name: string; shared: boolean; manageable: boolean }>; back: string }) {
  const hidden = (
    <>
      <input type="hidden" name="kind" value={row.kind} />
      <input type="hidden" name="id" value={row.id} />
    </>
  );
  const item = "crm-menu-item w-full text-left";
  const targets = folders.filter((f) => !f.shared || f.manageable);
  return (
    <DropdownMenu
      label={`Actions for ${row.name}`}
      className="w-64"
      trigger={({ toggle, open, id }) => (
        <button type="button" className="crm-icon-btn" onClick={toggle} aria-expanded={open} aria-controls={id} aria-label={`Actions for ${row.name}`} data-testid="hub-row-menu">
          <MoreHorizontal />
        </button>
      )}
    >
      {row.href ? <MenuItem href={row.href}>{row.editable ? "Edit" : "Open"}</MenuItem> : null}
      {row.href ? <MenuItem href={row.href}>Preview</MenuItem> : null}
      {row.cloneable ? (
        <ActionForm action={cloneTemplateAction}>
          {hidden}
          <button type="submit" role="menuitem" className={item}>
            Clone
          </button>
        </ActionForm>
      ) : null}
      {row.href && row.editable && (row.kind === "record" || row.kind === "document") ? <MenuItem href={row.href}>Share…</MenuItem> : null}
      {row.canDefault ? (
        <ActionForm action={defaultTemplateAction}>
          {hidden}
          <input type="hidden" name="on" value={row.isDefault ? "0" : "1"} />
          <button type="submit" role="menuitem" className={item}>
            {row.isDefault ? "Remove as default" : "Set as default"}
          </button>
        </ActionForm>
      ) : null}
      {row.href && (row.kind === "email" || row.kind === "document" || row.kind === "record") ? <MenuItem href={row.href}>View versions</MenuItem> : null}
      {targets.length || row.folderId ? (
        <ActionForm action={moveToFolderAction} className="border-t border-border px-3 py-2">
          {hidden}
          <label className="block text-xs text-text-muted" htmlFor={`mv-${row.kind}-${row.id}`}>
            Move to folder
          </label>
          <div className="mt-1 flex gap-1">
            <select id={`mv-${row.kind}-${row.id}`} name="folderId" defaultValue={row.folderId ?? ""} className="crm-select min-w-0 flex-1">
              <option value="">No folder</option>
              {targets.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.shared ? " (shared)" : ""}
                </option>
              ))}
            </select>
            <SubmitButton size="sm" variant="outline">
              Move
            </SubmitButton>
          </div>
        </ActionForm>
      ) : null}
      {row.canArchive ? (
        <ActionForm action={archiveTemplateAction} className="border-t border-border">
          {hidden}
          <input type="hidden" name="archived" value={row.archived ? "0" : "1"} />
          <button type="submit" role="menuitem" className={item}>
            {row.archived ? "Restore" : "Archive"}
          </button>
        </ActionForm>
      ) : null}
      {row.editable ? (
        <ActionForm action={deleteTemplateAction} confirm={row.associated.length ? undefined : `Delete “${row.name}”?`}>
          {hidden}
          <input type="hidden" name="back" value={back} />
          <button type="submit" role="menuitem" className={`${item} text-danger`} title={row.associated.length ? `In use: ${row.associated.join("; ")}` : undefined}>
            Delete
          </button>
        </ActionForm>
      ) : null}
    </DropdownMenu>
  );
}

// ───────────────────────────── New Template ─────────────────────────────

export interface NewTemplateData {
  tabs: Array<{ key: string; label: string }>;
  modules: Record<string, Array<{ key: string; label: string }>>;
  brands: Array<{ id: string; label: string }>;
  group: boolean;
  /** starters per tab: { key, name, module (null = any) } */
  starters: Record<string, Array<{ key: string; name: string; module: string | null }>>;
  /** templates the user can copy: { kind, id, name, module, tab } */
  existing: Array<{ kind: string; id: string; name: string; module: string | null; tab: string }>;
}

/** A scrollable, searchable module list: type to filter, arrows to move, Enter to choose; ✓ marks the selection. */
function ModuleSelect({ options, value, onChange }: { options: Array<{ key: string; label: string }>; value: string; onChange: (key: string) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())), [options, query]);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.key === value);
  const choose = (key: string) => {
    onChange(key);
    setOpen(false);
    setQuery("");
  };
  return (
    <div
      ref={ref}
      className="relative"
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-text-muted">
        Select Module
      </label>
      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${id}-${shown[active].key}` : undefined}
          className="crm-input w-full pr-8"
          placeholder="Choose a module…"
          value={open ? query : (current?.label ?? "")}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(shown.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && open && shown[active]) {
              e.preventDefault();
              choose(shown[active].key);
            } else if (e.key === "Escape" && open) {
              // only the list closes – not the dialog around it (its Escape handler listens on the document)
              e.nativeEvent.stopImmediatePropagation();
              setOpen(false);
            }
          }}
          data-testid="module-select"
        />
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
      </div>
      {open ? (
        <ul id={`${id}-list`} role="listbox" aria-label="Modules" className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg" data-testid="module-options">
          {shown.map((o, i) => (
            <li
              key={o.key}
              id={`${id}-${o.key}`}
              role="option"
              aria-selected={o.key === value}
              className={`flex cursor-pointer items-center justify-between px-3 py-1.5 text-[13px] ${i === active ? "bg-muted" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o.key);
              }}
            >
              {o.label}
              {o.key === value ? <Check className="h-4 w-4 text-primary" aria-hidden /> : null}
            </li>
          ))}
          {shown.length === 0 ? <li className="px-3 py-1.5 text-[13px] text-text-muted">No module matches.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

const TAB_NOUN: Record<string, string> = { email: "Email", document: "Document", record: "Record", sms: "SMS", whatsapp: "WhatsApp" };

/** "+ New Template": type → module → brand → start from → Next opens the editor of that template type. */
export function NewTemplate({ data, tab }: { data: NewTemplateData; tab: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(tab);
  const [moduleKey, setModuleKey] = useState("");
  const [brand, setBrand] = useState(data.brands[0]?.id ?? "");
  const [from, setFrom] = useState("blank");
  const [pending, start] = useTransition();
  const modules = data.modules[type] ?? [];
  const starters = (data.starters[type] ?? []).filter((s) => !s.module || s.module === moduleKey);
  const copies = data.existing.filter((e) => e.tab === type && (!moduleKey || e.module === moduleKey || e.module === null));
  const openDialog = () => {
    setType(tab);
    setModuleKey("");
    setFrom("blank");
    setOpen(true);
  };

  const next = () => {
    if (!moduleKey) return toast("Select the module first", "error");
    const b = brand && brand !== "all" && brand !== "group" ? `&brand=${brand}` : brand === "group" ? "&brand=group" : "";
    if (from.startsWith("clone:")) {
      const [, kind, id] = from.split(":");
      return start(async () => {
        const fd = new FormData();
        fd.set("kind", kind!);
        fd.set("id", id!);
        const res = await cloneTemplateAction(null, fd);
        if (!res.ok) return toast(res.error.message, "error");
        router.push(res.data.redirect ?? "/templates");
      });
    }
    const starter = from.startsWith("starter:") ? from.slice(8) : "";
    if (type === "email") router.push(`/campaigns/templates/email/new?starter=${starter || "blank"}&module=${moduleKey}${b}`);
    else if (type === "document") router.push(`/templates/documents/new?module=${moduleKey}${starter ? `&starter=${starter}` : ""}${b}`);
    else if (type === "record") router.push(`/templates/records/new?module=${moduleKey}${starter ? `&starter=${starter}` : ""}${b}`);
    else router.push(`/campaigns/templates?channel=${type === "sms" ? "SMS" : "WHATSAPP"}${b}`);
  };

  return (
    <>
      <Button type="button" className="w-full" onClick={openDialog} data-testid="new-template">
        <Plus className="h-4 w-4" /> New Template
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Create ${TAB_NOUN[type] ?? ""} Template`}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={next} disabled={pending} data-testid="new-template-next">
              {pending ? "Working…" : "Next"}
            </Button>
          </>
        }
      >
        <div className="space-y-3" data-testid="new-template-dialog">
          <div>
            <label htmlFor="nt-type" className="mb-1 block text-xs font-medium text-text-muted">
              Template type
            </label>
            <select
              id="nt-type"
              className="crm-select w-full"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setModuleKey("");
                setFrom("blank");
              }}
            >
              {data.tabs.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <ModuleSelect
            options={modules}
            value={moduleKey}
            onChange={(k) => {
              setModuleKey(k);
              setFrom("blank");
            }}
          />
          <div>
            <label htmlFor="nt-brand" className="mb-1 block text-xs font-medium text-text-muted">
              Brand / Company
            </label>
            <select id="nt-brand" className="crm-select w-full" value={brand} onChange={(e) => setBrand(e.target.value)}>
              {data.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
              {type === "email" || type === "sms" || type === "whatsapp" ? null : <option value="all">All my brands</option>}
              {data.group ? <option value="group">Group (all brands)</option> : null}
            </select>
          </div>
          <div>
            <label htmlFor="nt-from" className="mb-1 block text-xs font-medium text-text-muted">
              Start from
            </label>
            <select id="nt-from" className="crm-select w-full" value={from} onChange={(e) => setFrom(e.target.value)} disabled={type === "sms" || type === "whatsapp"}>
              <option value="blank">Blank</option>
              {starters.length ? (
                <optgroup label="Starter gallery">
                  {starters.map((s) => (
                    <option key={s.key} value={`starter:${s.key}`}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {copies.length ? (
                <optgroup label="Clone an existing template">
                  {copies.map((c) => (
                    <option key={`${c.kind}:${c.id}`} value={`clone:${c.kind}:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </div>
          <p className="text-xs text-text-muted">Only modules you can open are listed. The next step opens the editor of this template type.</p>
        </div>
      </Modal>
    </>
  );
}
