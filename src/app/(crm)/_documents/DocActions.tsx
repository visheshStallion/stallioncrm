"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { addPaymentAction, convertAction, createQuoteAction, decideApprovalAction, transitionAction } from "@/server/modules/documents/actions";

type Result = { ok: true; data: { message?: string; redirect?: string } } | { ok: false; error: { message: string } };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    start(async () => {
      const res = await fn();
      if (!res.ok) return toast(res.error.message, "error");
      if (res.data.message) toast(res.data.message, "success");
      if (res.data.redirect) router.push(res.data.redirect);
      else router.refresh();
    });
  };
  return { run, pending };
}

export interface DocButton {
  op: string;
  label: string;
  variant?: "default" | "outline" | "destructive";
  confirm?: string;
  /** "convert" calls the conversion action instead of a status transition */
  kind?: "transition" | "convert";
  /** asks for a note first (void reason, approval note); empty → nothing happens */
  ask?: string;
}

/** Status buttons for a document (which ones are offered is decided on the server from status + permissions). */
export function DocButtons({ type, id, buttons }: { type: string; id: string; buttons: DocButton[] }) {
  const { run, pending } = useRun();
  return (
    <>
      {buttons.map((b) => (
        <Button
          key={b.op}
          variant={b.variant ?? "outline"}
          disabled={pending}
          onClick={() => {
            const note = b.ask ? window.prompt(b.ask)?.trim() : undefined;
            if (b.ask && !note) return;
            run(() => (b.kind === "convert" ? convertAction(type, id) : transitionAction(type, id, b.op, note)) as Promise<Result>, b.confirm);
          }}
        >
          {b.label}
        </Button>
      ))}
    </>
  );
}

/** "Create Quote" on a deal. */
export function CreateQuoteButton({ dealId }: { dealId: string }) {
  const { run, pending } = useRun();
  return (
    <>
      <Button variant="outline" disabled={pending} onClick={() => run(() => createQuoteAction(dealId) as Promise<Result>)}>
        Create Quote
      </Button>
      <Button variant="ghost" asChild>
        <a href={`/templates/pick?module=quotes&dealId=${dealId}`} data-testid="quote-from-template">
          Quote from template
        </a>
      </Button>
    </>
  );
}

/** Approve / reject a pending discount approval (shown to the assigned approver and management). */
export function ApprovalDecision({ requestId }: { requestId: string }) {
  const { run, pending } = useRun();
  const [note, setNote] = useState("");
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="h-8 w-64" aria-label="Decision note" />
      <Button size="sm" disabled={pending} onClick={() => run(() => decideApprovalAction(requestId, true, note) as Promise<Result>)}>
        Approve
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => decideApprovalAction(requestId, false, note) as Promise<Result>)}>
        Reject
      </Button>
    </div>
  );
}

/** Record a receipt against an invoice. */
export function PaymentForm({ invoiceId, balance }: { invoiceId: string; balance: number }) {
  const { run, pending } = useRun();
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState("TRANSFER");
  const [reference, setReference] = useState("");
  const [receivedAt, setReceivedAt] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="payment-form">
      <Input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={0} step="0.01" className="h-8 w-40 text-right" aria-label="Payment amount" />
      <Select value={method} onChange={(e) => setMethod(e.target.value)} className="h-8" aria-label="Payment method">
        {["TRANSFER", "CASH", "POS", "CHEQUE", "FINANCE", "ONLINE"].map((m) => (
          <option key={m} value={m}>
            {m.charAt(0) + m.slice(1).toLowerCase()}
          </option>
        ))}
      </Select>
      <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Reference / receipt no." className="h-8 w-48" aria-label="Payment reference" />
      <Input value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} type="date" className="h-8 w-40" aria-label="Received on" />
      <Button size="sm" disabled={pending} onClick={() => run(() => addPaymentAction(invoiceId, { amount, method, reference, receivedAt }) as Promise<Result>)}>
        Record payment
      </Button>
    </div>
  );
}
