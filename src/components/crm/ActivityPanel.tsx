import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { formatDateTime, type DateFormat } from "@/lib/format";
import { completeActivityAction } from "@/server/modules/activities/actions";
import type { ActivityRow } from "@/server/modules/activities/queries";
import { STATUS_LABELS, TYPE_LABELS, type ActivityTypeKey } from "@/server/modules/activities/schema";
import { StatusPill } from "./primitives";
import { RelatedListCard } from "./record";

type Groups = { overdue: ActivityRow[]; upcoming: ActivityRow[]; history: ActivityRow[] };

const typeLabel = (t: string) => TYPE_LABELS[t as ActivityTypeKey] ?? t;

function Row({ a, canEdit, dateFormat }: { a: ActivityRow; canEdit: boolean; dateFormat: DateFormat }) {
  return (
    <li className="flex items-center gap-2 py-1.5" data-testid="activity-row">
      <span className="w-20 shrink-0 text-xs text-text-muted">{typeLabel(a.type)}</span>
      <Link href={`/activities/${a.id}`} className="min-w-0 flex-1 truncate font-medium text-primary hover:underline">
        {a.subject}
      </Link>
      <span className="text-xs text-text-muted">{a.ownerName}</span>
      <span className="w-32 text-right text-xs text-text-muted">{a.at ? formatDateTime(a.at, dateFormat) : "—"}</span>
      {a.status !== "OPEN" ? (
        <StatusPill tone={a.status === "COMPLETED" ? "success" : "neutral"}>{STATUS_LABELS[a.status as keyof typeof STATUS_LABELS]}</StatusPill>
      ) : a.overdue ? (
        <StatusPill tone="danger">Overdue</StatusPill>
      ) : null}
      {canEdit && a.status === "OPEN" && a.type !== "TEST_DRIVE" ? (
        <ActionForm action={completeActivityAction}>
          <input type="hidden" name="id" value={a.id} />
          <button type="submit" className="text-xs font-semibold text-primary hover:underline" aria-label={`Complete ${a.subject}`}>
            Complete
          </button>
        </ActionForm>
      ) : null}
    </li>
  );
}

/**
 * Activity panel of a record (prompt 07 §1): overdue, upcoming and history, with quick links to add a task,
 * log a call, plan a meeting or book a test drive. Activities inherit the record's brand and region.
 */
export function ActivityPanel({
  parentType,
  parentId,
  groups,
  canCreate,
  canEdit,
  dateFormat,
  phone,
  testDrive = false,
}: {
  parentType: string;
  parentId: string;
  groups: Groups;
  canCreate: boolean;
  canEdit: boolean;
  dateFormat: DateFormat;
  /** Customer phone for the click-to-call link. */
  phone?: string | null;
  testDrive?: boolean;
}) {
  const base = `/activities/new?parentType=${parentType}&parentId=${parentId}`;
  const total = groups.overdue.length + groups.upcoming.length + groups.history.length;
  const section = (title: string, rows: ActivityRow[], testId: string) =>
    rows.length ? (
      <div data-testid={testId}>
        <h3 className="mb-1 text-[11px] font-semibold uppercase text-text-muted">{title}</h3>
        <ul className="divide-y divide-border">
          {rows.map((a) => (
            <Row key={a.id} a={a} canEdit={canEdit} dateFormat={dateFormat} />
          ))}
        </ul>
      </div>
    ) : null;
  const quick = "rounded-md border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted";
  return (
    <RelatedListCard id="open-activities" title="Activities" count={total}>
      <div className="space-y-3" data-testid="activity-panel">
        {canCreate ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`${base}&type=task`} className={quick}>
              + Task
            </Link>
            <Link href={`${base}&type=meeting`} className={quick}>
              + Meeting
            </Link>
            {testDrive ? (
              <Link href={`${base}&type=testdrive`} className={quick}>
                + Test Drive
              </Link>
            ) : null}
            <Link href={`${base}&type=call&log=1${phone ? `&phone=${encodeURIComponent(phone)}` : ""}`} className={quick}>
              Log Call
            </Link>
            {phone && !phone.includes("*") ? (
              <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className={quick} data-testid="click-to-call">
                Call {phone}
              </a>
            ) : null}
          </div>
        ) : null}
        {section("Overdue", groups.overdue, "activities-overdue")}
        {section("Upcoming", groups.upcoming, "activities-upcoming")}
        {section("History", groups.history, "activities-history")}
        {total === 0 ? <p className="text-text-muted">No activities yet.</p> : null}
      </div>
    </RelatedListCard>
  );
}
