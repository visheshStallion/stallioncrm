/** What an ERP adapter receives: a confirmed sales order or issued invoice of ONE brand (= one legal entity). */
export interface ErpDocument {
  type: "salesOrder" | "invoice";
  id: string;
  number: string;
  brandCode: string;
  /** Brand.erpCompanyCode – the company of the brand's legal entity in the ERP */
  companyCode: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  customerName: string | null;
  accountId: string | null;
  dealId: string | null;
  /** the customer as the document shows it (snapshot): the ERP matches its customer by tax id, then phone, then name */
  customer: { name: string | null; taxId: string | null; phone: string | null; email: string | null; address: string | null };
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  lines: Array<{ position: number; description: string; qty: number; unitPrice: number; discountPct: number; taxRate: number; lineTotal: number; vin: string | null }>;
}

export interface ErpSettings {
  baseUrl?: string;
  token?: string;
}

export interface ErpAdapter {
  /** stored as `erp:<key>` in ExternalRef.system */
  key: string;
  /** Posts the document to `doc.companyCode` and returns the ERP's id for it. Must throw on failure. */
  postDocument(doc: ErpDocument, settings: ErpSettings): Promise<{ externalId: string; raw?: unknown }>;
  /** Optional: hands an inventory journal (prompt 16) to the ERP company of the brand. */
  postJournal?(journal: ErpJournal, settings: ErpSettings): Promise<{ externalId: string }>;
}

export interface ErpJournal {
  id: string;
  number: string;
  companyCode: string;
  date: string;
  memo: string;
  lines: Array<{ account: string; debit: number; credit: number; memo: string | null }>;
}

export async function postJson(url: string, token: string | undefined, body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ERP answered HTTP ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("ERP answered with something that is not JSON");
  }
}
