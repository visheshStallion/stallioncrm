import Link from "next/link";
import { StatusPill } from "@/components/crm/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loginHistory } from "@/server/modules/setup/service";
import { requireSetup } from "../guard";
import { Section, SetupHeader, fmtDateTime } from "../_components";

export const metadata = { title: "Login History" };

export default async function LoginHistoryPage({ searchParams }: { searchParams: Promise<{ page?: string; failed?: string }> }) {
  const { ctx, entry } = await requireSetup("login-history"); // setupPermission: ADMIN
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const failedOnly = sp.failed === "1";
  const { rows, more } = await loginHistory(ctx, { page, failedOnly });
  const link = (p: number, failed = failedOnly) => `/setup/login-history?page=${p}${failed ? "&failed=1" : ""}`;
  return (
    <div>
      <SetupHeader
        entry={entry}
        actions={
          <Link href={link(1, !failedOnly)} className="crm-btn crm-btn-secondary">
            {failedOnly ? "Show all" : "Failed attempts only"}
          </Link>
        }
      />
      <Section title={failedOnly ? "Failed sign-in attempts" : "Sign-ins, failed attempts and sign-outs"} testId="login-history">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Device / detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const after = (r.after ?? {}) as { email?: string; reason?: string; agent?: string | null; twoStep?: boolean; provider?: string };
              return (
                <TableRow key={r.id} data-testid="login-row">
                  <TableCell>{fmtDateTime(r.at)}</TableCell>
                  <TableCell>{r.user ? `${r.user.name} (${r.user.email})` : (after.email ?? "—")}</TableCell>
                  <TableCell>
                    <StatusPill tone={r.action === "LOGIN" ? "success" : r.action === "LOGIN_FAILED" ? "danger" : "neutral"}>{r.action === "LOGIN" ? "Signed in" : r.action === "LOGIN_FAILED" ? "Failed" : "Signed out"}</StatusPill>
                  </TableCell>
                  <TableCell>{r.ip ?? "—"}</TableCell>
                  <TableCell className="max-w-96 truncate text-text-muted" title={after.agent ?? undefined}>
                    {[after.reason, after.twoStep ? "two-step" : null, after.provider, after.agent].filter(Boolean).join(" · ") || "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="flex justify-end gap-2">
          {page > 1 ? (
            <Link href={link(page - 1)} className="crm-btn crm-btn-secondary crm-btn-sm">
              Newer
            </Link>
          ) : null}
          {more ? (
            <Link href={link(page + 1)} className="crm-btn crm-btn-secondary crm-btn-sm">
              Older
            </Link>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
