/**
 * System-side queries of the cases module (prompt 11): the satisfaction survey is answered by a customer
 * without a session, and the public case form has to recognise an existing customer. Narrow and token- /
 * brand-bound.
 */
import "server-only";
import { unsafeDb } from "./unsafe";

export function caseBySurveyToken(token: string) {
  return unsafeDb.case.findUnique({ where: { surveyToken: token }, select: { id: true, number: true, satisfactionScore: true, brand: { select: { name: true } } } });
}

/** Records the customer's answer once (later submissions do not overwrite it). */
export async function recordSurvey(token: string, score: number, note: string | null): Promise<{ number: string; brandName: string; already: boolean } | null> {
  const c = await caseBySurveyToken(token);
  if (!c) return null;
  if (c.satisfactionScore !== null) return { number: c.number, brandName: c.brand.name, already: true };
  await unsafeDb.case.update({ where: { id: c.id }, data: { satisfactionScore: score, satisfactionNote: note?.slice(0, 1000) || null } });
  return { number: c.number, brandName: c.brand.name, already: false };
}

/** A known contact for a phone number / email (public case form, inbound messages). */
export async function contactByAddress(phone: string | null, email: string | null): Promise<{ id: string; accountId: string | null } | null> {
  if (!phone && !email) return null;
  return unsafeDb.contact.findFirst({
    where: { deletedAt: null, OR: [...(phone ? [{ mobile: phone }, { altPhone: phone }] : []), ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : [])] },
    select: { id: true, accountId: true },
    orderBy: { updatedAt: "desc" },
  });
}
