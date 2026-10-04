"use server";

import { revalidatePath } from "next/cache";
import { safeAction, type ActionResult } from "@/server/api";
import { createPaymentLink } from "@/server/integrations/payments";
import * as webhooks from "@/server/integrations/webhooks";
import { requireContext } from "@/server/request";
import * as tokens from "./tokens";

type Secret = { label: string; value: string };
type Outcome = { message?: string; redirect?: string; secrets?: Secret[] };
const str = (fd: FormData, k: string) => (fd.get(k) ?? "").toString().trim();
const all = (fd: FormData, k: string) => fd.getAll(k).map(String).filter(Boolean);
const tokenInput = (fd: FormData) => ({ name: str(fd, "name"), brandIds: all(fd, "brandIds"), expiresInDays: str(fd, "expiresInDays"), rateLimit: str(fd, "rateLimit") });

// ── tokens ──
export async function createPersonalTokenAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const res = await tokens.createPersonalToken(await requireContext(), tokenInput(fd));
    revalidatePath("/tokens");
    return { message: "Token created", secrets: [{ label: "API token", value: res.token }] };
  });
}

export async function createIntegrationTokenAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const res = await tokens.createIntegrationToken(await requireContext(), str(fd, "userId"), tokenInput(fd));
    revalidatePath("/admin/api");
    return { message: "Integration token created", secrets: [{ label: "API token", value: res.token }] };
  });
}

export async function revokeTokenAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await tokens.revokeToken(await requireContext(), str(fd, "id"));
    revalidatePath("/tokens");
    revalidatePath("/admin/api");
    return { message: "Token revoked" };
  });
}

export async function createPrincipalAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await tokens.createPrincipal(await requireContext(), { name: str(fd, "name"), roleId: str(fd, "roleId"), profileId: str(fd, "profileId"), brandIds: all(fd, "brandIds") });
    revalidatePath("/admin/api");
    return { message: "Integration principal created" };
  });
}

export async function createClientAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const res = await tokens.createClient(await requireContext(), { name: str(fd, "name"), userId: str(fd, "userId"), brandIds: all(fd, "brandIds"), rateLimit: str(fd, "rateLimit") });
    revalidatePath("/admin/api");
    return { message: "OAuth client created", secrets: [{ label: "Client id", value: res.clientId }, { label: "Client secret", value: res.clientSecret }] };
  });
}

export async function setClientActiveAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const active = str(fd, "active") === "true";
    await tokens.setClientActive(await requireContext(), str(fd, "id"), active);
    revalidatePath("/admin/api");
    return { message: active ? "Client enabled" : "Client disabled – its tokens are revoked" };
  });
}

// ── webhooks ──
export async function saveWebhookAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const id = str(fd, "id") || null;
    const res = await webhooks.saveSubscription(await requireContext(), id, { name: str(fd, "name"), url: str(fd, "url"), events: all(fd, "events"), brandIds: all(fd, "brandIds"), userId: str(fd, "userId"), active: id ? fd.get("active") === "on" : true });
    revalidatePath("/admin/webhooks");
    return { message: id ? "Subscription saved" : "Subscription created", secrets: res.secret ? [{ label: "Signing secret", value: res.secret }] : undefined };
  });
}

export async function deleteWebhookAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await webhooks.deleteSubscription(await requireContext(), str(fd, "id"));
    revalidatePath("/admin/webhooks");
    return { message: "Subscription deleted", redirect: "/admin/webhooks" };
  });
}

export async function redeliverAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await webhooks.redeliver(await requireContext(), str(fd, "id"));
    revalidatePath("/admin/webhooks");
    return { message: "Delivery queued again" };
  });
}

// ── online payments ──
export async function createPaymentLinkAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const invoiceId = str(fd, "invoiceId");
    const link = await createPaymentLink(await requireContext(), invoiceId, { provider: str(fd, "provider") || undefined, amount: str(fd, "amount") || null, email: str(fd, "email") || null });
    revalidatePath(`/invoices/${invoiceId}`);
    return { message: `Payment link created (${link.provider})` };
  });
}
