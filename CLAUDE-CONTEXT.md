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

### Sub-phase 3b: Quantity-Tracked Bookings (COMPLETED)

Shipped in commit `13eed847f`.

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
- TOCTOU hardening (`9f7642b84`): row-locked availability re-checks in
  `checkoutBooking` and `adjust-asset-quantity` API; input validation on
  the JSON `quantities` map and the merged_bug_001 cross-tenant IDOR
  in `adjustQuantity`.

### Sub-phase 3c: Quantity-aware Check-in (COMPLETED)

Shipped across `60bfebe35` (core), `1fd4ad5bb` (test scaffold + qty
unit coverage), `e92dfd52e` (audit-style expected-list UX in the
partial-checkin drawer).

- Drawer ledger UI: per-asset disposition split (Returned / Consumed /
  Lost / Damaged) with cumulative totals across check-in sessions
  (qty-tracked partials persist via `ConsumptionLog` rows).
- Service: `partialCheckinBooking` + `checkinBooking` accept a
  `dispositions` map and write `ConsumptionLog` rows transactionally
  per asset. `checkinAssets` wrapper rebuilt around the new shape.
- Route: `bookings.$bookingId.overview.checkin-assets.tsx` action
  parses the new schema; loader ships partial-checkin progress for
  the drawer + sidebar overlays.
- Audit-style "expected list" pattern ported into the drawer — items
  pre-rendered as pending rows, flip to scanned on QR; ledger UI
  redesigned per Phase 3c follow-up.
- 22 unit tests (14 booking, 3 asset checkOutQuantity, 5 pure
  booking-asset utils).

**Original gap doc kept below for historical reference:**

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

**Follow-ups to land before Sub-phase 3d (Book-by-Model):**

1. **Refactor partial check-in UX to match the audit UI pattern.** The
   current scanner-drawer flow diverges from how audits present the same
   "per-asset, per-session reconciliation" mental model. Unify the two so
   users don't have to learn two paradigms for the same kind of work.
   User to expand the spec before we start; design should follow the
   audit UI as the baseline.
2. **Implement consumption-log view on the asset page.** Phase 2 built
   the `ConsumptionLog` model and Phase 3c populates it heavily on
   check-in (RETURN / CONSUME / LOSS / DAMAGE), but there's no
   user-facing surface for the resulting audit trail. Add a
   consumption-log tab or section on the asset detail page showing the
   chronological log with category, quantity, booking link, user, and
   note. Reuse `getConsumptionLogs` from
   `modules/consumption-log/service.server.ts`.
3. **Unit tests for everything in Phase 3c.** The service-level
   refactors (`partialCheckinBooking`, `checkinBooking`,
   `computeBookingAssetRemaining`, `isBookingFullyCheckedIn`) and the
   route-level action shipped without unit-test coverage; manual
   verification via `TESTING-PHASE-3C.md` only. Land the test matrix
   documented in that file before book-by-model touches the same code.

---

### Sub-phase 3d: Book-by-Model (COMPLETED)

Shipped in commit `e5cbd7568`. Plan file:
`/home/donkoko/.claude/plans/phase-3d-book-by-model.md`. Manual test
checklist: `TESTING-PHASE-3D.md` at repo root.

- New `BookingModelRequest` pivot table (`{bookingId, assetModelId,
quantity}` with `@@unique([bookingId, assetModelId])`). Intent
  row; decrements on scan, deletes on last unit.
- Migration: `20260421125426_add_booking_model_request`.
- Service module `modules/booking-model-request/service.server.ts`:
  `getAssetModelAvailability`, `upsertBookingModelRequest`,
  `removeBookingModelRequest`, `materializeModelRequestForAsset`.
  All tx-aware; availability subtracts custody + concrete
  BookingAsset reservations + other bookings' model-level
  requests within the date window.
- Checkout hard-block in `checkoutBooking` when any request has
  `quantity > 0`. No `forcePartial` — security over flexibility.
  Error payload carries `outstanding: [{assetModelName, remaining}]`
  for UI surfacing.
- Scan-to-assign integrates into `addScannedAssetsToBooking`:
  unmatched scans fall through to the existing direct-
  BookingAsset path (no regression for model-free bookings).
- HTTP route `api+/bookings.$bookingId.model-requests.ts` (POST
  upsert / DELETE remove).
- UI: manage-assets gains a **Models** tab (picker + per-model
  availability hints + remove buttons); sidebar shows
  "Unassigned model reservations (N)" above the asset list;
  reservation email + PDF both gain "Requested models" sections.
- +17 unit tests (15 service + 2 checkout guard); full
  `webapp:validate` green (130 files, 1742 tests).

### Sub-phase 3d-Polish: Fulfil-and-Checkout Flow (COMPLETED)

Shipped in commits `c1596f239` (core) + `1a5a12ffe` (table-integrated
row refactor).

- New `/bookings/:id/overview/fulfil-and-checkout` route + dedicated
  scanner drawer (`fulfil-reservations-drawer.tsx`) with audit-style
  expected-list preview, per-model progress strips, and matched /
  unmatched / duplicate / already-included buckets. Inline
  `CheckoutDialog` surfaces the early-checkout alert without leaving
  the scanner.
- `fulfilModelRequestsAndCheckout` service composes scan-materialise +
  checkout writes in a single `$transaction` via shared helpers
  (`addScannedAssetsToBookingWithinTx`, `checkoutBookingWritesWithinTx`,
  `runCheckoutSideEffects`) — same callback also records the activity
  events main brought in.
- **Audit-trail schema refactor:** `BookingModelRequest` rows are no
  longer deleted on fulfilment. New columns
  `fulfilledQuantity Int @default(0)` + `fulfilledAt DateTime?`.
  Outstanding filter is `fulfilledAt IS NULL`. Manage-assets **Models**
  tab splits into "Active" + "Fulfilled (read-only)" sections.
  Migration `20260423120457_track_fulfilled_quantity_on_booking_model_request`.
- `removeAssets` decrements `fulfilledQuantity` so scan → remove →
  rescan self-heals without orphaning the request.
- `reserveBooking` rejects non-`DRAFT` to suppress spurious
  Reserved → Reserved transition notes when a fulfil flow re-enters
  the route.
- Model-request rows render inline in the **Assets & Kits** list (not a
  separate Card) with a Popover-based actions kebab matching
  `AssetRowActionsDropdown`.
- 5 contract tests added for `fulfilModelRequestsAndCheckout`.

### Sub-phase 3d follow-ups (NOT STARTED)

Found during manual testing of 3d — worth a dedicated sub-phase
rather than stretching 3d itself.

1. **Bulk-create assets per model.** Currently you can only create
   one asset at a time from an `AssetModel`. For orgs with large
   fleets (10 of the same laptop, 20 of the same battery) this is
   tedious. Add a "Create N assets from this model" action on the
   AssetModel detail page that:
   - Takes a quantity + a title-template (e.g. `Dell Latitude {i}`)
     or a base title that gets suffixed
   - Creates all assets in one transaction with the model's
     defaults (category, valuation) pre-applied
   - Surfaces progress / rolls back on partial failure
   - Could also support per-asset QR codes generated up-front
2. **Asset index grouped by model.** The current asset index lists
   every asset flat. For orgs using models heavily, a "group by
   model" view would:
   - Show each `AssetModel` as a collapsible header with the
     count of assets underneath and a "N available / M total"
     summary
   - Collapse individual assets under the header by default; click
     to expand
   - Filter / search still works across the flattened list — the
     grouping is purely a view toggle
   - Needs server-side aggregation since client-side grouping
     across pages doesn't work
3. **Import round-trip for `AssetModel`.** The export CSV already
   includes an `assetModel` column (see `csv.server.ts:505`
   reading `asset.assetModelName`), but
   `createAssetsFromContentImport` in `modules/asset/service.server.ts:2495`
   does NOT handle it — the module uses
   `createKitsIfNotExists` / `createCategoriesIfNotExists` /
   `createLocationsIfNotExists` / `createTagsIfNotExists` /
   `createTeamMembersIfNotExists` / `createCustomFieldsIfNotExists`
   but has no `createAssetModelsIfNotExists` sibling, so the
   export→import round-trip silently drops the model link.
   Add:
   - `createAssetModelsIfNotExists({ data, userId, organizationId })`
     helper that upserts `AssetModel` rows by name (org-scoped,
     case-insensitive match to tolerate casing drift in CSVs)
   - Wire the helper into the `Promise.all` batch around
     `service.server.ts:2558-2580` alongside the other related
     entities
   - Pass the resolved `assetModelId` into the per-asset `create`
     block in the same tx (mirrors the existing `categoryId`
     handling)
   - Update the sample / downloadable template CSV so admins
     know the column exists on import, not just export
   - Handles `assetModel = ""` as "no model" (clears on update
     imports per the backup-import path)
   - Backup import (`createAssetsFromBackupImport` at
     `service.server.ts:2867`) needs the same treatment

Tracking as a future Phase 3d.1 (or whatever we call it) — blocks
nothing, worth scoping once we decide the model UX direction.
Natural order: bulk-create first (operators need to populate
models), then import round-trip (CSV parity with categories /
kits), then index grouping (last because it's the most UX-heavy).

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
6. `20260421125426_add_booking_model_request` — Phase 3d: model-request pivot table
7. `20260423120457_track_fulfilled_quantity_on_booking_model_request` — Phase 3d-Polish: audit-trail columns (`fulfilledQuantity`, `fulfilledAt`)
8. `20260421123609_add_activity_events_model` — main (PR #2495): structured `ActivityEvent` table for reports

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

## Last sync with main

| When                 | Merge commit | What main brought                                                                                                              | Pre-merge HEAD |
| -------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| 2026-04-29 (earlier) | `a613f4231`  | Misc churn pre-PR-2495                                                                                                         | `1a5a12ffe`    |
| 2026-04-29 (later)   | `a64d8c22e`  | **PR #2495 — Activity Events / Reports system** + React Doctor integration + audit bulk-actions + 4 new `.claude/rules/` files | `a613f4231`    |

Conflicted files in the `a64d8c22e` merge: `utils/error.ts`,
`assets/form.tsx`, `booking/availability-label.tsx`,
`booking/service.server.test.ts`, `booking/service.server.ts`,
`custody/service.server.ts`,
`scanner/drawer/uses/partial-checkin-drawer.tsx`. Resolutions
documented in the commit body of `a64d8c22e`.

**Open follow-up from this sync:** main's `reports/helpers.server.ts`
(~1500 lines) and `scripts/seed-reporting-demo/*` came in unconflicted
but reference pre-Phase-3a `asset.bookings` / `booking.assets` and
pre-Phase-2 `custody.custodian` (singular). ~60 typecheck errors. The
ActivityEvent migration + service + types compile fine and are wired
into checkout / checkin / partialCheckin. The report _renderers_ and
seed scripts won't run until ported; tracking under "Reports port".

---

## Files created in this feature

### New modules:

- `app/modules/asset-model/service.server.ts`
- `app/modules/consumption-log/service.server.ts`
- `app/modules/consumption-log/quantity-lock.server.ts`
- `app/modules/consumption-log/low-stock.server.ts`
- `app/modules/custody/utils.ts`
- `app/modules/booking-model-request/service.server.ts` (+ `.test.ts`) — Phase 3d

### New components:

- `app/components/asset-model/` — form, quick-actions, delete-asset-model, bulk-actions-dropdown, bulk-delete-dialog
- `app/components/assets/quantity-overview-card.tsx`
- `app/components/assets/quantity-custody-dialog.tsx`
- `app/components/assets/quantity-custody-list.tsx`
- `app/components/assets/quick-adjust-dialog.tsx`
- `app/components/booking/manage-model-requests.tsx` — Phase 3d Models tab
- `app/components/booking/model-request-row-actions-dropdown.tsx` — Phase 3d-Polish
- `app/components/scanner/drawer/uses/fulfil-reservations-drawer.tsx` — Phase 3d-Polish

### New routes:

- `settings.asset-models.tsx` (parent), `settings.asset-models.index.tsx`, `settings.asset-models.new.tsx`, `settings.asset-models.$assetModelId_.edit.tsx`
- `api+/assets.adjust-quantity.ts`
- `api+/assets.assign-quantity-custody.ts`
- `api+/assets.release-quantity-custody.ts`
- `api+/bookings.$bookingId.model-requests.ts` — Phase 3d
- `_layout+/bookings.$bookingId.overview.fulfil-and-checkout.tsx` — Phase 3d-Polish

### New hooks:

- `app/hooks/use-booking-checkin-session-initialization.ts` — Phase 3c (audit-style expected list)
- `app/hooks/use-booking-fulfil-session-initialization.ts` — Phase 3d-Polish

### New emails:

- `app/emails/low-stock-alert.tsx`

### New tests:

- `app/modules/asset-model/service.server.test.ts`
- `app/components/asset-model/form.test.ts`
- `app/components/assets/form.test.ts`
- `test/factories/assetModel.ts`

---

## Current testing status

**Pre-merge baseline at `a613f4231`:** full `pnpm webapp:validate` green
— **1865 / 1865** tests across 133 files (up from 1747 before
Phase 3c/3d/3d-Polish unit-test additions). `TESTING-PHASE-3D.md`
manual checklist is current.

**Post-merge at `a64d8c22e` (pending):** typecheck has ~60 errors in
main's reports + seed scripts (Phase-3a/Phase-2 incompatibility — see
"Last sync with main"). Custody / booking / drawer / activity-event
paths are clean. Test count and validate status will be re-baselined
once the reports port lands.

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
