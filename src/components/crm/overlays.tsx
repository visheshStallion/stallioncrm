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
          className={cn("crm-menu", align === "right" ? "right-0" : "left-0", className)}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({ children, onClick, href, disabled }: { children: ReactNode; onClick?: () => void; href?: string; disabled?: boolean }) {
  const cls = cn("crm-menu-item", disabled && "pointer-events-none opacity-50");
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

/** Centred popup (Quick Create): header with title and close, scrolling body, optional footer with the buttons. */
export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label={title} data-testid="modal">
      <button type="button" aria-label="Close" className="crm-overlay" onClick={onClose} />
      <div className="crm-modal">
        <header className="crm-modal-header">
          <h2>{title}</h2>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close popup">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="crm-modal-body">{children}</div>
        {footer ? <footer className="crm-modal-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

/** Side drawer (module customisation, filter panel on narrow screens). */
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
      <button type="button" aria-label="Close" className="crm-overlay" onClick={onClose} />
      <aside className="crm-drawer" style={{ width }}>
        <header className="crm-modal-header">
          <h2>{title}</h2>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close drawer">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="crm-modal-body">{children}</div>
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
      <button type="button" aria-label="Cancel" className="crm-overlay" onClick={onCancel} />
      <div className="crm-modal max-w-sm">
        <h2 className="crm-modal-header">{title}</h2>
        {text ? <p className="crm-modal-body text-text-muted">{text}</p> : null}
        <div className="crm-modal-footer">
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
