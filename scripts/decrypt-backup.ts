/**
 * Decrypts a full backup export:  pnpm backup:decrypt <backup.zip.enc> <out.zip>
 * The passphrase is read from BACKUP_PASSPHRASE or asked on the terminal (never passed as an argument).
 */
import fs from "node:fs";
import readline from "node:readline";
import { decryptBackup } from "../src/lib/backup-crypto";

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error("usage: pnpm backup:decrypt <backup.zip.enc> <out.zip>");
  let passphrase = process.env.BACKUP_PASSPHRASE ?? "";
  if (!passphrase) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    passphrase = await new Promise<string>((resolve) => rl.question("Passphrase: ", (a) => (rl.close(), resolve(a))));
  }
  fs.writeFileSync(output, decryptBackup(fs.readFileSync(input), passphrase));
  console.error(`Decrypted to ${output}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
