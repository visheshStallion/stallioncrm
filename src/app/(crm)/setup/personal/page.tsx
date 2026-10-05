import Link from "next/link";
import { getPreferences } from "@/server/modules/preferences/queries";
import { requireSetup } from "../guard";
import { Section, SetupHeader } from "../_components";
import { Prefs } from "./Prefs";

export const metadata = { title: "Personal Settings" };

export default async function PersonalSettingsPage() {
  const { ctx, entry } = await requireSetup("personal-settings"); // setupPermission: ALL
  const prefs = await getPreferences(ctx);
  return (
    <div>
      <SetupHeader entry={entry} />
      <Section title="Profile">
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[160px_1fr]">
          <dt className="text-text-muted">Name</dt>
          <dd>{ctx.user.name}</dd>
          <dt className="text-text-muted">E-mail</dt>
          <dd>{ctx.user.email}</dd>
          <dt className="text-text-muted">Role</dt>
          <dd>{ctx.user.roleName}</dd>
          <dt className="text-text-muted">Profile</dt>
          <dd>{ctx.profile.name}</dd>
        </dl>
        <p className="text-xs text-text-muted">Name, role and profile are changed by an administrator.</p>
      </Section>
      <Section title="Display" testId="personal-display">
        <Prefs values={{ theme: prefs.theme, density: prefs.density, nav: prefs.nav, dateFormat: prefs.dateFormat }} />
      </Section>
      <Section title="More">
        <ul className="space-y-1">
          <li>
            <Link href="/notifications" className="text-primary underline">
              Notification preferences
            </Link>{" "}
            – which notifications you get, quiet hours, daily digest, push on this device
          </li>
          <li>
            <Link href="/security" className="text-primary underline">
              Sign-in security
            </Link>{" "}
            – password and two-step sign-in
          </li>
          <li>
            <Link href="/tokens" className="text-primary underline">
              My API tokens
            </Link>
          </li>
        </ul>
      </Section>
    </div>
  );
}
