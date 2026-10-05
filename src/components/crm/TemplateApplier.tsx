"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export interface AppliedTemplate {
  id: string;
  name: string;
  values: Record<string, unknown>;
  locked: string[];
  hidden: string[];
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Sets a value the way a user would, so that React-controlled fields and dependent pickers notice it. */
function setValue(el: Control, v: unknown): boolean {
  if (el instanceof HTMLInputElement && el.type === "checkbox") {
    const want = v === true || v === "true" || v === "on";
    if (el.checked !== want) el.click();
    return true;
  }
  if (el instanceof HTMLInputElement && el.type === "radio") {
    if (el.value === String(v) && !el.checked) el.click();
    return true;
  }
  let s = v === null || v === undefined ? "" : String(v);
  if (el instanceof HTMLInputElement && el.type === "datetime-local" && /^\d{4}-\d{2}-\d{2}$/.test(s)) s += "T09:00";
  if (el.value === s) return true;
  // a dependent list (models of the brand, regions) may not have the option yet: try again on the next pass
  if (el instanceof HTMLSelectElement && !Array.from(el.options).some((o) => o.value === s)) return false;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, s);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function lock(el: Control) {
  if (el.dataset.templateLocked) return;
  el.dataset.templateLocked = "1";
  el.title = "Set by the template";
  if (el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio"))) {
    // not `disabled`: a disabled control is not submitted. The server applies the template's value in any case.
    el.setAttribute("aria-disabled", "true");
    el.tabIndex = -1;
    el.style.pointerEvents = "none";
  } else el.readOnly = true;
}

/** The smallest wrapper that holds this control and nothing else to fill in (label + input), up to three levels up. */
function wrapperOf(el: Control): HTMLElement | null {
  let best: HTMLElement | null = null;
  let cur: HTMLElement | null = el.parentElement;
  for (let i = 0; i < 3 && cur && cur.tagName !== "FORM"; i++) {
    if (cur.querySelectorAll("input:not([type=hidden]), select, textarea").length !== 1) break;
    best = cur;
    cur = cur.parentElement;
  }
  return best;
}

/**
 * Placed inside a module's create form when it was opened with `?template=<id>` ("Create from template"): fills the
 * template's values in, makes locked fields read-only and takes hidden fields out of sight. This is convenience
 * only – the create action applies locked and hidden values again on the server, whatever the browser sends.
 */
export function TemplateApplier({ template, clearHref }: { template: AppliedTemplate; clearHref: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const touched = new Set<string>();
    const onInput = (e: Event) => {
      const t = e.target as Control;
      if (e.isTrusted && t?.name) touched.add(t.name);
    };
    form.addEventListener("input", onInput);
    // the brand first: other pickers depend on it
    const names = Object.keys(template.values).sort((a, b) => Number(b === "brandId") - Number(a === "brandId"));
    const forced = new Set([...template.locked, ...template.hidden]);
    const pass = () => {
      for (const name of names) {
        const els = Array.from(form.querySelectorAll<Control>(`[name="${CSS.escape(name)}"]`)).filter((el) => !(el instanceof HTMLInputElement && el.type === "hidden"));
        for (const el of els) {
          if (!touched.has(name) || forced.has(name)) setValue(el, template.values[name]);
          if (forced.has(name)) lock(el);
          if (template.hidden.includes(name)) wrapperOf(el)?.setAttribute("hidden", "");
        }
      }
    };
    pass();
    const timers = [120, 400, 1000].map((ms) => window.setTimeout(pass, ms));
    return () => {
      form.removeEventListener("input", onInput);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [template]);

  return (
    <div ref={ref} role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm" data-testid="template-banner">
      <input type="hidden" name="_templateId" value={template.id} />
      <span>
        From the template <strong>{template.name}</strong>
        {template.locked.length ? " – fields set by the template cannot be changed." : "."}
      </span>
      <Link href={clearHref} className="ml-auto text-xs font-semibold text-primary underline">
        Start without the template
      </Link>
    </div>
  );
}
