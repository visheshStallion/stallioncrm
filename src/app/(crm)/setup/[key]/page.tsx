import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/crm/primitives";
import { hrefOf } from "@/server/modules/setup/catalogue";
import { requireSetup } from "../guard";
import { Section, SetupHeader, tiersText } from "../_components";

/**
 * Page of a catalogue function that has no page of its own: a planned function ("Coming soon" with what it will do
 * and what exists today), or a link to the page that implements it elsewhere. Unknown keys and functions outside
 * the user's tier answer 404.
 */
export default async function SetupFunctionPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { entry } = await requireSetup(key);
  const href = hrefOf(entry);
  if (href !== `/setup/${entry.key}`) redirect(href);
  return (
    <div data-testid="setup-coming-soon">
      <SetupHeader entry={entry} />
      <Section title="Coming soon">
        <EmptyState
          title={`${entry.label} is planned`}
          text={`Priority ${entry.priority} · for ${tiersText(entry)}. ${entry.statusNote ? `Today: ${entry.statusNote}.` : "Nothing of it is built yet."}`}
          actions={
            <Link href="/setup" className="crm-btn crm-btn-secondary">
              Back to Setup
            </Link>
          }
        />
      </Section>
    </div>
  );
}
