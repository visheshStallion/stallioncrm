/**
 * Domain events (outbox). `emitEvent` stores the event in `DomainEvent`; integrations (prompt 13) read the
 * outbox and deliver it (e.g. `document.confirmed` → the brand's ERP company). Stored with the system client:
 * user sessions have no access to the outbox.
 */
import "server-only";
import { storeDomainEvent } from "@/server/db/system";
import { logger } from "@/server/log";

export interface DocumentConfirmedEvent {
  documentType: "salesOrder" | "invoice";
  documentId: string;
  number: string;
  brandId: string;
  brandCode: string;
  /** ERP / Books company of the brand's legal entity */
  erpCompanyCode: string | null;
  dealId: string;
  currency: string;
  total: number;
}

export async function emitEvent(name: "document.confirmed", payload: DocumentConfirmedEvent): Promise<void> {
  try {
    await storeDomainEvent(name, payload.brandId, payload);
  } catch (err) {
    logger.error({ err, name }, "could not store domain event");
    throw err;
  }
}
