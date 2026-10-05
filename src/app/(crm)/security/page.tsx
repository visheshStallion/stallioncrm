import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { SecretForm } from "@/components/crm/SecretForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmTwoStepAction, disableTwoStepAction, startTwoStepAction } from "@/server/modules/security/actions";
import { twoStepStatus } from "@/server/modules/security/service";
import { changeOwnPasswordAction } from "@/server/modules/setup/actions";
import { getSetting } from "@/server/modules/setup/service";
import { requireContext, securityRequirement } from "@/server/request";

export const metadata = { title: "Sign-in security" };

/** The signed-in user's own sign-in security: two-step sign-in with an authenticator app. */
export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const ctx = await requireContext();
  const [status, need, policy] = await Promise.all([twoStepStatus(ctx), securityRequirement(ctx), getSetting("passwordPolicy")]);
  const { required } = await searchParams;
  const rules = [
    `at least ${policy.minLength} characters`,
    policy.requireUpper ? "an upper-case letter" : null,
    policy.requireLower ? "a lower-case letter" : null,
    policy.requireDigit ? "a digit" : null,
    policy.requireSymbol ? "a symbol" : null,
    policy.history ? `not one of your last ${policy.history} password(s)` : null,
  ].filter(Boolean);
  const code = (
    <div className="space-y-1">
      <Label htmlFor="code">6-digit code from the app</Label>
      <Input id="code" name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={7} className="w-40" />
    </div>
  );
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitleRow title="Sign-in security" left={<span className="text-[13px] text-text-muted">{ctx.user.email}</span>} />
      {need ? (
        <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm" data-testid="security-required">
          {need === "two-step"
            ? "Your organisation requires two-step sign-in for your profile. Set it up below – until then the rest of the CRM stays closed."
            : "Your password has expired. Choose a new one below – until then the rest of the CRM stays closed."}
        </p>
      ) : required ? (
        <p role="status" className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
          Done – nothing more is required.{" "}
          <Link href="/" className="font-bold text-primary underline">
            Continue to the CRM
          </Link>
        </p>
      ) : null}
      <section className="rounded-lg border border-border bg-surface p-4 text-[13px]" data-testid="two-step">
        <h2 className="mb-2 flex items-center gap-2 font-semibold">
          Two-step sign-in <StatusPill tone={status.enabled ? "success" : "neutral"}>{status.enabled ? "On" : "Off"}</StatusPill>
        </h2>
        <p className="mb-3 text-text-muted">With two-step sign-in a password alone is not enough: you also enter a code from an authenticator app (Microsoft Authenticator, Google Authenticator, Authy …).</p>
        {status.enabled ? (
          <ActionForm action={disableTwoStepAction} confirm="Switch two-step sign-in off?" className="flex items-end gap-2">
            {code}
            <SubmitButton variant="outline">Switch off</SubmitButton>
          </ActionForm>
        ) : (
          <div className="space-y-4">
            <SecretForm action={startTwoStepAction as never}>
              <SubmitButton variant={status.pending ? "outline" : "default"}>{status.pending ? "Start again with a new key" : "Set up two-step sign-in"}</SubmitButton>
            </SecretForm>
            {status.pending ? (
              <ActionForm action={confirmTwoStepAction} className="flex items-end gap-2 border-t border-border pt-3">
                {code}
                <SubmitButton>Confirm and switch on</SubmitButton>
              </ActionForm>
            ) : null}
          </div>
        )}
        <p className="mt-3 text-xs text-text-muted">Lost the phone? An administrator can reset two-step sign-in for you. After five wrong passwords or codes the account is locked for 15 minutes.</p>
      </section>
      <section className="rounded-lg border border-border bg-surface p-4 text-[13px]" data-testid="change-password">
        <h2 className="mb-2 font-semibold">Password</h2>
        <p className="mb-3 text-text-muted">A new password needs: {rules.join(", ")}.{policy.expiryDays ? ` It expires after ${policy.expiryDays} days.` : ""}</p>
        <ActionForm action={changeOwnPasswordAction} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="current">Current password</Label>
            <Input id="current" name="current" type="password" required autoComplete="current-password" className="w-56" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="next">New password</Label>
            <Input id="next" name="next" type="password" required autoComplete="new-password" className="w-56" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="repeat">New password again</Label>
            <Input id="repeat" name="repeat" type="password" required autoComplete="new-password" className="w-56" />
          </div>
          <SubmitButton variant="outline">Change password</SubmitButton>
        </ActionForm>
      </section>
      <p className="text-[13px]">
        <Link href="/setup/personal" className="text-primary underline">
          Personal settings
        </Link>
        {" · "}
        <Link href="/tokens" className="text-primary underline">
          My API tokens
        </Link>
      </p>
    </div>
  );
}
