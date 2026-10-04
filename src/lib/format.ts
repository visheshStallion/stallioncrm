const ngn = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

export const formatMoney = (v: number | null | undefined) => (v === null || v === undefined ? "—" : ngn.format(v));
export const formatDate = (v: string | Date | null | undefined) => (v ? date.format(new Date(v)) : "—");
