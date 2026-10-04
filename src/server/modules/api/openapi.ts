/**
 * OpenAPI 3.1 document of the REST API (prompt 13), generated from the same Zod schemas the services validate
 * with – the request bodies in the document cannot drift from what the API accepts. Served at /api/v1/docs.
 */
import "server-only";
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { EVENTS } from "@/server/integrations/events";
import { activitySchema } from "@/server/modules/activities/schema";
import { createCaseSchema, updateCaseSchema } from "@/server/modules/cases/schema";
import { productSchema } from "@/server/modules/catalogue/schema";
import { accountSchema, contactSchema } from "@/server/modules/customers/schema";
import { createDealSchema, updateDealSchema } from "@/server/modules/deals/schema";
import { paymentSchema, saveSchema } from "@/server/modules/documents/config";
import { createLeadSchema, updateLeadSchema } from "@/server/modules/leads/schema";

interface Resource {
  path: string;
  tag: string;
  create?: ZodTypeAny;
  update?: ZodTypeAny;
  remove?: boolean;
  filters?: string[];
  note?: string;
}

const RESOURCES: Resource[] = [
  { path: "leads", tag: "Leads", create: createLeadSchema, update: updateLeadSchema, remove: true, filters: ["status", "source", "brandId", "regionId", "ownerId", "from", "to", "q"] },
  { path: "deals", tag: "Deals", create: createDealSchema, update: updateDealSchema, remove: true, filters: ["brandId", "regionId", "pipelineId", "ownerId", "q", "f", "sort"] },
  { path: "accounts", tag: "Accounts", create: accountSchema, update: accountSchema, remove: true, filters: ["q"], note: "Shared between brands; contact details are masked for users without a relationship to the customer." },
  { path: "contacts", tag: "Contacts", create: contactSchema, update: contactSchema, remove: true, filters: ["q"] },
  { path: "activities", tag: "Activities", create: activitySchema, update: activitySchema, remove: true, filters: ["type", "status", "ownerId", "from", "to"] },
  { path: "cases", tag: "Cases", create: createCaseSchema, update: updateCaseSchema, remove: true, filters: ["queue", "q", "brandId", "regionId"] },
  { path: "products", tag: "Products", create: productSchema, update: productSchema, filters: ["brandId", "q"] },
  { path: "quotes", tag: "Quotes", update: saveSchema, filters: ["brandId", "regionId", "status", "dealId", "q"], note: "Created with POST { dealId }. Only drafts can be changed; totals are computed by the server." },
  { path: "salesOrders", tag: "Sales orders", update: saveSchema, filters: ["brandId", "regionId", "status", "dealId", "q"], note: "Created by converting an accepted quote." },
  { path: "invoices", tag: "Invoices", update: saveSchema, filters: ["brandId", "regionId", "status", "dealId", "q"], note: "Created by converting a sales order." },
];

const jsonSchema = (schema: ZodTypeAny) => {
  const { $schema: _dialect, ...rest } = zodToJsonSchema(schema, { $refStrategy: "none", target: "jsonSchema2019-09", effectStrategy: "input" }) as Record<string, unknown>;
  return rest;
};
const json = (schema: unknown) => ({ content: { "application/json": { schema } } });
const errorRef = { $ref: "#/components/schemas/Error" };
const errors = {
  "400": { description: "Validation failed", ...json(errorRef) },
  "401": { description: "Missing, invalid, expired or revoked token", ...json(errorRef) },
  "403": { description: "The token's profile does not allow this action", ...json(errorRef) },
  "404": { description: "Not found – also returned for records outside the token's brands and territories", ...json(errorRef) },
  "429": { description: "Rate limit of the token exceeded (see Retry-After)", ...json(errorRef) },
};
const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } };
const query = (name: string, description?: string) => ({ name, in: "query", required: false, schema: { type: "string" }, ...(description ? { description } : {}) });
const record = { type: "object", additionalProperties: true, description: "The record as the caller may see it (hidden fields are absent, masked fields are partially obscured)." };

export function openApiDocument(baseUrl: string) {
  const paths: Record<string, unknown> = {};
  const schemas: Record<string, unknown> = {
    Error: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, issues: {} } } } },
    ListMeta: { type: "object", properties: { total: { type: "integer" }, page: { type: "integer" }, per: { type: "integer" }, nextCursor: { type: ["string", "null"], description: "Pass as `cursor` to read the next page; null on the last page." } } },
    Payment: jsonSchema(paymentSchema),
  };
  for (const r of RESOURCES) {
    const name = r.tag.replace(/\s+/g, "");
    if (r.create) schemas[`${name}Create`] = jsonSchema(r.create);
    if (r.update) schemas[`${name}Update`] = jsonSchema(r.update);
    const ref = (kind: "Create" | "Update") => ({ $ref: `#/components/schemas/${name}${kind}` });
    paths[`/${r.path}`] = {
      get: {
        tags: [r.tag],
        summary: `List ${r.tag.toLowerCase()} in the caller's scope`,
        description: r.note,
        parameters: [query("cursor", "Opaque cursor from `meta.nextCursor`"), query("limit", "1–200, default 50 (with cursor paging)"), query("page"), query("per"), ...(r.filters ?? []).map((f) => query(f))],
        responses: { "200": { description: "A page of records", ...json({ type: "object", properties: { data: { type: "array", items: record }, meta: { $ref: "#/components/schemas/ListMeta" } } }) }, ...errors },
      },
      ...(r.create || r.path === "quotes"
        ? {
            post: {
              tags: [r.tag],
              summary: `Create ${r.tag.toLowerCase()}`,
              parameters: [{ name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 200 }, description: "Replays the first response for 24 hours instead of creating a duplicate." }],
              requestBody: { required: true, ...json(r.create ? ref("Create") : { type: "object", required: ["dealId"], properties: { dealId: { type: "string" } } }) },
              responses: { "201": { description: "Created", ...json({ type: "object", properties: { data: record } }) }, ...errors },
            },
          }
        : {}),
    };
    paths[`/${r.path}/{id}`] = {
      get: { tags: [r.tag], summary: "Get one record", parameters: [idParam], responses: { "200": { description: "The record", ...json({ type: "object", properties: { data: record } }) }, ...errors } },
      ...(r.update ? { patch: { tags: [r.tag], summary: "Update", parameters: [idParam], requestBody: { required: true, ...json(ref("Update")) }, responses: { "200": { description: "Updated", ...json({ type: "object", properties: { data: record } }) }, ...errors } } } : {}),
      ...(r.remove ? { delete: { tags: [r.tag], summary: "Soft delete (needs the delete permission)", parameters: [idParam], responses: { "204": { description: "Deleted" }, ...errors } } } : {}),
    };
  }
  paths["/invoices/{id}/payment-links"] = {
    post: {
      tags: ["Invoices"],
      summary: "Create an online payment link (Paystack / Flutterwave) for the balance or a deposit",
      parameters: [idParam],
      requestBody: { required: false, ...json({ type: "object", properties: { provider: { type: "string", enum: ["paystack", "flutterwave"] }, amount: { type: "number" }, email: { type: "string", format: "email" } } }) },
      responses: { "201": { description: "The link", ...json({ type: "object", properties: { data: { type: "object", properties: { url: { type: "string" }, reference: { type: "string" }, amount: { type: "number" }, provider: { type: "string" } } } } }) }, ...errors },
    },
  };
  paths["/me"] = { get: { tags: ["Session"], summary: "The principal behind the token: user, profile, brands", responses: { "200": { description: "Principal", ...json(record) }, ...errors } } };

  return {
    openapi: "3.1.0",
    info: {
      title: "StallionCRM API",
      version: "1.0.0",
      description: [
        "REST API of StallionCRM. Every token belongs to a user or an integration principal with its own profile and territories: the API returns exactly what that principal sees in the application – the same brand isolation, permissions and field masks. Records of other brands answer 404.",
        "",
        "**Authentication** – `Authorization: Bearer scrm_…` with a personal access token (My API tokens), an integration token (Setup → API & integrations) or an OAuth2 access token from the client-credentials grant (`POST /api/public/oauth/token`).",
        "",
        "**Webhooks** – subscribe in Setup → Webhooks. Events: " + EVENTS.map((e) => `\`${e}\``).join(", ") + ". Each delivery carries `X-Stallion-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of \"<t>.<raw body>\" with the subscription secret>`.",
      ].join("\n"),
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    security: [{ bearer: [] }, { oauth2: [] }],
    tags: [...RESOURCES.map((r) => ({ name: r.tag })), { name: "Session" }],
    paths,
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "Personal access token or integration token" },
        oauth2: { type: "oauth2", flows: { clientCredentials: { tokenUrl: `${baseUrl}/api/public/oauth/token`, scopes: {} } } },
      },
      schemas,
    },
  };
}
