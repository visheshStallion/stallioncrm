"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { importCommitAction, importDryRunAction } from "@/server/modules/admin/actions";
import type { ImportPlan } from "@/server/modules/admin/import-plan";

const SAMPLE = `name,email,company_codes,role,region
Example Rep,example.rep@stallioncrm.test,"HMNL, SNML, SNMN",Sales Exec,Lagos
`;

/** Dry-run → preview → confirm. The CSV is read in the browser and sent as text; nothing is stored. */
export function ImportClient() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [overrides, setOverrides] = useState<Set<number>>(new Set());
  const [pending, start] = useTransition();

  const dryRun = () =>
    start(async () => {
      const res = await importDryRunAction(text);
      if (!res.ok) return toast(res.error.message, "error");
      setPlan(res.data);
      setOverrides(new Set());
    });

  const commit = () =>
    start(async () => {
      const res = await importCommitAction(text, [...overrides]);
      if (!res.ok) return toast(res.error.message, "error");
      toast(`Imported: ${res.data.created} created, ${res.data.updated} updated, ${res.data.skipped} skipped`, "success");
      setPlan(null);
      setText("");
      router.push("/admin/users");
    });

  const importable = plan ? plan.summary.ok + overrides.size : 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>1. Choose a CSV file</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Columns: <code>name, email, company_codes, role, region</code>. Legacy company codes (e.g. “HMNL, MG, SNML”)
            are resolved through the brand code aliases. Real data stays in your browser and the database – never in the
            repository.
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setText(await f.text());
              setPlan(null);
            }}
          />
          <textarea
            className="h-40 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
            placeholder={SAMPLE}
            value={text}
            aria-label="CSV text"
            onChange={(e) => {
              setText(e.target.value);
              setPlan(null);
            }}
          />
          <Button type="button" onClick={dryRun} disabled={!text.trim() || pending}>
            {pending && !plan ? "Checking…" : "Dry run"}
          </Button>
        </CardContent>
      </Card>

      {plan ? (
        <Card data-testid="import-preview">
          <CardHeader>
            <CardTitle>2. Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-4 text-sm" data-testid="import-summary">
              <span>{plan.summary.total} rows</span>
              <span className="text-emerald-700">{plan.summary.ok} ready</span>
              <span className="text-amber-700">{plan.summary.flagged} need confirmation</span>
              <span className="text-red-700">{plan.summary.errors} errors</span>
              <span>{plan.summary.creates} new · {plan.summary.updates} existing</span>
              <span>{plan.summary.multiBrand} multi-brand reps</span>
              <span>{plan.summary.noCompany} without company</span>
              {plan.summary.unknownCodes.length ? <span>Unknown codes: {plan.summary.unknownCodes.join(", ")}</span> : null}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="p-1">Line</th>
                    <th className="p-1">Import?</th>
                    <th className="p-1">Name / email</th>
                    <th className="p-1">Role</th>
                    <th className="p-1">Codes → brands</th>
                    <th className="p-1">Territories</th>
                    <th className="p-1">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((r) => (
                    <tr
                      key={r.line}
                      data-testid="import-row"
                      className={cn(
                        "border-t border-border align-top",
                        r.status === "error" && "bg-red-50",
                        r.status === "flagged" && "bg-amber-50",
                      )}
                    >
                      <td className="p-1">{r.line}</td>
                      <td className="p-1">
                        {r.status === "ok" ? (
                          "✓"
                        ) : r.status === "flagged" ? (
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={overrides.has(r.line)}
                              onChange={() =>
                                setOverrides((s) => {
                                  const n = new Set(s);
                                  if (n.has(r.line)) n.delete(r.line);
                                  else n.add(r.line);
                                  return n;
                                })
                              }
                            />
                            confirm
                          </label>
                        ) : (
                          "✗"
                        )}
                      </td>
                      <td className="p-1">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-muted-foreground">
                          {r.email} {r.action === "update" ? "(existing)" : ""}
                        </div>
                      </td>
                      <td className="p-1">
                        {r.role} {r.region ? `· ${r.region}` : ""}
                      </td>
                      <td className="p-1">
                        {r.companyCodes || "—"} → {r.brands.join(", ") || "—"}
                      </td>
                      <td className="p-1">{r.territories.map((t) => t.replace("|", " – ")).join(", ") || "—"}</td>
                      <td className="p-1">{[...r.errors, ...r.flags].join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button type="button" onClick={commit} disabled={pending || importable === 0}>
              {pending ? "Importing…" : `Import ${importable} user(s)`}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
