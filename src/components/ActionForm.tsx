"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { toastResult } from "@/components/Toaster";
import { Button, type ButtonProps } from "@/components/ui/button";

type Outcome = { message?: string; redirect?: string };
type Result = { ok: true; data: Outcome } | { ok: false; error: { code: string; message: string } };

/** Puts the submitted values back into the form (React resets a form after its action, also when it failed). */
function restore(form: HTMLFormElement, fd: FormData) {
  for (const el of Array.from(form.elements)) {
    if (el instanceof HTMLInputElement) {
      if (!el.name || el.type === "file" || el.type === "hidden" || el.type === "submit") continue;
      if (el.type === "checkbox" || el.type === "radio") el.checked = fd.getAll(el.name).includes(el.value);
      else if (fd.has(el.name)) el.value = String(fd.get(el.name));
    } else if ((el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) && el.name && fd.has(el.name)) {
      el.value = String(fd.get(el.name));
    }
  }
}

/**
 * Form posting to a server action that returns an ActionResult: shows a toast (ForbiddenError →
 * error toast), then refreshes or follows `redirect`. Optional `confirm` text asks before submitting.
 * When the action fails, what the user typed stays in the form.
 */
export function ActionForm({
  action,
  children,
  className,
  confirm,
  id,
}: {
  action: (prev: unknown, fd: FormData) => Promise<Result>;
  children: ReactNode;
  className?: string;
  confirm?: string;
  /** lets a submit button outside the form (popup footer) reference it with `form` */
  id?: string;
}) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const failed = useRef<FormData | null>(null);
  const [state, formAction] = useActionState(async (prev: Result | undefined, fd: FormData) => {
    if (confirm && !window.confirm(confirm)) {
      failed.current = fd; // cancelled: keep the input as well
      return prev ? { ...prev } : prev;
    }
    const result = await action(prev, fd);
    failed.current = result.ok ? null : fd;
    toastResult(result, result.ok ? result.data.message : undefined);
    if (result.ok && result.data.redirect) router.push(result.data.redirect);
    else router.refresh();
    return result;
  }, undefined);
  // Runs after React's automatic form reset.
  useEffect(() => {
    if (failed.current && ref.current) restore(ref.current, failed.current);
    failed.current = null;
  }, [state]);
  return (
    <form ref={ref} id={id} action={formAction} className={className}>
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
