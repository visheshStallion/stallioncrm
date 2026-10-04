"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Click-to-open menu with outside-click / Escape close and keyboard focus. */
export function DropdownMenu({
  trigger,
  children,
  align = "right",
  label,
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void; id: string }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right";
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o), id })}
      {open ? (
        <div
          id={id}
          role="menu"
          aria-label={label}
          className={cn(
            "absolute z-40 mt-1 min-w-48 rounded-md border border-border bg-surface p-1 text-sm text-text shadow-lg",
            align === "right" ? "right-0" : "left-0",
            className,
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({ children, onClick, href, disabled }: { children: ReactNode; onClick?: () => void; href?: string; disabled?: boolean }) {
  const cls = cn(
    "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left hover:bg-muted focus:bg-muted focus:outline-none",
    disabled && "pointer-events-none opacity-50",
  );
  return href ? (
    <a role="menuitem" href={href} className={cls}>
      {children}
    </a>
  ) : (
    <button role="menuitem" type="button" className={cls} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** Right-side drawer (Quick Create, filter panel on narrow screens). */
export function Drawer({ open, onClose, title, children, width = 440 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex max-w-full flex-col bg-surface shadow-xl" style={{ width }}>
        <header className="flex h-[52px] items-center justify-between border-b border-border px-4">
          <h2 className="font-semibold">{title}</h2>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close drawer">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </div>
  );
}

/** Confirmation for destructive actions. */
export function ConfirmDialog({
  open,
  title,
  text,
  confirmLabel = "Confirm",
  destructive,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  text?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Cancel" className="absolute inset-0 bg-black/30" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-lg bg-surface p-5 shadow-xl">
        <h2 className="font-semibold">{title}</h2>
        {text ? <p className="mt-2 text-sm text-text-muted">{text}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
