/**
 * Starter record templates for vehicle sales (prompt 22 §3) – fictitious examples, copy-and-edit. Pure data: the
 * "Start from: Starter" choice of the New Template dialog opens one in the editor; nothing is created until saved.
 */
import type { RecordTemplateBody } from "./service";

export interface RecordStarter {
  key: string;
  module: string;
  body: RecordTemplateBody;
}

export const RECORD_STARTERS: RecordStarter[] = [
  {
    key: "walk-in-enquiry",
    module: "leads",
    body: { name: "Walk-in showroom enquiry", description: "A visitor in the showroom: source, rating and a follow-up call", fieldValues: { source: "WALK_IN", rating: "WARM", regionId: { $: "userRegion" }, ownerId: { $: "currentUser" } }, lockedFields: ["source"], childRecords: [{ subject: "Follow up in 24 h", type: "CALL", dueInHours: 24, priority: "HIGH" }] },
  },
  {
    key: "referral-lead",
    module: "leads",
    body: { name: "Referral from a customer", description: "Lead recommended by an existing customer", fieldValues: { source: "REFERRAL", rating: "HOT", regionId: { $: "userRegion" } }, lockedFields: ["source"], childRecords: [{ subject: "Thank the referrer", type: "TASK", dueInHours: 48, priority: "NORMAL" }] },
  },
  {
    key: "fleet-deal",
    module: "deals",
    body: { name: "Fleet / corporate deal", description: "Fleet payment, close date in 45 days, credit check and proposal tasks", fieldValues: { paymentType: "FLEET", closeDate: { $: "today+45d" }, regionId: { $: "userRegion" } }, lockedFields: ["paymentType"], childRecords: [{ subject: "Credit check", type: "TASK", dueInHours: 48, priority: "HIGH" }, { subject: "Send the proposal", type: "TASK", dueInHours: 96, priority: "NORMAL" }] },
  },
  {
    key: "bank-finance-deal",
    module: "deals",
    body: { name: "Bank-finance retail deal", description: "Bank finance with the KYC and approval-letter checklist", fieldValues: { paymentType: "BANK_FINANCE", closeDate: { $: "today+30d" }, quantity: 1, regionId: { $: "userRegion" } }, lockedFields: ["paymentType"], childRecords: [{ subject: "Collect KYC documents", type: "TASK", dueInHours: 24, priority: "HIGH" }, { subject: "Bank approval letter", type: "TASK", dueInHours: 120, priority: "NORMAL" }] },
  },
  {
    key: "standard-offer",
    module: "quotes",
    body: { name: "Standard offer", description: "Standard terms; add the brand's vehicle and accessories as line items", fieldValues: { terms: "This quotation is valid for 14 days. Prices include VAT at 7.5 %. Delivery is ex-showroom." } },
  },
  {
    key: "delivery-complaint",
    module: "cases",
    body: { name: "Delivery complaint", description: "A complaint about a delivery: type and priority are fixed", fieldValues: { type: "DELIVERY_ISSUE", priority: "HIGH", regionId: { $: "userRegion" } }, lockedFields: ["type"], childRecords: [{ subject: "Call the customer back", type: "CALL", dueInHours: 4, priority: "HIGH" }] },
  },
  {
    key: "corporate-account",
    module: "accounts",
    body: { name: "Corporate account", description: "A company customer awaiting KYC", fieldValues: { type: "CORPORATE" }, childRecords: [{ subject: "Request company documents (CAC, TIN)", type: "TASK", dueInHours: 48, priority: "NORMAL" }] },
  },
];

export const recordStarter = (key: string) => RECORD_STARTERS.find((s) => s.key === key);
