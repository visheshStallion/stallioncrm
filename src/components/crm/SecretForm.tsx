"use client";

import { useRouter } from "next/navigation";
import { useActionState, type ReactNode } from "react";
import { toastResult } from "@/components/Toaster";

type Secret = { label: string; value: string };
type Outcome = { message?: string; secrets?: Secret[] };
type Result = { ok: true; data: Outcome } | { ok: false; error: { code: string; message: string } };

/**
 * Like ActionForm, for actions that create a credential: the secret values the action returns are shown ONCE,
 * right under the form, with a note that they cannot be shown again.
 */
export function SecretForm({ action, children, className }: { action: (prev: unknown, fd: FormData) => Promise<Result>; children: ReactNode; className?: string }) {
  const router = useRouter();
  const [state, formAction] = useActionState(async (prev: Result | undefined, fd: FormData) => {
    const result = await action(prev, fd);
    toastResult(result, result.ok ? result.data.message : undefined);
    router.refresh();
    return result;
  }, undefined);
  const secrets = state?.ok ? (state.data.secrets ?? []) : [];
  return (
    <div>
      <form action={formAction} className={className}>
        {children}
      </form>
      {secrets.length ? (
        <div role="status" className="mt-3 space-y-2 rounded-md border border-border bg-muted p-3 text-[13px]" data-testid="new-secret">
          <p className="font-semibold">Copy this now – it is not stored and cannot be shown again.</p>
          {secrets.map((s) => (
            <label key={s.label} className="block">
              <span className="text-xs text-text-muted">{s.label}</span>
              <input readOnly value={s.value} onFocus={(e) => e.currentTarget.select()} className="mt-0.5 block w-full rounded border border-border bg-surface px-2 py-1 font-mono text-xs" />
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
