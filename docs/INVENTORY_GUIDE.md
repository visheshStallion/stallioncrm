# Inventory guide – vehicles & parts per brand

Inventory manages every vehicle (by VIN), plus parts and accessories, **separately for each brand**. A brand is a
legal entity: its stock, its cost and its journals never mix with another brand's. Group management sees a
consolidated report; everyone else sees their own brand(s) only.

Open it with **Inventory** in the navigation. What you see depends on your role.

## 1. Who sees and does what

| Role (profile) | Sees | Can do |
|---|---|---|
| Sales Exec, RSM (*Sales Exec*, *RSM*) | **Available to sell**: available units of their brands – model, colour, year, location, price, VIN with only the last six characters – and the units of their own deals in full. No cost, no documents. | Reserve a unit for a deal they can edit |
| Stock Controller (*Inventory Officer*) | All stock and documents of the brand – **without cost** | Receive, transfer, adjust (up to the limit), PDI, stock counts |
| Logistics / Clearing Officer (*Logistics*) | Stock, documents and cost of the brand | Purchase orders, shipments, port clearing, receipts, entering landed cost vouchers |
| Brand Accountant (*Inventory Finance*) | Stock, cost, valuation, journals | Bills, allocating landed cost, vendor credits, approving adjustments, settings and period lock |
| Brand Manager | Whole brand stock incl. cost | Approves purchase orders, extends reservations, approves inter-brand transfers |
| Management | All brands incl. cost, group consolidation | Read |
| Administrator | Everything | Everything |

Cost (purchase cost, landed cost, stock value, margin, journals, bills) is the **inventory finance** permission.
Users without it never receive those fields – not in lists, exports, the API or webhook payloads. They also
cannot *set* a cost: a receipt entered by a Stock Controller takes its prices from the purchase order.

New roles are created like any other user (Setup → Users): give the user the profile above and the **brand**
territory (e.g. `HMNL`) – they then see that brand's stock and nothing of other brands.

## 2. Vehicle lifecycle

```
On order → In transit → At port → In clearing → In stock – PDI pending → In stock – available
        → Reserved (deal) → Allocated (sales order) → Invoiced → Delivered
side states: Demo / test-drive fleet · Damaged / on hold · Transferred · Returned · Written off
```

The status only changes through the steps below; each change is in the unit's **status history**, each stock
movement in its **ledger**. A unit cannot become *available* without a passed PDI.

## 3. From purchase to stock

1. **Purchase order** (*Inventory → Purchase Orders → New*, or **+ → Purchase Order**) – see *Creating a purchase
   order* below. *Submit* – above the brand's limit it waits for the Brand Manager. The PDF is on the brand's legal
   entity.
2. **Shipment** (*Create shipment* on the order): bill of lading, vessel, port, ETA and – when known – the VINs.
   *Next stage* moves it Ordered → Shipped → At port → Clearing → Cleared → Delivered; the vehicles follow
   (in transit, at port, in clearing).
3. **Goods receipt** (*Create goods receipt* on the order or shipment): the warehouse and one line per vehicle
   with its **VIN** (17 characters; the check digit is verified, so a typing error is caught). *Receive* puts the
   units into stock as *PDI pending* and starts their ageing.
4. **Vendor bill** (accountant): *Create vendor bill* on the receipt, then *Open*. Payments are recorded on the bill.
5. **Landed cost voucher**: customs duty, levy, port and terminal charges, clearing agent, shipping, insurance,
   haulage. Choose the vehicles and the method (by value, equally per vehicle, or manual amounts). Logistics
   enters it; the accountant presses *Allocate* – each vehicle's cost goes up by its share.
6. **PDI** (vehicle → *Start PDI*): tick the brand's checklist. Everything ticked → *available*; otherwise the
   unit goes *on hold* with the findings.

### Creating a purchase order

The page has four parts, like the CRM it replaces: **Purchase Order Information**, **Address Information**,
**Purchase Items** and **Terms / Description**. Mandatory fields have a red bar on the left edge: Brand / Company,
Subject, Vendor Name and the Purchase Items section.

- **Owner** is you; change it to anyone with access to the brand. **PO Number** is generated on save
  (`HMNL-PO-2026-00001`); a brand can allow a typed external number (*Setup → Purchase Orders*).
- **Vendor Name** lists the brand's vendors only (**+ New vendor** if you may create one). **Contact Name** then lists
  that vendor's people (**+ New contact**). **Carrier** comes from the brand's list; **Tracking Number** is the
  courier / B/L / container number; **Requisition Number** your internal reference.
- **PO Date** is today, **Due Date** must not be before it – both in your date format (*Personal settings*).
- **Currency** is NGN with **Exchange Rate 1** (locked). Another currency takes the rate from *Setup → Currencies*;
  only inventory finance users may change it. Under the rate the Grand Total is shown in naira.
- **Excise Duty** and **Sales Commission** are recorded; excise is added to the Grand Total only when the brand says
  so.
- **Copy Address**: billing → shipping, shipping → billing, billing from the brand's letterhead, shipping from one of
  the brand's warehouses, billing from the vendor. Billing Country is *Nigeria* by default; with Nigeria the state is
  a list of the 36 states and the FCT.
- **Purchase Items**: the same grid as sales orders – Add row, Add multiple products, paste from Excel, discounts,
  taxes, Adjustment. The List Price is the purchase price: the last price paid to this vendor, else the item's cost
  price, else typed. *Show only this vendor's products* narrows the search. VINs are not needed (they are captured on
  the goods receipt); a vehicle line can carry the *expected VINs* the vendor announced.
- **Save** opens the purchase order; **Save and New** opens a fresh form with the same brand, owner, vendor, currency
  and carrier; **Cancel** (or Esc) asks before discarding changes. **Ctrl+S** saves. A new purchase order is kept on
  your device every 30 seconds and offered back if the page was closed before saving.
- **Status**: Created → (Pending Approval) → Approved → *Send to vendor* (the PDF is e-mailed to the contact or the
  vendor) → Partially Received / Received (goods receipts) → Closed. Cancel is possible while Created or Approved.
  Approved orders are locked; the Brand Manager or an administrator can *Reopen* one until goods are shipped or
  received against it. *Clone* copies an order into a new one.
- **Form views**: administrators and Brand Admins can create a *custom form page* (for example an "Import PO view")
  that hides fields or sections; users pick it in the bar at the bottom of the form. *Edit Page Layout* opens the same
  settings (*Setup → Purchase Orders*), where the carriers, default terms, receiving warehouse, approval limit,
  excise rule and typed numbers are set per brand.

## 4. Selling

- **Reserve**: the executive opens the unit from *Available to sell* (or the deal page) and reserves it for their
  deal. Only one reservation can win when two people try at once. A reservation expires after the brand's
  reservation period (default 7 days) unless the Brand Manager extends it; a won deal keeps its unit.
- **Sales order → Allocate** takes the deal's reserved unit(s) – only units of the order's own brand.
- **Invoice → Issue** posts the cost of sale (the unit at its own landed cost).
- **Sales order → Deliver** is the gate pass: a delivery note is created, the unit is *delivered*, the deal moves
  to Delivery.

## 5. Moving and correcting stock

- **Transfer order**: between two warehouses of the same brand; *Ship* then *Receive*.
- **Inter-brand transfer**: a sale between two legal entities. Enter the vehicles and the transfer price; it
  needs the Brand Manager **and** the Brand Accountant of **both** brands. After *Ship* the receiving brand
  receives the vehicles (Documents → Inter-brand transfers → *Transfers to your brand*) into its own warehouse as
  its own item, at the transfer price. Neither brand sees the other's cost.
- **Inventory adjustment**: write-off, change of value, hold / release for vehicles; quantity changes for parts.
  Above the brand's limit it waits for the Brand Accountant.
- **Stock count**: choose the warehouse, *Start counting* (a snapshot of what should be there), scan or type the
  VINs found and enter part quantities, *Reconcile*. Differences become a **draft** adjustment for review –
  nothing is written off automatically.
- **Vendor credit / purchase return**: units go back to the vendor.
- **Demo fleet**: *Move to demo fleet* on an available unit (with mileage); *Back to sellable stock* returns it.

Posted documents cannot be edited. A mistake is corrected with a new document – the ledger is append-only.

## 6. Parts & accessories

Quantity stock per warehouse (and batch). Set a **reorder level** and order quantity per item (Parts &
accessories); the dashboard and the reorder report list what is at or below its level. Parts are valued at
weighted average or FIFO (Settings, per brand).

## 7. Scanning and labels

*Scan* looks a vehicle up by VIN – with the phone camera where the browser supports barcode scanning, or typed /
from a handheld scanner. *Print VIN label* on a vehicle gives a label with a Code 39 barcode. Scanning a VIN of
another brand answers "not found".

## 8. Reports

Stock on hand, ageing, available vs reserved vs allocated, in-transit and port pipeline, days of cover,
slow-moving stock, reorder, stock count variance, movement history per VIN – and for finance: landed cost
per VIN, valuation as of a date, gross margin per VIN. *Group consolidated stock* is for group management.
Reports follow the brand switcher and can be exported as CSV (export permission; audited).

## 9. Accounting

Every posting creates a balanced journal in the brand's own accounts (Settings → accounts):

| Event | Debit | Credit |
|---|---|---|
| Goods receipt | Inventory | Goods received not invoiced |
| Vendor bill | GRNI (+/− purchase price variance) | Accounts payable |
| Landed cost | Inventory | Landed cost clearing |
| Invoice / gate pass | Cost of goods sold | Inventory |
| Write-off / loss | Inventory adjustment | Inventory |
| Purchase return | Accounts payable | Inventory |
| Inter-brand, seller | Inter-company (+/− gain or loss) | Inventory |
| Inter-brand, buyer | Inventory | Inter-company |

Journals are immutable. With the ERP integration switched on for the brand (see API.md) they are handed to that
brand's ERP company. **Period close**: set the lock date in Settings – nothing can be posted on or before it.

## 10. What is not in this version

- Bins inside a warehouse; reorder levels per warehouse (they are per item); batch expiry dates.
- A Stock Controller is limited to a brand, not to single locations.
- Allocation of landed cost by weight is available through the API only (the screen offers value, equal, manual).
- Parts on a sales order are not issued from stock automatically – adjust or count them.
- Paying a vendor bill records the payment but posts no bank journal (that belongs to the ERP).
- Voiding an opened bill and reversing a posted document need a correcting document.
- The vehicle documents vault (B/L, customs papers per VIN), photos on PDI, and the link between demo units and
  test-drive bookings are not built.
- Inventory is not a data source of the report builder; it has its own report list.
- Journal export to the ERP exists for the CSV adapter only.
