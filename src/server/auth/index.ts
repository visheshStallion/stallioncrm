import "server-only";
import { verify } from "@node-rs/argon2";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { z } from "zod";
import { audit } from "@/server/db/audit";
import { findActiveUserIdByEmail, findUserForLogin } from "@/server/db/system";
import { logger } from "@/server/log";
import { authConfig } from "./config";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
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
      credentials: { email: { label: "Email" }, password: { label: "Password", type: "password" } },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) throw new CredentialsSignin();
        const { email, password } = parsed.data;
        const ip = clientIp(request);
        const user = await findUserForLogin(email);
        const ok =
          !!user?.active && !!user.passwordHash && (await verify(user.passwordHash, password).catch(() => false));
        if (!ok || !user) {
          await audit({ action: "LOGIN_FAILED", entity: "User", entityId: user?.id ?? null, userId: user?.id, ip, after: { email } });
          throw new CredentialsSignin();
        }
        await audit({ action: "LOGIN", entity: "User", entityId: user.id, userId: user.id, ip });
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
