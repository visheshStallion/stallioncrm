"use client";

import { useState, useTransition } from "react";
import { RichTextEditor } from "@/components/crm/RichTextEditor";
import { toast } from "@/components/Toaster";
import { saveSignatureAction } from "@/server/modules/email/actions";

/** The user's own e-mail signature for each of their brands (an empty text removes it). */
export function Signatures({ brands }: { brands: Array<{ brandId: string; code: string; name: string; html: string }> }) {
  const [brandId, setBrandId] = useState(brands[0]?.brandId ?? "");
  const [html, setHtml] = useState<Record<string, string>>(Object.fromEntries(brands.map((b) => [b.brandId, b.html])));
  const [pending, start] = useTransition();
  if (!brands.length) return <p className="text-sm text-text-muted">You are not a member of a brand.</p>;
  const save = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("brandId", brandId);
      fd.set("html", html[brandId] ?? "");
      const res = await saveSignatureAction(fd);
      toast(res.ok ? (res.data.message ?? "Saved") : res.error.message, res.ok ? "success" : "error");
    });
  return (
    <div className="space-y-2">
      {brands.length > 1 ? (
        <label className="flex items-center gap-2 text-sm">
          Brand
          <select className="crm-select" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            {brands.map((b) => (
              <option key={b.brandId} value={b.brandId}>
                {b.code} – {b.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-sm text-text-muted">
          {brands[0]!.code} – {brands[0]!.name}
        </p>
      )}
      <RichTextEditor key={brandId} label="E-mail signature" value={html[brandId] ?? ""} onChange={(v) => setHtml((h) => ({ ...h, [brandId]: v }))} maxImageBytes={100 * 1024} minHeight={110} />
      <button type="button" className="crm-btn crm-btn-primary" disabled={pending} onClick={save} data-testid="signature-save">
        {pending ? "Saving…" : "Save signature"}
      </button>
    </div>
  );
}
