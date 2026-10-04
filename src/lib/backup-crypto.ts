/**
 * Encryption of the administrator's full backup export (prompt 12): AES-256-GCM with a key derived from a
 * passphrase by scrypt. File layout (all binary):
 *
 *   "SCRMBK1\n" (8 bytes) · salt (16) · iv (12) · auth tag (16) · ciphertext (the zip)
 *
 * Decrypt with `pnpm backup:decrypt <file> <out.zip>` (scripts/decrypt-backup.ts) and the passphrase. Standard
 * ZIP encryption is deliberately not used: ZipCrypto is broken and AES-zip needs a third-party tool anyway.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const MAGIC = Buffer.from("SCRMBK1\n", "latin1");
const KEY_LENGTH = 32;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

export const MIN_PASSPHRASE = 12;

export function encryptBackup(plain: Uint8Array, passphrase: string): Uint8Array {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error(`The passphrase needs at least ${MIN_PASSPHRASE} characters`);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", scryptSync(passphrase, salt, KEY_LENGTH, SCRYPT), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

/** Throws when the passphrase is wrong or the file was modified (GCM authentication). */
export function decryptBackup(file: Uint8Array, passphrase: string): Uint8Array {
  const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (buf.length < 52 || !buf.subarray(0, 8).equals(MAGIC)) throw new Error("Not a StallionCRM backup file");
  const salt = buf.subarray(8, 24);
  const iv = buf.subarray(24, 36);
  const tag = buf.subarray(36, 52);
  const decipher = createDecipheriv("aes-256-gcm", scryptSync(passphrase, salt, KEY_LENGTH, SCRYPT), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(buf.subarray(52)), decipher.final()]);
  } catch {
    throw new Error("Wrong passphrase or damaged backup file");
  }
}
