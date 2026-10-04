"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { uploadAttachmentAction } from "@/server/modules/deals/actions";

/**
 * Test-drive capture on the phone (prompt 14): a photo of the driving licence (camera) and the customer's
 * signature on the indemnity (drawn with the finger). Both are stored as attachments of the test drive – in
 * the brand's storage area, visible to whoever can see the activity.
 */
export function TestDriveCapture({ activityId, path }: { activityId: string; path: string }) {
  const router = useRouter();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);

  async function upload(file: File, done: string) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("entity", "Activity");
      fd.set("entityId", activityId);
      fd.set("path", path);
      fd.set("file", file);
      const res = await uploadAttachmentAction(undefined, fd);
      toast(res.ok ? done : res.error.message, res.ok ? "success" : "error");
      if (res.ok) router.refresh();
      return res.ok;
    } finally {
      setBusy(false);
    }
  }

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = point(e);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111827";
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d");
    const { x, y } = point(e);
    ctx?.lineTo(x, y);
    ctx?.stroke();
    setSigned(true);
  };
  const clear = () => {
    const c = canvas.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setSigned(false);
  };
  const saveSignature = () => {
    const c = canvas.current;
    if (!c) return;
    // white background so the PNG is readable when printed
    const out = document.createElement("canvas");
    out.width = c.width;
    out.height = c.height;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(c, 0, 0);
    out.toBlob(async (blob) => {
      if (blob && (await upload(new File([blob], `indemnity-signature-${new Date().toISOString().slice(0, 10)}.png`, { type: "image/png" }), "Signature saved"))) clear();
    }, "image/png");
  };

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="test-drive-capture">
      <h2 className="mb-2 text-[13px] font-semibold">Licence photo and indemnity signature</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="licence-photo" className="mb-1 block text-[13px] font-medium">
            Driving licence (photo)
          </label>
          <input
            id="licence-photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            disabled={busy}
            className="block w-full text-[13px]"
            onChange={async (e) => {
              const input = e.currentTarget;
              const file = input.files?.[0];
              if (!file) return;
              const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
              await upload(new File([file], `driving-licence-${new Date().toISOString().slice(0, 10)}.${ext}`, { type: file.type }), "Licence photo saved");
              input.value = "";
            }}
          />
          <p className="mt-1 text-xs text-text-muted">On a phone this opens the camera. The photo is stored with the test drive.</p>
        </div>
        <div>
          <div className="mb-1 text-[13px] font-medium">Customer signature (indemnity)</div>
          <canvas ref={canvas} width={600} height={200} onPointerDown={start} onPointerMove={move} onPointerUp={() => (drawing.current = false)} onPointerLeave={() => (drawing.current = false)} className="h-32 w-full touch-none rounded-md border border-border bg-white" aria-label="Signature pad" data-testid="signature-pad" />
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" disabled={!signed || busy} onClick={saveSignature}>
              Save signature
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={!signed || busy} onClick={clear}>
              Clear
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
