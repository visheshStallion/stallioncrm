import "server-only";
import { verify } from "@node-rs/argon2";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { z } from "zod";
import { audit } from "@/server/db/audit";
import { findActiveUserIdByEmail, findUserForLogin, recordLoginFailure, recordLoginSuccess } from "@/server/db/system";
import { isRateLimited, rateLimit } from "@/server/rate-limit";
import { logger } from "@/server/log";
import { authConfig } from "./config";
import { LOCKOUT_MINUTES, MAX_FAILED_LOGINS, openSecret, passwordLoginAllowed, verifyTotp } from "./protection";

/** Shown to the user instead of the generic message (they reveal nothing an attacker does not know already). */
class AccountLocked extends CredentialsSignin {
  code = "locked";
}
class CodeRequired extends CredentialsSignin {
  code = "code_required";
}
class TooManyAttempts extends CredentialsSignin {
  code = "slow_down";
}

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
  code: z.string().trim().max(12).optional(),
});

function clientIp(request: Request | undefined): string | null {
  const fwd = request?.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || request?.headers.get("x-real-ip") || null;
}

const entraConfigured = !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: { label: "Email" }, password: { label: "Password", type: "password" }, code: { label: "Code" } },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) throw new CredentialsSignin();
        const { email, password, code } = parsed.data;
        const ip = clientIp(request);
        // Throttle guessing: FAILED attempts per address and per account (in-memory window; the lockout below is in the database).
        const WINDOW = 5 * 60_000;
        const keys = [[`login:ip:${ip ?? "unknown"}`, 30], [`login:email:${email}`, 10]] as const;
        if (keys.some(([k, n]) => isRateLimited(k, n, WINDOW))) throw new TooManyAttempts();
        const user = await findUserForLogin(email);
        const fail = async (reason: string) => {
          for (const [k, n] of keys) rateLimit(k, n, WINDOW);
          await audit({ action: "LOGIN_FAILED", entity: "User", entityId: user?.id ?? null, userId: user?.id, ip, after: { email, reason } });
        };
        if (!user?.active || user.isIntegration || !user.passwordHash || !passwordLoginAllowed(email)) {
          // unknown, inactive, integration or SSO-only account: indistinguishable from a wrong password
          if (user?.passwordHash) await verify(user.passwordHash, password).catch(() => false);
          await fail("not allowed");
          throw new CredentialsSignin();
        }
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          await fail("locked");
          throw new AccountLocked();
        }
        if (!(await verify(user.passwordHash, password).catch(() => false))) {
          const { locked } = await recordLoginFailure(user.id, MAX_FAILED_LOGINS, LOCKOUT_MINUTES);
          await fail(locked ? "wrong password – account locked" : "wrong password");
          throw locked ? new AccountLocked() : new CredentialsSignin();
        }
        // Two-step sign-in (TOTP) when the user switched it on.
        if (user.totpEnabledAt && user.totpSecret) {
          if (!code || !/[0-9]/.test(code)) throw new CodeRequired();
          const secret = openSecret(user.totpSecret);
          if (!secret || !verifyTotp(secret, code)) {
            const { locked } = await recordLoginFailure(user.id, MAX_FAILED_LOGINS, LOCKOUT_MINUTES);
            await fail(locked ? "wrong code – account locked" : "wrong code");
            throw locked ? new AccountLocked() : new CredentialsSignin();
          }
        }
        await recordLoginSuccess(user.id);
        await audit({ action: "LOGIN", entity: "User", entityId: user.id, userId: user.id, ip, after: user.totpEnabledAt ? { twoStep: true } : undefined });
        return { id: user.id };
      },
    }),
    ...(entraConfigured
      ? [
          MicrosoftEntraID({
            clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
            clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
            issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
          }),
        ]
      : []),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (account?.provider !== "microsoft-entra-id") return true;
      // SSO only for users that already exist and are active – no auto-provisioning.
      const email = (profile?.email ?? user.email ?? "").toString();
      const match = email ? await findActiveUserIdByEmail(email) : null;
      if (!match) {
        await audit({ action: "LOGIN_FAILED", entity: "User", after: { email, provider: "entra" } });
        return false;
      }
      return true;
    },
    async jwt({ token, user, account, profile }) {
      if (account?.provider === "microsoft-entra-id") {
        const email = (profile?.email ?? user?.email ?? "").toString();
        const match = await findActiveUserIdByEmail(email);
        if (!match) return {};
        await recordLoginSuccess(match.id);
        await audit({ action: "LOGIN", entity: "User", entityId: match.id, userId: match.id, after: { provider: "entra" } });
        return { sub: match.id };
      }
      return authConfig.callbacks.jwt({ token, user });
    },
  },
  events: {
    async signOut(message) {
      const sub = "token" in message ? message.token?.sub : undefined;
      if (sub) await audit({ action: "LOGOUT", entity: "User", entityId: sub, userId: sub });
    },
  },
  logger: {
    error: (error) => logger.warn({ err: error.message }, "auth error"),
    warn: (code) => logger.debug({ code }, "auth warning"),
  },
});
