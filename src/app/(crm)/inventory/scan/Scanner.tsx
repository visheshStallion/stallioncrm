"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Found {
  id: string;
  vin: string;
  productName: string;
  statusLabel: string;
  warehouseName: string | null;
  colour: string | null;
}
type Detector = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };

/**
 * Scan a VIN label (Code 39 / QR) with the phone camera – where the browser has the BarcodeDetector API –
 * or type the VIN. The lookup only finds units of the user's brands: any other VIN is "not found".
 */
export function Scanner() {
  const video = useRef<HTMLVideoElement>(null);
  const [vin, setVin] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => setSupported(typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia), []);

  async function lookup(value: string) {
    const v = value.trim().toUpperCase();
    if (!v) return;
    setMessage(null);
    setFound(null);
    const res = await fetch(`/api/v1/inventory/lookup?vin=${encodeURIComponent(v)}`);
    if (res.ok) setFound(((await res.json()) as { data: Found }).data);
    else setMessage(res.status === 404 ? `Not found: ${v}` : "The lookup failed – try again");
  }

  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current || stopped) return;
        video.current.srcObject = stream;
        await video.current.play();
        const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        const detector = new Ctor({ formats: ["code_39", "code_128", "qr_code", "data_matrix"] });
        while (!stopped && video.current) {
          const codes = await detector.detect(video.current).catch(() => []);
          // VIN labels sometimes carry a leading "I" (import prefix) in the barcode
          const raw = codes[0]?.rawValue?.replace(/^I(?=[A-HJ-NPR-Z0-9]{17}$)/, "");
          if (raw) {
            setVin(raw);
            setScanning(false);
            void lookup(raw);
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        setMessage("The camera could not be opened – type the VIN instead");
        setScanning(false);
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [scanning]);

  return (
    <div className="mx-auto max-w-md space-y-4" data-testid="scanner">
      {scanning ? <video ref={video} className="w-full rounded-lg border border-border bg-black" muted playsInline aria-label="Camera preview" /> : null}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup(vin);
        }}
      >
        <Input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} placeholder="VIN" aria-label="VIN" className="h-11 flex-1 font-mono text-base" autoCapitalize="characters" autoComplete="off" />
        <Button type="submit" className="h-11">
          Find
        </Button>
      </form>
      {supported ? (
        <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setScanning((s) => !s)}>
          {scanning ? "Stop camera" : "Scan with camera"}
        </Button>
      ) : (
        <p className="text-xs text-text-muted">This browser cannot scan barcodes – type the VIN or use a handheld scanner (it types into the field).</p>
      )}
      {message ? (
        <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-[13px]" data-testid="scan-message">
          {message}
        </p>
      ) : null}
      {found ? (
        <div className="rounded-lg border border-border bg-surface p-4 text-[13px]" data-testid="scan-result">
          <div className="font-mono text-base font-semibold">{found.vin}</div>
          <div>{found.productName}</div>
          <div className="text-text-muted">
            {found.statusLabel} · {found.warehouseName ?? "no warehouse"} · {found.colour ?? ""}
          </div>
          <Link href={`/inventory/units/${found.id}`} className="mt-2 inline-block text-primary underline">
            Open vehicle
          </Link>
        </div>
      ) : null}
    </div>
  );
}
