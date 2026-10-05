/**
 * Starter gallery of e-mail templates for automotive sales (prompt 20 §B2). Our own wording; every starter is a
 * normal block document that the template editor opens for editing. Pure data.
 */
import type { EmailCategory, EmailDoc } from "./blocks";

export interface Starter {
  key: string;
  name: string;
  category: EmailCategory;
  module: string | null;
  subject: string;
  doc: EmailDoc;
}

const hello = `<p>Dear {{contact.firstName | "Customer"}},</p>`;
const bye = `<p>Kind regards,<br>{{owner.name | "Your sales team"}}<br>{{brand.name}}</p>`;
const text = (...parts: string[]): EmailDoc["blocks"][number] => ({ type: "text", html: parts.join("") });

export const EMAIL_STARTERS: Starter[] = [
  {
    key: "enquiry-follow-up",
    name: "Enquiry follow-up",
    category: "Sales",
    module: "leads",
    subject: "Your {{brand.name}} enquiry",
    doc: { blocks: [text(hello, `<p>Thank you for your interest in the {{deal.model | "vehicle"}}. I would be glad to answer your questions, send you a quotation or arrange a test drive at a time that suits you.</p>`), { type: "button", label: "Reply to book a test drive", href: "mailto:{{user.email}}" }, text(bye)] },
  },
  {
    key: "test-drive-confirmation",
    name: "Test-drive confirmation",
    category: "Sales",
    module: "deals",
    subject: "Your test drive with {{brand.name}} is confirmed",
    doc: { blocks: [text(hello, `<p>Your test drive of the {{deal.model | "vehicle"}} is confirmed. Please bring a valid driving licence. If you need to change the time, simply reply to this e-mail.</p>`), { type: "divider" }, text(`<p><strong>What to expect</strong></p><ul><li>A short walk-around of the vehicle</li><li>About 30 minutes on the road</li><li>Time for your questions about price, finance and delivery</li></ul>`, bye)] },
  },
  {
    key: "quotation-sent",
    name: "Quotation sent",
    category: "Sales",
    module: "quotes",
    subject: "Your quotation {{quote.number}} from {{brand.name}}",
    doc: { blocks: [text(hello, `<p>Please find attached our quotation <strong>{{quote.number}}</strong>. The prices are valid as stated on the document. I will gladly go through it with you.</p>`), text(bye)] },
  },
  {
    key: "booking-confirmation",
    name: "Booking confirmation",
    category: "Transactional",
    module: "deals",
    subject: "Booking confirmed – {{deal.name}}",
    doc: { blocks: [text(hello, `<p>We confirm your booking of the {{deal.model | "vehicle"}}. Your booking receipt is attached. We will keep you informed about the delivery date.</p>`), text(bye)] },
  },
  {
    key: "payment-receipt",
    name: "Payment receipt",
    category: "Transactional",
    module: "invoices",
    subject: "Payment received – invoice {{invoice.number}}",
    doc: { blocks: [text(hello, `<p>Thank you. We have received your payment for invoice <strong>{{invoice.number}}</strong>. The invoice is attached for your records.</p>`), text(bye)] },
  },
  {
    key: "delivery-appointment",
    name: "Delivery appointment",
    category: "Sales",
    module: "deals",
    subject: "Your {{deal.model | \"vehicle\"}} is ready for delivery",
    doc: { blocks: [text(hello, `<p>Good news: your {{deal.model | "vehicle"}} is ready. Please reply with a day and time that suit you for the handover. Kindly bring a means of identification.</p>`), text(bye)] },
  },
  {
    key: "thank-you-delivery",
    name: "Thank you after delivery",
    category: "Service",
    module: "deals",
    subject: "Thank you from {{brand.name}}",
    doc: { blocks: [text(hello, `<p>Thank you for choosing {{brand.name}}. We hope you are enjoying your new {{deal.model | "vehicle"}}. If anything is not as you expect, reply to this e-mail and we will take care of it.</p>`), text(bye)] },
  },
  {
    key: "service-reminder",
    name: "Service reminder",
    category: "Service",
    module: null,
    subject: "Time for your next service",
    doc: { blocks: [text(hello, `<p>Your vehicle is due for its next service. Regular servicing keeps the warranty valid and the vehicle safe.</p>`), { type: "button", label: "Book a service", href: "mailto:{{user.email}}" }, text(bye)] },
  },
  {
    key: "birthday",
    name: "Birthday greeting",
    category: "Marketing",
    module: "contacts",
    subject: "Happy birthday from {{brand.name}}",
    doc: { blocks: [text(`<h2>Happy birthday, {{contact.firstName | "dear customer"}}!</h2>`, `<p>Everyone at {{brand.name}} wishes you a wonderful day and a safe year on the road.</p>`)] },
  },
  {
    key: "new-model-launch",
    name: "New model launch",
    category: "Marketing",
    module: null,
    subject: "Meet the new arrival at {{brand.name}}",
    doc: {
      blocks: [
        text(hello, `<p>We are pleased to introduce a new model in our showroom.</p>`),
        { type: "vehicle", model: "Model name", price: "From ₦ 00,000,000", description: "Two or three lines about what makes this model special.", cta: "Book a test drive", href: "mailto:{{user.email}}" },
        text(bye),
      ],
    },
  },
];

export const starter = (key: string) => EMAIL_STARTERS.find((s) => s.key === key);
