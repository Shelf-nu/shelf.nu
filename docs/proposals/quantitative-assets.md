# Quantitative Assets

> **Status:** Draft / RFC
> **Authors:** Shelf team
> **Created:** 2026-02-17
> **Last updated:** 2026-02-18

---

## How to Read This Document

This proposal is split into two parts:

- **Part 1 — Product Proposal** covers the what and why: the problem we're solving, what users will experience, how competitors handle it, and open questions for discussion. Everyone should read this.
- **Part 2 — Technical Design** covers the how: database changes, schema details, migration plans, and implementation phasing. This is for engineers.

---

## Table of Contents

### Part 1 — Product Proposal

1. [Problem Statement](#problem-statement)
2. [Core Concepts](#core-concepts)
3. [User Stories](#user-stories)
4. [Competitor Analysis](#competitor-analysis)
5. [Feature Overview](#feature-overview)
6. [Transition for Existing Users](#transition-for-existing-users)
7. [Decisions](#decisions)
8. [Remaining Open Questions](#remaining-open-questions)

### Part 2 — Technical Design

9. [Design Principles](#design-principles)
10. [Proposed Data Model](#proposed-data-model)
11. [Migration Strategy](#migration-strategy)
12. [Implementation Phases](#implementation-phases)

---

# Part 1 — Product Proposal

---

## Problem Statement

Shelf currently treats every asset as a single, individually-tracked item. Each asset has its own status, custody record, QR code, and booking history. This works well for laptops, cameras, vehicles, and other uniquely-identifiable equipment.

However, many organizations also manage items that don't fit this model:

### Quantity-tracked assets (fungible items managed by count)

Items where individual identity doesn't matter — only the count. Examples:

- **Office supplies:** pens, sticky notes, printer cartridges
- **Safety equipment:** gloves, masks, earplugs
- **IT supplies:** cables, adapters, USB drives
- **Medical supplies:** bandages, syringes, test kits
- **Event materials:** lanyards, stickers, printed handouts

Creating a separate asset record for each pen in a box of 500 is impractical. Users need a single record that says "500 pens in Room A" and tracks usage over time.

### Asset Models (template-grouped individual assets)

Items that are individually tracked but share a common model or template. Examples:

- A fleet of 30 identical Dell Latitude 5550 laptops
- 15 identical Bosch power drills across 3 job sites
- 50 identical safety harnesses with individual serial numbers

Today, users create these one by one with no formal grouping. They can't say "book any available Dell Latitude" or see "8 of 30 Latitude 5550s are currently available." Categories provide loose grouping, but aren't specific enough — a "Laptop" category contains many different models.

### Why this matters

Without quantity support:

- Users create hundreds of dummy asset records for bulk items, cluttering their workspace
- Inventory counts require manual spreadsheets outside Shelf
- One-way usage (checkout without return) can't be tracked
- "Book any available X" is impossible — users must find and select a specific unit
- Low-stock situations go unnoticed until someone physically checks

---

## Core Concepts

Before diving into user stories and features, here are the foundational concepts that shape this design.

### Tracking Method

Every asset in Shelf has a **tracking method** chosen at creation time. This is a permanent choice that determines how the asset behaves throughout the system.

|                        | Individually tracked                                  | Tracked by quantity                           |
| ---------------------- | ----------------------------------------------------- | --------------------------------------------- |
| **What it represents** | One record = one physical item                        | One record = N fungible items at a location   |
| **QR code**            | One QR per asset (links to that specific item)        | One QR per record (links to the pooled stock) |
| **Custody**            | One custodian at a time                               | Multiple custodians, each holding a portion   |
| **History**            | Full per-unit lifecycle (location, custody, bookings) | Aggregate changes (±quantity, who, when, why) |
| **Examples**           | Laptops, cameras, vehicles, tools with serial numbers | Cables, gloves, pens, cartridges, test kits   |

### Identity boundary rule

> **If you need per-unit scan or per-unit history → use Individually tracked.**
>
> **If you only need the count → use Tracked by quantity.**

This is a hard guardrail. An asset's tracking method cannot be changed after creation because the data models diverge (individual assets have per-unit history; quantity assets have aggregate logs). Choosing the wrong method means re-creating the asset.

### Behavior modes (quantity-tracked assets only)

Quantity-tracked assets have a **behavior mode** that controls what happens after checkout:

- **Used up (one-way):** Items are consumed and not expected back. Checkout permanently reduces the count. Examples: disposable gloves, single-use test kits, printed handouts.
- **Returnable (two-way):** Items are checked out and expected back, with a consumption report at check-in. The user reports how many were returned vs. lost/consumed. Examples: cables, adapters, reusable tools.

### Two user intents for quantity assets

Quantity-tracked assets support two distinct workflows:

1. **Circulation** — The standard booking/custody flow. Reserve a quantity, check it out, optionally check it back in. This is scheduled and tracked through the booking system.
2. **Stock management** — A quick adjustment from anywhere (e.g., scanning the QR code on a shelf). Add stock when a shipment arrives, remove stock for ad-hoc usage. This is immediate and doesn't go through bookings.

Both create audit log entries with full attribution.

---

## User Stories

### Quantity-tracked assets

| #   | As a...           | I want to...                                                                  | So that...                                                                      |
| --- | ----------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| C1  | Warehouse manager | Create a quantity-tracked asset (e.g., "500 USB-C cables")                    | I can track inventory without creating 500 individual records                   |
| C2  | Office admin      | Assign 20 pens to a team member from a pool of 200                            | I can track who has what quantity, and my available count updates automatically |
| C3  | IT admin          | Check out 5 adapters for a conference (one-way consumption)                   | The quantity decreases and I don't expect them back                             |
| C4  | Lab manager       | Check out 10 test kits, then log that 3 were consumed and 7 returned          | I can track actual consumption vs. returns for budgeting                        |
| C5  | Procurement lead  | See that printer cartridges are below my minimum threshold of 10              | I get alerted and can reorder before we run out                                 |
| C6  | Facility manager  | Split 100 gloves into separate records at Building A (60) and Building B (40) | I can track per-location inventory while maintaining overall visibility         |
| C7  | Safety officer    | Add 50 hard hats to a "Job Site Safety Kit"                                   | My kits can include quantities, not just individual assets                      |
| C8  | Admin             | Book 10 extension cords for a conference next week                            | I can reserve quantities for upcoming events                                    |

### Asset Models

| #   | As a...            | I want to...                                                                         | So that...                                                                      |
| --- | ------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| M1  | IT admin           | Create a "Dell Latitude 5550" model and assign 30 laptops to it                      | I can see all units of this model, their status, and availability at a glance   |
| M2  | Event coordinator  | Book "any 5 available projectors" from the Epson EB-FH52 model                       | I don't have to pick specific serial numbers — just reserve the quantity I need |
| M3  | Warehouse operator | Scan a specific projector's QR code at checkout to assign it to the booking          | The booking transitions from "5 generic" to "these 5 specific units"            |
| M4  | Fleet manager      | View all Toyota Hilux trucks and see 8 available, 4 booked, 3 in maintenance         | I have a dashboard-level view of model utilization                              |
| M5  | Admin              | Select 15 existing individual laptops and group them into a new "ThinkPad T14" model | I can organize legacy assets into models without re-creating them               |
| M6  | Admin              | Create a new asset within an existing model, inheriting the model's default fields   | I save time and maintain consistency across units of the same model             |

### Cross-cutting

| #   | As a... | I want to...                                                                                     | So that...                               |
| --- | ------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| X1  | Admin   | Set the tracking method when creating: Individually tracked, or Tracked by quantity              | I choose the right tracking mode upfront |
| X2  | User    | See quantity columns in the asset list for quantity-tracked assets                               | I can quickly scan inventory levels      |
| X3  | Admin   | Build a kit with 2 individual laptops + 10 quantity-tracked cables + 5 quantity-tracked adapters | Kits reflect real-world equipment sets   |
| X4  | Admin   | Export quantity-tracked asset data including quantities                                          | I can share inventory reports externally |
| X5  | User    | Search/filter assets by type (individual vs. quantity-tracked)                                   | I can find what I need faster            |

---

## Competitor Analysis

### Feature Comparison

| Capability            | Cheqroom                                      | Sortly                                        | Snipe-IT                                                                   | Shelf (proposed)                                                      |
| --------------------- | --------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Quantity model**    | "Bulk Items" toggle on asset                  | Quantity field on every item                  | 5 separate entity types (Asset, Consumable, Component, Accessory, License) | Type toggle on asset (Individual or Quantity-tracked)                 |
| **Quantity tracking** | Checkout reduces quantity, no return expected | Quantity adjustments with audit log           | One-way only (consume, never return)                                       | Configurable per-item: one-way OR two-way with consumption report     |
| **Asset model**       | Not formalized                                | "Variants" concept                            | Asset Models with custom field templates                                   | Asset Model concept, independent of Category                          |
| **Generic booking**   | Not supported                                 | Not supported                                 | Not supported for consumables                                              | Book-by-model: reserve N from model, scan-to-assign at checkout       |
| **Multi-location**    | Separate records per location                 | Folder = location hierarchy                   | Per-location quantity tracking                                             | Split creates separate quantity-tracked records per location          |
| **Low stock alerts**  | Not available                                 | Min quantity + alerts                         | Two-tier: per-item minimum + global threshold                              | Per-asset min quantity threshold with notifications                   |
| **Kit integration**   | Kits mix individual + bulk items              | Bundles with mixed item types                 | No kit concept                                                             | Kits can include quantity-tracked items alongside individual assets   |
| **QR / barcode**      | One QR per bulk item record                   | One barcode per item (regardless of quantity) | Individual barcodes for assets; not for consumables                        | Shared QR for quantity-tracked records; individual QR per model asset |
| **Migration**         | Manual re-creation                            | Bulk import with quantity column              | Separate import per entity type                                            | Manual grouping tool: select existing assets and assign to model      |

### Key Takeaways

**Cheqroom** keeps things simple — a "Bulk Item" toggle converts an asset into a quantity-tracked record. Location-bound (splitting across locations creates separate records). No custody for bulk items. Kits can mix individual and bulk. Limitations: no generic booking, no low-stock alerts, no return tracking.

**Sortly** takes the most unified approach — every item has a quantity field (defaulting to 1 for individual assets). Variants act as lightweight templates. Folder hierarchy doubles as location structure. Min levels with alerts are built-in. Custom units of measure. Limitations: no formal booking system, no generic booking, variant system is limited.

**Snipe-IT** has the most mature model with 5 entity types, but it's also the most rigid. Asset Models serve as templates with custom field sets. Consumables are strictly one-way (no return/two-way tracking). Two-tier alert system is powerful. Limitations: no kit concept, no generic booking, consumables live in a completely separate area (different UI, different workflows).

**Our approach** borrows the best ideas:

- **From Cheqroom:** Simple toggle on the asset (not a separate area), location-bound records
- **From Sortly:** Unified experience, per-asset min quantity alerts
- **From Snipe-IT:** Formal Asset Model concept (independent of category), template-based creation
- **Novel:** Configurable behavior mode (one-way vs. two-way), generic book-by-model with scan-to-assign, quantity-aware custody

---

## Feature Overview

### 1. Asset Creation

When creating a new asset, users choose a **tracking method**:

- **Individually tracked** (default): Works exactly as today. One record = one physical item.
- **Tracked by quantity**: One record represents N fungible items at a location.

|                   | Individually tracked    | Tracked by quantity                      |
| ----------------- | ----------------------- | ---------------------------------------- |
| **QR outcome**    | One QR per asset        | One shared QR for the pooled record      |
| **Custody model** | Single custodian        | Multiple custodians, each with a portion |
| **Booking**       | Book specific items     | Reserve a quantity from the pool         |
| **History**       | Full per-unit lifecycle | Aggregate quantity changes               |

When **Tracked by quantity** is selected, the form shows additional fields:

- **Quantity** — How many units (e.g., 500)
- **Unit of measure** — What they're counted in (e.g., "pcs", "boxes", "liters")
- **Min quantity** — Low-stock alert threshold (e.g., alert me when below 10)
- **Behavior mode** — "Used up" (one-way: consumed and gone) or "Returnable" (two-way: checked out and returned, with a consumption report)

Both tracking methods can optionally be assigned to an **Asset Model** (e.g., "Dell Latitude 5550"). When creating an asset from an existing model, fields like category and valuation are pre-filled from the model's defaults.

### 2. Asset Listing

For quantity-tracked assets, the asset list shows:

- **Quantity column:** Available vs. total (e.g., "85 / 100 pcs")
- **Low stock badge:** Visual indicator when stock is below the minimum threshold

The asset list also gains a **"Group by Model"** view option:

- Assets sharing the same model are grouped under a collapsible header
- Header shows: model name, total count, and availability summary (e.g., "Dell Latitude 5550 — 8 available / 12 total")

New filters: type (Individual / Quantity-tracked), model, and "low stock only."

### 3. Custody with Quantities

**Individual assets** — unchanged. One custodian per asset.

**Quantity-tracked assets** — custody becomes quantity-aware:

- "Assign 20 of 100 USB-C cables to Sarah." The available count drops by 20.
- Multiple team members can hold different quantities of the same asset. "Sarah has 20, Mike has 15, 65 remain available."
- Releasing custody (fully or partially) returns units to the available pool.

### 4. Booking with Quantities

#### Availability formula

The system calculates available stock using:

```
Available = Total quantity − In custody − Reserved in bookings
```

When a user reserves N units in a booking, the available count drops by N immediately. This ensures two bookings can't double-reserve the same stock.

#### Booking quantity-tracked assets

Users can reserve a specific quantity:

1. **Reserve:** "Book 10 extension cords for the conference next week." Available count drops by 10 immediately.
2. **Checkout:** The reserved quantity is checked out. For "Used up" assets, they're consumed permanently. For "Returnable" assets, a return is expected.
3. **Check-in (Returnable only):** The user reports what came back. "7 returned, 3 consumed." The 7 go back to the available pool. The 3 are permanently deducted. The system must clearly reconcile returned vs. consumed quantities before closing the check-in.

#### Book-by-Model (generic booking)

Users can book from a model without choosing specific units upfront:

1. **Reserve:** "Book any 5 projectors from the Epson EB-FH52 model for next week." The system checks that 5 are available.
2. **Checkout (scan-to-assign):** At checkout, the operator scans QR codes of specific projector units. Each scan assigns a real asset to the booking. Checkout completes once all reserved units are assigned.
3. **Check-in:** Standard individual check-in for each assigned unit.

### 5. Kit Integration

Kits can include quantity-tracked items alongside individual assets:

- A kit might contain: "1x Dell Latitude, 1x Projector, 10x USB-C Cable, 5x HDMI Adapter"
- When a kit is checked out, quantities are decremented and individual assets are checked out as usual
- Kit check-in works the same way in reverse

### 6. Location Handling

Quantity-tracked assets are tied to a single location per record. To track the same item across multiple locations, the user **splits** the record:

- **Before:** "100 USB-C cables" at Warehouse A
- **After:** "60 USB-C cables" at Warehouse A + "40 USB-C cables" at Warehouse B

Both records can share the same Asset Model for aggregate reporting. A **merge** operation does the reverse — combines two same-model records into one.

### 7. Consumption Tracking

Each quantity-tracked asset can be configured for one of two behavior modes:

**One-way consumption** — Items are used up and not expected back.

- Check out 50 gloves for a job site. Quantity drops permanently.
- Use case: disposables (gloves, masks, single-use test kits).

**Two-way consumption** — Items are checked out and returned, with a consumption report.

- Check out 10 cables for a conference. When the conference ends, the user reports: "8 returned, 2 lost."
- The 8 go back to available stock. The 2 are deducted permanently.
- Use case: reusable supplies that occasionally get lost or consumed (cables, adapters, tools).

**Restocking** — For both modes, admins can manually increase quantity when new stock arrives.

All quantity changes are logged for audit purposes.

### 8. Low Stock Alerts

Quantity-tracked assets with a minimum quantity threshold trigger alerts when available stock drops to or below that threshold:

- **Dashboard widget:** Shows all low-stock quantity-tracked assets at a glance
- **In-app notification:** Sent to organization admins
- **List badge:** "Low Stock" badge appears on the asset in the list view

Alerts clear automatically when stock rises above the threshold (via restock or returns).

### 9. QR Codes

| Asset Type                        | QR Code Behavior                                                          |
| --------------------------------- | ------------------------------------------------------------------------- |
| Individually tracked (no model)   | One QR per asset (unchanged)                                              |
| Individually tracked (with model) | One QR per asset (unchanged). QR links to the individual asset page.      |
| Tracked by quantity               | One QR per record. Scanning shows stock status and a quick-adjust action. |

#### Quick adjust from QR scan

When scanning a quantity-tracked asset's QR code, the **primary action is a quick adjust**: the user can immediately increase or decrease quantity with a note (e.g., "+50 — new shipment arrived" or "−12 — handed out at event"). This is the stock management intent described in [Core Concepts](#core-concepts).

Paths to the full booking/custody flows are visible but secondary — most QR scans on quantity assets are for quick stock checks or adjustments, not for starting a formal booking.

#### Label expectations guardrail

> **Important:** If users print multiple QR labels for a quantity-tracked asset, all labels point to the same pooled record. Scanning any of them shows the same stock count and adjusts the same pool.
>
> **Need per-unit history?** Use Individually tracked assets instead. Each unit gets its own QR code with independent scan and custody history.

---

## Transition for Existing Users

- **No disruption.** All existing assets remain "Individually tracked." Nothing changes for them.
- **No forced migration.** Organizations adopt quantity-tracked assets and models at their own pace.
- **Manual grouping tool.** To organize existing individual assets into models:
  1. Select assets from the list (multi-select or bulk select)
  2. Choose "Create Model" or "Assign to Model" from the bulk actions menu
  3. Enter model details (or pick an existing model) — done

This is gradual and opt-in. Organizations don't need to group everything at once.

---

## Decisions

These items were discussed during the team call and in Carlos's PR review. They are now resolved.

| #   | Question                                                       | Decision                                                                                                                                                          |
| --- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **How should book-by-model handle partial availability?**      | Allow partial checkout. Notify the user of unavailable items and let them adjust the booking before proceeding.                                                   |
| 2   | **Should Asset Models have their own listing page?**           | Both: a dedicated Models listing page AND grouping in the asset index. Users can browse models directly or see model-grouped assets in the main list.             |
| 3   | **Do we need a consumption dashboard in the initial release?** | Defer to a follow-up release. Focus on core quantity tracking, custody, and booking features first.                                                               |
| 4   | **Unit conversion**                                            | Single unit per asset (no conversion). Each quantity-tracked asset uses one unit of measure. Revisit if users request conversion support.                         |
| 5   | **Custom field defaults from models**                          | Not in the initial release. Models will not carry custom field defaults — the complexity is too high for v1. Models provide category and valuation defaults only. |
| 6   | **How detailed should the audit trail be?**                    | Full attribution: every quantity change records per-custodian, per-booking, and per-location context. See the updated `ConsumptionLog` model in Part 2.           |

---

## Remaining Open Questions

New questions that emerged from the review and team discussion.

| #   | Question                                                 | Context                                                                                                                                                                      |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Default scan action for quantity-tracked QR**          | When scanning a quantity-tracked asset's QR, should the default action be: View details, Quick adjust, or Start checkout? (Raised by Carlos)                                 |
| 2   | **Communication flow when assets become unavailable**    | Between booking creation and checkout, availability can change. What notification/workflow should the user see when they arrive to check out and some items are unavailable? |
| 3   | **Naming: "Asset Model" vs "Asset Type" vs other terms** | What label is clearest for users? "Model" is accurate for grouped individual assets (e.g., Dell Latitude 5550) but may confuse users who think of "model" differently.       |

---

# Part 2 — Technical Design

> The following sections are intended for the engineering team. They cover database schema changes, migration details, and implementation phasing.

---

## Design Principles

1. **Extend, don't fragment.** Add an `AssetType` enum to the existing `Asset` model rather than creating separate entity types. This preserves existing queries, filters, bulk operations, and UI patterns.
2. **AssetModel is independent of Category.** An Asset has both a Category (broad organizational grouping like "Electronics") and an optional AssetModel (specific template like "Dell Latitude 5550"). They serve different purposes.
3. **Quantity-tracked records are per-location.** When a quantity-tracked asset needs to exist in multiple locations, it is split into separate records. Each record has its own quantity. This keeps the `Asset → Location` relationship singular.
4. **Custody and booking extend with quantities.** Instead of replacing the one-to-one custody model, quantity-aware custody uses a composite unique constraint. Bookings gain a quantity field on an explicit pivot table.

---

## Proposed Data Model

### New Enums

```prisma
enum AssetType {
  INDIVIDUAL        // Default. One row = one physical item.
  QUANTITY_TRACKED  // One row = N fungible items at a location.
}

enum ConsumptionType {
  ONE_WAY       // Checked out and consumed. No return expected.
  TWO_WAY       // Checked out and returned, with consumption report.
}
```

### Modified Model: Asset

```prisma
model Asset {
  // ... existing fields unchanged ...

  // New fields
  type              AssetType       @default(INDIVIDUAL)
  assetModelId      String?
  assetModel        AssetModel?     @relation(fields: [assetModelId],
                                     references: [id])

  // Quantity-tracked fields (null for INDIVIDUAL assets)
  quantity          Int?            // Total quantity at this location
  availableQuantity Int?            // Currently available (not in custody/booked)
  minQuantity       Int?            // Low-stock alert threshold
  consumptionType   ConsumptionType? // How consumption is tracked
  unitOfMeasure     String?         // e.g., "pcs", "boxes", "liters"
}
```

**Notes:**

- `type` defaults to `INDIVIDUAL`, so existing assets require no data migration.
- Quantity-tracked fields are nullable to avoid cluttering individual assets.
- `availableQuantity` is maintained by the system: `quantity - (in_custody + booked)`.
- `unitOfMeasure` is a freeform string to support any unit without a fixed enum.

### New Model: AssetModel

```prisma
model AssetModel {
  id              String       @id @default(cuid())
  name            String       // e.g., "Dell Latitude 5550"
  description     String?
  image           String?
  imageExpiration DateTime?

  // Template defaults (applied when creating a new asset from this model)
  defaultCategoryId String?
  defaultCategory   Category?   @relation(fields: [defaultCategoryId],
                                 references: [id])
  defaultValuation  Float?

  // Relationships
  assets          Asset[]
  organization    Organization @relation(fields: [organizationId],
                                references: [id], onDelete: Cascade)
  organizationId  String
  createdBy       User         @relation(fields: [userId],
                                references: [id], onDelete: Cascade)
  userId          String

  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  @@index([organizationId, name])
}
```

**Notes:**

- AssetModel is a template/grouping entity. It holds default values (category, valuation) that are applied when creating new assets from this model.
- Custom field defaults are out of scope for the initial release (Decision #5). Models provide category and valuation defaults only.
- Relationship to Category is for defaults only — each Asset still has its own `categoryId`.
- An AssetModel can group both individual assets (e.g., 30 laptops of the same model) and serve as a template for creating new ones.

### Modified Model: Custody (quantity-aware)

```prisma
model Custody {
  id            String     @id @default(cuid())
  custodian     TeamMember @relation(fields: [teamMemberId],
                            references: [id])
  teamMemberId  String
  asset         Asset      @relation(fields: [assetId], references: [id])
  assetId       String     // Remove @unique for quantity-tracked assets
  quantity      Int        @default(1)  // How many units in custody

  createdAt     DateTime   @default(now())

  @@unique([assetId, teamMemberId])  // One record per asset-custodian pair
}
```

**Key change:** The current `assetId @unique` constraint enforces one custodian per asset. For quantity-tracked assets, we need to allow multiple custodians to hold different quantities. The new constraint is `@@unique([assetId, teamMemberId])` — one record per asset+custodian pair.

For `INDIVIDUAL` assets, application logic continues to enforce single-custodian behavior (only one Custody row allowed). For `QUANTITY_TRACKED` assets, multiple Custody rows are permitted, each with a quantity.

### New Model: BookingAsset (explicit pivot)

Currently, bookings and assets use a Prisma implicit many-to-many join. We need an explicit join table to support quantities:

```prisma
model BookingAsset {
  id          String   @id @default(cuid())
  booking     Booking  @relation(fields: [bookingId], references: [id],
                        onDelete: Cascade)
  bookingId   String
  asset       Asset    @relation(fields: [assetId], references: [id],
                        onDelete: Cascade)
  assetId     String
  quantity    Int      @default(1)  // For quantity-tracked assets: how many booked
  // For model-level booking: starts null, assigned at checkout
  assignedAssetId String?

  @@unique([bookingId, assetId])
}
```

**Notes:**

- For `INDIVIDUAL` assets, `quantity` is always 1.
- For `QUANTITY_TRACKED` assets, `quantity` is the number reserved/checked-out.
- For book-by-model bookings, `assetId` initially points to a placeholder or the model's representative asset, and `assignedAssetId` is populated at checkout when specific units are scanned.

### New Model: ConsumptionLog

```prisma
model ConsumptionLog {
  id            String              @id @default(cuid())
  asset         Asset               @relation(fields: [assetId], references: [id],
                                     onDelete: Cascade)
  assetId       String
  category      ConsumptionCategory // What kind of event this is
  quantity      Int                 // Positive = consumed/removed, negative = restocked/returned
  note          String?
  performedBy   User                @relation(fields: [userId], references: [id])
  userId        String
  booking       Booking?            @relation(fields: [bookingId], references: [id])
  bookingId     String?
  custodian     TeamMember?         @relation(fields: [custodianId], references: [id])
  custodianId   String?             // Who received/returned the items (if applicable)

  createdAt     DateTime            @default(now())

  @@index([assetId, createdAt])
}

enum ConsumptionCategory {
  CHECKOUT    // Items checked out to a custodian or booking
  RETURN      // Items returned from a custodian or booking
  RESTOCK     // New stock added (shipment arrived, manual increase)
  ADJUSTMENT  // Manual correction (inventory count, error fix)
  LOSS        // Items reported lost or damaged
}
```

**Purpose:** Full-attribution audit trail for all quantity changes. Every event records who performed it, who received/returned items (custodian), which booking it relates to, and what kind of event it was. This satisfies Decision #6 (full per-custodian, per-booking, per-location attribution).

### Entity Relationship Overview

```
Organization
├── AssetModel ──────────── (*) Asset
│     (template/group)          │
│                               ├── type: INDIVIDUAL | QUANTITY_TRACKED
├── Category ───────────── (*) Asset
│     (broad grouping)          │
│                               ├── (*) Custody ──── TeamMember
├── Location ──────────── (*) Asset     (qty-aware for quantity-tracked)
│                               │
├── Kit ───────────────── (*) Asset     (with quantity for quantity-tracked)
│                               │
└── Booking ──────────── (*) BookingAsset ──── Asset
                                (qty-aware pivot)
```

---

## Migration Strategy

### Existing Assets

All existing assets default to `type: INDIVIDUAL`. No data changes required. The migration adds the new columns with default/null values:

```sql
ALTER TABLE "Asset" ADD COLUMN "type" "AssetType" DEFAULT 'INDIVIDUAL';
ALTER TABLE "Asset" ADD COLUMN "assetModelId" TEXT;
ALTER TABLE "Asset" ADD COLUMN "quantity" INTEGER;
ALTER TABLE "Asset" ADD COLUMN "availableQuantity" INTEGER;
ALTER TABLE "Asset" ADD COLUMN "minQuantity" INTEGER;
ALTER TABLE "Asset" ADD COLUMN "consumptionType" "ConsumptionType";
ALTER TABLE "Asset" ADD COLUMN "unitOfMeasure" TEXT;
```

### Custody Table Changes

The `Custody` table migration removes the `@unique` constraint on `assetId` and adds:

- `quantity` column with default value of 1
- New composite unique index `@@unique([assetId, teamMemberId])`

Existing custody records remain valid (they have `quantity: 1` and the new unique constraint holds since each asset currently has at most one custodian).

### Booking Pivot Migration

The implicit `_AssetToBooking` join table is replaced with the explicit `BookingAsset` model. Migration must:

1. Create `BookingAsset` table
2. Copy existing rows from `_AssetToBooking` with `quantity: 1`
3. Drop `_AssetToBooking`

### API Backwards Compatibility

New fields are additive and optional. Existing API consumers that don't send `type`, `quantity`, etc. will continue to create `INDIVIDUAL` assets with default behavior. This is a non-breaking change for external integrations.

---

## Implementation Phases

All phases ship together as one release. This ordering reflects build dependencies, not separate releases.

### Phase 1: Foundation

**Goal:** Core data model changes and basic CRUD.

- Add `AssetType` enum, `ConsumptionType` enum, `ConsumptionCategory` enum
- Add new fields to `Asset` model
- Create `AssetModel` model (no custom field defaults — deferred per Decision #5)
- Create `ConsumptionLog` model (with full attribution fields)
- Create `BookingAsset` explicit pivot table
- Run data migration for existing assets and bookings
- Update asset creation form with tracking method selection
- Update asset detail page to show quantity fields for quantity-tracked assets
- Add AssetModel CRUD (create, edit, delete)
- Add Asset Model listing page (per Decision #2)

### Phase 2: Quantity-tracked Operations

**Goal:** Quantity-aware checkout, custody, and consumption.

- Quantity-aware custody: assign/release partial quantities
- Modify Custody model (remove unique constraint, add quantity)
- Consumption tracking (one-way and two-way flows)
- ConsumptionLog recording with full attribution
- Restock flow
- Quick-adjust flow: QR scan → ± quantity with note (stock management intent)
- Low-stock alert threshold and notifications
- Update asset list to display quantities and low-stock badges

### Phase 3: Booking Integration

**Goal:** Quantity-aware bookings and book-by-model.

- Quantity-tracked booking: reserve quantity N of a quantity-tracked asset
- Quantity on `BookingAsset` pivot
- Availability formula enforcement (`Available = Total − In custody − Reserved`)
- Book-by-model: reserve N from an AssetModel
- Scan-to-assign at checkout for model-level bookings
- Conflict detection for quantity-aware and model-level bookings
- Partial check-in with consumption reports (returnable assets)
- Calendar view updates

### Phase 4: Kit, Location, and Auxiliary Features

**Goal:** Remaining integrations and polish.

- Kit integration: quantity-tracked items in kits
- Kit checkout/check-in with quantity handling
- Location split and merge for quantity-tracked assets
- Model grouping tool (bulk assign existing assets to a model)
- QR code handling for quantity-tracked assets and model groups
- Asset list: group-by-model view
- Import/export with quantity columns
- Bulk operations awareness of asset types

> **Deferred post-launch:** Consumption dashboard (consumption rate, top consumed items, cost tracking) — see Decision #3.
