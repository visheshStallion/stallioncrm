"use client";

import { useRouter } from "next/navigation";
import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { toastResult } from "@/components/Toaster";
import { Button, type ButtonProps } from "@/components/ui/button";

type Outcome = { message?: string; redirect?: string };
type Result = { ok: true; data: Outcome } | { ok: false; error: { code: string; message: string } };

/**
 * Form posting to a server action that returns an ActionResult: shows a toast (ForbiddenError →
 * error toast), then refreshes or follows `redirect`. Optional `confirm` text asks before submitting.
 */
export function ActionForm({
  action,
  children,
  className,
  confirm,
}: {
  action: (prev: unknown, fd: FormData) => Promise<Result>;
  children: ReactNode;
  className?: string;
  confirm?: string;
}) {
  const router = useRouter();
  const [, formAction] = useActionState(async (prev: Result | undefined, fd: FormData) => {
    if (confirm && !window.confirm(confirm)) return prev;
    const result = await action(prev, fd);
    toastResult(result, result.ok ? result.data.message : undefined);
    if (result.ok && result.data.redirect) router.push(result.data.redirect);
    else router.refresh();
    return result;
  }, undefined);
  return (
    <form action={formAction} className={className}>
      {children}
    </form>
  );
}

export function SubmitButton({ children, ...props }: ButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? "Working…" : children}
    </Button>
  );
}
