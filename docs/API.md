# StallionCRM API, webhooks & integrations

The machine-readable description is the OpenAPI 3.1 document at **`/api/v1/docs`** (generated from the same Zod
schemas the server validates with). This page explains the concepts around it.

## 1. Principals and brand isolation

Every request runs as a **principal** and sees exactly what that principal sees in the application: the same
brand and territory isolation (enforced again by PostgreSQL row-level security), the same profile permissions
and the same field masks. A record outside the principal's brands answers **404**, never 403 – its existence is
not revealed.

| Credential | Acts as | Created in |
|---|---|---|
| Personal access token | the user who created it | avatar menu → *My API tokens* |
| Integration token | an **integration principal** – a user that cannot sign in, with its own profile and brand territories | Setup → Developer Space → *API & integrations* (administrators) |
| OAuth2 access token | the integration principal of the OAuth client | client-credentials grant, see below |

A token can additionally be **limited to brands**. That only ever narrows: a token of the Managing Director
limited to SNMNL sees SNMNL only (and has no administrator rights); a brand the user cannot see cannot be added.

Only the SHA-256 hash of a token is stored; the token is shown once. Tokens can expire, are revoked by their
user or an administrator, and stop working when the user is deactivated.

```bash
curl -H "Authorization: Bearer scrm_…" https://crm.example.com/api/v1/deals?limit=50
```

### OAuth2 client credentials

```bash
curl -X POST https://crm.example.com/api/public/oauth/token \
  -d grant_type=client_credentials -d client_id=scrm_client_… -d client_secret=scrm_secret_…
# → { "access_token": "scrm_…", "token_type": "Bearer", "expires_in": 3600 }
```

HTTP Basic authentication for the client is accepted as well. Disabling a client revokes its access tokens.

## 2. Conventions

- **Resources**: `leads`, `deals`, `accounts`, `contacts`, `activities`, `cases`, `products`, `priceBooks`,
  `quotes`, `salesOrders`, `invoices`, plus `reports`, `campaigns`, `search`, `me`.
  `GET /{resource}` (list), `GET /{resource}/{id}`, `POST`, `PATCH`, `DELETE` (soft delete, where offered).
- **Paging**: `?limit=1…200&cursor=<meta.nextCursor>`; `meta.nextCursor` is `null` on the last page. The cursor is
  opaque. `page` / `per` still work.
- **Filtering**: the list filters of the application (`brandId`, `regionId`, `ownerId`, `status`, `q`, and
  `f=field~op~value` on deals). Filters only narrow the principal's scope.
- **Sorting**: `?sort=amount|-amount|closeDate|-closeDate|createdAt|-createdAt|name|-name` on deals; other lists
  have a fixed order (newest first).
- **Errors**: `{ "error": { "code", "message", "issues?" } }` with 400 (validation), 401, 403, 404, 409 (record
  locked by a pending approval), 422 (idempotency key reused with another body), 429.
- **Rate limit**: per token (default 120 requests/minute for personal, 300 for integration tokens; set per
  token). `429` carries `Retry-After`. The limiter is per server process – behind several instances put a shared
  limiter (API gateway) in front.
- **Idempotency**: send `Idempotency-Key: <unique string>` with a `POST`. The first successful response is stored
  for 24 hours and replayed (`Idempotent-Replay: true`) instead of creating a duplicate.
- **Audit**: every write is in the audit log under the principal (integration principals are distinct users, so
  their writes are attributable).
- **Soft delete**: `DELETE` sets `deletedAt`; needs the profile's delete permission. Quotes, orders and invoices
  cannot be deleted (gap-free numbering) – void or cancel them.

## 3. Webhooks (outbound)

Setup → Developer Space → *Webhooks*. A subscription has a URL (https, public address), a list of events, an
optional brand filter and a **principal**.

Events: `lead.created`, `deal.created`, `deal.stage_changed`, `quote.approved`, `salesorder.confirmed`,
`invoice.issued`, `invoice.paid`, `case.created`, `case.resolved`.

```json
{ "id": "<delivery id>", "event": "deal.stage_changed", "createdAt": "2026-10-05T09:12:00.000Z",
  "brandId": "…", "entity": "Deal", "data": { "id": "…", "name": "…", "stageName": "Quotation", "…": "…" } }
```

- `data` is the record **as the subscription's principal sees it through the API**: fields hidden for its
  profile are absent, masked fields are masked. A record the principal cannot see is not delivered at all (the
  delivery log shows *Skipped*).
- **Signature**: `X-Stallion-Signature: t=<unix seconds>,v1=<hex>` where `v1 = HMAC-SHA256(secret, "<t>.<raw body>")`.
  Verify it with the signing secret shown when the subscription was created, and reject old timestamps.
- **Retries**: a non-2xx answer or a timeout (10 s) is retried with exponential back-off (1, 2, 4 … minutes, six
  attempts). Deliveries are at-least-once – deduplicate on `id` (also in `X-Stallion-Delivery`).
- The delivery log (latest 100) is on the same page; failed and skipped deliveries can be sent again.

## 4. Integrations

All integrations are **off until configured** and configured **per brand**, because every brand is a separate
legal entity. A setting `NAME_<BRANDCODE>` overrides the group-wide `NAME`. Secrets live in the environment only.

### 4.1 ERP / accounting

On `salesorder.confirmed` and `invoice.issued` the document is posted to the ERP company of **its own brand**
(`Brand.erpCompanyCode`, Setup → Brands). A brand without a company code fails loudly (automation run log) – a
document is never posted to another company.

| Setting | Meaning |
|---|---|
| `ERP_ADAPTER[_<BRAND>]` | `business-central` \| `zoho-books` \| `csv` (unset / `off` = disabled) |
| `ERP_BASE_URL[_<BRAND>]` | API root (Business Central: `…/api/v2.0`; Zoho Books: `…/books/v3`) |
| `ERP_TOKEN[_<BRAND>]` | OAuth access token for the ERP (refreshing it is the deployment's job) |
| `ERP_WEBHOOK_SECRET` | shared secret of the reconciliation endpoint |

- **business-central** – `POST {base}/companies({erpCompanyCode})/salesOrders | salesInvoices`.
- **zoho-books** – `POST {base}/salesorders | invoices?organization_id={erpCompanyCode}`.
- **csv** – one CSV per document under `erp-outbox/{erpCompanyCode}/` in the file storage, for ERPs without an
  API (pick up by SFTP or a mounted import folder).

The ERP's id is stored (`ExternalRef`). **Reconciliation**: the ERP (or a middleware) reports payments with

```bash
curl -X POST https://crm.example.com/api/public/webhooks/erp -H "Authorization: Bearer $ERP_WEBHOOK_SECRET" \
  -d '{"externalId":"<ERP invoice id>","companyCode":"<company>","amount":1500000,"reference":"RCPT-0042"}'
```

The company code must be the one the invoice was posted to; a reference is booked once.

The adapters are written against the vendors' documented endpoints and tested against a mock server. They have
**not** been run against a live Business Central or Zoho Books tenant – plan a test against a sandbox company
before go-live (field mapping of customers and items is deployment-specific).

### 4.2 Online payments

`PAYSTACK_SECRET_KEY[_<BRAND>]` and / or `FLUTTERWAVE_SECRET_KEY[_<BRAND>]` (+ `FLUTTERWAVE_WEBHOOK_HASH[_<BRAND>]`)
switch on *Create payment link* on issued invoices of that brand – for the balance or a smaller amount (booking
deposit). API: `POST /api/v1/invoices/{id}/payment-links`.

Provider webhooks: `/api/public/webhooks/payments/paystack` and `/api/public/webhooks/payments/flutterwave`.
The signature is checked with the key of the brand the payment reference belongs to; a verified successful
charge is booked as payment method *Online* exactly once. Not exercised against the live providers yet.

### 4.3 OEM portals, calendar sync

`src/server/integrations/oem` defines the adapter interface for retail-sales reporting and warranty
registration per brand; only a no-op adapter ships. Microsoft 365 calendar sync is **not implemented** (interface
only in `src/server/integrations/calendar`).
