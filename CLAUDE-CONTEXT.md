# Quantitative Assets — Session Context

> This file captures the full context of the Phase 1 & 2 implementation
> session so work can continue in a new Claude Code session.

## Branch: `feat-quantities`

## PR: https://github.com/Shelf-nu/shelf.nu/pull/2337

## PRD: `docs/proposals/quantitative-assets.md`

---

## What was built

### Phase 1: Foundation (COMPLETED)

**Schema:**

- Added `AssetType` (INDIVIDUAL/QUANTITY_TRACKED), `ConsumptionType` (ONE_WAY/TWO_WAY), `ConsumptionCategory` (CHECKOUT/RETURN/RESTOCK/ADJUSTMENT/LOSS) enums
- Added quantity fields to Asset: `type`, `quantity`, `minQuantity`, `consumptionType`, `unitOfMeasure`, `assetModelId`
- Created `AssetModel` entity (template/grouping for assets) with default category/valuation
- Created `ConsumptionLog` model for audit trail (used in Phase 2)
- Created `BookingAsset` explicit pivot table (coexists with implicit M2M — Phase 3 will do the rename migration)
- `availableQuantity` is NOT stored — computed at service layer (Decision #7)

**AssetModel CRUD:**

- Service: `app/modules/asset-model/service.server.ts`
- Routes under `settings.asset-models.*` (Settings > Workspace Settings > Asset Models)
- Full-page Card-based create/edit forms with DynamicSelect for default category
- Inline creation dialog on the asset form (like categories)
- Bulk delete with filter awareness (ALL_SELECTED_KEY respects search params)
- Delete dialog shows asset count warning

**Asset form:**

- Tracking method selector (radio cards: "Individually tracked" / "Tracked by quantity")
- Quantity fields appear below Name, above Asset ID when "Tracked by quantity" selected
- Consumption type uses Popover-based dropdown
- Asset Model DynamicSelect with default category auto-selection via search params
- Server-side validation for quantity-tracked assets

**Asset detail page:**

- QuantityOverviewCard in right sidebar showing computed total/available/inCustody
- Low Stock badge when available ≤ minQuantity
- Asset model link (permission-gated)

**Asset list:**

- QTY badge next to quantity-tracked asset names
- Quantity column in both simple and advanced views
- Tracking method and Asset model columns in advanced view
- Filters: quantity (number type), tracking type (enum), asset model (enum with DynamicSelect)
- Sort support for type, quantity, assetModel columns

### Phase 2: Quantity-Aware Custody & Consumption (COMPLETED)

**Schema migration:**

- Custody model: removed `@unique` on `assetId`, added `quantity Int @default(1)`, added `@@unique([assetId, teamMemberId])`
- Asset.custody changed from `Custody?` to `Custody[]` (one-to-many)
- Database trigger `custody_individual_asset_check` enforces single custodian for INDIVIDUAL assets
- 30+ files updated with `getPrimaryCustody()` and `hasCustody()` helpers from `app/modules/custody/utils.ts`

**ConsumptionLog service:** `app/modules/consumption-log/service.server.ts`

- `createConsumptionLog()` — with optional transaction client
- `getConsumptionLogs()` — paginated history
- `computeAvailableQuantity()` — `{ total, inCustody, available }` via `Promise.all`
- `adjustQuantity()` — transactional with `SELECT FOR UPDATE` row locking

**Concurrency:** `app/modules/consumption-log/quantity-lock.server.ts`

- `lockAssetForQuantityUpdate()` — PostgreSQL `SELECT FOR UPDATE` within Prisma transaction

**Quantity custody:** `app/modules/asset/service.server.ts`

- `checkOutQuantity()` — lock → validate → upsert custody → log CHECKOUT
- `releaseQuantity()` — lock → validate → delete/decrement custody → log RETURN
- Routes: `api+/assets.assign-quantity-custody.ts`, `api+/assets.release-quantity-custody.ts`
- UI: `QuantityCustodyDialog`, `QuantityCustodyList` (sidebar card with per-custodian release)

**Quick-adjust:** `api+/assets.adjust-quantity.ts`

- `QuickAdjustDialog` — Add (RESTOCK) / Remove (LOSS) with note
- Integrated into QuantityOverviewCard ("Adjust" button)
- Auto-opens after QR scan for quantity-tracked assets

**Low-stock notifications:** `app/modules/consumption-log/low-stock.server.ts`

- In-app notification via `sendNotification()`
- Email alert to org owner via React Email template (`app/emails/low-stock-alert.tsx`)
- Triggered after checkouts and subtractive adjustments

**QuantityOverviewCard:** Computed real values from custody aggregation. Shows `available / total` with Low Stock badge.

---

## Key Decisions (from PRD)

1. `availableQuantity` computed, not stored (Decision #7)
2. Custody partial unique index → replaced with DB trigger (PostgreSQL doesn't allow subqueries in partial index predicates)
3. `ConsumptionLog.quantity` always positive, direction from category (Decision #9)
4. BookingAsset migration deferred to Phase 3 using safe rename strategy (Decision #10)
5. Concurrency via `SELECT FOR UPDATE` row locking within `db.$transaction()`
6. `Custody?` → `Custody[]` with `getPrimaryCustody()` helper for backward compat
7. Asset model names are NOT unique per org (allow duplicates)

---

## Phase 3 — Booking Integration (IN PROGRESS)

**Goal:** Quantity-aware bookings and book-by-model.

**Resolved prerequisites:**

- OQ #2: Show warning at checkout if availability changed, let user proceed
- OQ #5: Store model-level intent in `BookingModelRequest`, create `BookingAsset` rows at scan-to-assign time

### Sub-phase 3a: Table Rename + Rewiring (COMPLETED)

**Migration:** Renamed `_AssetToBooking` → `BookingAsset` (rename strategy, no data copy).

- Dropped empty Phase 1 `BookingAsset` shell, renamed implicit M2M table
- Columns `A`/`B` → `assetId`/`bookingId`, added `id` (text PK) + `quantity` (default 1)
- Removed implicit M2M from Prisma schema (`Booking.assets`, `Asset.bookings`)
- Rewired ~60 Prisma relation usages and 18 raw SQL queries
- All `booking.assets` → `booking.bookingAssets` with nested `.asset`
- All `asset.bookings` → `asset.bookingAssets` with nested `.booking`
- `connect/disconnect` → `create/deleteMany` on BookingAsset
- `_count.assets` → `_count.bookingAssets` everywhere
- Added `normalizeBookingAssets()` adapter helper
- Updated all tests

### Sub-phase 3b: Quantity-Tracked Bookings (IN PROGRESS)

**Completed:**

- `computeBookingAvailableQuantity()` — `Available = Total - InCustody - Reserved`
- `updateBookingAssets()` accepts per-asset `quantities` map
- Manage-assets UI: quantity picker for qty-tracked assets, blue badge, availability filtering
- Conflict detection: qty-tracked assets skip binary checks (validated at service layer)
- Checkout validation: validates quantity availability, throws if insufficient
- Check-in: QUANTITY_TRACKED assets don't get status reset (other bookings/custody may exist)
- Booking overview: `bookedQuantity` attached to enriched items for display
- Sidebar + list-asset-content: show "× N" for qty-tracked assets
- Email: show "× N" for qty > 1
- PDF: added "Qty" column
- Manage-assets polish: quantities initialized from existing booking, unsaved-changes detection
- Constants: `type: true` added to asset selects in booking includes

**Needs testing/polish:**

- Full end-to-end booking flow with qty-tracked assets (create → reserve → checkout → checkin)
- Quantity display consistency across all views
- Edge cases: fully-allocated assets, concurrent bookings on same qty asset

### Sub-phase 3c: Quantity-aware Check-in (NOT STARTED)

**Goal:** Make check-in respect `BookingAsset.quantity` and `Asset.consumptionType`.
Today both the quick and explicit check-in paths treat every asset as binary
(scanned or not), ignoring booked quantities and consumption behavior. The PRD
calls this out ("7 returned, 3 consumed") but it was never wired in Phase 3b.

**Scheduling note:** This must land **before** sub-phase 3d (book-by-model).
Book-by-model will also flow through check-in, so we need the quantity-aware
check-in plumbing in place first to avoid re-doing it for both paths.

**Gap (see the "Current state" report for line-level details):**

| Behavior                                         | Quick check-in | Explicit check-in |
| ------------------------------------------------ | -------------- | ----------------- |
| Accept a return quantity                         | ❌             | ❌                |
| Branch on `consumptionType`                      | ❌             | ❌                |
| Write `ConsumptionLog` (RETURN / LOSS / CONSUME) | ❌             | ❌                |
| Decrement `Asset.quantity` for ONE_WAY consume   | ❌             | ❌                |
| Validate return qty ≤ booked qty                 | ❌             | ❌                |
| Prompt the user in the drawer UI                 | ❌             | ❌                |

**Files in scope:**

- Service: `app/modules/booking/service.server.ts`
  - `partialCheckinBooking()` (~line 1773)
  - `checkinBooking()` (~line 1381)
  - `checkinAssets()` wrapper (~line 4865)
- Route: `app/routes/_layout+/bookings.$bookingId.overview.checkin-assets.tsx`
  (action + `partialCheckinAssetsSchema` — currently only `assetIds`)
- UI: `app/components/scanner/drawer/uses/partial-checkin-drawer.tsx`
- Existing infra to reuse:
  - `createConsumptionLog()` in `app/modules/consumption-log/service.server.ts`
  - `lockAssetForQuantityUpdate()` in `app/modules/consumption-log/quantity-lock.server.ts`
  - The `ConsumptionLog.bookingId` relation already exists for audit trail

**Behavior spec:**

- **TWO_WAY (returnable):**
  - Per qty-tracked row in the drawer: number input, default = `BookingAsset.quantity`,
    min = 0, max = `BookingAsset.quantity`.
  - If `returned < booked`: write two logs in one transaction — `RETURN` for
    the returned count, `LOSS` for the remainder — and decrement
    `Asset.quantity` by the lost delta.
  - If `returned == booked`: single `RETURN` log, `Asset.quantity` unchanged.
- **ONE_WAY (consumable):**
  - No input. Drawer shows "X units will be consumed" as informational.
  - Single log with category `CONSUME` (new enum value — see open question),
    `Asset.quantity` decremented by `BookingAsset.quantity`.
- **INDIVIDUAL assets:** unchanged — current binary flow is correct.
- `BookingAsset.quantity` is **not** mutated on check-in; it stays as the
  historical record of what was booked. Flow-back is captured in
  `ConsumptionLog`.

**Concurrency:** All pool-mutating steps (log write + `Asset.quantity`
decrement + `BookingAsset` update + status flip) happen in a single
`db.$transaction` with `lockAssetForQuantityUpdate()`, matching the Phase 2
pattern from `checkOutQuantity`.

**Activity notes:**

- Asset-side: "<user> returned **N** / consumed **M** units via <booking>"
- Booking-side system note: summary line listing returned/consumed counts per
  asset (use `wrapAssetsWithDataForNote` helper for the list, append qty
  annotations — same pattern we just standardized in `manage-assets`).

**Schema changes (candidate):**

- Add `CONSUME` to `ConsumptionCategory` enum. Current values are
  `CHECKOUT | RETURN | RESTOCK | ADJUSTMENT | LOSS`. Overloading `LOSS` for
  intentional consumption would muddy low-stock / loss reporting later.

**Open questions (resolve before coding):**

1. New `CONSUME` category vs. reusing `LOSS`?
2. For TWO_WAY partial returns, auto-decrement `Asset.quantity` for the
   missing units, or flag them for explicit follow-up (a separate
   "mark-as-lost" step)?
3. Multiple partial check-ins from the same booking: allowed? If yes,
   `PartialBookingCheckin` already records per-asset slices — we can sum.
4. How does "early check-in" (date before booking end) interact here —
   anything extra to validate?

**Test coverage to add:**

- Unit: `partialCheckinBooking` across each `(type × consumptionType ×
returnedQty)` matrix.
- Integration: `checkin-assets` route with qty-tracked assets (happy path,
  partial return, over-return rejection, consume path).
- Regression: INDIVIDUAL asset check-in path unchanged.

---

### Sub-phase 3d: Book-by-Model (NOT STARTED)

- New `BookingModelRequest` model (schema change needed)
- Reserve by model service
- Scan-to-assign at checkout
- Availability accounting for model requests
- UI: model picker, fulfillment status, scanner drawer mode
- Depends on sub-phase 3c so model-based bookings check in with the same
  quantity/consumption semantics as direct qty bookings.

### Sub-phase 3e: Calendar + Polish (NOT STARTED)

- Calendar tooltip quantity info
- Edge cases: multiple bookings from same qty pool, overdue handling

## Phase 4 — Kit, Location, and Auxiliary

- Kit integration with quantity-tracked items
- Location split/merge for quantity-tracked assets (pending design)
- Model grouping tool
- Import/export with quantity columns

---

## Migrations applied

1. `20260331101357_add_asset_model_and_quantity_based_fields` — Phase 1 schema
2. `20260401113301_add_index_to_asset_models` — Index on AssetModel
3. `20260403135852_add_quantity_based_custody_fields` — Custody quantity + composite unique
4. `20260403140000_add_custody_individual_unique_trigger` — DB trigger for individual asset single custody
5. `20260409100000_rename_asset_to_booking_to_booking_asset` — Phase 3a: rename implicit M2M to explicit BookingAsset

---

## PR Review rounds

Three rounds of CodeRabbit/Copilot review feedback were addressed:

- Bulk delete filter awareness
- Delete dialog disabled states
- Custody permission checks
- Number filter SQL type casting
- Sort mappings for new columns
- Server-side error fallbacks on forms
- Low-stock email notifications

All review threads resolved on the PR.

---

## Files created in this feature

### New modules:

- `app/modules/asset-model/service.server.ts`
- `app/modules/consumption-log/service.server.ts`
- `app/modules/consumption-log/quantity-lock.server.ts`
- `app/modules/consumption-log/low-stock.server.ts`
- `app/modules/custody/utils.ts`

### New components:

- `app/components/asset-model/` — form, quick-actions, delete-asset-model, bulk-actions-dropdown, bulk-delete-dialog
- `app/components/assets/quantity-overview-card.tsx`
- `app/components/assets/quantity-custody-dialog.tsx`
- `app/components/assets/quantity-custody-list.tsx`
- `app/components/assets/quick-adjust-dialog.tsx`

### New routes:

- `settings.asset-models.tsx` (parent), `settings.asset-models.index.tsx`, `settings.asset-models.new.tsx`, `settings.asset-models.$assetModelId_.edit.tsx`
- `api+/assets.adjust-quantity.ts`
- `api+/assets.assign-quantity-custody.ts`
- `api+/assets.release-quantity-custody.ts`

### New emails:

- `app/emails/low-stock-alert.tsx`

### New tests:

- `app/modules/asset-model/service.server.test.ts`
- `app/components/asset-model/form.test.ts`
- `app/components/assets/form.test.ts`
- `test/factories/assetModel.ts`

---

## Current testing status

Phase 2 was browser-tested and verified working:

- Quantity Overview card shows real computed values ✅
- Quick Adjust — Add stock (restock) ✅
- Assign quantity custody to team member ✅
- Available quantity decreases correctly ✅
- Custody Breakdown shows custodians + quantities ✅
- Low Stock badge ✅
- Individual asset custody unchanged (regression) — needs manual verification
- Release custody — needs manual verification
- Remove stock via quick-adjust — needs manual verification
- Low-stock email delivery — needs verification
- Concurrent operations — needs verification

## Known Issues

### Duplicate rows in advanced asset index for multi-custodian quantity assets

**Problem:** When a quantity-tracked asset has multiple custody records (multiple
custodians), it shows as duplicate rows in the advanced index view. This is because
the raw SQL query in `asset/query.server.ts` does a `LEFT JOIN` on `Custody` and
the `GROUP BY` includes `cu.id`, so each custody record produces a separate row.

**Root cause:** `assetQueryJoins` (line 1866) joins custody 1:1 per row, and the
`GROUP BY` in `service.server.ts` (line 907) groups by `cu.id, tm.name, u.id, ...`
— grouping per custody record instead of per asset.

**Fix needed:** Replace the direct custody LEFT JOIN with a lateral subquery or
correlated subquery that aggregates all custody records into a single JSON array
per asset. This way each asset produces exactly one row regardless of how many
custodians it has. The custody column in the index should show multiple custodians
(e.g., "Project Engineer (4), Self Service (7)") rather than duplicating the row.

**Files to change:**

- `app/modules/asset/query.server.ts` — `assetQueryJoins` and custody CASE block
- `app/modules/asset/service.server.ts` — GROUP BY clause (remove `cu.id`, `tm.name`, `u.id`, etc.)
- Asset index UI components — custody column renderer to handle multiple custodians

### Kit custody assigns only 1 unit for quantity-tracked assets

**Problem:** When a quantity-tracked asset is added to a kit that already
has custody, the inherited custody record is created with `quantity: 1`
(the default) instead of the asset's full tracked quantity. The asset
gets marked `IN_CUSTODY` while only 1 unit is actually assigned.

**Files to change:**

- `app/modules/kit/service.server.ts` — the `custody.create` inside
  `assetsToInheritStatus` map (~line 2256) needs to set `quantity`
  from the asset's tracked amount

### Kit removal wipes all custody for quantity-tracked assets

**Problem:** Removing a quantity-tracked asset from an in-custody kit
deletes ALL custody rows via `custody: { deleteMany: {} }` and forces
`AVAILABLE` status. This erases unrelated quantity custody allocations
that have nothing to do with the kit.

**Files to change:**

- `app/routes/_layout+/kits.$kitId.tsx` (~line 297) — needs a
  quantity-aware release path that only removes the kit-related
  custody record, not all of them
