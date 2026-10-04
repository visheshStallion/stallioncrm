/**
 * Sign-in protection (prompt 15): lockout rules and TOTP two-step sign-in (RFC 6238, SHA-1, 6 digits, 30 s –
 * what authenticator apps expect). No third-party library: Node's crypto only.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

/** The 6-digit code of a 30-second step. */
export function totpCode(secret: string, atMs = Date.now(), step = 0): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000) + step));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const code = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(code % 1_000_000).padStart(6, "0");
}

/** Accepts the current step and one step either side (clock drift). Constant-time comparison. */
export function verifyTotp(secret: string, code: string, atMs = Date.now()): boolean {
  const given = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return false;
  let ok = false;
  for (const step of [-1, 0, 1]) {
    if (timingSafeEqual(Buffer.from(totpCode(secret, atMs, step)), Buffer.from(given))) ok = true;
  }
  return ok;
}

export const otpauthUri = (secret: string, account: string, issuer = "StallionCRM") => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// The secret is stored encrypted (AES-256-GCM) with a key derived from AUTH_SECRET: a database dump alone
// does not yield working authenticator secrets.
const key = () => createHash("sha256").update(`totp:${process.env.AUTH_SECRET ?? ""}`).digest();

export function sealSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function openSecret(sealed: string): string | null {
  try {
    const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key(), iv!);
    decipher.setAuthTag(tag!);
    return Buffer.concat([decipher.update(body!), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Password sign-in allowed for this address? With AUTH_SSO_ONLY=1 only the listed break-glass accounts. */
export function passwordLoginAllowed(email: string): boolean {
  if (process.env.AUTH_SSO_ONLY !== "1") return true;
  return (process.env.AUTH_PASSWORD_LOGIN_ALLOW ?? "").toLowerCase().split(/[\s,;]+/).filter(Boolean).includes(email.toLowerCase());
}
