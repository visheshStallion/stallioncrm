/**
 * "Send to vendor" (prompt 25 §6): the PO's PDF on the brand letterhead, e-mailed from the brand's sender address to
 * the PO's contact (or the vendor's e-mail). Without an address the PO is only marked as sent.
 */
import "server-only";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { logger } from "@/server/log";
import { BadRequestError } from "@/server/errors";
import { isValidEmail } from "@/server/modules/messaging/merge";
import { providerFor } from "@/server/modules/messaging/providers";
import { purchaseOrderPdf } from "./pdf";

export async function sendPurchaseOrder(ctx: AccessContext, id: string): Promise<{ to: string | null }> {
  const db = scopedDb(ctx);
  const po = await db.inventoryDocument.findUniqueOrThrow({ where: { id }, select: { brandId: true, number: true, subject: true, vendorId: true, vendorContactId: true } });
  const [vendor, contact, brand] = await Promise.all([
    po.vendorId ? db.vendor.findUnique({ where: { id: po.vendorId }, select: { name: true, email: true } }) : null,
    po.vendorContactId ? db.vendorContact.findUnique({ where: { id: po.vendorContactId }, select: { name: true, email: true } }) : null,
    db.brand.findUniqueOrThrow({ where: { id: po.brandId }, select: { name: true, legalEntity: true, fromName: true, fromEmail: true } }),
  ]);
  const to = [contact?.email, vendor?.email].find((e): e is string => !!e && isValidEmail(e)) ?? null;
  if (!to) return { to: null };
  const { bytes } = await purchaseOrderPdf(ctx, id);
  const from = brand.fromEmail ? { name: brand.fromName || brand.name, address: brand.fromEmail } : { name: process.env.MAIL_FROM_NAME ?? brand.name, address: process.env.MAIL_FROM ?? "crm@example.test" };
  const greeting = contact?.name ?? vendor?.name ?? "Sir / Madam";
  try {
    await providerFor("EMAIL").send({
      channel: "EMAIL",
      from,
      to,
      replyTo: ctx.user.email || null,
      subject: `Purchase order ${po.number}${po.subject ? ` – ${po.subject}` : ""}`,
      text: `Dear ${greeting},\n\nPlease find attached our purchase order ${po.number}.\n\nKind regards,\n${ctx.user.name}\n${brand.legalEntity ?? brand.name}`,
      attachments: [{ filename: `${po.number}.pdf`, contentType: "application/pdf", content: bytes }],
    });
  } catch (err) {
    logger.warn({ err }, "purchase order e-mail failed");
    throw new BadRequestError("The e-mail could not be sent – try again or check the e-mail settings");
  }
  return { to };
}
