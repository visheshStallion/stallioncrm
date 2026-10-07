"use client";

import { Download, FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { SubmitButton } from "@/components/ActionForm";

/** Drag and drop (or Browse Files) one CSV / XLSX file into the import form. */
export function UploadZone({ module }: { module: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`rounded-lg border-2 border-dashed p-8 text-center text-[13px] ${over ? "border-primary bg-primary/5" : "border-border-strong"}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (!f || !input.current) return;
        const dt = new DataTransfer();
        dt.items.add(f);
        input.current.files = dt.files;
        setName(f.name);
      }}
      data-testid="upload-zone"
    >
      <FileUp className="mx-auto mb-2 h-10 w-10 text-primary" aria-hidden />
      <p className="font-semibold">Drag and drop the file here</p>
      <p className="my-1 text-text-muted">- or -</p>
      <label className="crm-btn crm-btn-secondary cursor-pointer">
        Browse Files
        <input ref={input} name="file" type="file" required accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" aria-label="File to import" onChange={(e) => setName(e.target.files?.[0]?.name ?? null)} />
      </label>
      {name ? (
        <p className="mt-3" data-testid="upload-file-name">
          {name}
        </p>
      ) : null}
      <p className="mt-3 text-text-muted">Supported file formats are XLSX and CSV</p>
      <p className="mt-1 inline-flex items-center gap-1 text-text-muted">
        <Download className="h-3.5 w-3.5" aria-hidden /> Download sample file:{" "}
        <a href={`/api/v1/imports/sample?module=${module}&format=csv`} className="text-primary underline">
          CSV
        </a>{" "}
        or{" "}
        <a href={`/api/v1/imports/sample?module=${module}&format=xlsx`} className="text-primary underline">
          XLSX
        </a>
      </p>
      <div className="mt-4">
        <SubmitButton disabled={!name}>Next</SubmitButton>
      </div>
    </div>
  );
}
