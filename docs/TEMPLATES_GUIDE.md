# Templates guide

One place for every kind of template in Stallion CRM – and record templates, which create a record in one click.

| Template type | What it is | Where it is edited |
| --- | --- | --- |
| **Email** | Rich e-mail with blocks, in the brand layout | E-mail template editor (docs/PRINT_AND_EMAIL_GUIDE.md §2) |
| **Document / Print** | Company-formatted documents (invoice, quotation, offer letter…) and print layouts | Document template builder (§3 of the same guide); print layouts in Setup → Print templates |
| **Record** | Pre-filled values for a new lead, deal, case, account, contact or quotation | Record template editor (below) |
| **SMS / WhatsApp** | Plain text with merge fields | Campaigns → Templates |

The same rule as everywhere: **a template of a brand you are not in does not exist for you** – not in the hub, not in
a picker, not by address, not through the API.

## 1. The hub

Open **Templates** (`/templates`; administrators and Brand Admins also find it under Setup → Customization → Templates).

- **Tabs**: Email · Document / Print · Record · SMS · WhatsApp, each with its number of templates.
- **Views** (left): All Templates · Favorites (your stars) · Associated Templates (used by a campaign, a workflow rule
  or another template – the row says where) · Created by me · Shared with me (your brands' templates by others) ·
  Public Templates (for every brand).
- **Folders** (left): your own folders, and shared folders of a brand or of the group. *New folder* → *Only me* or
  *Shared*. Shared brand folders are made and filled by the brand's manager, its Brand Admin or an administrator;
  group folders by administrators. Removing a folder never removes its templates.
- **Toolbar**: Module · Brand (your brands only) · Folder · Status · Owner · search (name, subject, text) · sort
  (last updated, name, most used).
- **A row** shows the star, the name, the module chip, the brand (or *All my brands*), who it is for (Personal, Shared,
  Public), the status (Draft, Pending approval, Published, Archived / Inactive), the owner, when it was updated and
  how often it was used.
- **⋯ on a row**: Edit / Open · Preview · Clone · Share… (opens the editor, where visibility is set) · Set as default ·
  View versions · Move to folder · Archive / Restore · Delete. You only see what you may do.
  - **Delete is refused while a template is in use** – the message lists the campaigns, workflow rules and templates
    that use it. Archive it instead. Only a Super Admin can delete a template that is in use. A template that records
    or documents were made with is never deleted.

### New Template

**+ New Template** → *Create {type} Template*:

1. **Template type** – follows the tab you are on.
2. **Select Module** – a searchable list of the modules you can open: type to filter, arrows and Enter to choose; the
   selected module has a ✓. Order: Leads, Contacts, Accounts, Deals, Activities, Products, Quotes, Sales Orders,
   Inventory documents, Invoices, Campaigns, Price Books, Cases, Vehicle Units – each template type offers the
   modules it applies to (document templates: every printable module; record templates: modules with a create form).
3. **Brand / Company** – one of your brands, *All my brands*, or *Group* (administrators).
4. **Start from** – Blank, a starter from the gallery, or a clone of a template you can see.
5. **Next** opens the editor of that type.

## 2. Record templates

A record template stores **default values** for a module so that common records are created in one click.

### Create one

*New Template* on the **Record** tab, or **Save as template** on a lead, deal, case, account or contact (the record's
reusable values are copied; names, phone numbers, e-mail addresses, VIN, numbers, links to other records, the owner
and dates are left out).

The editor lists the fields the module's create form accepts:

- **Default value** – a choice for option fields, a number, yes / no, text. Dates take *today plus n days* (for
  example close date = today + 45) or a fixed date. *Owner* can be *the user who creates the record*, *Region* *the
  user's own region*.
- **Lock** – the user sees the value but cannot change it. **Hide** – the value is applied without showing the field.
  Both are enforced on the server: a changed form or an API call cannot override them.
- **Tasks created with the record** – subject, kind (task, call, meeting), due in hours, priority. They are created
  for the user who creates the record.
- **Line items** (quotation templates) – products of the template's brand with quantity and discount. **Prices are
  not stored**: they come from the price book on the day the quotation is created.
- **After the record is created** – an e-mail template and / or a document template. The e-mail composer then opens
  with them chosen; nothing is sent without the user.

Who may do what:

| | Sales Exec | Brand Manager | Brand Admin | Administrator | Super Admin |
| --- | --- | --- | --- | --- | --- |
| Use published templates of own brands and public ones | ✅ | ✅ | ✅ | ✅ | ✅ |
| Personal templates (publish them oneself) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Shared brand templates | – | create, then **submit for approval** | create and publish (own brand) | ✅ | ✅ |
| Set the default of a module and brand | – | – | own brand | ✅ | ✅ |
| Public (group) templates, group folders | – | – | – | ✅ | ✅ |
| Delete a template that is in use | – | – | – | – (archive) | ✅ |

Approval of shared templates runs through **Approvals**: the brand's Brand Admin decides (an administrator when the
brand has none). A published shared template changed by its brand manager goes back to draft until approved again.
Every save is a version; earlier versions can be restored.

### Use one

- **Create {Module} ▾ → Create from template** on the list of leads, deals, cases, accounts and contacts opens the
  picker: your favourites first, then the brand's default, with a search box. **Use** opens the normal create form,
  pre-filled; locked fields are read-only, hidden fields are not shown. Complete the rest and save.
- **Quotations**: on a deal choose **Quote from template** – the quotation is created for that deal with the
  template's line items at today's prices, terms and validity.
- **Quick create (+)** → *From a template…* lists the templates of every module you can create in.
- The record remembers the template and its version (*created from “Fleet deal”, version 3*); the template's page
  shows how many records were created from it, in total and this month.
- **Template required**: Setup → Customization → Record template policy. For a ticked module the blank create form
  and the create API are refused until a template is chosen. Imports, web forms and conversions are not affected.

### Starter record templates

Walk-in showroom enquiry and Referral from a customer (leads) · Fleet / corporate deal and Bank-finance retail deal
(deals) · Standard offer (quotations) · Delivery complaint (cases) · Corporate account (accounts). They are in the
*Start from* list of the New Template dialog; demo data has them as public templates. All content is fictitious.

## 3. API

| Call | Result |
| --- | --- |
| `GET /api/v1/templates?type=email\|document\|record\|sms\|whatsapp[&module=deals]` | The hub's list for the caller: type, name, module, brand, status, scope, owner, default, usage, where it is used |
| `GET /api/v1/templates` | Message templates, as before |
| `POST /api/v1/{module}/from-template/{id}` | Creates a lead, deal, case, account, contact or quotation from a published record template. The body holds the values the caller adds (for quotations `{ "dealId": "…" }`); locked and hidden fields cannot be overridden. Answers the new id, the template id and version, and the number of tasks created |
| `POST /api/v1/leads` (and deals, cases, accounts, contacts) with `"templateId"` | The same through the module's own create call. Without `templateId` the call is refused (403) when the module requires a template |

A template of another brand answers 404. Creating a record in a brand the caller is not in is refused whatever the
template says.

## 4. Rules

- The hub adds no access of its own: each row comes from its template type's service with that type's rules.
- A template's brand must be one of its author's brands. An *All my brands* template applies to the brands of the
  user who **uses** it – it cannot create a record in a brand they are not in.
- Every value of a record template is validated again by the module's create service when it is used (brand, region,
  product of the brand, option values). Templates never show data: defaults and merge fields resolve with the current
  user's access.
- Creating, changing, publishing, approving, deleting and using a template are in the audit trail (entities
  *RecordTemplate*, *RecordTemplateUse*, *DocumentTemplate*, *Template*, *TemplateFolder*).

## 5. Known limits

- **Sales orders, invoices and purchase orders have no record templates**: in this CRM they are never created blank
  (an order comes from a quotation, an invoice from an order), so there is no form to pre-fill and no "template
  required" rule for them. Their *document* templates (prompt 21) are in the hub.
- There are **no custom modules** in this CRM (only custom fields), so the module list has the built-in modules.
  Tasks, meetings, calls and test drives are one module, *Activities*; activities, products, price books, campaigns,
  vendors and solutions have no record templates.
- The record template editor is a table of the module's fields, not a copy of the create form, and has no default
  attachments. Fields that point to another record (model, pipeline) take an id – easiest through *Save as template*.
- "Created from template" is kept in a link table (record ↔ template and version) and shown on the template; it is
  not a column of each module or a report filter yet.
- The picker is a page, not a pop-up; the mobile quick screen reaches it through the + menu.
- *Share…* opens the editor: sharing is the template's visibility (personal, brand, public) – there is no sharing
  with single users, roles or territories.
- Print layouts (Setup → Print templates) are listed in the hub but copied, archived and deleted in their designer.
- There is no separate profile permission "Manage templates" per template type: who may write a template follows the
  roles above (author, brand manager, Brand Admin, administrator) and, for e-mail / SMS / WhatsApp templates, the
  Campaigns permission.
- Demo data has the starter record templates as public templates. A database that is not re-seeded (production)
  gets them through *New Template → Start from*.
