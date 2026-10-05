import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireSetup } from "../guard";
import { Section, SetupHeader } from "../_components";

export const metadata = { title: "Data Backup" };

export default async function BackupPage() {
  const { entry } = await requireSetup("data-backup"); // setupPermission: SA
  return (
    <div>
      <SetupHeader entry={entry} />
      <Section
        title="Full backup (all brands)"
        hint="One CSV per table in a zip, encrypted with AES-256-GCM from your passphrase. The passphrase is not stored – without it the file cannot be opened. Decrypt with: pnpm backup:decrypt. The download is recorded in the audit log."
        testId="backup"
      >
        <form method="post" action="/api/v1/admin/backup" className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="passphrase">Passphrase (at least 12 characters)</Label>
            <Input id="passphrase" name="passphrase" type="password" required minLength={12} autoComplete="new-password" className="w-72" />
          </div>
          <Button type="submit">Download backup</Button>
        </form>
      </Section>
    </div>
  );
}
