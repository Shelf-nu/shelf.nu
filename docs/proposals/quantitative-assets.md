# Quantitative Assets

> **Status:** Draft / RFC
> **Authors:** Shelf team
> **Created:** 2026-02-17
> **Last updated:** 2026-02-17

---

## How to Read This Document

This proposal is split into two parts:

- **Part 1 — Product Proposal** covers the what and why: the problem we're solving, what users will experience, how competitors handle it, and open questions for discussion. Everyone should read this.
- **Part 2 — Technical Design** covers the how: database changes, schema details, migration plans, and implementation phasing. This is for engineers.

---

## Table of Contents

### Part 1 — Product Proposal

1. [Problem Statement](#problem-statement)
2. [User Stories](#user-stories)
3. [Competitor Analysis](#competitor-analysis)
4. [Feature Overview](#feature-overview)
5. [Transition for Existing Users](#transition-for-existing-users)
6. [Open Questions](#open-questions)

### Part 2 — Technical Design

7. [Design Principles](#design-principles)
8. [Proposed Data Model](#proposed-data-model)
9. [Migration Strategy](#migration-strategy)
10. [Implementation Phases](#implementation-phases)

---

# Part 1 — Product Proposal

---

## Problem Statement

Shelf currently treats every asset as a single, individually-tracked item. Each asset has its own status, custody record, QR code, and booking history. This works well for laptops, cameras, vehicles, and other uniquely-identifiable equipment.

However, many organizations also manage items that don't fit this model:

### Consumables (quantity-tracked, fungible items)

Items where individual identity doesn't matter — only the count. Examples:

- **Office supplies:** pens, sticky notes, printer cartridges
- **Safety equipment:** gloves, masks, earplugs
- **IT consumables:** cables, adapters, USB drives
- **Medical supplies:** bandages, syringes, test kits
- **Event materials:** lanyards, stickers, printed handouts

Creating a separate asset record for each pen in a box of 500 is impractical. Users need a single record that says "500 pens in Room A" and tracks consumption over time.

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
- Consumable usage (checkout without return) can't be tracked
- "Book any available X" is impossible — users must find and select a specific unit
- Low-stock situations go unnoticed until someone physically checks

---

## User Stories

### Consumables

| #   | As a...           | I want to...                                                                  | So that...                                                                      |
| --- | ----------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| C1  | Warehouse manager | Create a consumable asset with quantity (e.g., "500 USB-C cables")            | I can track inventory without creating 500 individual records                   |
| C2  | Office admin      | Assign 20 pens to a team member from a pool of 200                            | I can track who has what quantity, and my available count updates automatically |
| C3  | IT admin          | Check out 5 adapters for a conference (one-way consumption)                   | The quantity decreases and I don't expect them back                             |
| C4  | Lab manager       | Check out 10 test kits, then log that 3 were consumed and 7 returned          | I can track actual consumption vs. returns for budgeting                        |
| C5  | Procurement lead  | See that printer cartridges are below my minimum threshold of 10              | I get alerted and can reorder before we run out                                 |
| C6  | Facility manager  | Split 100 gloves into separate records at Building A (60) and Building B (40) | I can track per-location inventory while maintaining overall visibility         |
| C7  | Safety officer    | Add 50 hard hats to a "Job Site Safety Kit"                                   | My kits can include consumable quantities, not just individual assets           |
| C8  | Admin             | Book 10 extension cords for a conference next week                            | I can reserve consumable quantities for upcoming events                         |

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

| #   | As a... | I want to...                                                                         | So that...                               |
| --- | ------- | ------------------------------------------------------------------------------------ | ---------------------------------------- |
| X1  | Admin   | Set the asset type when creating: Individual, or Consumable                          | I choose the right tracking mode upfront |
| X2  | User    | See quantity columns in the asset list for consumables                               | I can quickly scan inventory levels      |
| X3  | Admin   | Build a kit with 2 individual laptops + 10 consumable cables + 5 consumable adapters | Kits reflect real-world equipment sets   |
| X4  | Admin   | Export consumable data including quantities                                          | I can share inventory reports externally |
| X5  | User    | Search/filter assets by type (individual vs. consumable)                             | I can find what I need faster            |

---

## Competitor Analysis

### Feature Comparison

| Capability              | Cheqroom                                      | Sortly                                        | Snipe-IT                                                                   | Shelf (proposed)                                                   |
| ----------------------- | --------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Quantity model**      | "Bulk Items" toggle on asset                  | Quantity field on every item                  | 5 separate entity types (Asset, Consumable, Component, Accessory, License) | Type toggle on asset (Individual or Consumable)                    |
| **Consumable tracking** | Checkout reduces quantity, no return expected | Quantity adjustments with audit log           | One-way only (consume, never return)                                       | Configurable per-item: one-way OR two-way with consumption report  |
| **Asset model**         | Not formalized                                | "Variants" concept                            | Asset Models with custom field templates                                   | Asset Model concept, independent of Category                       |
| **Generic booking**     | Not supported                                 | Not supported                                 | Not supported for consumables                                              | Book-by-model: reserve N from model, scan-to-assign at checkout    |
| **Multi-location**      | Separate records per location                 | Folder = location hierarchy                   | Per-location quantity tracking                                             | Split creates separate consumable records per location             |
| **Low stock alerts**    | Not available                                 | Min quantity + alerts                         | Two-tier: per-item minimum + global threshold                              | Per-consumable min quantity threshold with notifications           |
| **Kit integration**     | Kits mix individual + bulk items              | Bundles with mixed item types                 | No kit concept                                                             | Kits can include consumable quantities alongside individual assets |
| **QR / barcode**        | One QR per bulk item record                   | One barcode per item (regardless of quantity) | Individual barcodes for assets; not for consumables                        | Shared QR for consumable records; individual QR per model asset    |
| **Migration**           | Manual re-creation                            | Bulk import with quantity column              | Separate import per entity type                                            | Manual grouping tool: select existing assets and assign to model   |

### Key Takeaways

**Cheqroom** keeps things simple — a "Bulk Item" toggle converts an asset into a quantity-tracked record. Location-bound (splitting across locations creates separate records). No custody for bulk items. Kits can mix individual and bulk. Limitations: no generic booking, no low-stock alerts, no return tracking.

**Sortly** takes the most unified approach — every item has a quantity field (defaulting to 1 for individual assets). Variants act as lightweight templates. Folder hierarchy doubles as location structure. Min levels with alerts are built-in. Custom units of measure. Limitations: no formal booking system, no generic booking, variant system is limited.

**Snipe-IT** has the most mature model with 5 entity types, but it's also the most rigid. Asset Models serve as templates with custom field sets. Consumables are strictly one-way (no return/two-way tracking). Two-tier alert system is powerful. Limitations: no kit concept, no generic booking, consumables live in a completely separate area (different UI, different workflows).

**Our approach** borrows the best ideas:

- **From Cheqroom:** Simple toggle on the asset (not a separate area), location-bound records
- **From Sortly:** Unified experience, per-item min quantity alerts
- **From Snipe-IT:** Formal Asset Model concept (independent of category), template-based creation
- **Novel:** Configurable consumption mode (one-way vs. two-way), generic book-by-model with scan-to-assign, quantity-aware custody

---

## Feature Overview

### 1. Asset Creation

When creating a new asset, users choose a type:

- **Individual** (default): Works exactly as today. One record = one physical item.
- **Consumable**: The form shows additional fields:
  - **Quantity** — How many units (e.g., 500)
  - **Unit of measure** — What they're counted in (e.g., "pcs", "boxes", "liters")
  - **Min quantity** — Low-stock alert threshold (e.g., alert me when below 10)
  - **Consumption type** — One-way (consumed and gone) or Two-way (checked out and returned, with a consumption report)

Both types can optionally be assigned to an **Asset Model** (e.g., "Dell Latitude 5550"). When creating an asset from an existing model, fields like category and valuation are pre-filled from the model's defaults.

### 2. Asset Listing

For consumable assets, the asset list shows:

- **Quantity column:** Available vs. total (e.g., "85 / 100 pcs")
- **Low stock badge:** Visual indicator when stock is below the minimum threshold

The asset list also gains a **"Group by Model"** view option:

- Assets sharing the same model are grouped under a collapsible header
- Header shows: model name, total count, and availability summary (e.g., "Dell Latitude 5550 — 8 available / 12 total")

New filters: type (Individual / Consumable), model, and "low stock only."

### 3. Custody with Quantities

**Individual assets** — unchanged. One custodian per asset.

**Consumable assets** — custody becomes quantity-aware:

- "Assign 20 of 100 USB-C cables to Sarah." The available count drops by 20.
- Multiple team members can hold different quantities of the same consumable. "Sarah has 20, Mike has 15, 65 remain available."
- Releasing custody (fully or partially) returns units to the available pool.

### 4. Booking with Quantities

#### Booking consumables

Users can reserve a specific quantity:

1. **Reserve:** "Book 10 extension cords for the conference next week."
2. **Checkout:** The reserved quantity is checked out. For one-way consumables, they're consumed. For two-way, a return is expected.
3. **Check-in (two-way):** The user reports what came back. "7 returned, 3 consumed." The consumed units are permanently deducted; the returned units go back to the available pool.

#### Book-by-Model (generic booking)

Users can book from a model without choosing specific units upfront:

1. **Reserve:** "Book any 5 projectors from the Epson EB-FH52 model for next week." The system checks that 5 are available.
2. **Checkout (scan-to-assign):** At checkout, the operator scans QR codes of specific projector units. Each scan assigns a real asset to the booking. Checkout completes once all reserved units are assigned.
3. **Check-in:** Standard individual check-in for each assigned unit.

### 5. Kit Integration

Kits can include consumable quantities alongside individual assets:

- A kit might contain: "1x Dell Latitude, 1x Projector, 10x USB-C Cable, 5x HDMI Adapter"
- When a kit is checked out, consumable quantities are decremented and individual assets are checked out as usual
- Kit check-in works the same way in reverse

### 6. Location Handling

Consumables are tied to a single location per record. To track the same item across multiple locations, the user **splits** the record:

- **Before:** "100 USB-C cables" at Warehouse A
- **After:** "60 USB-C cables" at Warehouse A + "40 USB-C cables" at Warehouse B

Both records can share the same Asset Model for aggregate reporting. A **merge** operation does the reverse — combines two same-model records into one.

### 7. Consumption Tracking

Each consumable can be configured for one of two tracking modes:

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

Consumables with a minimum quantity threshold trigger alerts when available stock drops to or below that threshold:

- **Dashboard widget:** Shows all low-stock consumables at a glance
- **In-app notification:** Sent to organization admins
- **List badge:** "Low Stock" badge appears on the asset in the list view

Alerts clear automatically when stock rises above the threshold (via restock or returns).

### 9. QR Codes

| Asset Type              | QR Code Behavior                                                            |
| ----------------------- | --------------------------------------------------------------------------- |
| Individual (no model)   | One QR per asset (unchanged)                                                |
| Individual (with model) | One QR per asset (unchanged). QR links to the individual asset page.        |
| Consumable              | One QR per consumable record. Scanning shows the quantity and stock status. |

---

## Transition for Existing Users

- **No disruption.** All existing assets automatically become "Individual" type. Nothing changes for them.
- **No forced migration.** Organizations adopt consumables and models at their own pace.
- **Manual grouping tool.** To organize existing individual assets into models:
  1. Select assets from the list (multi-select or bulk select)
  2. Choose "Create Model" or "Assign to Model" from the bulk actions menu
  3. Enter model details (or pick an existing model) — done

This is gradual and opt-in. Organizations don't need to group everything at once.

---

## Open Questions

These are items for the team to discuss before finalizing the design.

| #   | Question                                                       | Context                                                                                                                                                            | Options                                                                                                              |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 1   | **How should book-by-model handle partial availability?**      | A user books 5 from a model, but only 3 are available at checkout time (2 went into maintenance).                                                                  | A) Block checkout until all available — B) Allow partial checkout and adjust booking — C) Notify and let user decide |
| 2   | **Should Asset Models have their own listing page?**           | Or should they be a filter/grouping within the existing asset index?                                                                                               | A) Separate "Models" page — B) Integrated into the asset list as a view mode — C) Both                               |
| 3   | **Do we need a consumption dashboard in the initial release?** | Consumption rate, top consumed items, cost tracking — useful, but potentially deferrable.                                                                          | A) Include basic consumption report — B) Defer to a follow-up release                                                |
| 4   | **Unit conversion**                                            | If a consumable uses "boxes" as the unit but custody/booking is in individual items, do we need conversion?                                                        | A) Single unit per consumable (no conversion) — B) Base unit + display unit with conversion factor                   |
| 5   | **Custom field defaults from models**                          | When an asset is created from a model, it inherits default custom field values. If the user later edits those fields, should the link to the model defaults break? | A) Independent (model defaults are only initial values) — B) Linked with override tracking                           |
| 6   | **How detailed should the audit trail be?**                    | Every quantity change is logged. Do we also need detailed per-custodian, per-booking, per-location attribution on every change?                                    | A) Simple log (who, what, when, how many) — B) Full attribution (per-custodian, per-booking, per-location)           |

---

# Part 2 — Technical Design

> The following sections are intended for the engineering team. They cover database schema changes, migration details, and implementation phasing.

---

## Design Principles

1. **Extend, don't fragment.** Add an `AssetType` enum to the existing `Asset` model rather than creating separate entity types. This preserves existing queries, filters, bulk operations, and UI patterns.
2. **AssetModel is independent of Category.** An Asset has both a Category (broad organizational grouping like "Electronics") and an optional AssetModel (specific template like "Dell Latitude 5550"). They serve different purposes.
3. **Consumable records are per-location.** When a consumable needs to exist in multiple locations, it is split into separate records. Each record has its own quantity. This keeps the `Asset → Location` relationship singular.
4. **Custody and booking extend with quantities.** Instead of replacing the one-to-one custody model, quantity-aware custody uses a composite unique constraint. Bookings gain a quantity field on an explicit pivot table.

---

## Proposed Data Model

### New Enums

```prisma
enum AssetType {
  INDIVIDUAL    // Default. One row = one physical item.
  CONSUMABLE    // One row = N fungible items at a location.
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

  // Consumable-specific fields (null for INDIVIDUAL assets)
  quantity          Int?            // Total quantity at this location
  availableQuantity Int?            // Currently available (not in custody/booked)
  minQuantity       Int?            // Low-stock alert threshold
  consumptionType   ConsumptionType? // How consumption is tracked
  unitOfMeasure     String?         // e.g., "pcs", "boxes", "liters"
}
```

**Notes:**

- `type` defaults to `INDIVIDUAL`, so existing assets require no data migration.
- Consumable-specific fields are nullable to avoid cluttering individual assets.
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

  // Custom field defaults for this model
  customFields    AssetModelCustomField[]

  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  @@index([organizationId, name])
}
```

**Notes:**

- AssetModel is a template/grouping entity. It holds default values that are applied when creating new assets from this model.
- Relationship to Category is for defaults only — each Asset still has its own `categoryId`.
- An AssetModel can group both individual assets (e.g., 30 laptops of the same model) and serve as a template for creating new ones.

### New Model: AssetModelCustomField

```prisma
model AssetModelCustomField {
  id            String     @id @default(cuid())
  assetModel    AssetModel @relation(fields: [assetModelId],
                            references: [id], onDelete: Cascade)
  assetModelId  String
  customField   CustomField @relation(fields: [customFieldId],
                             references: [id], onDelete: Cascade)
  customFieldId String
  value         String     // Default value for this field on this model

  @@unique([assetModelId, customFieldId])
}
```

### Modified Model: Custody (quantity-aware)

```prisma
model Custody {
  id            String     @id @default(cuid())
  custodian     TeamMember @relation(fields: [teamMemberId],
                            references: [id])
  teamMemberId  String
  asset         Asset      @relation(fields: [assetId], references: [id])
  assetId       String     // Remove @unique for consumables
  quantity      Int        @default(1)  // How many units in custody

  createdAt     DateTime   @default(now())

  @@unique([assetId, teamMemberId])  // One record per asset-custodian pair
}
```

**Key change:** The current `assetId @unique` constraint enforces one custodian per asset. For consumables, we need to allow multiple custodians to hold different quantities. The new constraint is `@@unique([assetId, teamMemberId])` — one record per asset+custodian pair.

For `INDIVIDUAL` assets, application logic continues to enforce single-custodian behavior (only one Custody row allowed). For `CONSUMABLE` assets, multiple Custody rows are permitted, each with a quantity.

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
  quantity    Int      @default(1)  // For consumables: how many booked
  // For model-level booking: starts null, assigned at checkout
  assignedAssetId String?

  @@unique([bookingId, assetId])
}
```

**Notes:**

- For `INDIVIDUAL` assets, `quantity` is always 1.
- For `CONSUMABLE` assets, `quantity` is the number reserved/checked-out.
- For book-by-model bookings, `assetId` initially points to a placeholder or the model's representative asset, and `assignedAssetId` is populated at checkout when specific units are scanned.

### New Model: ConsumptionLog

```prisma
model ConsumptionLog {
  id            String   @id @default(cuid())
  asset         Asset    @relation(fields: [assetId], references: [id],
                          onDelete: Cascade)
  assetId       String
  quantity      Int      // Positive = consumed, negative = restocked
  note          String?
  performedBy   User     @relation(fields: [userId], references: [id])
  userId        String
  booking       Booking? @relation(fields: [bookingId], references: [id])
  bookingId     String?

  createdAt     DateTime @default(now())

  @@index([assetId, createdAt])
}
```

**Purpose:** Audit trail for all quantity changes on consumables. Every checkout, return, restock, or manual adjustment creates a log entry.

### Entity Relationship Overview

```
Organization
├── AssetModel ──────────── (*) Asset
│     (template/group)          │
│                               ├── type: INDIVIDUAL | CONSUMABLE
├── Category ───────────── (*) Asset
│     (broad grouping)          │
│                               ├── (*) Custody ──── TeamMember
├── Location ──────────── (*) Asset     (qty-aware for consumables)
│                               │
├── Kit ───────────────── (*) Asset     (with quantity for consumables)
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

- Add `AssetType` enum, `ConsumptionType` enum
- Add new fields to `Asset` model
- Create `AssetModel` and `AssetModelCustomField` models
- Create `ConsumptionLog` model
- Create `BookingAsset` explicit pivot table
- Run data migration for existing assets and bookings
- Update asset creation form with type selection
- Update asset detail page to show quantity fields for consumables
- Add AssetModel CRUD (create, edit, delete, list)

### Phase 2: Consumable Operations

**Goal:** Quantity-aware checkout, custody, and consumption.

- Quantity-aware custody: assign/release partial quantities
- Modify Custody model (remove unique constraint, add quantity)
- Consumption tracking (one-way and two-way flows)
- ConsumptionLog recording
- Restock flow
- Low-stock alert threshold and notifications
- Update asset list to display quantities and low-stock badges

### Phase 3: Booking Integration

**Goal:** Quantity-aware bookings and book-by-model.

- Consumable booking: reserve quantity N of a consumable
- Quantity on `BookingAsset` pivot
- Book-by-model: reserve N from an AssetModel
- Scan-to-assign at checkout for model-level bookings
- Conflict detection for quantity-aware and model-level bookings
- Partial check-in with consumption reports (two-way consumables)
- Calendar view updates

### Phase 4: Kit, Location, and Auxiliary Features

**Goal:** Remaining integrations and polish.

- Kit integration: consumable quantities in kits
- Kit checkout/check-in with consumable quantity handling
- Location split and merge for consumables
- Model grouping tool (bulk assign existing assets to a model)
- QR code handling for consumables and model groups
- Asset list: group-by-model view
- Import/export with quantity columns
- Bulk operations awareness of asset types
