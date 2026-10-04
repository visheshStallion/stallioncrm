/**
 * API authentication (prompt 13): personal access tokens, integration principals and OAuth2 client credentials.
 *
 * Every token resolves to a USER – a person, or an integration principal (a user flagged `isIntegration` with
 * its own profile and territories) – and the request then runs with that user's access context: the same
 * `scopedDb`, `can()` and field masks as the UI. A token may additionally be narrowed to some brands; it can
 * never widen what its user may see.
 */
import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { loadAccessContext } from "@/server/access/context";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import * as store from "@/server/db/api-store";
import { BadRequestError, RateLimitError } from "@/server/errors";
import { createUser } from "@/server/modules/admin/service";
import { rateLimit } from "@/server/rate-limit";

export const TOKEN_PREFIX = "scrm_";
const OAUTH_TTL_SEC = 3600;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newSecret = (prefix: string) => `${prefix}${randomBytes(30).toString("base64url")}`;

/**
 * Pure: narrows a context to the given brands. A scope-ALL user restricted to brands becomes a territory-scoped
 * context with brand-level memberships (and loses administrator rights – setup spans all brands).
 */
export function restrictToBrands(ctx: AccessContext, brandIds: string[]): AccessContext {
  if (brandIds.length === 0) return ctx;
  const allowed = ctx.brandIds.filter((b) => brandIds.includes(b));
  const memberships =
    ctx.scope === "ALL"
      ? allowed.map((brandId) => ({ territoryId: `token:${brandId}`, brandId, regionId: null, isManager: false }))
      : ctx.memberships.filter((m) => allowed.includes(m.brandId));
  return { ...ctx, scope: "TERRITORY", memberships, brandIds: allowed, isAdmin: false };
}

/** Resolves a bearer token to an access context. 401 for unknown / revoked / expired tokens, 429 over the limit. */
export async function authenticateToken(raw: string): Promise<AccessContext> {
  if (!raw.startsWith(TOKEN_PREFIX) || raw.length > 200) throw new UnauthenticatedError("Invalid API token");
  const token = await store.findTokenByHash(sha256(raw));
  const now = new Date();
  if (!token || token.revokedAt || (token.expiresAt && token.expiresAt <= now)) throw new UnauthenticatedError("Invalid API token");
  const limit = rateLimit(`api:${token.id}`, token.rateLimit, 60_000);
  if (!limit.ok) throw new RateLimitError(limit.retryAfterSec);
  const ctx = await loadAccessContext(token.userId);
  if (!ctx) throw new UnauthenticatedError("Invalid API token"); // user deactivated
  await store.touchToken(token.id, now);
  return { ...restrictToBrands(ctx, token.brandIds), tokenId: token.id };
}

// ───────────────────────────── token management ─────────────────────────────

const tokenInput = z.object({
  name: z.string().trim().min(2, "Name the token").max(80),
  brandIds: z.array(z.string().max(40)).max(20).default([]),
  expiresInDays: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), z.coerce.number().int().min(1).max(3650).nullable()),
  rateLimit: z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), z.coerce.number().int().min(1).max(6000).optional()),
});

function assertInteractive(ctx: AccessContext) {
  if (ctx.tokenId || ctx.system) throw new ForbiddenError("Tokens are managed in the application, not through the API");
}
function assertAdmin(ctx: AccessContext) {
  if (!ctx.isAdmin) throw new NotFoundError();
}

async function issue(ctx: AccessContext, kind: "PERSONAL" | "INTEGRATION", userId: string, input: unknown, visibleBrands: string[]) {
  const data = tokenInput.parse(input);
  const outside = data.brandIds.filter((b) => !visibleBrands.includes(b));
  if (outside.length) throw new BadRequestError("A token can only be limited to brands its user can see");
  const raw = newSecret(TOKEN_PREFIX);
  const row = await store.insertToken({
    name: data.name,
    kind,
    prefix: raw.slice(0, 12),
    tokenHash: sha256(raw),
    userId,
    brandIds: data.brandIds,
    rateLimit: data.rateLimit ?? (kind === "INTEGRATION" ? 300 : 120),
    expiresAt: data.expiresInDays ? new Date(Date.now() + data.expiresInDays * 86_400_000) : null,
    createdById: ctx.userId,
  });
  await audit({ ctx, action: "CREATE", entity: "ApiToken", entityId: row.id, after: { name: row.name, kind, userId, brandIds: row.brandIds, expiresAt: row.expiresAt } });
  /** the raw token is returned once and never stored */
  return { id: row.id, token: raw };
}

/** A personal token acts as the signed-in user. */
export async function createPersonalToken(ctx: AccessContext, input: unknown) {
  assertInteractive(ctx);
  return issue(ctx, "PERSONAL", ctx.userId, input, ctx.brandIds);
}

/** A token for an integration principal – administrators only. */
export async function createIntegrationToken(ctx: AccessContext, principalId: string, input: unknown) {
  assertInteractive(ctx);
  assertAdmin(ctx);
  const principal = await principalContext(principalId);
  return issue(ctx, "INTEGRATION", principalId, input, principal.brandIds);
}

async function principalContext(userId: string): Promise<AccessContext> {
  const user = await store.userKind(userId);
  if (!user?.isIntegration) throw new BadRequestError("Choose an integration principal");
  const ctx = await loadAccessContext(userId);
  if (!ctx) throw new BadRequestError("This integration principal is inactive");
  return ctx;
}

export async function listMyTokens(ctx: AccessContext) {
  return store.listTokens(ctx.userId);
}

export async function listAllTokens(ctx: AccessContext) {
  assertAdmin(ctx);
  const tokens = await store.listTokens();
  const users = await scopedDb(ctx).user.findMany({ where: { id: { in: [...new Set(tokens.map((t) => t.userId))] } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return tokens.map((t) => ({ ...t, userName: name.get(t.userId) ?? "—" }));
}

/** Revocation by the token's user or an administrator. */
export async function revokeToken(ctx: AccessContext, id: string) {
  assertInteractive(ctx);
  const token = await store.getToken(id);
  if (!token || (token.userId !== ctx.userId && !ctx.isAdmin)) throw new NotFoundError();
  await store.revokeToken(id);
  await audit({ ctx, action: "DELETE", entity: "ApiToken", entityId: id, before: { name: token.name, userId: token.userId } });
}

// ───────────────────────────── integration principals ─────────────────────────────

const principalInput = z.object({
  name: z.string().trim().min(2).max(100),
  roleId: z.string().min(1, "Choose a role"),
  profileId: z.string().min(1, "Choose a profile"),
  brandIds: z.array(z.string().max(40)).min(1, "Choose at least one brand").max(20),
});

/**
 * An integration principal is a user that cannot sign in: no password, a non-routable address. It gets the
 * chosen profile and the brand-level territory of each chosen brand, so it sees exactly those brands.
 */
export async function createPrincipal(ctx: AccessContext, input: unknown) {
  assertInteractive(ctx);
  assertAdmin(ctx);
  const data = principalInput.parse(input);
  const territories = await store.brandLevelTerritories(data.brandIds);
  if (territories.length !== data.brandIds.length) throw new BadRequestError("Unknown brand");
  const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "integration";
  const user = await createUser(ctx, { name: data.name, email: `${slug}-${randomBytes(4).toString("hex")}@integration.invalid`, roleId: data.roleId, profileId: data.profileId, managerId: null, password: null }, territories.map((t) => t.id));
  await store.markIntegration(user.id);
  return { id: user.id };
}

export async function listPrincipals(ctx: AccessContext) {
  assertAdmin(ctx);
  return store.listPrincipals();
}

// ───────────────────────────── OAuth2 client credentials ─────────────────────────────

const clientInput = z.object({
  name: z.string().trim().min(2).max(80),
  userId: z.string().min(1, "Choose an integration principal"),
  brandIds: z.array(z.string().max(40)).max(20).default([]),
  rateLimit: z.preprocess((v) => (v === "" || v === null || v === undefined ? 300 : v), z.coerce.number().int().min(1).max(6000)),
});

export async function createClient(ctx: AccessContext, input: unknown) {
  assertInteractive(ctx);
  assertAdmin(ctx);
  const data = clientInput.parse(input);
  const principal = await principalContext(data.userId);
  if (data.brandIds.some((b) => !principal.brandIds.includes(b))) throw new BadRequestError("A client can only be limited to brands its principal can see");
  const clientId = `scrm_client_${randomBytes(9).toString("hex")}`;
  const secret = newSecret("scrm_secret_");
  const row = await store.insertClient({ name: data.name, clientId, secretHash: sha256(secret), userId: data.userId, brandIds: data.brandIds, rateLimit: data.rateLimit, createdById: ctx.userId });
  await audit({ ctx, action: "CREATE", entity: "OAuthClient", entityId: row.id, after: { name: row.name, clientId, userId: row.userId, brandIds: row.brandIds } });
  return { id: row.id, clientId, clientSecret: secret };
}

export async function listClients(ctx: AccessContext) {
  assertAdmin(ctx);
  return store.listClients();
}

export async function setClientActive(ctx: AccessContext, id: string, active: boolean) {
  assertInteractive(ctx);
  assertAdmin(ctx);
  const client = await store.setClientActive(id, active);
  await audit({ ctx, action: "UPDATE", entity: "OAuthClient", entityId: id, after: { active, clientId: client.clientId } });
}

/** RFC 6749 §4.4: exchanges client credentials for a short-lived access token. */
export async function issueClientToken(clientId: string, clientSecret: string) {
  const limit = rateLimit(`oauth:${clientId.slice(0, 80)}`, 30, 60_000);
  if (!limit.ok) throw new RateLimitError(limit.retryAfterSec);
  const client = await store.findClient(clientId);
  const given = Buffer.from(sha256(clientSecret));
  const expected = Buffer.from(client?.secretHash ?? sha256(""));
  if (!client || !client.active || !timingSafeEqual(given, expected)) throw new UnauthenticatedError("invalid_client");
  const user = await store.userKind(client.userId);
  if (!user?.active) throw new UnauthenticatedError("invalid_client");
  const raw = newSecret(TOKEN_PREFIX);
  await store.insertToken({ name: client.name, kind: "OAUTH", prefix: raw.slice(0, 12), tokenHash: sha256(raw), userId: client.userId, brandIds: client.brandIds, rateLimit: client.rateLimit, clientId: client.clientId, expiresAt: new Date(Date.now() + OAUTH_TTL_SEC * 1000) });
  return { access_token: raw, token_type: "Bearer", expires_in: OAUTH_TTL_SEC };
}
