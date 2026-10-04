import { z } from "zod";

export const DEAL_STAGES = [
  "ENQUIRY",
  "TEST_DRIVE",
  "QUOTATION",
  "BOOKING",
  "FINANCE_PAYMENT",
  "DELIVERY",
  "CLOSED_WON",
  "CLOSED_LOST",
] as const;

export const STAGE_LABELS: Record<(typeof DEAL_STAGES)[number], string> = {
  ENQUIRY: "Enquiry",
  TEST_DRIVE: "Test Drive",
  QUOTATION: "Quotation",
  BOOKING: "Booking",
  FINANCE_PAYMENT: "Finance / Payment",
  DELIVERY: "Delivery",
  CLOSED_WON: "Closed Won",
  CLOSED_LOST: "Closed Lost",
};

export const createDealSchema = z.object({
  name: z.string().trim().min(1).max(200),
  customerName: z.string().trim().max(200).optional(),
  amount: z.coerce.number().nonnegative().max(1e12).optional(),
  stage: z.enum(DEAL_STAGES).default("ENQUIRY"),
  closeDate: z.coerce.date().optional(),
  brandId: z.string().min(1),
  regionId: z.string().min(1),
});
export type CreateDealInput = z.input<typeof createDealSchema>;

// Brand/region moves are handled by scopedDb rules (and the brand-change approval, prompt 08).
export const updateDealSchema = createDealSchema.omit({ brandId: true }).partial();
export type UpdateDealInput = z.input<typeof updateDealSchema>;
