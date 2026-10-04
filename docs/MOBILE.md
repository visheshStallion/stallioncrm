# Mobile app (PWA), global search & notifications

## 1. The app on a phone

StallionCRM is an installable web app. Open it in Chrome / Edge (Android) or Safari (iPhone), then *Add to Home
screen* / *Install*. It needs https (or `localhost`).

- **Bottom navigation** on phones: Home, Leads, Deals, Activities, More. *More* holds every other module the
  profile may read plus the field tools: Quick actions, Search, Notifications, Scan VIN.
- **Quick actions** (`/quick`): log a call, add a note, create a lead – large fields for one-handed use.
- **Click to call / WhatsApp** on leads, activities and the offline lists.
- **Scan VIN** (Inventory → Scan): camera scan of the VIN barcode where the browser supports the BarcodeDetector
  API (Chrome / Edge on Android), otherwise typed. Number-plate recognition (OCR) is **not** included.
- **Test drive**: on the test-drive activity, *Driving licence (photo)* opens the camera and *Customer signature*
  is drawn with the finger; both are stored as attachments of the activity in the brand's storage area.

## 2. Offline

What works without a connection:

| | |
|---|---|
| Read | The user's **own** open leads, open deals and activities (up to 200 each), as last loaded |
| Record | Log a call, add a note, create a lead – kept in the **outbox** and sent when the connection is back |
| Not offline | Everything else: lists of colleagues' records, documents, reports, approvals |

How it stays safe:

- The device stores only what `GET /api/v1/offline/snapshot` returns – the same queries and masks as the
  screens, restricted to the user's own records. Nothing else is cached: the service worker keeps **no** page
  and **no** API response, only the static offline shell (`/offline`) and build assets.
- The cache belongs to one user with one access scope. It is **wiped**
  - on logout and whenever the sign-in page is shown (session ended),
  - when another user signs in on the device,
  - when the user's access changed (territory added / removed, profile or permissions changed): every refresh
    compares the server's scope fingerprint with the stored one.
- Outbox actions are applied with the user's access **at the time of sending**. If the user lost access to the
  record meanwhile (or it was deleted) the action is refused and stays in the outbox as "not applied" for the
  user to read and discard. Each action has a client-generated key and is applied at most once, however often
  it is sent.
- There is no merge of field edits: offline actions only *add* records (a lead, a call, a note), so two people
  cannot overwrite each other's changes.

Limits: the cache refreshes when the app is opened or comes back online, not continuously; background sync
while the app is closed is not used (the outbox is sent the next time the app is open and online).

## 3. Global search

Ctrl / ⌘ + K (or *Search* on the phone) finds leads, contacts, accounts, deals, quotes, sales orders, invoices,
cases, activities, products and vehicle stock by name, phone, e-mail, VIN and document number.

- "Contains" matching, backed by PostgreSQL **trigram** indexes (`pg_trgm`). There is no ranked full-text
  (`tsvector`) search – results are ordered by recency per module.
- Every searcher runs through `scopedDb` and row-level security with the module's own masking: a record of
  another brand is simply not found, shared customers appear with their masked tier, sales users find stock by
  the last six characters of a VIN only. The result never says how many hidden records exist.

## 4. Notifications

- **Notification centre** (`/notifications`, or the bell): everything addressed to the user, filter by type,
  mark as read.
- **Types**: approvals, assignments, mentions, activity reminders, case SLA breaches, stale deals (an open deal
  without any change for 14 days – the owner is told once per period), other.
- **Preferences per type**: in app, e-mail, push. **Quiet hours** (Lagos time): no e-mail and no push, the
  notification still appears in the app. **Daily digest**: one e-mail after 07:00 with the unread notifications.
- **Who is notified** is decided where the notification is raised – always users who can see the record (owner,
  approver, a mentioned colleague with access, the Brand Manager of the record's brand). Preferences only decide
  *how*.
- **Web push** goes to the browsers the user switched it on for (*Turn on push on this device*). A push message
  contains the title and the link only; the record is loaded with the user's own access when they open it.
  A browser that signs in as another user stops delivering to the previous one.

### Switching on e-mail and push (administrator)

| Setting | Meaning |
|---|---|
| `NOTIFICATION_EMAILS=1` | e-mail copies and the daily digest (uses the mail settings of messaging) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | web push; generate the pair with `npx web-push generate-vapid-keys`; subject is a `mailto:` address |
| `APP_URL` | absolute links in e-mails |

Reminders, the digest and stale-deal notifications need the scheduler tick (`/api/public/cron/tick`).
Web push has been tested up to the push job (recipients, payload, removal of dead subscriptions); it has not
been exercised against a real browser push service in this repository's tests.
