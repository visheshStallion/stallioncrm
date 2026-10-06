/** Purchase order page constants (prompt 25) – plain module: used by the server and the browser form. */

export const PO_CURRENCIES = ["NGN", "USD", "EUR", "GBP", "JPY", "CNY"] as const;

/** Status codes of a PO (inventory workflow) and the names the page shows. */
export const PO_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Created",
  PENDING_APPROVAL: "Pending Approval",
  ISSUED: "Approved",
  SENT: "Sent to Vendor",
  PARTIALLY_RECEIVED: "Partially Received",
  RECEIVED: "Received",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

/** Sections and fields a custom form view can hide (the standard view shows all). */
export const PO_FORM_PARTS = {
  requisitionNumber: "Requisition Number",
  vendorContactId: "Contact Name",
  trackingNumber: "Tracking Number",
  carrier: "Carrier",
  dueDate: "Due Date",
  salesCommission: "Sales Commission",
  exciseDuty: "Excise Duty",
  address: "Address Information",
  terms: "Terms and Conditions",
  description: "Description Information",
} as const;
export type PoFormPart = keyof typeof PO_FORM_PARTS;
export interface PoFormView {
  id: string;
  name: string;
  hidden: PoFormPart[];
}

export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT – Abuja", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
] as const;
