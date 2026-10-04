import { describe, expect, it } from "vitest";
import { fieldMaskView, stripUneditable } from "@/server/access/field-mask";
import type { AccessContext } from "@/server/access/types";
import { base32Decode, base32Encode, newTotpSecret, openSecret, otpauthUri, passwordLoginAllowed, sealSecret, totpCode, verifyTotp } from "@/server/auth/protection";
import { buildEnvelope, parseDsn } from "@/server/error-tracking";

describe("TOTP (RFC 6238)", () => {
  // RFC 6238 appendix B, SHA-1, secret "12345678901234567890"; the last six digits of the 8-digit test values
  const secret = base32Encode(Buffer.from("12345678901234567890"));

  it("matches the RFC test vectors", () => {
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(totpCode(secret, 59_000)).toBe("287082");
    expect(totpCode(secret, 1_111_111_109_000)).toBe("081804");
    expect(totpCode(secret, 1_234_567_890_000)).toBe("005924");
    expect(totpCode(secret, 2_000_000_000_000)).toBe("279037");
  });

  it("accepts the current step and one step either side, nothing else", () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totpCode(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now + 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now - 90_000), now)).toBe(false);
    expect(verifyTotp(secret, "12345", now)).toBe(false);
    expect(verifyTotp(secret, "abcdef", now)).toBe(false);
    expect(verifyTotp(secret, ` ${totpCode(secret, now).slice(0, 3)} ${totpCode(secret, now).slice(3)} `, now)).toBe(true); // "123 456"
  });

  it("base32 round trip, new secrets and the authenticator link", () => {
    const s = newTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(s))).toBe(s);
    expect(otpauthUri(s, "ada@example.test")).toBe(`otpauth://totp/StallionCRM:ada%40example.test?secret=${s}&issuer=StallionCRM&algorithm=SHA1&digits=6&period=30`);
  });

  it("the stored secret is encrypted with a key derived from AUTH_SECRET", () => {
    process.env.AUTH_SECRET = "unit-test-secret-1";
    const sealed = sealSecret(secret);
    expect(sealed).not.toContain(secret);
    expect(openSecret(sealed)).toBe(secret);
    expect(sealSecret(secret)).not.toBe(sealed); // random nonce
    process.env.AUTH_SECRET = "another-secret";
    expect(openSecret(sealed)).toBeNull(); // useless without the key
    expect(openSecret("garbage")).toBeNull();
  });

  it("SSO-only mode leaves password sign-in to the listed break-glass accounts", () => {
    delete process.env.AUTH_SSO_ONLY;
    expect(passwordLoginAllowed("anyone@example.test")).toBe(true);
    process.env.AUTH_SSO_ONLY = "1";
    process.env.AUTH_PASSWORD_LOGIN_ALLOW = "Admin@Example.test, ops@example.test";
    expect(passwordLoginAllowed("admin@example.test")).toBe(true);
    expect(passwordLoginAllowed("exec@example.test")).toBe(false);
    delete process.env.AUTH_SSO_ONLY;
    delete process.env.AUTH_PASSWORD_LOGIN_ALLOW;
  });
});

describe("field-level security helpers", () => {
  const ctx = { profile: { fieldPermissions: { deals: { amount: "hidden", vinChassisNo: "masked", closeDate: "read", name: "edit" } } } } as unknown as AccessContext;
  const open = { profile: { fieldPermissions: {} } } as unknown as AccessContext;

  it("screens: hidden fields become null, masked ones are obscured, the record keeps its shape", () => {
    const deal = { id: "d1", name: "Deal", amount: 30_000_000, vinChassisNo: "1M8GDM9AXKP042788", closeDate: "2026-12-01" };
    const view = fieldMaskView(ctx, "deals", deal);
    expect(view).toMatchObject({ id: "d1", name: "Deal", amount: null, closeDate: "2026-12-01" });
    expect(view.vinChassisNo).not.toBe(deal.vinChassisNo);
    expect(Object.keys(view)).toEqual(Object.keys(deal));
    expect(fieldMaskView(open, "deals", deal)).toBe(deal);
  });

  it("writes: anything that is not editable is dropped from an update", () => {
    expect(stripUneditable(ctx, "deals", { name: "New", amount: 1, vinChassisNo: "X", closeDate: "2027-01-01", colour: "Red" })).toEqual({ name: "New", colour: "Red" });
    const input = { amount: 5 };
    expect(stripUneditable(open, "deals", input)).toBe(input);
  });
});

describe("error tracking", () => {
  it("parses a Sentry-compatible DSN and builds an envelope without request data", () => {
    expect(parseDsn("https://abc123@errors.example.test/42")).toEqual({ url: "https://errors.example.test/api/42/envelope/", key: "abc123" });
    expect(parseDsn(undefined)).toBeNull();
    expect(parseDsn("not a url")).toBeNull();
    expect(parseDsn("https://errors.example.test/42")).toBeNull(); // no key
    const [header, item, event] = buildEnvelope(new TypeError("boom"), { route: "/api/v1/deals", method: "GET", empty: undefined }, "https://abc123@errors.example.test/42", new Date("2026-10-05T00:00:00Z")).split("\n").map((l) => JSON.parse(l));
    expect(header.dsn).toContain("errors.example.test");
    expect(item).toEqual({ type: "event" });
    expect(event.exception.values[0]).toMatchObject({ type: "TypeError", value: "boom" });
    expect(event.tags).toEqual({ route: "/api/v1/deals", method: "GET" });
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(event)).not.toMatch(/cookie|authorization|password/i);
  });
});
