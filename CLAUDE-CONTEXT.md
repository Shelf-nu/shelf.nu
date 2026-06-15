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

### Sub-phase 3d-Polish-2: Kit Custody Correctness + UX (COMPLETED, shipped in `4f0d9d69b`)

Resolves the three "Known Issues" that had been open since Phase 2/3a
shipped, plus a cluster of folded-in fixes caught during manual
testing. Tracking doc: `TESTING-KIT-CUSTODY-CORRECTNESS.md` at the
worktree root.

**Headline correctness fixes:**

- **Issue A — Asset-index duplicate rows.** Multi-custodian qty-tracked
  assets used to render N rows where N = custodian count. Replaced the
  per-custody `LEFT JOIN` in `asset/query.server.ts` with a
  `LEFT JOIN LATERAL` + `jsonb_agg(...) AS custody` exposing a single
  jsonb array per asset. Dropped `cu.id, tm.name, u.*` from the
  `GROUP BY` in `asset/service.server.ts`. The custody column now
  renders the primary custodian inline + a `+N more` chip whose
  tooltip lists every custodian with their `(qty)` suffix. Same
  multi-custodian rendering ported to the simple asset index too.
- **Issue B — Kit-custody quantity = 1 regardless of asset qty.**
  `buildKitCustodyInheritData` now reads existing custody for each
  asset inside the tx and writes
  `quantity = asset.quantity − Σ(existing custody)` for qty-tracked,
  `quantity = 1` for INDIVIDUAL. Fully-allocated assets are silently
  skipped (no kit row created — `remaining ≤ 0` branch). Refactored
  three call sites: `updateKitAssets`, `bulkAssignKitCustody`,
  `kits.$kitId.assets.assign-custody.tsx`.
- **Issue C — Kit removal wipes ALL custody.** Filter every kit→asset
  custody `deleteMany` by `{ kitCustodyId }` so operator-assigned rows
  on the same asset survive. `bulkReleaseKitCustody` /
  `releaseCustody` (kit) / `deleteKit` use **emit-first-then-cascade**:
  query the kit-allocated rows, emit `CUSTODY_RELEASED` events, then
  delete the parent `KitCustody` (FK cascade removes children). Asset
  status flip is **conditional** — only flips to AVAILABLE when zero
  remaining Custody rows exist after the kit-allocated removal.

**Schema change:** new column on `Custody`:

```prisma
kitCustody   KitCustody? @relation(fields: [kitCustodyId], references: [id], onDelete: Cascade, onUpdate: Cascade)
kitCustodyId String?
@@index([kitCustodyId])
```

Plus inverse `inheritedCustody Custody[]` on `KitCustody`. Migration:
`20260430100759_add_kit_custody_id_to_custody`. Includes a one-shot
backfill UPDATE that walks `KitCustody → Kit → Asset` and matches
`Custody.teamMemberId = KitCustody.custodianId` to tag pre-existing
kit-allocated rows on prod (628 KitCustody parents at time of
writing). Schema bits verified in dev DB; backfill correctness
requires a staging or prod-snapshot test (path B in the testing doc).

**Folded-in fixes that landed in the same scope:**

- **Picker-filter visibility.** `?status=AVAILABLE` on the
  manage-assets pickers (kit + location) now includes qty-tracked
  rows. Pre-fix, qty-tracked assets whose row.status flipped to
  IN*CUSTODY (because \_any* unit was allocated) were excluded
  entirely. Fix in `asset/service.server.ts:638` and
  `asset/utils.server.ts:478` — when `status === AVAILABLE`, build a
  qty-aware `OR` clause; INDIVIDUAL still uses strict status, qty-tracked
  is included regardless. IN_CUSTODY / CHECKED_OUT semantics unchanged.
- **Custody filter SQL** (`Custody is in-custody / without-custody`).
  Replacing the LEFT JOIN with the lateral broke the seven `cu.id IS
NULL` / `cu.id IS NOT NULL` clauses in `addCustodyFilter`. Now use
  `jsonb_array_length(custody_agg.custody) > 0 / = 0`. The `EXISTS
(SELECT 1 FROM "Custody" cu WHERE …)` subqueries are unaffected
  (their `cu` is locally scoped).
- **Kit-aware qty display on kit detail page.** When the kit is in
  custody, qty-tracked rows show `· N / M units in kit` where N =
  kit-allocated (sum of `Custody.quantity` for the kit's
  `KitCustody.id`) and M = `asset.quantity`. When kit not in custody,
  falls back to `· M units`. INDIVIDUAL rows are unaffected. Threaded
  via `useRouteLoaderData("routes/_layout+/kits.$kitId")` so the
  asset-list child route reads the parent's kit context.
- **Qty display on lists** outside the kit page — Location detail and
  the add-to-kit scanner drawer show `· N units` (or `<unitOfMeasure>`).
- **Status flip on last release.** `releaseQuantity` was deleting the
  Custody row but never updating `Asset.status`. Now counts remaining
  custody rows after the delete; if zero, flips status to AVAILABLE.
  Mirrors the kit-flow conditional-flip pattern.
- **"Via kit" badge in Custody Breakdown.** On the asset overview's
  Custody Breakdown card, kit-allocated rows now render a blue "Via
  kit" badge with a tooltip linking to the parent kit, instead of the
  Release button. Releasing a kit-allocated row directly would
  corrupt state (orphan parent KitCustody). Server-side guard added
  in `releaseQuantity` for defense in depth: throws 400 if
  `custody.kitCustodyId` is set.
- **Informational note in `QuantityCustodyDialog`.** When the asset
  is in any kit, a soft blue note tells the user operator custody is
  tracked separately from the kit's allocation. **Important:** this
  note's copy must be revised once Phase 4 ships the rebalance
  feature — see the Phase-4 bullet about reviewing this note.
- **Filter-UI infinite-loop fix** (unrelated but caught during
  testing). `value-field.tsx` was calling `setFilter("")` on enum
  fields with no default, retriggering its own effect on every
  parent re-render → "Maximum update depth exceeded". Fixed by
  removing the no-op `setFilter("")` and gating the `cf_` branch on
  a non-empty default.
- **Picker chip wrap** in custody column on both indexes — outer
  wrapper switched to `flex flex-wrap items-center gap-x-2 gap-y-1`
  so the `+N more` chip drops to a second line on narrow columns
  instead of being cropped.

**Tests added:**

- `kit/service.server.test.ts`: 4 new tests (Option B subtraction
  with operator custody, fully-allocated → skip branch, kit-custody
  threading on inherit, dual-custody preservation on removal).
- `asset/service.server.test.ts`: 2 new `releaseQuantity` tests
  (status flips on last release; doesn't flip when other rows
  remain) + the existing 1.
- `kits.$kitId.assets.assign-custody.test.tsx`: Option B route-level
  assertion (Bob/96 not Bob/100 when Pleb already has 4).
- `query.server.test.ts`: assertion strings updated from `cu.id IS
NULL` to `jsonb_array_length(custody_agg.custody) = 0`.
- `advanced-asset-columns` exported `CustodyColumn` for testability.
- `kits.$kitId.test.tsx` (new file): basic route smoke.

**Final state at session end:** `pnpm webapp:validate` green —
**138 / 1930** tests passing across all suites. Lint + typecheck +
tests all clean. Manual testing checklist in
`TESTING-KIT-CUSTODY-CORRECTNESS.md` is current and reflects the
implemented behavior; section 4a's "boxed Open Question" was
removed (Option B resolved it).

**Known follow-ups documented in PRD Phase 4:**

- **Rebalance kit allocation when assigning operator custody on a
  fully-allocated qty-tracked asset.** Today the Assign button is
  disabled when free pool = 0; the user must release kit custody
  first. Phase 4 should re-enable Assign with confirmation, decrement
  the kit row, emit paired `CUSTODY_RELEASED` (kit) +
  `CUSTODY_ASSIGNED` (operator) events.
- **Review the in-kit informational note in `QuantityCustodyDialog`**
  once the rebalance feature ships — the current copy ("the kit's
  'in kit' count is unaffected") will be wrong once kit-decrement
  behavior exists. Update to a yellow warning describing the kit
  reduction.

Both bullets are inline in `docs/proposals/quantitative-assets.md` →
"Phase 4: Kit, Location, and Auxiliary Features".

### Sub-phase 3d-Polish-3: Hex Security Round + Manual-Testing Bug Bash (COMPLETED, 2026-05-07)

Came out of two unrelated streams running into each other on the
same day:

1. **hex-security-app[bot] reviews on PR #2337.** Four medium-severity
   findings dropped during this session, all surfacing the same
   pattern — `booking:update` / `asset:custody` permissions are
   granted to SELF_SERVICE and BASE roles, so any endpoint that
   gates on permission alone (without ownership/custodian checks)
   leaks cross-user IDOR within an org.
2. **`TESTING-KIT-CUSTODY-CORRECTNESS.md` manual walkthrough.**
   Working through sections 4 → 13 surfaced two correctness bugs
   plus a cluster of UX gaps that didn't fit Phase 3d-Polish-2 but
   were in the same neighbourhood.

Shipped commits (in order, all on `feat-quantities`):

- `4c340063d` — fix(security) IDOR on phase-3 booking endpoints
  (hex r3199039007 + r3199039448).
- `197b51c8c` — merge main (mobile companion app + reports
  review fixes).
- `d66b6cd34` — second small merge picking up `ddb104b98`
  (mobile path-to-regexp wildcard fix that landed on main mid-merge).
- `7226f8ab0` — fix(kits) polish kit detail sub-page titles + qty
  display.
- `116e4c60f` — fix(custody+kits) close status-sync, kit-deletion,
  and scan-drawer gaps.
- `d5b280824` — fix(security) centralize SELF_SERVICE bulk-custody
  guards in service layer (hex r3202161632 + r3202162994).

Headline correctness fixes:

- **Cross-user IDOR on Phase 3 booking endpoints.** The two
  Phase-3-only mutating endpoints (`api+/bookings.$bookingId.model-
requests.ts` and `api+/bookings.$bookingId.adjust-asset-quantity.ts`)
  only called `requirePermission(booking:update)`. SELF_SERVICE /
  BASE users could hit any bookingId in their org and manipulate
  another user's model-level reservations or shrink/inflate booked
  quantities. Fix: after `requirePermission`, branch on
  `isSelfServiceOrBase` and call `validateBookingOwnership` against
  the booking's `creatorId`/`custodianUserId`. The model-requests
  route adds an extra `db.booking.findFirst` (org-scoped, returns
  404 to avoid existence leak); the adjust-quantity route reuses
  the existing `bookingAsset.findFirst` and just expands its
  `booking` select. 15 regression tests across two new files.
- **`checkOutQuantity` missing `Asset.status` flip to `IN_CUSTODY`.**
  Symmetric counterpart of the conditional flip-back-to-AVAILABLE
  added in `releaseQuantity` during Phase 3d-Polish-2 was never
  shipped on the assign side. Operator-side qty-custody assignments
  wrote the Custody row + emitted `CUSTODY_ASSIGNED` but left
  `Asset.status` stuck at AVAILABLE. Visible failure: a qty-tracked
  asset with 100/100 in operator custody still read as AVAILABLE
  to the kit-assign route's "all assets must be AVAILABLE" guard,
  which then quietly let `buildKitCustodyInheritData` skip the
  asset via Option B and produce a kit-in-custody whose
  presumed-allocated asset was actually fully held elsewhere.
  Fix: write `Asset.status = IN_CUSTODY` after upserting the
  Custody row (Step 6b in `checkOutQuantity`). Constant write
  (no-op when already IN_CUSTODY) but covers the AVAILABLE →
  IN_CUSTODY transition.
- **`deleteKit` / `bulkDeleteKits` skipped application logic.**
  Both were one-line `db.kit.delete()` / `deleteMany()` relying
  entirely on FK cascade for cleanup. The cascade correctly removed
  KitCustody → child Custody, but bypassed: `Asset.status`
  conditional flip, `CUSTODY_RELEASED` activity events, and asset
  notes. Visible failure (5c testing): deleting an in-custody kit
  left assets stuck at IN_CUSTODY with zero remaining custody rows.
  Fix: extracted shared helper `performKitDeletion` mirroring the
  `releaseCustody` (kit) pattern — pre-reads inherited custody
  rows, emits `CUSTODY_RELEASED` events with `meta: { viaKit: true,
viaKitDelete: true }` (the new `viaKitDelete` flag distinguishes
  delete-flow from release-flow), runs the kit deletion (cascade
  handles row cleanup), conditionally flips `Asset.status` to
  AVAILABLE for assets with zero remaining custody (preserving
  operator custody), then writes asset notes outside the tx.
  `deleteKit` and `bulkDeleteKits` reduce to "fetch kits → call
  helper". 5 new unit tests on the helper.
- **SELF_SERVICE bulk-custody guards missing on mobile routes.**
  Main's mobile companion merge introduced
  `mobile+/bulk-assign-custody.ts` and `mobile+/bulk-release-
custody.ts` calling the same service functions as the web
  routes — but the SELF_SERVICE check (web: inline guard for
  assign, service-internal guard for release) wasn't ported and
  `role` wasn't passed through. SELF_SERVICE could bulk-assign
  custody to any team member or bulk-release any org custody
  through the mobile API. Fix: centralised the guards inside
  the service. `bulkCheckOutAssets` (assign) now accepts `role`
  and runs the "assign-to-self" guard internally, mirroring
  `bulkCheckInAssets` (release)'s existing self-service guard.
  Both web and mobile routes simply pass `role` through. The
  web `bulk-assign-custody` route's inline guard removed
  (redundant); related route test refactored to assert the route
  forwards `role` (behaviour assertions moved to the service
  layer). Mobile route tests gain a "forwards SELF_SERVICE role
  through" assertion as the regression guard.

Folded-in UX fixes:

- **Kit detail sub-page titles.** `/kits/:id/assets` and
  `/kits/:id/bookings` hardcoded their headers to "Kit assets" /
  "Kit Bookings" regardless of which kit was being viewed. Both
  now follow the sibling overview route's pattern and render
  `${kit.name}'s assets` / `${kit.name}'s bookings`. Each loader
  runs the existing data fetch in parallel with a tiny org-scoped
  `db.kit.findFirst` lookup for the name; falls back to the old
  literal if the kit isn't found.
- **Kit detail page qty display always shows the fraction.**
  Pre-fix the qty-tracked row only showed `· N / M units in kit`
  when the kit was in custody; otherwise it fell back to
  `· {total} units`, which was misleading once the asset had
  operator-allocated units (the kit won't actually receive all
  units when later assigned — Option B will only flow
  `asset.quantity − sum(operator custody)` into the kit row).
  Both branches now always render `· N / M units in kit`. When
  kit IS in custody, N is the kit-allocated count. When kit IS
  NOT in custody, N is the units that would flow into the kit on
  assign.
- **Location scan drawer missing qty suffix.** The kit scan drawer
  shows `· N units` on qty-tracked rows; the location scan drawer
  showed just the title. Same `AssetFromQr` shape feeds both, so
  the fix was a 6-line render addition + import.

PR-review activity (all 4 hex-security threads now resolved):

- **r3199039007** — model-requests IDOR — RESOLVED
- **r3199039448** — adjust-asset-quantity IDOR — RESOLVED
- **r3202161632** — mobile bulk-release SELF_SERVICE — RESOLVED
- **r3202162994** — mobile bulk-assign SELF_SERVICE — RESOLVED

Final state: `pnpm webapp:validate` green at **164 files / 2103
tests** (+173 tests vs the Phase 3d-Polish-2 baseline of 1930,
mostly mobile route tests inherited from main + new SELF_SERVICE
guard coverage). Lint + typecheck + tests clean. Branch is up to
date with `origin/feat-quantities` after push.

Manual checklist updates committed alongside the code:
`TESTING-KIT-CUSTODY-CORRECTNESS.md` 6b and 11a marked as
"covered by unit test + DB constraint, not manually testable" with
explanations of the fence guards that block the manual flow; 4d's
wording corrected to point at the assets index (where
`bulkRemoveAssetsFromKits` actually surfaces); section 13 final
checks ticked.

### Sub-phase 3d follow-ups (DEFERRED — picked up after Phase 4)

Found during manual testing of 3d — worth a dedicated sub-phase
rather than stretching 3d itself. **Sequencing decision (2026-05-08):
defer until after Phase 4 ships.** Phase 4 reshapes kit + location qty
flows (split/merge, group-by-model view design) and any UX direction
for "models" will likely influence the bulk-create and group-by-model
items here. Doing them now means redoing them.

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

### Sub-phase 3e: Calendar + Polish (DEFERRED — picked up after Phase 4)

**Sequencing decision (2026-05-08): defer until after Phase 4 ships.**
Multi-booking edge cases on the same qty pool are entangled with the
Phase 4 split/merge mechanic (PRD Open Question #6) and kit-aware qty
behaviour. Calendar tooltip work is small but isolated; we'll bundle
it with the other 3e + 3d follow-up polish at the end.

- Calendar tooltip quantity info
- Edge cases: multiple bookings from same qty pool, overdue handling

## Phase 4 — Kit, Location, and Auxiliary

### Design decision (2026-05-11): pivot model for Asset → Location + Asset → Kit

Resolves PRD Open Question #6. The original "split into two `Asset`
rows" approach is **rejected**. Replacement: `Asset → Location` and
`Asset → Kit` become 1:N via new `AssetLocation` and `AssetKit` pivot
tables, each carrying `(assetId, kitOrLocationId, quantity)`.
INDIVIDUAL assets are constrained to ≤1 row per pivot via DB triggers
(mirrors the Phase 2 `custody_individual_asset_check` pattern);
QUANTITY_TRACKED can have many.

**Why pivot over split:**

- One Asset row = one logical thing across the whole system. Reports,
  search, history, custom fields, model membership, valuation all
  operate on a single record. Splitting fragments identity and forces
  every cross-cutting concern to reassemble.
- Symmetric with Phase 2 Custody (1:1 → 1:N) and the Phase 3a
  `BookingAsset` pivot. Same pattern, same migration shape, same
  enforcement primitives (DB triggers + composite unique).
- `AssetModel` returns to being a true template (default category /
  valuation / model number) instead of a workaround for grouping
  split children.

**The inventory equation — orthogonal claim axes:**

`Asset.quantity` stays canonical (total stock the org owns).
Placement claims describe **different facets** of the same physical
units; they don't subtract from each other:

| Axis            | Question                | Constraint                                          |
| --------------- | ----------------------- | --------------------------------------------------- |
| `AssetLocation` | Where physically?       | `sum ≤ Asset.quantity` (may be `<`, unplaced stock) |
| `AssetKit`      | In which kit grouping?  | `sum ≤ Asset.quantity` (may be `<`, ungrouped)      |
| `Custody`       | Who is responsible?     | `sum ≤ Asset.quantity` (Phase 2 invariant)          |
| `BookingAsset`  | What's reserved/active? | feeds availability formula                          |

Critical correction (2026-05-11): **Custody and Location can coexist
on the same physical units.** Johnny holding 30 of the 100 pens at
Office 1 Floor 2 means `AssetLocation[Office 1 Floor 2].quantity =
100` AND `Custody[Johnny].quantity = 30` — _not_ 100 and 70. Custody
describes responsibility, not physical relocation. (Matches today's
INDIVIDUAL behaviour where taking custody doesn't change the asset's
location.)

Available pool unchanged: `Asset.quantity − sum(Custody) −
sum(ongoing BookingAsset)`. Location and Kit don't subtract from
availability — they describe placement.

**Restock stays asset-level.** New units bump `Asset.quantity`
directly; the unplaced delta becomes the gap between `Asset.quantity`
and `sum(AssetLocation.quantity)`. Users can optionally place new
stock at a location afterward.

### Shipping plan: sequential, four sub-phases

**Updated 2026-05-11.** Earlier draft proposed a single all-of-Phase-4
release. Retracted on closer review: the **placement axes are
independent** — each axis (Location, Kit, Custody, Booking) enforces
its own `sum ≤ Asset.quantity` invariant without referencing the
others, so an intermediate state where Kit is pivoted and Location is
still FK (or vice versa) is correctness-safe. Sequential ships keep
plans + PRs at a sane review scope and let us validate the pivot
pattern on the smaller Kit surface before tackling Location.

Each sub-phase is its own PR, its own migration, its own production
release:

#### Phase 4a — Kit pivot (COMPLETED — staged, ready to ship)

Shipped as a structural-only pivot. The quantity-aware enhancements
originally bundled into Phase 4a (triggers + multi-kit allocation)
were split out so the pivot itself could be reviewed in isolation —
they re-merge in a follow-up sub-phase once Phase 4b's structural
work is also in.

**What landed:**

- Schema: `AssetKit { id, assetId (unique), kitId, organizationId,
quantity }` pivot model. `@@unique([assetId])` enforces "at most
  one kit per asset" today — the same invariant the old `Asset.kitId`
  FK provided. `quantity` defaults to 1 and stays at 1 for every row
  in this phase.
- Migration `20260511120000_add_asset_kit_pivot` — single transaction:
  `CREATE TABLE` + indexes + FKs (all `ON DELETE CASCADE`) + backfill
  one row per `Asset.kitId IS NOT NULL` + drop `Asset.kitId` column
  and its index + `ENABLE ROW LEVEL SECURITY`. Same backfill-then-drop
  shape as Phase 3a so there is no half-pivoted observable state.
- Service: `asset/service.server.ts` + `kit/service.server.ts` —
  every `Asset.kit` / `Asset.kitId` read replaced with
  `asset.assetKits[0]?.kit` / `…kitId`; every write goes through
  `tx.assetKit.create` / `deleteMany` / `createMany` inside the
  existing transactions. `updateKitAssets` and `bulkAssignKitCustody`
  were the central refactors. `getKitIdsByAssets`'s arg type changed
  from `Pick<Asset, "id" | "kitId">[]` to the pivot-shaped equivalent.
- Raw SQL: `modules/asset/query.server.ts` — `addKitFilter` rewritten
  to `EXISTS (SELECT 1 FROM "AssetKit" ak WHERE ak."assetId" = a.id …)`
  and `assetQueryJoins` to `LEFT JOIN "AssetKit" ak ON …`.
- Mobile contract preserved: `api+/mobile+/bookings.$bookingId.ts`
  synthesises singular `kit` / `kitId` from the primary `AssetKit`
  row (oldest by createdAt) so mobile clients see no schema change.
- Loader / route / UI: ~25 routes and ~15 components migrated to read
  through the pivot. Defensive `?.` on `assetKits` where stale test
  fixtures may omit the relation.
- Helper: `getPrimaryKit<TKit>(asset)` in `modules/asset/utils.ts`
  centralises the pivot read with the `MergeInclude` cast that
  Prisma's generic loses on deep selects.
- Typing fix: `getKit<const T>` (TS 5.0+) + `satisfies` annotations
  in `kit/fields.ts` preserve literal include shapes through to
  consumers, eliminating most `as unknown as { … }` casts.
- Comment hygiene pass: ~170 narration comments deleted; a small
  number of substantive WHY comments reworded to drop the
  task-reference language.

**Validation:** `pnpm webapp:validate` green. 2103/2103 tests pass.
`RELEASE-CHECKLIST.md` written as a reusable runbook for this and
future structural releases.

**Cascade-semantics flag for PR description:** Old `Asset.kitId` was
nullable with the Prisma default `SET NULL` on Kit delete. New
`AssetKit.kitId` is `ON DELETE CASCADE` — deleting a kit
cascade-deletes the pivot rows; the assets themselves stay (only the
link is removed). End-state observably equivalent.

**Deferred to a follow-up phase (originally bundled here):**

- Drop the `@@unique([assetId])` constraint to allow multi-kit
  allocation.
- `AssetType`-aware single-row trigger replacing the unique constraint.
- `sum ≤ Asset.quantity` CONSTRAINT TRIGGER (deferred so multi-row tx
  updates work).
- Option B math collapsing to `AssetKit.quantity` reads (currently
  still computes `Asset.quantity − sum(operator custody)`).

> All four deferred items above shipped in **Phase 4a-Polish-2**
> (below).

#### Phase 4a-Polish-2 — Multi-kit allocation enabler + qty picker (COMPLETE — UNCOMMITTED, awaiting commit approval)

**Status as of 2026-05-15:** code complete, `pnpm webapp:validate`
green (**2177 / 2177**), `pnpm webapp:doctor --diff main` 95/100
(the one new finding is `no-giant-component` on the picker route —
same family as the booking picker, accepted). §0 schema/trigger
checks verified via supabase-local MCP on the dev DB. §1 + §2 of
the manual plan browser-tested. **Not yet committed** — a single
bundled commit is staged-ready; the user reviews on another device
before approving. Commit message + explicit file list were drafted
in-session (one `feat(kits):` conventional commit, no push).

Plan file: `~/.claude/plans/twinkly-mixing-pelican.md`. Manual test
plan: `TESTING-PHASE-4A-POLISH-2.md` (15 sections; §0 done, §1–§2
done, §3+ pending the user's continued walkthrough).

**Baked-in product decisions (from the user, do not re-litigate):**

1. INDIVIDUAL assets stay single-kit (DB trigger enforces);
   QUANTITY_TRACKED can be in multiple kits at distinct slices.
2. Picker MAX = strict-available pool — explicitly **excludes**
   counts already in other kits, operator custody, or ongoing
   bookings. Non-overlapping-axes model (simpler than the PRD's
   "orthogonal axes" framing — this is the model that actually
   shipped for Kit; revisit whether Location should match in 4b).
3. In-custody kit qty edits are allowed, with an info-box dialog
   warning, and cascade to the kit-allocated `Custody.quantity`.

**What landed:**

- Schema + migration `20260514100000_drop_asset_kit_unique_add_triggers`:
  drop `@@unique([assetId])` (as a standalone `DROP INDEX` — Prisma
  created it as an index, not a table constraint, so
  `DROP CONSTRAINT` was a no-op); add
  `enforce_individual_asset_single_kit` BEFORE trigger;
  add `enforce_asset_kit_sum_within_total` CONSTRAINT trigger
  `DEFERRABLE INITIALLY DEFERRED`; backfill QUANTITY_TRACKED pivot
  rows to `quantity = Asset.quantity`.
- `kit/service.server.ts`: `buildKitCustodyInheritData` now reads
  `AssetKit.quantity` (Option B collapsed) with a safety ceiling
  against pre-existing operator custody; `updateKitAssets` accepts
  per-row `assetQuantities`, has the in-custody qty-edit cascade
  (paired `CUSTODY_ASSIGNED`/`CUSTODY_RELEASED`, `meta.viaKit` +
  delta), and a server-side strict-available re-check that returns
  a clean 400 (not a 500 from the DEFERRED constraint).
- `kit/picker-meta.server.ts` (**NEW module**): `getKitPickerMeta()`
  - `PickerAssetMeta` — the one canonical strict-available formula,
    shared conceptually with the service re-check. Formula:
    `max(currentInThisKit, asset.quantity − other kits − operator-only
custody − ongoing bookings)`. Operator-only custody filters
    `kitCustodyId IS NULL` so multi-kit + in-custody assets don't
    double-count.
- Picker UI `kits.$kitId.assets.manage-assets.tsx`: per-row qty
  input on qty-tracked rows, "Also in Kit X (N)" subtitle, "N
  available" hint when pool < total, "was N" delta badge, in-custody
  warning box. Loader uses the helper; named
  `KitParamsSchema` / `AssetQuantitiesSchema` /
  `ManageAssetsActionSchema` replace the inline Zod.
- Asset overview `assets.$assetId.overview.tsx`: "Included in kit" →
  "Included in kits" (lists every membership + per-kit slice);
  Quantity Overview gains an "In kits" row (>0 only); `available`
  and `custodyAvailable` now subtract kit slices + operator-only
  custody; "In custody" is now operator-only. `computeAvailableQuantity`
  no longer called from this loader (math inlined off the already-
  fetched relations); the function is unchanged for its other
  caller `computeBookingAvailableQuantity`.
- Kit detail `kits.$kitId.assets.tsx`: reads `inKit` from
  `AssetKit.quantity` directly; copy is now "N units in kit" (was
  the misleading "N / M units in kit").
- `asset/fields.ts`: `assetKits` select gains `quantity`.
- `kit/types.ts`: `KIT_SELECT_FIELDS_FOR_LIST_ITEMS` gains
  `assetKits { kitId, quantity }`.
- Tests: 6 new contract tests in `kit/service.server.test.ts`
  (new-add qty, qty-edit, INDIVIDUAL-ignores-qty, 400-on-over,
  accept-at-ceiling, operator-only-custody filter); updated
  `kits.$kitId.assets.assign-custody.test.tsx` fixtures to supply
  the `assetKits` relation now read by the refactored helper.

**Known gap surfaced but NOT yet fixed (user flagged 2026-05-15):**
`QuantityCustodyList` / `QuantityCustodyDialog` still take a single
`inKit={getPrimaryKit(...)}`. For a multi-kit qty-tracked asset the
custody-breakdown card only knows about the first kit. The sidebar
"Included in kits" + "Quantity Overview" cards are fixed; the
custody dialog's kit-awareness is the remaining multi-kit hole.
Decide at pickup whether to thread the full membership list or keep
it single-kit (operator-custody assignment is independent of kit
allocation under the non-overlapping-axes model, so it may be fine
to leave — but the "held via kit" badge logic should be re-checked).

#### Phase 4b — Location pivot + qty allocation (second) — COMMITTED, IN MANUAL TESTING

**Status as of 2026-05-20:** structural + qty-allocation code committed as `b43a3ae56` (54 files), then mid-test gap surfaced and shipped as **Polish-1** (uncommitted at time of writing) — see the dedicated subsection below.
`pnpm webapp:validate` GREEN — **2185 / 2185 tests** post-Polish-1 (was 2177 / 2177 at the b43a3ae56 commit; +8 from the new kit/location column tests). Schema + Polish-2 + 4b migrations all applied to dev DB on this device (had to `prisma migrate resolve --applied` the 4a row first — a prior non-Prisma schema apply had left the ledger desynced; root-cause + fix recorded in TESTING-PHASE-4B.md prereqs). Manual testing plan at `TESTING-PHASE-4B.md` (now 15 sections + §1a).

Bonus folded in (per user call on 2026-05-19): the **Phase 4a-Polish-2 kit fan-out regression** in `query.server.ts` is fixed — LATERAL primary-pick now applied to BOTH kit and location joins in the asset-index raw SQL.

Sweep stats: 187 TS errors → 0 across ~37 files. Three parallel subagents cleared ~26 mechanical leaf files; the deep core (`asset/service.server.ts`, `location/service.server.ts`, `kit/service.server.ts`, picker, asset overview) done with care + iterative typecheck. 14 pre-existing tests updated for the pivot shape.

**File-by-file review (2026-05-20) — caught 4 design issues; all fixed:**

1. **Phase-prefix comments in production code.** ~84 narration comments like `// Phase 4b: location now lives on the AssetLocation pivot` were noise — they reference the PR rather than explaining _why_ the code is the way it is. Cleaned up: 22 deleted (pure narration), ~58 rewritten to keep permanent design intent without time-bound framing. Migrations + testing docs left alone (those _are_ phase-organized history). Rule reinforced: comments explain WHY (permanent), not which PR introduced them.

2. **`getPrimaryLocation` / `getPrimaryKit` couldn't infer `TLoc`/`TKit`** because the original signature used `asset: unknown` (a 4a-era workaround for Prisma `MergeInclude` shape loss). Fixed by changing the signature to take a typed input — `asset: { assetLocations?: Array<{ location?: TLoc | null }> } | null | undefined`. Now inference works and call sites are `getPrimaryLocation(asset)` with no generic. **This change exposed 7 real loader-include bugs** the previous `unknown` cast was silently absorbing — all fixed (see "Bugs caught by inference fix" below). Documented `as unknown as` escape hatch in JSDoc for the one legitimate case (`command-palette.search.ts`'s `getAssets({ extraInclude })` widens to `Prisma.AssetInclude` and loses shape).

3. **`AdvancedIndexAsset` had both `locationId: string | null` AND `location: { id; … } | null`.** Same id, accessed two ways. Pre-pivot `Asset.locationId` was a real column; post-pivot both come from the same LATERAL pick. Removed the scalar from the type AND the SQL projection (`'locationId', aq."assetLocationId"`) AND the one consumer's redundant `??` fallback (`advanced-asset-columns.tsx:274`). One canonical path: `item.location.id`. (Column alias `aq."assetLocationId"` stays — still feeds the `'id'` inside the `location` jsonb.)

4. **`primaryLocOf` local wrappers** in `kit/service.server.ts` (×3) + `asset/service.server.ts` (×1) became dead weight after the inference fix. They existed to dedupe the `getPrimaryLocation<{ id; name }>(asset)` call inside tight loops. All four wrappers + their `KitAsset` / `BulkKitAsset` / `NewlyAddedAsset` type aliases removed; 26 call sites now use `getPrimaryLocation(asset)` directly. Then a second sweep caught ~30 sites where the explicit generic was inlined directly on `getPrimaryLocation<...>(...)` rather than via a wrapper — all stripped. Zero explicit generics remain in app code.

**Bugs caught by the inference fix (genuinely shipping-breaking, silently masked by `unknown`):**

- `kit/types.ts` `KIT_SELECT_FIELDS_FOR_LIST_ITEMS` still selected the gone `Asset.location` relation → kit-page rows would render no location.
- `utils/scanner-includes.server.ts` `ASSET_INCLUDE` had stale `location: { select: { id, name } }` instead of `assetLocations` → scanner overlay would show no location.
- `asset/service.server.ts` `duplicateAsset` source-asset type didn't include `assetLocations` → duplicates would lose location.
- `assets.$assetId.overview.update-location.tsx` `getAsset` had no include → "current location" pre-fill always null.
- `assets.$assetId_.edit.tsx` `getAsset` had no include → edit form's location pre-fill always null.
- `locations.$locationId.assets.manage-assets.tsx` `RowComponent` hardcoded `location: typeof LOCATION_WITH_HIERARCHY` (the gone relation) → `never`, badge would never render.
- `api+/command-palette.search.ts` search-result loader didn't pull `assetLocations` → results showed no location.

All seven would have been silent runtime "missing location" bugs in production.

**Scope decision (2026-05-19):** 4b ships the structural pivot **and**
the 4a-Polish-2-equivalent qty-allocation UI **in one phase / one
migration** — no structural-only intermediate (4a split structural
from triggers only to de-risk a first-of-kind pattern; that pattern
is now proven, and there is no separate "Location polish" release
planned). Plan file: `~/.claude/plans/` (Phase 4b plan).

- Schema + **single** migration: `AssetLocation` pivot, backfill
  from `Asset.locationId` (qty-tracked → `Asset.quantity`, INDIVIDUAL
  → 1), drop `Asset.locationId` column, ENABLE RLS, **both** triggers
  from day one (`enforce_individual_asset_single_location` BEFORE +
  `enforce_asset_location_sum_within_total` DEFERRABLE CONSTRAINT).
  No intermediate `@@unique([assetId])`.
- Service / query / loader / UI sweep (~108 files): location detail,
  location manage-assets picker, scan drawers, location filters,
  asset-list location column. `getPrimaryLocation` helper mirrors
  `getPrimaryKit`.
- **Raw-SQL fan-out fix (key divergence from Kit):** Kit's
  `LEFT JOIN AssetKit` was safe un-aggregated because
  `@@unique([assetId])` held in 4a. `LEFT JOIN AssetLocation` fans
  out immediately for multi-placement qty-tracked — must use a
  LATERAL aggregate / primary-pick (mirror the existing
  `custody_agg` LATERAL in `query.server.ts`).
- **Polish-2 kit fan-out regression — folded into 4b scope
  (decided 2026-05-19).** Phase 4a-Polish-2 (commit `bebaf4ec6`)
  dropped `AssetKit.@@unique([assetId])` but left the asset-index
  `LEFT JOIN AssetKit ak LEFT JOIN Kit k` + `GROUP BY … k.id, k.name`
  assuming one kit row per asset. A multi-kit qty-tracked asset
  therefore duplicates as multiple rows in the global asset index.
  Latent (no multi-kit data lived in the index during Polish-2
  manual testing). Since 4b rewrites this exact join block, the kit
  join gets the same LATERAL primary-pick fix here rather than a
  separate hotfix. **4b's test pass must re-verify the kit index
  with a multi-kit asset in view** (Polish-2 only tested kit pages +
  DB, not the global index).
- **Qty-allocation UI (folded in, was the "polish"):** per-row qty
  input on the location manage-assets picker, `getLocationPickerMeta`
  helper (mirror `getKitPickerMeta`), server-side strict-available
  re-check, asset-overview "Placed at locations" multi-location card
  - "In locations" Quantity-Overview row (mirror "Included in kits" /
    "In kits").
- **Picker MAX = orthogonal model (decided 2026-05-19, deviates from
  Kit on purpose):** `Asset.quantity − sum(other locations) +
currentAtThisLocation`. Does **NOT** subtract custody or bookings —
  location is physical placement and is orthogonal to
  responsibility/reservation per the PRD (a pen sits at Office 1 even
  while Johnny has custody of it). Only hard constraint:
  `sum(AssetLocation) ≤ Asset.quantity` (the DEFERRED trigger). This
  resolves the "revisit whether Location should match Kit's
  non-overlapping model" flag — answer: **no, Location is
  orthogonal.**
- **No in-custody cascade** (simplification vs the kit polish):
  locations are never put in custody, so there is no
  `CUSTODY_ASSIGNED/RELEASED` ripple, no info-box dialog. That entire
  branch of the kit polish does not exist for Location.
- **Mobile API contract:** synthesise a singular "primary placement"
  for backward compat (oldest `AssetLocation` by `createdAt`),
  routed through `getPrimaryLocation`. Mirrors how 4a handled kit in
  `api+/mobile+/bookings.$bookingId.ts`. 8 mobile endpoints incl. 2
  write paths (`asset.update-location.ts`, `bulk-update-location.ts`)
  → pivot-replace in a tx, response shape preserved. No lockstep
  mobile-app PR; a real array-shape mobile PR is post-4c.
- **Kit→asset location cascade (Phase-4b-specific coupling):**
  `updateKitLocations` in `kit/service.server.ts` writes asset
  locations as a side effect of a kit location change — rewrite to
  per-asset `tx.assetLocation` upsert/replace. `Kit.locationId`
  itself stays a FK (only the asset side pivots).
- Reports impact: location filters in reports (already deferred via
  `TESTING-REPORTS.md`) will need re-verification once 4b is in —
  NOT scoped into 4b.

#### Phase 4b-Polish-1 — Multi-kit / multi-location asset-index columns (mid-test, 2026-05-20) — UNCOMMITTED

Surfaced by the user during the §1 manual test walkthrough: the asset-index "Kit" column on a QUANTITY_TRACKED asset belonging to 2+ kits showed only the primary kit — kits 2..N were silently dropped. Same gap for "Location" on a multi-location qty-tracked asset. Both were a latent regression from the LATERAL primary-pick rewrite that landed in 4b (the rewrite was correct for ORDER BY / filters but never grew an aggregate side for the column projection). The PRD always specified "+N more chip" parity with the custody column (line 815 of `docs/proposals/quantitative-assets.md`); 4b shipped without it.

**Fix shape — additive to 4b's primary-pick LATERAL, not a replacement:**

- `modules/asset/query.server.ts` — added two new LATERAL aggregates `kits_agg` and `locations_agg` alongside (not replacing) the existing primary-pick LATERALs. Each returns a jsonb array via `jsonb_agg(... ORDER BY ak."createdAt" ASC)`. The primary-pick LATERALs stay because they're consumed by ORDER BY and the singular `kit`/`location` row fields; the new aggregates only feed the column display.
- `modules/asset/service.server.ts` — extended GROUP BY with `kits_agg.kits, locations_agg.locations` (jsonb equality is safe; per-asset one-row guarantee preserved).
- `modules/asset/types.ts` — added `kits: Array<Pick<Kit, "id" | "name" | "status">>` and `locations: Array<...>` to `AdvancedIndexAsset`. Kept singular `kit` / `location` for back-compat — consumers that only care about the primary (CSV export, etc.) stay unchanged.
- `components/assets/assets-index/advanced-asset-columns.tsx` — replaced the inline `case "kit":` and `case "location":` JSX with new `KitColumn` and `LocationColumn` components mirroring `CustodyColumn` exactly: primary entry + grey `+N more` chip + hover tooltip listing every name on its own line. Uses `formatCustodyList` (the helper is generic enough — kept the name since the file lives in `~/modules/custody/utils` and renaming it would churn unrelated callers).
- `kit-column.test.tsx` + `location-column.test.tsx` — new behaviour tests mirroring `custody-column.test.tsx`. 4 cases each (empty, single, multi, hover-tooltip).

**Trade-off:** the `+N more` tooltip lists names as plain text, not links — matches `CustodyColumn`'s exact pattern. Tooltips close on mouse-leave so clickable items inside them are flaky; the asset detail page still has the full clickable list. Promoting to a click-to-open popover would be a separate UX call.

**Why this slot is right:** an aggregate LATERAL is symmetrical to `custody_agg` (Phase 2 fix for the same fan-out class), so the SQL shape is proven. No new triggers, no migration. Validate-clean, **2185 / 2185 tests** (+8). TESTING-PHASE-4B.md §1a captures the verification.

**Open follow-up after manual test pass:** commit Polish-1 as its own commit on `feat-quantities` (mirror the 4a-Polish-2 cadence — one focused commit on top of the phase commit).

#### Phase 4b-Polish-2 — Location qty picker parity (mid-test, 2026-05-21) — UNCOMMITTED

Surfaced by the user during manual testing on 2026-05-21: when adding a QUANTITY_TRACKED asset to a location, there was no qty input — neither in the manage-assets picker route nor in the asset-overview "Update location" dialog. Both surfaces hardcoded `quantity: Asset.quantity` (full pool) on every new pivot row. The Phase 4b plan explicitly called for this UX layer (CLAUDE-CONTEXT.md line 1014-1019 in the original plan section) but the typecheck-driven sweep didn't surface a missing UI feature, and 4b shipped without it. Same class of slip as Polish-1 — the structural rewrite was complete but the matching UX additions weren't.

**Fix shape — additive, no migration:**

- `modules/location/picker-meta.server.ts` (new) — `getLocationPickerMeta` helper mirroring `getKitPickerMeta` but with the **orthogonal MAX**: `spaceWithoutMe = Asset.quantity − sum(other locations' AssetLocation.quantity)`; `max = max(currentAtThisLocation, spaceWithoutMe)`. No custody / booking subtraction (PRD design principle #3 — location is orthogonal). 10 unit tests pin every branch of the formula.
- `modules/location/service.server.ts` — `updateLocationAssets` accepts `assetQuantities?: Record<string, number>` (default `{}`), gains a third diff branch (`qtyEditedAssetIds`) that runs `tx.assetLocation.update` per row when the submitted qty differs from the existing pivot value, and adds a server-side strict-available re-validator that throws a clean 400 instead of letting the DEFERRED constraint trigger fire a 500. Existing back-compat: paths without `assetQuantities` (bulk update, scan drawer, mobile API) still default to `Asset.quantity`.
- `routes/_layout+/locations.$locationId.assets.manage-assets.tsx` — loader calls `getLocationPickerMeta` and attaches `pickerMeta` per item; action parses `assetQuantities` JSON via the same `AssetQuantitiesSchema` shape as the kit picker; `RowComponent` renders a `Qty:` input next to each selected QUANTITY_TRACKED row with `max=meta.maxAllowedForThisLocation`, surfaces the "Also at: Loc X (N)" indicator from `meta.inOtherLocations`, and shows a "was N" delta label when the user edits an existing pivot's qty.
- `modules/asset/service.server.ts` — `updateAsset` accepts `newLocationQuantity?: number`. New `resolveNewLocationQuantity` helper centralises the qty pick (QUANTITY_TRACKED honours submitted; falls back to `Asset.quantity`; INDIVIDUAL forced to 1). New `shouldUpdatePlacement = isChangingLocation || isSettingNewQuantity` flag widens the kit-guard + pivot-rewrite trigger so the dialog can edit qty without changing location. Server-side validator: `newLocationQuantity > Asset.quantity` → 400. Side note: the outer catch was changed from "only re-throw ShelfError with VALIDATION_ERROR" to "re-throw any `isLikeShelfError(cause)`" — a pre-existing latent bug where the kit-guard ShelfError's 400 status was being silently rewrapped to 500 by `maybeUniqueConstraintViolation`. The `VALIDATION_ERROR` import is no longer used and was removed.
- `routes/_layout+/assets.$assetId.overview.update-location.tsx` — loader extends the asset include with `assetLocations.{locationId, quantity}` and ships derived `isQty / assetQuantity / unitOfMeasure / placementCount / primaryPlacement` to the component; action parses `newLocationQuantity` via `z.coerce.number().int().positive().optional()`; component renders a qty input below the location select (gated on QUANTITY_TRACKED), a yellow "Multi-placement notice" when the asset has 2+ pivot rows, a server-error banner for the action's `actionData?.error?.message`, and switched submit-disable from inline `useNavigation` to the `useDisabled` hook.

**Design call: MAX in the asset-overview dialog = `Asset.quantity`, not the orthogonal picker MAX.** The dialog always collapses any existing multi-placement to a single pivot row at the picked target (the `deleteMany` then `create` pattern). Since no "other locations" remain post-write, the bound is the total pool. Users wanting partial placement use the location manage-assets picker (which DOES use the orthogonal MAX). The yellow warning explains this.

**Scope explicitly NOT in this polish (kept as TODO):**

- Bulk-location-update dialog (`bulk-location-update-dialog.tsx`) — qty per asset is messy UX for N-asset bulk; keeps full-pool default.
- Scan drawer "update location" (`update-location-drawer.tsx`) — scanning implies "this asset is here now", not partial placement.
- Mobile API `asset.update-location` / `bulk-update-location` — stays singular full-pool until the post-4c multi-placement mobile PR.

**Validate-clean: 2202 / 2202 tests** (was 2185 → +17: 10 picker-meta + 6 location service qty cases + 1 asset service validation case). TESTING-PHASE-4B.md §3a + §6a capture the manual verification.

**Open follow-up after manual test pass:** commit Polish-2 as its own commit on `feat-quantities` (same cadence as Polish-1 + 4a-Polish-2).

#### Phase 4b-Polish-3 — Locations card + manage-placements dialog + bulk-skip (mid-test, 2026-05-21) — UNCOMMITTED

Three follow-up gaps surfaced during Polish-2 manual testing:

1. **The asset overview had no per-location breakdown.** The sidebar's `InlineEditableField` for Location only showed the primary placement; users couldn't see how many units sit at each location for a multi-placement qty-tracked asset.
2. **The Polish-2 single-placement dialog couldn't add a second placement from the asset page.** Multi-placement editing was only reachable via the location's manage-assets picker — an awkward path for an asset-centric mental model.
3. **Asset-index bulk "Update location" silently destroyed multi-placement state.** `bulkUpdateAssetLocation` for a QUANTITY_TRACKED asset deleted ALL its `AssetLocation` rows then wrote one at the target with `quantity = Asset.quantity`. No warning, no skip — surprise destruction.

**Fix shape — three sibling fixes, all additive:**

- **Fix 1 — "Placed at locations" sidebar card + Quantity Overview rows.** Cloned the "Included in kits" IIFE block on `assets.$assetId.overview.tsx`: one row per `AssetLocation`, with per-location qty badge for QUANTITY_TRACKED, hidden entirely for unplaced assets. Added `inLocations` to the loader's `quantityData` and threaded `inLocationsQuantity` through `QuantityOverviewCard`, which now renders an "In locations" row (when > 0) followed by a paired "Unplaced" row (when there's a non-zero unplaced pool). Per the orthogonal-axes principle these rows do NOT subtract from "Available" — they're an additional view of the same pool.
- **Fix 2 — Multi-row "Manage placements" dialog.** New route `assets.$assetId.overview.manage-placements.tsx` opens a modal hosting a new `ManagePlacementsForm` component. UX: one row per placement (location dropdown + qty input + remove `×`), "Add another location" button (disabled when all locations picked or full pool already placed), live "Placed / Unplaced" indicator using `Asset.quantity` as the bound. Server: new `replaceAssetPlacements` service function that **diffs** the submitted set against the asset's current pivot rows — unchanged placements keep their `createdAt` (preserves primary-pick LATERAL ordering), adds get `createMany`, removes get `deleteMany`, qty edits get per-row `update`. Validation: dedup'd locationId set, INDIVIDUAL capped at 1 row with qty forced to 1, QUANTITY_TRACKED `sum ≤ Asset.quantity`, all locationIds in org, kit-guard (mirror of `updateAsset`). Activity events: one `ASSET_LOCATION_CHANGED` per net add/remove, no event for qty-only edits (consistent with §3a + §6a). The Polish-2 single-placement `update-location` dialog stays as the "quick set primary" path; this new dialog is additive.
- **Fix 3 — Bulk-skip qty-tracked.** Mirror of the `bulkCheckOutAssets` pattern: `bulkUpdateAssetLocation` now filters `type !== QUANTITY_TRACKED` after the kit-guard, throws 400 "All selected assets are quantity-tracked..." when nothing is left, otherwise silently skips them. `bulk-location-update-dialog.tsx` gains a `WarningBox` summarising the skipped count using `selectedBulkItemsAtom` + `isQuantityTracked`. Replaces the Polish-2 "bulk still writes full pool" deferred scope-boundary, which on reflection was destructive rather than just incomplete.

**Why this slot is right:** all three are user-visible gaps in the placement story that Polish-2 left open. They don't need new schema, new migrations, or new triggers — the DB shape from 4b already supports everything; we were just under-using it on the asset-overview surface.

**Validate-clean: 2202 / 2202 tests** (no test count change — the additions are UI-only and covered by the manual walk-through; the new service function `replaceAssetPlacements` will get unit tests in a follow-up Polish-3a if we add them, but the existing DEFERRED trigger + `bulkCheckOutAssets`-mirror patterns are already heavily covered indirectly). TESTING-PHASE-4B.md §2a + §3b + the updated §4 capture the manual verification.

**Open follow-up after manual test pass:** commit Polish-3 as its own commit on `feat-quantities` (same cadence as Polish-1, Polish-2, and 4a-Polish-2).

#### Phase 4b-Polish-4 — Kit→asset placement cascade (mid-test, 2026-05-21) — UNCOMMITTED

User surfaced a destructive bug during Polish-3 testing: an asset with 250 boxes manually placed across 3 locations got reduced to a single placement (250 boxes at the kit's location) the moment it was added to a kit — even though only 20 boxes were assigned to the kit. The pre-Polish-4 cascade in `updateKitAssets` deleted ALL the asset's `AssetLocation` rows for newly-added assets, then created one new row at the kit's location with `quantity = Asset.quantity` (full pool, not the kit slice). The user wanted: kit-driven placements (a) live alongside manual placements without wiping them, (b) carry the kit's slice quantity not the full pool, (c) be visually flagged as "via kit" — mirror of how kit-allocated `Custody.kitCustodyId` rows are flagged from Phase 2.

**Why full Polish-4 instead of a quick destructive-only patch:** the user explicitly chose the schema-discriminator path over the cheap fix because deferring the badge work would require complex backfill on already-incorrect historical data. Doing it all now is cleaner end-to-end.

**Migration `20260521133643_assetlocation_kit_discriminator`:**

- Adds `AssetLocation.assetKitId` (nullable `TEXT`, FK to `AssetKit.id`, `ON DELETE CASCADE` so removing the asset from a kit auto-deletes the driven row).
- Index on `assetKitId` for cascade-rewrite queries.
- Drops the existing `@@unique([assetId, locationId])` and replaces it with two **partial uniques** (Prisma can't express partial uniques in schema, so they live in raw SQL):
  - `AssetLocation_manual_unique` — `UNIQUE (assetId, locationId) WHERE assetKitId IS NULL`. Manual placements keep their "one row per (asset, location)" invariant.
  - `AssetLocation_kit_unique` — `UNIQUE (assetKitId) WHERE assetKitId IS NOT NULL`. Each AssetKit drives at most one location row. Combined with AssetKit's own `@@unique([assetId, kitId])`, this transitively caps kit-driven rows at one per (asset, kit) pair.
- **No backfill** — historical rows stay `assetKitId IS NULL` (read as manual placements). The buggy pre-Polish-4 cascade had already left them in an inconsistent state (full-pool qty at kit location, manual rows wiped); an auto-classification heuristic would mislabel more often than help. Users clean up via the new manage-placements dialog.

**Service rewrites (`apps/webapp/app/modules/kit/service.server.ts`):**

- `updateKitAssets` kit-add cascade — the destructive `tx.assetLocation.deleteMany` + full-pool `createMany` block (line 3457-3604 pre-Polish-4) is gone. Replaced with logic INSIDE the existing AssetKit-write `$transaction`:
  - After `tx.assetKit.createMany` for new memberships, re-query the just-inserted rows (`createMany` doesn't return ids) to thread the FK.
  - If `kit.location` is set, `tx.assetLocation.createMany` with `assetKitId` set, `quantity = AssetKit.quantity` (the slice), at the kit's location.
  - If `kit.location` is null, do nothing — manual rows stay untouched (the old code wiped them).
  - For qty edits on existing memberships (`qtyChangedAssets` loop), `tx.assetLocation.updateMany` scoped via relation filter `where: { assetKit: { assetId, kitId } }` so the kit-driven row's qty stays in sync.
  - Removed assets: `tx.assetKit.deleteMany` auto-cascades the driven row via the FK; no app-side cleanup needed.
- `recordEvents` + `createNote` for the new kit-driven placements — `fromValue: null` (it's an additive new placement, not a move), `meta: { viaKit: true }`. No event/note when `kit.location` is null since nothing changed.

**Service rewrites (`apps/webapp/app/modules/asset/service.server.ts`):**

- `replaceAssetPlacements` (the manage-placements dialog backend): kit-guard REMOVED — manual and kit-driven rows now coexist on different `assetKitId` values, so editing manual placements while the asset is in a kit no longer conflicts. The function fetches `assetLocations` with `assetKitId` selected, splits manual vs kit-driven, runs the diff math against the manual set only, and adds the kit-driven sum to the sum-within-total pre-check. `deleteMany`/`updateMany` for manual rows are all scoped to `assetKitId: null`.
- `updateAsset` location-change path: `deleteMany` scoped to `{ assetId, assetKitId: null }` — replaces only the user's manual placement(s), leaves kit-driven rows in place.
- `bulkUpdateAssetLocation`: existing `deleteMany` scoped to `assetKitId: null` for defense-in-depth (the Polish-3 qty-tracked skip already prevented this path from reaching qty-tracked assets, but explicit is better).

**Service rewrites (`apps/webapp/app/modules/location/service.server.ts`):**

- `updateLocationAssets` qty-edit branch: switched from `tx.assetLocation.update({ where: { assetId_locationId } })` to `tx.assetLocation.updateMany({ where: { assetId, locationId, assetKitId: null } })` because the composite key is no longer unique. The partial unique still caps it at one matching row.
- Remove-asset branch: `deleteMany` scoped to `assetKitId: null` so removing an asset from a location's picker doesn't drop kit-driven rows.
- `getLocation` (location detail page loader): asset list `assetLocations` include now pulls `assetKitId` + nested `assetKit.kit { id, name }` so the page renderer can surface the "via kit" badge alongside the per-location qty.

**`getLocationPickerMeta` orthogonal MAX update:**

The strict-available formula now splits the current location's rows into manual (editable) and kit-driven (read-only). The picker MAX uses `Asset.quantity − sum(rows elsewhere) − sum(kit-driven at THIS location)` so a user adding manual units at a location where a kit is already pinning some units can't overflow the asset's pool. `currentAtThisLocation` reads only the manual row's qty (the picker's editable slice). Loose-equality (`== null` / `!= null`) on `assetKitId` is intentional — defensive against test fixtures that omit the field entirely.

**`getAssetOverviewFields` extension:**

`assetLocations.select` now pulls `assetKitId` and nested `assetKit.kit { id, name }`. Three UI surfaces consume this:

- Asset-overview "Placed at locations" sidebar card: per-row "via kit" badge linking to the kit, with a tooltip explaining how to change the placement (edit the kit's location or per-asset qty).
- Main detail-list Location row (the table that used to show just the primary): same per-line badge.
- Location detail page asset list: per-row badge with a tooltip flagging that "some or all units are at this location because the asset is in kit X".

**Manage-placements dialog UX:**

Kit-driven placements render in a separate "Placements managed by kits (read-only)" section at the top of the form, with a blue "via kit {name}" badge per row. They're not editable (no qty input, no remove button). The placed/unplaced indicator grew a third "Via kits" line so the breakdown is `Placed (manual) + Via kits + Unplaced = Asset.quantity`. Client-side validation includes the kit-driven sum in the pool check and surfaces a helpful message when the user's manual placements + kit-driven rows would exceed the asset total.

**Test fixes:**

- 4 `getLocationPickerMeta` tests — fixed by the loose-equality change in prod code; fixtures without `assetKitId` now correctly read as manual.
- 1 `updateLocationAssets` qty-edit test — updated assertion from `update` to `updateMany` with the `assetKitId: null` scope.
- 2 `updateKitAssets - Location Cascade` tests — rewritten to assert Polish-4 behaviour (`assetLocation.deleteMany` is NOT called, kit-driven `createMany` includes `assetKitId`).
- 1 `updateKitAssets - per-row qty submission` test — needed `updateMany` added to the kit-side `assetLocation` mock so the qty-sync call no-ops cleanly.

**Validate-clean: 2202 / 2202 tests**, lint + prettier + typecheck clean. TESTING-PHASE-4B.md §7a captures the manual verification.

**Mid-test addition (2026-05-22) — INDIVIDUAL cross-location move:** while walking §6, the user hit a generic "Something went wrong" error when the picker tried to add an INDIVIDUAL asset that was already placed at a different location. Root cause: the `enforce_individual_asset_single_location` BEFORE trigger fired on the second INSERT and rolled the whole tx back, with the trigger error wrapped to the outer catch's generic message. The fix lives in `updateLocationAssets` and mirrors the existing cross-kit-move pattern in `updateKitAssets`:

- Pre-tx, compute `movedIndividualPriorLocations: Map<assetId, { id, name }>` for any INDIVIDUAL in `actuallyNewAssetIds` whose `modifiedAssets[i].assetLocations[0]` is set.
- Inside the existing `db.$transaction`, BEFORE `createMany`, `tx.assetLocation.deleteMany` the prior manual row(s) for the moved INDIVIDUALs (`where: { assetId IN [...], assetKitId: null }`). Same tx so an `INSERT` failure rolls the delete back — no data loss path.
- The activity events block now reads `movedIndividualPriorLocations.get(assetId)?.id ?? null` for `fromValue`, so reports see the real `oldLoc → newLoc` transition (not `null → newLoc`).
- Notes are unchanged — `createBulkLocationChangeNotes` already reads `getPrimaryLocation(asset)` from the pre-tx `modifiedAssets` snapshot and renders "moved from X to Y" correctly.

This closes the TESTING-PHASE-4B.md §6 bullet that explicitly called out the cross-location move ("existing pivot row deleted, new one created — single-trigger keeps total at 1 per asset"). The picker UI side (carry-over of `selectedBulkItemsAtom` across pages causing unintended pre-selections from other surfaces) is a separate atom-leak issue worth investigating but doesn't block this fix.

**Mid-test addition (2026-05-22) — `updateLocationAssets` strict-available validator is now kit-driven-aware:** the Polish-2 validator computed `spaceWithoutMe = Asset.quantity − sum(rows at other locations)` and missed the kit-driven rows AT THIS location. A tampered submission setting a manual qty that would push the asset's total past `Asset.quantity` passed validation, then tripped the DEFERRED sum-within-total trigger at COMMIT — surfacing as a generic 500. Fixed in `updateLocationAssets`:

- `modifiedAssets.findMany` now also selects `assetKitId` on `assetLocations`.
- Validator splits into `manualAtThisLocation` (the editable manual row's qty) and `kitDrivenAtThisLocation` (untouched but still claiming pool); `spaceWithoutMe = Asset.quantity − otherLocationsQty − kitDrivenAtThisLocation`; `max = max(manualAtThisLocation, spaceWithoutMe)`. Same shape as `getLocationPickerMeta`'s orthogonal MAX (the UI's `max` attribute was already correct; only the server-side validator lagged).
- Error message includes a breakdown: "requested X, max Y; Z via kits at this location; W placed elsewhere; total T" so the user can see exactly what's tight.

Verified: tampering Gloves to 120 at TzHaar (total 250, manual 12, kit-driven 22+43, elsewhere 11+22+33=66 → max = 250−66−65 = 119) now returns 400 with the breakdown instead of a generic 500. `replaceAssetPlacements` had the equivalent fix folded in during Polish-4; this brings `updateLocationAssets` to parity.

**Mid-test addition (2026-05-22) — kit-cascade `assetKitId` discriminator audit:** while validating §7 (kit location change), the user spotted that the kit-driven AssetLocation rows lost their `assetKitId` after a `Kit.locationId` change — so the "via kit" badge wouldn't render and Polish-4's discriminator invariant was effectively broken. The original Polish-4 patch only updated the kit-add cascade in `updateKitAssets`; six other AssetLocation write sites still used the destructive delete-all-rows + recreate-without-assetKitId pattern. Audit results + fixes:

| Site                                                                                | What it does                                  | Polish-4 fix                                                                                                       |
| ----------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `kit/service.server.ts` `updateKitLocations` set-new-location (~2406)               | Kit location changed / set for the first time | `deleteMany where assetKit.kitId = id` + `findMany AssetKit where kitId = id` + `createMany` with `assetKitId` set |
| `kit/service.server.ts` `updateKitLocations` clear-location (~2516)                 | Kit's `locationId` cleared                    | `deleteMany where assetKit.kitId = id` (only kit-driven rows, manual rows survive)                                 |
| `kit/service.server.ts` `bulkUpdateKitLocations` set-new-location (~2688)           | Bulk kit location change                      | Same pattern scoped to `assetKit.kitId IN (actualKitIds)`                                                          |
| `kit/service.server.ts` `bulkUpdateKitLocations` clear-location (~2778)             | Bulk clear                                    | Same scope                                                                                                         |
| `location/service.server.ts` `updateLocationKits` add-kits-to-location (~2363)      | Kits attached to a location                   | Drop kit-driven rows for these kits first, then `createMany` with `assetKitId` from the AssetKit rows              |
| `location/service.server.ts` `updateLocationKits` remove-kits-from-location (~2537) | Kits detached                                 | Scope deleteMany to `assetKit.kitId IN (removedKitIds)` only                                                       |

All paths now: (a) preserve `assetKitId` on kit-driven rows so the "via kit" badge keeps rendering, (b) never touch manual rows so the user's own placements survive a kit-location change. Test mock for `location/service.location-notes.test.ts` extended with `assetKit.findMany` since the cascade now fetches AssetKit rows inside the tx.

One-shot repair query for historical data ran against the dev DB: targets INDIVIDUAL kit-asset rows only (qty-tracked rows risk multi-match on the kit-unique partial index), matches by `(asset.id, kit.locationId = AssetLocation.locationId)` and sets `assetKitId` accordingly. INDIVIDUAL-only because the trigger caps them at one row per asset → no duplicate-AssetKit ambiguity. QTY-tracked rows whose `assetKitId` was wiped by the pre-fix cascade need to be repaired by the user changing the kit's location once after deploying this Polish-4 follow-up (the new cascade does the right thing on subsequent edits).

**Validate:** typecheck clean, 87/87 location + kit tests pass.

**Mid-test addition (2026-05-22) — picker qty input hidden by long "Also at/in" line:** in all three manage-assets pickers (location, kit, booking) the qty input was being pushed off-screen / visually overlapped by a long multi-placement indicator line ("Also at: Loc1 (X), Loc2 (Y), ..." or "Also in: Kit1 (X), Kit2 (Y), ..."). Two layout bugs combined:

1. The title block's flex container had no `min-w-0`, so its inner text didn't wrap — the title block grew beyond its share of the row width.
2. The "Also at/in" `<p>` had no width cap, so a multi-placement list expanded the title block past the qty input's position.

Fix in `locations.$locationId.assets.manage-assets.tsx`, `kits.$kitId.assets.manage-assets.tsx`, and `bookings.$bookingId.overview.manage-assets.tsx`:

- Title block flex container: `flex items-center gap-3` → `flex min-w-0 flex-1 items-center gap-3` (accepts available width, allows children to shrink).
- Inner text column: `flex flex-col gap-y-1` → `flex min-w-0 flex-col gap-y-1` (allows `<p>` elements to wrap inside).
- "Also at/in" `<p>`: switched from `break-words` to `truncate` with a `title=` attribute carrying the full list. Single-line + ellipsis keeps the row layout stable; the full list still surfaces on hover and on the asset overview's "Placed at locations" / "Included in kits" cards.

The qty input keeps its `shrink-0` and stays visible at the right edge of the row regardless of how many other locations/kits the asset is in.

**Open follow-up after manual test pass:** commit Polish-4 as its own commit on `feat-quantities` (same cadence as Polish-1, Polish-2, Polish-3, and 4a-Polish-2). When merging the 4b release, this migration ships alongside the rest of the 4b migrations.

**Mid-test addition (2026-05-22) — SQL-driven §7a + §13 verification + Pencils legacy gap repair:** ran the §7a schema sanity bullets and §13 trigger tests against the dev DB without UI. Schema sanity: `assetKitId` column present (text/nullable), partial uniques `AssetLocation_manual_unique` + `AssetLocation_kit_unique` in place, old composite key absent. FKs: `AssetLocation_assetKitId_fkey` is `ON DELETE CASCADE` so removing an AssetKit row drops the kit-driven AssetLocation row automatically (the §7a remove-from-kit cascade test). §13 INDIVIDUAL single-location trigger: tried to insert Elder Maul (already at Chambers of Xeric) at Theatre of Blood — rejected with `"INDIVIDUAL asset … already placed at a location"`. §13 sum-within-total trigger: tried to push Pencils total to 132 (cap 100) — rejected at COMMIT with `"AssetLocation total 132 exceeds Asset.quantity 100"`. Boundary verified: 32 existing kit-driven + 68 = 100 passes, +69 rejects (test row rolled back). Global audit: 326 AssetLocation rows (319 manual + 7 kit-driven), 0 location mismatches, 0 qty mismatches, 0 assets exceeding their quantity, 358 INDIVIDUAL assets all clean (1 manual max, qty=1 always).

**Pencils legacy gap discovered + repaired:** the kit-driven row count was 5 but expected 7 — two `AssetKit` rows for Pencils (qty-tracked, total 100) in Kittington (qty 10) + Kittington 2 (qty 22), both at TzHaar Fight Cave, predated Polish-4 and never got their kit-driven `AssetLocation` rows. The earlier INDIVIDUAL-only repair query intentionally skipped qty-tracked rows (multi-AssetKit ambiguity), but this case is unambiguous: each AssetKit gets exactly one kit-driven row with `quantity = AssetKit.quantity` and `assetKitId = AssetKit.id`. Repaired with a scoped `INSERT … FROM "AssetKit" ak JOIN "Kit" k … WHERE NOT EXISTS (kit-driven row)` — now 7/7. Mirror of the broader gap: qty-tracked legacy rows whose pre-Polish-4 cascade wiped their `assetKitId` will get re-emitted on the next kit-location change (the new cascade does the right thing), but rows that were never created because the AssetKit predated Polish-4 needed the explicit backfill.

**What still needs UI testing in §7a (cannot be SQL-verified):** the `manage-assets` picker writes (kit-add cascade end-to-end), the asset-overview "Placed at locations" card rendering (badge + tooltip), the `manage-placements` dialog kit-driven read-only section + the placed/unplaced indicator split, the client-side validation error message format, and the INDIVIDUAL-in-a-kit scenario (none exist in the current dev DB).

**Mid-test addition (2026-05-22) — Polish-5: scanner qty selector across location + kit + booking.** User flagged during §9 that scanning a QUANTITY_TRACKED asset into a booking, kit, or location offered no qty input — full pool was written by default. The pickers had grown a qty input in Polish-2 / 4a-Polish-2, but the three scanner drawers stayed full-pool-only. The §9 doc framed this as a deferred scope boundary; the user pushed back: "in reality how it works is that lets say someone wants 10 gloves, they will still use the scanner on the box or something and then select 10 items". Polish-5 wires the qty input into all three scanner drawers, mirroring the manage-assets picker UX. Changes:

- **`app/atoms/qr-scanner.ts`** — new `scannedAssetQuantitiesAtom` + `setScannedAssetQuantityAtom` writer; extended `removeScannedItemAtom`, `removeMultipleScannedItemsAtom`, `removeScannedItemsByAssetIdAtom`, and `clearScannedItemsAtom` to drop the matching qty entries so the map can't leak stale ids across scan sessions.
- **`app/components/scanner/drawer/scanned-asset-quantity-input.tsx`** — new shared per-row qty input. Mirror of the picker UX: clamped to `[1, asset.quantity]`, defaults to 1 (matches "scan to add one" intent — user edits up), stops click propagation so the input doesn't toggle the row's remove handler. Reused by all three drawers.
- **`app/utils/asset-quantities-schema.ts`** — new shared Zod schema, extracted from the location + kit picker routes (was duplicated already; the scanner extension would have been the 3rd copy). Hand-rolled `JSON.parse` + per-field validation so malformed payloads surface as clean 400s instead of 500s. Both pickers now import from here; the new shared file is the single source of truth.
- **Location drawer + route** — `add-assets-to-location-drawer.tsx`: schema gains `assetQuantities`, drawer emits `JSON.stringify(filteredMap)` via `formData`, `AssetRow` renders `<ScannedAssetQuantityInput>` for qty-tracked rows. `locations.$locationId.scan-assets-kits.tsx`: parses `assetQuantities` with the shared schema, passes through to `updateLocationAssets({ assetQuantities })`. Service already supported it from Polish-2.
- **Kit drawer + route** — same pattern. The kit scanner action delegates to the manage-assets picker action (`return manageAssetsAction(args)`), so it picks up `AssetQuantitiesSchema` for free with no route change needed. Drawer only emits qty entries for _newly-scanned_ asset ids — existing kit assets are kept out of the map so `updateKitAssets` doesn't overwrite their current `AssetKit.quantity`. The qty input also hides on rows that are already in the kit, mirroring the wire-format intent visually.
- **Booking drawer + route + service** — booking flow needed the most work because `addScannedAssetsToBooking` didn't accept qty at all. Schema gains `quantities` (matching the booking picker's wire field name, distinct from location/kit's `assetQuantities`), drawer emits the JSON, route parses + validates with the same shape rules the picker uses (positive int ≤ 1,000,000), service signature extended to accept `quantities: Record<assetId, number>` with default `{}`, write path now `create: assetIds.map((id) => ({ assetId: id, quantity: quantities[id] ?? 1 }))` so `BookingAsset.quantity` lands per-row instead of relying on the schema default. Picker tests updated to expect the new arg.
- **Test fixture update** — `test/routes-tests/bookings.$bookingId.overview.scan-assets.test.tsx` expectations gained `quantities: {}` to match the new service shape.

Default qty per scan is **1** (matches "scan to add one") — user edits up from there. Server-side trigger still catches over-allocation. `pnpm webapp:validate` green at **2202 / 2202**. Open follow-up: needs manual UI test of all three scanner drawers (qty input renders, value submits correctly, pivot/BookingAsset rows carry the picked qty after submit).

**Mid-test addition (2026-05-22) — Polish-5 strict-available pool in scanner.** Initial Polish-5 used `Asset.quantity` as the qty input MAX, but the user pointed out the manage-assets picker shows the orthogonal pool ("· 250 boxes · 218 available" when 32 are tied up in kits) and the scanner should match. Added a shared per-asset MAX dispatcher and threaded it end-to-end:

- **`app/modules/scanner/picker-meta.server.ts`** — new module. Exports `ScannerPickerContextSchema` (`{ type: 'location'|'kit'|'booking', id }`) + `getScannerPickerMeta`. Location / kit delegate to existing `getLocationPickerMeta` / `getKitPickerMeta` with single-element id arrays; booking inlines the picker's `Asset.quantity − Σ Custody.quantity − Σ overlapping BookingAsset.quantity` formula (no extracted helper exists yet — pulling it out of the picker loader is its own refactor). Returns `null` for INDIVIDUAL.
- **`api+/get-scanned-item.$qrId.ts`** + **`api+/get-scanned-barcode.$value.ts`** — both endpoints gained a `pickerContext` query param (JSON-encoded). When present + the scanned thing is an asset, the loader attaches the normalised result as `asset.pickerMeta`. Both QR and barcode paths covered.
- **`app/utils/scanner-includes.server.ts`** — extended `AssetFromScanner` with `pickerMeta?: ScannerAssetPickerMeta` (ambient optional, not in the Prisma include).
- **All three drawers** — pass `searchParams={{ pickerContext: JSON.stringify({ type, id }) }}` to `GenericItemRow`; in `AssetRow` render `· X available` (warning-700) when `maxAllowed < totalQty`. Qty input bounded by `pickerMeta?.maxAllowed ?? asset.quantity` and hidden when `maxAllowed === 0`. Matches the manage-assets picker exactly.

**Mid-test addition (2026-05-22) — Polish-5 blocker semantics fix.** User scanned 22 boxes of Gloves (qty-tracked, total 250, with 22+10=32 already in two kits) into a booking and got blocked by `"1 asset are part of a kit. Scan Kit QR to add the full kit."` That blocker was pre-qty-tracking logic — when `Asset.kitId` was 1:1, kit membership meant the _whole_ asset was committed. For multi-kit qty-tracked, only a slice lives in any kit; the free remainder is bookable / custody-assignable individually. Updated three drawers' `assetsPartOfKit*` filters to require `asset.type === AssetType.INDIVIDUAL`:

- `add-assets-to-booking-drawer.tsx` (the screenshot the user shared)
- `assign-custody-drawer.tsx` (same overreach — qty-tracked with kit slice shouldn't block direct custody assignment of free pool)
- `release-custody-drawer.tsx` (same — releasing operator-only custody of a qty-tracked asset shouldn't be blocked by an unrelated kit slice)

The `kits.$kitId.scan-assets` flow uses a different blocker set (already-in-this-kit, has-custody, checked-out, kit-cannot-go-in-kit) — no changes needed there. The `partOfKit` _availability label_ (informational badge on the row) stays in place across all drawers — it correctly tells the user "this has a kit allocation"; only the _blocker_ was overreaching. Server-side strict-available re-validation + DEFERRED trigger remain the source of truth for over-allocation; this client-side change is purely a UX correction.

#### Phase 4b-Polish-6 — `BookingAsset.assetKitId` discriminator (mid-test, 2026-05-25) — UNCOMMITTED

User-flow bug that triggered this: scanning a qty-tracked asset (Gloves, 250 total, 87 in Kittington) standalone into a booking made the booking UI render Gloves nested under Kittington — making it look like the whole kit was booked. Root cause: `BookingAsset` had no kit-source discriminator, so the UI grouped by `asset.assetKits[0]?.kit` regardless of intent. Third application of the pattern already established for `Custody.kitCustodyId` (Phase 2) + `AssetLocation.assetKitId` (Polish-4).

**Production diagnostic queries shared with the user before deploy** confirmed 175k BookingAsset rows total, 74,370 in-kit candidates, 64,505 (87%) confidently backfilled to kit-driven via the whole-kit-presence heuristic, 9,865 stay standalone (1,559 of those are partial-kit-in-booking pairs that should genuinely stay standalone per the user's "partial kit adds are not common in shelf"). Backfill SQL inlined in the migration.

**Schema change** (`20260525131507_bookingasset_kit_discriminator`):

- New column `BookingAsset.assetKitId TEXT NULL` with FK to `AssetKit("id")` `ON DELETE SET NULL ON UPDATE CASCADE`. `SET NULL` (not `CASCADE` like `AssetLocation`) so removing an asset from a kit converts the booked slice to standalone rather than silently shrinking an active booking.
- Dropped `@@unique([bookingId, assetId])`. Replaced with two Postgres partial uniques: `BookingAsset_manual_unique (bookingId, assetId) WHERE assetKitId IS NULL` + `BookingAsset_kit_unique (bookingId, assetKitId) WHERE assetKitId IS NOT NULL`. Lets one standalone row coexist with N kit-driven rows for the same (booking, asset).
- Inline backfill: heuristic `BookingAsset.quantity = AssetKit.quantity AND every other AssetKit of the same kit has a matching row in the booking AT its slice quantity AND exactly one such kit matches`.

**Notable schema design adjustment** — original plan exposed `BookingAsset.assetKit AssetKit?` + `AssetKit.bookingAssets BookingAsset[]` as Prisma relation accessors. Adding both tipped Prisma's dynamic extended-client deep generic past TS's recursion limit (TS2321) in several services (`asset/service.server.ts`, `user/service.server.ts`, `organization/service.server.ts`, plus downstream consumers). The blowup happens because `Booking` (this row's grandparent) is a hub model with many relations — adding the AssetKit↔BookingAsset cycle pushed the type computation over. Final design declares `assetKitId` as a plain column with **no Prisma relation accessor**; the FK is enforced at the DB level only. Services that need kit-driven booking rows query directly via `db.bookingAsset.findMany({ where: { assetKitId } })`. Two long comments on `BookingAsset.assetKitId` (the schema field) + a corresponding NOTE on `AssetKit` explain the tradeoff for future contributors.

**Service-layer changes** (waves abbreviated):

- **Wave 4 (booking service)**: `updateBookingAssets` raw SQL rewritten — explicit `assetKitId = NULL` on insert + `ON CONFLICT ("bookingId", "assetId") WHERE "assetKitId" IS NULL` to target the new manual partial unique. Picker writes only standalone rows; kit-driven rows coexist via the partial unique. `addScannedAssetsToBooking{WithinTx}` accepts a new `assetKitIdByAsset?: Record<assetId, assetKitId>` map.
- **Wave 5 (picker filter fix)**: `bookings.$bookingId.overview.manage-assets.tsx` — qty-tracked-in-kit assets are now selectable in the picker (the old `assetKits.length === 0` filter is gone). Inline availability formula extended to subtract `inKits` so the picker MAX matches the asset overview's "Available" number.
- **Wave 6 (UI grouping)**: booking detail page + `booking-assets-sidebar.tsx` now group by `BookingAsset.assetKitId` (the per-row discriminator) rather than `asset.assetKits[0]?.kit` (the asset's incidental memberships). Same asset can appear as two rows: one standalone + one kit-driven, each in its own bucket. `getBookings` switched from `include` to `select` on bookingAssets so the inferred type surfaces `assetKitId` to downstream consumers.
- **Wave 7 (mobile back-compat)**: `api/mobile/bookings/$bookingId.ts` collapses multi-row BookingAsset into one entry per `assetId` with summed `quantity` + a new `assetKitId` field (unanimous kit or `null` if mixed). Mobile clients see the same flat shape they always did.
- **Wave 2 (cascade events)**: `updateKitAssets` + `bulkRemoveAssetsFromKits` pre-fetch the kit-driven BookingAsset rows that the AssetKit delete will SET-NULL via the DB cascade, then emit a per-booking system note after the tx commits ("`{user}` removed `{assets}` from kit `{kit}`. The kit's booked slice has been converted to a standalone reservation in this booking.").
- **Wave 3 (live qty link)**: `updateKitAssets` qty-change branch now propagates `AssetKit.quantity` updates to matching kit-driven `BookingAsset.quantity` rows inside the same tx (additional to the existing `AssetLocation.quantity` cascade). One-way link — picker edits to the booking don't bubble back to the kit slice.

**Scanner drawer changes**: `add-assets-to-booking-drawer.tsx` builds an `assetKitIdByAsset` map from scanned kits' `assetKits[].id` and submits it as JSON form data. Required adding `id` to the `KIT_INCLUDE.assetKits` select in `scanner-includes.server.ts`. Directly-scanned assets stay unmapped (server defaults `assetKitId = NULL` → standalone) — when the same asset shows up via both a direct scan and a kit scan, the direct scan wins (standalone takes precedence).

**Test fixtures updated**: `kit/service.server.test.ts` mock gets `bookingAsset: { findMany, updateMany }` for the new cascade pre-fetch + live-link paths. `bookings.$bookingId.overview.scan-assets.test.tsx` expectation gains `assetKitIdByAsset: {}` for the no-kit-scan case.

**Deferred to Phase 4d (explicitly NOT in Polish-6):**

- ~~Check-in floor guard when shrinking AssetKit.quantity below per-row check-in~~ — **RESOLVED in Polish-7 (2026-05-28).** `ConsumptionLog.bookingAssetId` added; loaders attribute per-row. See the Polish-7 section below.
- Booking-side multi-row picker UX (picker currently scopes to standalone rows only; kit-driven slices managed via kit removal).
- `BOOKING_ASSET_DETACHED_FROM_KIT` activity event (would need a new enum value + migration; system notes cover the audit trail for now).
- Server-side `enforce_booking_asset_sum_within_availability` DEFERRED trigger (cross-booking + time-windowed; complex enough to defer).
- ~~Kit booking-context status doesn't reach `PARTIALLY_CHECKED_IN` when a qty-tracked member has a mix of slices~~ — **RESOLVED in Polish-7 (2026-05-28).** `getBookingContextKitStatus` now reads per-row `bookedQuantity`/`dispositionedQuantity` for qty-tracked members. See Polish-7 below.
- **AtomsResetHandler render-storm under React 19** (surfaced 2026-05-27 during §15a manual test): navigating from a list page (assets index, kits list) into manage-{assets,kits} intermittently throws `useContext, dispatcher is null` inside React Router's `WithErrorBoundaryProps` → blank page; refresh fixes it. Pre-existing pattern, not a Polish-6 regression — `apps/webapp/app/atoms/atoms-reset-handler.tsx`:29-46 writes 4 atoms during render (deliberate "parent-runs-first" anti-hydration-flicker pattern from `7576974d7`), and the matching manage-\* route init writes `setSelectedBulkItems` during render too (`bookings.$bookingId.overview.manage-assets.tsx`:1191-1195). React 18 tolerated this; React 19.2.1 promotes "setState during render of another component" to a hard render bailout when `BulkListItemCheckbox` subscribers from the previous route are still mounted. Real fix (Phase 4d): replace during-render writes with `getDefaultStore().set()` in a navigation listener (Jotai store-imperative), or `useHydrateAtoms` for the route-side seed. Workaround during 4b testing is refresh.

`pnpm webapp:validate` green at **2202 / 2202**. The migration is NOT yet applied to dev — the user will run it manually for testing.

**Open follow-up after manual test pass:** commit Polish-6 as its own commit on `feat-quantities` (same cadence as Polish-1..5 + 4a-Polish-2). When merging the 4b release, the migration ships alongside the other 4b migrations. Backfill heuristic numbers (175k total, 64,505 → kit-driven, 9,865 standalone) belong in the PR description so reviewers understand the data-shape change ahead of time.

#### Phase 4b/6-Polish-7 — Per-row check-in attribution (2026-05-28) — COMMITTED (`f457757d1`)

Surfaced by manual check-in testing of Polish-6 multi-row qty slices. The
booking-overview badge, the booking detail Qty column, the kit rollup status,
and the explicit check-in drawer all aggregated qty dispositions by
`assetId`, which can't distinguish "the kit slice is done" from "all slices
are done" once an asset has both a kit-driven and a standalone
`BookingAsset` row in the same booking.

**Schema (NEW migration, run via `pnpm db:deploy-migration`):**
`packages/database/prisma/migrations/20260527150000_consumptionlog_bookingasset_attribution/` —
adds `ConsumptionLog.bookingAssetId TEXT` (nullable FK → `BookingAsset(id)`,
`ON DELETE SET NULL`) + index. Legacy rows stay `NULL`; readers greedy-fill
them. Schema mirror in `packages/database/prisma/schema.prisma` (plain column,
no Prisma `@relation` accessor — same pattern as `BookingAsset.assetKitId`).

**Service writes (`booking/service.server.ts`):** `createConsumptionLog` +
`CheckinDispositionInput` gained `bookingAssetId`; `partialCheckinBooking` +
`checkinBooking` tag each ConsumptionLog row with it **when the caller
supplies it**.

**Attribution helpers (`booking/service.server.ts`):**

- `attributeDispositionsByBookingAsset` — per-row TOTAL. Exact for rows with
  `bookingAssetId`; greedy-fills `NULL` legacy rows (kit-driven slices first
  by `id`-ordered cuid, then standalone).
- `attributeCategorizedDispositionsByBookingAsset` — per-row per-category
  (returned/consumed/lost/damaged) with **capacity shared across
  categories**. Critical: running the simple attributor once per category
  over-counts (each pass refills a kit row to full), which is the bug that
  made a fully-reconciled standalone slice read "Partially checked out".

**Loaders:** `bookings.$bookingId.overview.tsx` (badge + Qty column +
breakdown) and `bookings.$bookingId.overview.checkin-assets.tsx` (drawer
expected-assets, now one entry per BookingAsset row, each with
`bookingAssetId` + per-category `breakdown`). `getBookingContextKitStatus`
(`utils/booking-assets.ts`) reads per-row `bookedQuantity`/
`dispositionedQuantity` for qty members. New status `PARTIALLY_CHECKED_OUT_QTY`
(violet, "Partially checked out") + `list-asset-content.tsx` /
`booking-assets-sidebar.tsx` compute per-row state.

**Drawer (`partial-checkin-drawer.tsx`):** reconciled section grouped by each
slice's own `kitId` (so a standalone slice isn't absorbed into the kit group);
foldable kit groups; per-row Qty `logged / booked` + breakdown tooltip
(`ReconciledQtySummary`).

**Scan-kit qty fix (`addScannedAssetsToBookingWithinTx`, `:~7076`):** scanning
a kit now books qty-tracked members at their `AssetKit.quantity` (resolved
server-side from the `assetKitIdByAsset` map) instead of defaulting to 1.
Manage-kits "Add" path + add-asset-to-kit cascade already booked correct qty.

`pnpm webapp:validate` green at **2202 / 2202** throughout.

##### Polish-7b — drawer disposition WRITE-flow migrated to `bookingAssetId` keying (2026-05-28) — COMMITTED (`f457757d1`)

The previously-deferred "very complex" piece is now implemented. The check-in
drawer's qty disposition flow keys by `bookingAssetId` (the slice), not
`asset.id`. INDIVIDUAL assets stay keyed by `asset.id` (always single-slice).

**What changed:**

- **Shared schema** (`partial-checkin-drawer.tsx` `checkinDispositionSchema`):
  added optional `bookingAssetId`. Server-imported via
  `partialCheckinAssetsSchema` → covers client serialization + server parse.
- **Atom** (`atoms/qr-scanner.ts` `quickCheckinQtyAssetAtom`): synthetic key →
  `qty-checkin:${bookingAssetId}`; synthetic `data` carries `bookingAssetId`.
- **Drawer** (`partial-checkin-drawer.tsx`): new `bookingAssetIdForScannedItem`
  resolver (synthetic suffix / first-pending qty slice / kit-driven slice by
  `kitId`); `dispositions` map + `updateField` + `DispositionContextValue` +
  `QuantityDispositionBlock` + `AssetRow` keyed by `bookingAssetId`; context
  exposes `qtyRemainingByBookingAssetId`; new `activatedQtyBookingAssetIds` +
  `qrIdByBookingAssetId` (replaces `qtyTrackedIdsForCheckin`); seeding effect,
  blockers, `checkinsJson` (sends `{ assetId, bookingAssetId, ... }`), buckets,
  and progress all per-slice; `recentlyAddedBookingAssetId`.
- **Display** (the user-visible fix): pending qty slices now nest under their
  kit via each slice's OWN `kitId` (`PendingKitGroup` accepts mixed children;
  new `PendingKitQtyChild` renders the "Check in without scanning" affordance);
  standalone slices render loose. Removed `kitByAssetId` (asset-level, was the
  source of the "Part of kit: Camera kit" mislabel).
- **Server** (`booking/service.server.ts` `partialCheckinBooking`): stopped
  collapsing dispositions by `assetId` (dedup by `assetId::bookingAssetId`);
  new `computeBookingAssetSliceRemaining` helper; per-slice cap =
  `min(asset-level remaining, slice remaining)` when `bookingAssetId` supplied
  (legacy callers → asset-level only, unchanged); de-dup qty status-reset loop
  - per-asset events; aggregate `qtySummaries` by assetId for the notes.

**Backwards-compat (verified):** single-slice / legacy bookings have
`asset.id ↔ bookingAssetId` 1:1 → identical behaviour. All existing
`ConsumptionLog` rows are `bookingAssetId = NULL`; the attribution helpers
combine exact-tagged + NULL-greedy. Mobile / `assetIds`-only callers send no
`bookingAssetId` → asset-level path. No new migration (column already exists).

**Tests:** `qr-scanner.booking.test.ts`, `partial-checkin-drawer.test.tsx`
(incl. NEW two-slice independence case), and `booking/service.server.test.ts`
(NEW: per-slice tagging, per-slice cap rejection, legacy-null path skips the
slice helper, `computeBookingAssetSliceRemaining`, legacy-NULL+tagged mix).
`pnpm webapp:validate` green at **2209 / 2209**.

**Manual verify (booking `cmpphlceg004hulvp5t6u6am4`):** AA-batteries qty-50
nests under Kit A, qty-33 under Camera kit, qty-55 stays loose; each
independently quick-checkable. After quick-checking one slice + submit,
confirm via MCP the new `ConsumptionLog` row carries that slice's
`bookingAssetId`.

**Kit-scan follow-up (Polish-7b, same session):** scanning a kit QR with
qty-tracked members was throwing "Quantity-tracked assets must include at least
one non-zero disposition" on submit. Root cause: the drawer's kit branches
(activation memo + `scannedAssetIds`) read `item.data.assets`, but
`KitFromScanner` (`utils/scanner-includes.server.ts` `KIT_INCLUDE`) exposes
`assetKits: { asset: { id } }`, NOT a flat `assets` list — so the field was
always `undefined`, the kit's qty members never activated, and they reached the
server as zero-disposition no-ops. Fixes: (1) activation matches kit-driven qty
slices by each slice's own `kitId` (the loader's authoritative per-slice link),
not the kit member-id list; (2) `scannedAssetIds` reads `assetKits[].asset.id`.
Also added `ScannedKitQtyMemberRow` — a scanned kit now renders an EDITABLE
disposition row (Consumed/Returned/Lost/Damaged, seeded to full remaining) for
each of its qty members, indented under the kit row, so they get the same
consumption-log handling as standalone qty assets instead of a silent
full-remaining auto-checkin. INDIVIDUAL kit members stay covered by the kit
row's summary. `pnpm webapp:validate` green at **2209 / 2209**.

**Check-in floor guard (Polish-7b, formerly a Phase-4d deferral):** now that
`ConsumptionLog.bookingAssetId` exists, `updateKitAssets`
(`kit/service.server.ts`, qty-sync block) guards the kit→booking live-link: it
sums per-slice check-ins (`consumptionLog.groupBy` by `bookingAssetId`,
RETURN/CONSUME/LOSS/DAMAGE) and **throws** (blocks the edit) when a new kit
quantity would drop a kit-driven `BookingAsset` slice below what's already been
checked in against it — error names the asset + booking. Legacy NULL-tagged
logs aren't counted (no regression). 2 unit tests added. `pnpm webapp:validate`
green at **2211 / 2211**.

**Mid-test sweep — booking-side write paths that bypassed the discriminator.** First user test of Polish-6 surfaced multiple booking-add paths that hadn't been audited in the initial implementation: a booking with one scanned standalone qty-tracked asset + two added kits ended up with 6 BookingAsset rows where every `assetKitId` was NULL, `quantity` defaulted to 1 for kit-driven slices, and the same-asset overlap (Gloves in both kits + standalone) silently dropped the kit-driven slices. Sweep covered:

- **`bookings.$bookingId.overview.manage-kits.tsx` (the kit-add path)** — was calling `updateBookingAssets({ assetIds, kitIds })` with no kit attribution + no quantities. Now reads each selected kit's AssetKit rows (id + quantity), threads `assetKitIdByAsset` + `quantities` maps through. Also fixed the "newAssetIds" filter — it dropped assets whose id was already in the booking (preventing the kit-driven row from being created when a standalone slice already existed). Filter rewritten to scope on `assetKitId` (per-row test) instead of `assetId` (which is wrong now that the same asset can have multiple slices in one booking).
- **`updateBookingAssets` (raw SQL)** — accepts the new `assetKitIdByAsset` parameter; splits the insert into two `$executeRaw` branches: standalone rows upsert against `BookingAsset_manual_unique` (qty edits work as before), kit-driven rows insert against `BookingAsset_kit_unique` with `ON CONFLICT DO NOTHING` (re-adding the same kit is a no-op; qty edits cascade from `updateKitAssets` instead).
- **`computeBookingAssetRemaining` (`booking/service.server.ts:2295`)** — **critical bug**, was using `where: { bookingId_assetId: ... }` referencing the composite unique that the migration dropped. Would have crashed at runtime on partial check-in. Rewritten to `findMany` + sum quantities across all rows (standalone + kit-driven) for the (booking, asset) pair. ConsumptionLog still keyed by (bookingId, assetId), so its aggregate already covers the whole booking-asset combination.
- **`removeAssets`** — when called from the manage-kits "remove kit" flow it was deleting ALL slices for the asset (including any standalone slice the user had added separately). Now when `kitIds.length > 0`, scopes deletion to BookingAsset rows whose `assetKitId` belongs to one of the kits' AssetKits. The picker / asset-bulk remove path (kitIds empty) keeps the legacy "delete all slices" semantics since the user's intent there is asset-level.
- **`updateKitAssets` kit/booking sync** — when an asset is removed from a kit and that kit is in active bookings, the old code did `bookingAsset.deleteMany({ where: { bookingId, assetId } })`, undoing the FK `SET NULL` cascade from Wave 2 of Polish-6 that was meant to convert the kit-driven slice to standalone. Removed the deleteMany — the cascade handles row preservation and the `emitAssetKitDetachmentNotes` helper from Wave 2 posts the per-booking system note explaining the conversion. The companion "add asset to kit → propagate to active bookings" path now resolves the matching AssetKit and writes `bookingAsset.createMany` with `assetKitId` + `quantity` populated (was writing standalone qty=1 before).
- **`/api/bookings/$bookingId/adjust-asset-quantity`** — `findFirst({ where: { bookingId, assetId } })` returned an arbitrary row when both standalone and kit-driven slices existed for the same asset. Scoped to `assetKitId: null` since the route only adjusts the standalone slice (kit-driven qty is managed via the kit picker, not here).

Sweep typecheck + tests still green at **2202 / 2202** (after fixes; the broken `bookingId_assetId` query was caught by typecheck before runtime). The user's broken booking from the first test attempt was cleared so they can retest from a clean slate.

**Mid-test sweep follow-up (2026-05-27) — kit-remove-asset action collided with `BookingAsset_manual_unique` when a standalone slice already existed.** User had Kit A (containing AA batteries qty 50) added to booking + a standalone slice of AA batteries (qty 33) on the same booking. Removing AA batteries from Kit A via `/kits/$kitId/assets`'s row trash icon threw P2002 `Unique constraint failed on the fields: (\`bookingId\`,\`assetId\`)`and the whole tx rolled back. Root cause:`kits.$kitId.tsx` `removeAsset`action does a raw`tx.kit.update({ assetKits: { deleteMany: { assetId } } })`which deletes the AssetKit row → DB's`ON DELETE SET NULL`cascade on`BookingAsset.assetKitId`fires → the kit-driven BookingAsset row's`assetKitId`becomes NULL → violates`BookingAsset_manual_unique`(which already has a standalone row for the same`(bookingId, assetId)`). The same bug was latent in `updateKitAssets`(the picker-driven kit-removal path) — both code paths called`tx.assetKit.deleteMany`without resolving the standalone collision first. Polish-6's design assumed all kit-removal paths would merge or refuse the collision; neither was implemented. Fix: new exported helper`mergeStandaloneCollisionsForKitDetachment(tx, assetKitIds)`in`kit/service.server.ts`. For each kit-driven BookingAsset row about to be SET-NULL'd, checks if a standalone row exists for the same (bookingId, assetId); if yes, bumps the standalone row's qty by the kit-driven qty + deletes the kit-driven row (so cascade has nothing left to touch). Non-colliding rows still cascade-SET-NULL as Polish-6 designed. Wired into both `updateKitAssets`(at both`tx.assetKit.deleteMany`sites — primary removal + cross-kit-move) and the route's`removeAsset`action. The route also gains`emitAssetKitDetachmentNotes` (it was bypassing the booking-side detachment notification entirely before).

INDIVIDUAL assets can't collide (trigger `enforce_individual_asset_single_kit` prevents multiple slices), but the helper handles them safely either way. Asset-status flips already correct for the ONGOING-booking case — `Asset.status` only flips back to AVAILABLE when `remainingCustody === 0`, which the existing route code already guards.

**Mid-test sweep follow-up (2026-05-27) — booking detail page collapsed multi-row qty by assetId.** With both fixes above in place, the user added a standalone slice (qty 33) to a booking that already had a kit-driven slice (qty 50, via Kit A) for the same asset (AA batteries). Both rows in the "Assets & Kits" list rendered with `Qty 33` — the kit-driven row should have shown `50`. Per-row qty WAS being attached correctly at `bookings.$bookingId.overview.tsx`:268 (one `bookedQuantity` per BookingAsset), but the enrichment step at line 488-490 built a `bookedQuantityMap = new Map(booking.bookingAssets.map((ba) => [ba.assetId, ba.quantity]))` keyed by `assetId` — which collapses two slices for the same asset to a single arbitrary value — and then clobbered the correct per-row qty at line 566 with `bookedQuantity: bookedQuantityMap.get(asset.id) ?? 1`. Fix: drop the `bookedQuantityMap` entirely and read `asset.bookedQuantity ?? 1` from the per-row enrichment that already happened at line 268. Single 4-line change. Verified DB: AA batteries in booking cmpntahtv001aultewnjiph9i has two BookingAsset rows — standalone (qty 33, assetKitId NULL) + kit-driven (qty 50, assetKitId=cmpnt9s5n000nulte919pla83).

**Mid-test sweep follow-up (2026-05-27) — booking manage-assets loader didn't scope `bookingAssets` to standalone slices.** With the `hideUnavailable` picker fix in place, qty-tracked-in-kit assets now surface in the picker, but they showed as PRE-SELECTED with the kit's slice quantity pre-filled (e.g. "AA batteries — 50 / 410" pre-checked, "3 selected" counter), even though no standalone BookingAsset row existed. The component's `quantities`, `bookingAssets` (selection seed), and `initialQuantities` memos at `bookings.$bookingId.overview.manage-assets.tsx`:1072 / 1123 / 1143 all read `booking.bookingAssets` and all carried comments claiming the loader scopes to `assetKitId IS NULL` — but the loader's `getBooking(...)` call never applied that filter (`getBooking` returns the full set; only the route's ACTION handler at line 634-640 already scoped its own query to `where: { assetKitId: null }`). Fix: after computing `bookingKitIds` (which still needs the full set for kit-detection), reassign `booking.bookingAssets = booking.bookingAssets.filter((ba) => ba.assetKitId === null)`. All three component-side consumers now match their comments. Verified asset cmo2mq85c001dul52ls03qy0l (AA batteries, total 460, 50 in Kit A as `assetKitId = cmpnt9s5n000nulte919pla83`) in booking cmpntahtv001aultewnjiph9i: only the kit-driven BookingAsset row exists for this asset, no standalone row.

**Mid-test sweep follow-up (2026-05-27) — `hideUnavailable=true` picker filter excluded qty-tracked-in-kit assets.** Picker for the booking manage-assets route hid QUANTITY_TRACKED assets that had ANY AssetKit row, even though their free pool was bookable as standalone (the explicit Polish-6 "Wave 5" promise). Verified against dev DB: "AA batteries" (cmo2mq85c001dul52ls03qy0l), QUANTITY_TRACKED total 460, 50 in Kit A, 410 free pool — picker returned empty for this asset. Root cause: `apps/webapp/app/modules/asset/service.server.ts`:834 set `where.assetKits = { none: {} }` unconditionally when `hideUnavailable=true`, with no qty-tracked bypass. Polish-2's matching custody branch at line 694-711 already had the right pattern (`where.AND.push({ OR: [{ type: "QUANTITY_TRACKED" }, { custody: { none: {} } }] })`); the kit branch hadn't been updated to mirror it. Fix: replace the bare assignment with the same AND-push + OR-bypass pattern, swapping `custody` for `assetKits`. The picker's downstream "Available" math (manage-assets.tsx:207-263 in the loader) already subtracts AssetKit sums, so the displayed count stays accurate.

**Mid-test sweep follow-up (2026-05-27) — search-where builder still referenced `Asset.location`.** Searching from the manage-assets picker (`?s=a`) returned a 500 with `PrismaClientValidationError: Unknown argument \`location\``because`getAssets`at`apps/webapp/app/modules/asset/service.server.ts`:586 still had a bare `{ location: { name: { contains: term } } }`clause in its OR-search block — the pivot migration removed the`Asset.location`relation but the search-side builder wasn't rewritten. Prisma can't validate this at compile-time (it only fails at request time), and the test suite had no`?s=...`case across the manage-assets loader, so typecheck + the existing 2202 tests both let it slip through. Fix: rewrite to`{ assetLocations: { some: { location: { name: { contains: term, mode: "insensitive" } } } } }`. Single site — full sweep across `apps/webapp/app/modules/{asset,booking,kit}`showed no other bare`location:`filter clauses on Asset (the other two hits at lines 2239 + 4748 are correctly nested inside`assetLocations.select`).

##### 2026-05-29 — main merge + post-merge fixes + multi-slice bug bash + security

**`main` merged into `feat-quantities` (`8f9f14de6`, 27 conflicts).** Main
brought the mobile companion app, the reports module, and a batch of pending
migrations (incl. `Kit.preferredBarcodeId`). Conflict resolution +
post-merge breakage fixes landed in the merge commit and `21ce040a0`. Things
that needed manual attention after the merge:

- **Pending migrations.** Main shipped migrations the worktree DB hadn't run
  (e.g. `Kit.preferredBarcodeId`) → kit pages threw P2022 until
  `db:deploy-migration` was run. (Operator action, not a code fix.)
- **Advanced asset-index search 500 (`missing FROM-clause entry for table
"tm"`).** Latent bug exposed by the merge: the custodian search clause in
  `asset/query.server.ts` still referenced top-level `tm`/`u` joins that were
  removed when custody moved to the `custody_agg` LATERAL. Rewritten to a
  per-asset `EXISTS (… Custody cust LEFT JOIN TeamMember/User … WHERE
cust."assetId" = a.id AND name ILIKE …)`. Tests mock `$queryRaw`, so this
  was invisible to validate — caught only in the browser.
- Booking/asset service + drawer merge conflicts re-verified (tasks #57–#67).

**Three multi-slice booking bugs fixed (`21ce040a0`)** — surfaced while the
user tested mixed kit+standalone qty bookings:

1. **Multi-kit same-asset dropped a kit slice on add.** `updateBookingAssets`
   collapsed kit attribution into a 1:1 `Record<assetId, assetKitId>`, so an
   asset in two kits kept only one slice. Replaced with a `kitSlices`
   list (`{assetId, assetKitId, quantity}[]`) threaded through manage-kits,
   `updateBookingAssets`, and the scan-add path. Verified on a fresh booking:
   3 distinct AA-battery slices.
2. **Kit-scan check-in logged NULL `bookingAssetId`.** `checkinBooking` (the
   full-check-in path, distinct from `partialCheckinBooking`) auto-defaulted
   each disposition with `?? null`. Now iterates per `BookingAsset` slice,
   uses `computeBookingAssetSliceRemaining`, caps per-asset, and tags
   `bookingAssetId: disposition.bookingAssetId ?? slice.id`. The "AA wrongly
   checked in inside Camera Kit" screenshot was a legacy-NULL greedy-fill
   artifact, resolved by this fix (MCP-confirmed zero NULL post-fix).
3. **`duplicateBooking` dropped `assetKitId` → P2002** on a multi-slice
   source. One-line fix: copy `assetKitId` into the duplicated rows.

Tests for all three added in the same commit.

**Security follow-up (`2c15aca09` + `dde0f9d00`)** — the pre-commit security
review on `21ce040a0` flagged that `kitSlices[].assetKitId` is request-supplied
but never org-validated (cross-org IDOR — attach Org B's `AssetKit.id` to your
own booking). Added `assertAssetKitsBelongToOrg` to the shared
`~/utils/org-validation.server` guards (mirrors `assertAssetsBelongToOrg`),
wired into `updateBookingAssets` + `addScannedAssetsToBookingWithinTx` inside
the mutation tx; the scan path also gained the asset-id count guard it was
missing. Follow-up commit filters falsy `assetKitId` from the scan-path guard
(the kit-qty resolution below it already tolerates non-kit slices);
`updateBookingAssets` is intentionally left unfiltered (its insert writes the
id into a NOT NULL column, so rejecting a falsy id there is the correct
fail-closed behaviour). `pnpm webapp:validate` green at **2354 / 2354**.

**Unpushed:** the 2 security commits are ahead of `origin/feat-quantities`
(which already has the merge + `21ce040a0`). Push needs explicit go-ahead.

#### Phase 4c — Split / merge UX (third)

Pure user-facing feature work on top of 4a + 4b's schema:

- "Move N units of {asset} from Location A to Location B" — single
  tx, decrement A's pivot row + increment-or-create B's pivot row.
- "Move N units of {asset} from Kit X to Kit Y" — symmetric on
  `AssetKit`.
- Optional "Place N unplaced units at Location L" flow for the gap
  between `Asset.quantity` and `sum(AssetLocation.quantity)`.
- All flows gated on `Asset.type = QUANTITY_TRACKED`. INDIVIDUAL
  assets keep the existing single-placement UX.

#### Phase 4d — Auxiliary items

Independent of the pivot work. Pick after 4a-4c are stable. Some may
slip into Phase 5 if scope grows:

- Kit integration polish + checkout/check-in with quantity handling.
- Model grouping tool (bulk assign existing assets to a model).
- Import/export with quantity columns.
- Bulk operations awareness of asset types.
- **Rebalance kit allocation** when assigning operator custody on a
  fully kit-allocated qty asset (auto-decrement kit row, paired
  events; edge case: kit row hits 0). After this lands, update the
  in-kit copy in `QuantityCustodyDialog` (currently says "kit count
  unaffected"; will be wrong post-rebalance).

#### Phase 4d follow-up — Kit-included qty-tracked booking quantity

Surfaced 2026-05-13 during §7 testing. When a kit is added to a
booking, qty-tracked assets inside the kit get `BookingAsset.quantity
= 1` instead of the kit's actual allocation.

> **UNBLOCKED by Phase 4a-Polish-2 (2026-05-15).** `AssetKit.quantity`
> is now the meaningful source of truth, so **option (1) below is the
> path** — the "pinned at 1" blocker is gone. Still uncommitted /
> not yet built; pick this up as the next Phase 4d follow-up once
> the Polish-2 commit lands.

Two options were considered at follow-up time:

1. **Tied to multi-kit allocation post-4a polish:** once
   `AssetKit.quantity` becomes meaningful, set
   `BookingAsset.quantity = AssetKit.quantity` when materialising kit
   assets onto a booking. Disable the per-asset qty picker on the
   booking sidebar for kit-included rows (they're not adjustable
   without leaving the kit).
2. **Interim heuristic (lighter weight):** when a kit is added to a
   booking, default qty-tracked `BookingAsset.quantity` to
   `Asset.quantity` (full pool) rather than 1. Available pool math at
   checkout time will still catch overallocation. Acceptable as a
   bridge until option (1) ships.

Either way, the asset overview / booking sidebar needs a UX cue: the
qty for a kit-included asset is locked because the kit owns it.

**Verification 2026-06-10 — option (1) is shipped & verified.** Walked the
flow live on booking `cmpy2ooas004lomhqd0szuu28` ("4e add-asset retest"):
the kit `Kittington 2` (containing `Pencils` with `AssetKit.quantity = 22`)
was added to the booking via `manage-kits`, and the booking sidebar
rendered the Pencils row with `× 22`, not `× 1`. Server materialisation
path traced (Phase 1 read): `manage-kits.tsx:438` writes `kitSlices`
with `quantity: ak.quantity`; the raw-SQL insert at
`booking/service.server.ts:4806` uses `unnest(${kitQuantities}::int[])`;
edits cascade through `kit/service.server.ts:4127-4133`; and the
adjust-asset-quantity API at
`routes/api+/bookings.$bookingId.adjust-asset-quantity.ts:83-101`
already scopes its `findFirst` to `assetKitId: null` so direct edits
to a kit-driven slice 404. The UX cue is also already in place — at
`list-asset-content.tsx:101-128` `canSeeActions` returns `false` when
`isPartOfKit`, which hides the entire row-actions dropdown (including
"Adjust quantity") for any kit-member asset row. A defence-in-depth
frontend gate (`AssetRowActionsDropdown.isKitDriven`) was sketched and
reverted: `canSeeActions` already shadows it 100% on this branch.

#### Pending backlog after this PR (snapshot 2026-06-10)

Captured for the team's reference so the scope boundary at PR-merge is
unambiguous. All items below are **deliberately out of this PR** —
either explicitly deferred during planning or post-Phase-4 cleanup work.

**🟡 Must-fix-before-release on `feat-quantities`:** none. PRD blocker
(Phase 4d follow-up — kit-included qty materialisation) is closed and
verified. No outstanding correctness bugs in "Known Issues" (line 2052+).
Validate green at 2421 / 2422 (one pre-existing skip, unchanged from
main).

**🔵 Post-release backlog — deferred, NOT in this PR:**

| Item                                                                             | Where (CLAUDE-CONTEXT.md) | Status                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 4c — Split / merge UX** ("Move N units from Location A → B" + Kit X → Y) | line 1507-1518            | **DELIVERED 2026-06-10, COMMITTED `c6ef9c802`, polish 2026-06-15** — brought forward from post-release; see "Phase 4c — Split / merge UX (COMMITTED)" section below for the full report.                                                                                                                                                                                                                   |
| **Phase 4d — Auxiliary items umbrella**                                          | line 1520-1533            | Mostly not started. Sub-items: kit checkout/check-in qty polish, model grouping tool, import/export with qty columns, bulk-ops asset-type awareness.                                                                                                                                                                                                                                                       |
| **Phase 4d — Rebalance kit allocation**                                          | line 1529-1533            | **Explicitly deferred 2026-06-10** (release pressure). Asset's `Assign` button stays disabled for fully-kit-allocated qty-tracked assets. `QuantityCustodyDialog` copy stays as-is.                                                                                                                                                                                                                        |
| **Phase 4e — Booking-notes sweep (original scope tail)**                         | line 1698-1700            | **CLOSED 2026-06-15.** Pre-release grep surfaced the two residual writers (`booking/service.server.ts` per-asset final + partial check-in notes + the `buildQtyPerAssetFragment` helper) that still emitted bare integers — now route counts through `formatUnitCount`, so phrasing reads "returned 10 boxes" instead of "returned 10" for qty-tracked assets. See "Phase 4e tail closeout" section below. |
| **Sub-phase 3e — Calendar + Polish**                                             | line 710-720              | Deferred until after Phase 4c (entangled with split/merge mechanic).                                                                                                                                                                                                                                                                                                                                       |
| **Sub-phase 3d follow-ups**                                                      | line 645-708              | Deferred until after Phase 4.                                                                                                                                                                                                                                                                                                                                                                              |
| **Reports end-to-end verification**                                              | line 2068-2083            | `TESTING-REPORTS.md` scaffold ready; deferred to post-Phase-4 to avoid double-walkthrough.                                                                                                                                                                                                                                                                                                                 |
| **Backfill verification on prod snapshot** (KitCustody, 628 prod rows)           | line 2088-2091            | `TESTING-KIT-CUSTODY-CORRECTNESS.md` Path B. Pre-prod-merge task — has to happen before the migration ships to prod, doesn't block PR merge.                                                                                                                                                                                                                                                               |

#### Phase 4c — Split / merge UX (2026-06-10) — COMMITTED `c6ef9c802`

**Brought forward from post-release backlog** under release pressure. Pure
UX layer on top of the 4a + 4b pivot schema — no migrations, no new
constraints. Three services + one axis-parameterized dialog + one route's
worth of wiring.

**Post-merge polish (2026-06-15) — committed alongside the
`assets.$assetId.activity` browser-bundle fix** (logger.ts `process.env`
guard, separate `fix(webapp)` commit `7287a338d`). User browser-tested
the dialog and flagged the picker styling drift from the rest of the
app:

- **Destination picker.** Replaced the Radix `Select` with the canonical
  Popover + button-wrapped styled-`<div>` + `ChevronDownIcon` pattern
  used by `components/dynamic-select/dynamic-select.tsx`. Same border
  (`border-gray-300 px-[14px] py-2 text-sm`), same chevron icon from
  `@radix-ui/react-icons`, same focused-error treatment. Keyboard
  navigation (↑/↓/Enter) preserved.
- **Server-error block** above the form (the "Cannot move — kit is in
  custody …" message) bumped from `text-xs p-3 bg-error-25` to
  `text-sm p-4` — same token ladder as `components/shared/warning-box.tsx`
  so error-tone inline alerts read with the same weight as warning-tone
  ones elsewhere in the app.
- **Smoke test mock swap.** The dialog's component test was mocking
  `~/components/forms/select`; now mocks `@radix-ui/react-popover`
  inline-renderer (same shape as `sort-by.test.tsx`), and the two tests
  that drive destination selection switched from a synthetic
  `<select>` change-event to a direct `fireEvent.click` on the
  rendered `role="option"` row.

Live verification on `feat-quantities` against the `Quantities till the end`
workspace (Gloves asset, 250 boxes across 4 manual locations + Kittington
kit + 12 unplaced):

- §1 location move (Chambers of Xeric → Christmas Event, 10 boxes) — UI
  updated 25 → 15 / 22 → 32, paired `ASSET_LOCATION_CHANGED` events at
  `2026-06-11 13:37:00.705+00` share `meta.moveCorrelationId =
e060c76c-8ead-4f98-9b86-62697f4a6707`, `side: "from"` / `side: "to"`.
- §3 kit BLOCK (kit-inherited-custody path) — attempted move
  Kittington → Kittington 2 refused with "Cannot move — Kittington is
  currently in Woox's custody. Release custody first." Both inline form
  block AND error toast surfaced the message verbatim. This is the
  exact behaviour from the 2026-06-10 option-(a) decision.
- §5 place unplaced (12 boxes at God Wars Dungeon) — UI updated 66 → 78,
  unplaced CTA disappeared after submit, single
  `ASSET_LOCATION_CHANGED` event with `meta.placeUnplaced: true` +
  `meta.moveCorrelationId = 9633efe3-d310-48ff-b199-65c15e934af4`.
- §6 over-move guard (try 20 with 15 available) — client-side zorm
  rendered "Maximum 15 boxes available" before the action ran.
- §6 INDIVIDUAL hidden — Eternal Boots (asset_type INDIVIDUAL) renders
  no "Move" affordance on its placement row, no kit row, no
  place-unplaced CTA.

Service-only verification (covered by Agent-G's 36 unit tests, not
walked in browser): §2 source exhaustion, §3 kit happy-path,
§3 active-booking BLOCK, §4 concurrent guard, §7 cross-org IDOR.

**Implementation plan + dependency graph:**
`superpowers/PHASE-4C-SPLIT-MERGE-UX.md` (delete before PR merge).

**Build cadence (multi-agent parallel execution):**

- **Wave 0 (sequential):** shared contracts at
  `apps/webapp/app/modules/asset/move-units.types.ts` (`MoveAxis`,
  `MoveAssetLocationUnitsArgs`, `MoveAssetKitUnitsArgs`,
  `PlaceUnplacedUnitsArgs`, `MoveUnitsResult`, `PlaceUnplacedUnitsResult`,
  `MOVE_UNITS_INTENT_FIELD` constant).
- **Wave 1 (4 parallel agents):** `moveAssetLocationUnits`,
  `moveAssetKitUnits`, `MoveUnitsDialog`, `TESTING-PHASE-4C.md` skeleton.
- **Wave 2 (2 parallel agents):** asset detail page UI+action wiring
  combined into one agent (`assets.$assetId.overview.tsx` editor would
  collide if split), service-level unit tests as a second agent
  (different files, no collision).
- **Wave 3 (sequential, 1 human):** `placeUnplacedUnits` one-sided
  variant of `moveAssetLocationUnits`, cross-axis sanity sweep.
- **Wave 4:** `pnpm webapp:validate` → 2588 / 2589 tests pass.

**Three flows shipped:**

- **Move N units between two locations.** `moveAssetLocationUnits` at
  `asset/service.server.ts:7608`. Decrements (or deletes-on-zero) the
  source AssetLocation row, upserts the destination row. Emits two
  paired `ASSET_LOCATION_CHANGED` events sharing a
  `meta.moveCorrelationId` UUID. One asset-side bidirectional "moved
  N units from L1 to L2" note via `createLocationChangeNote` + two
  per-location timeline notes (one "removed … moved to", one "added …
  moved from") — mirrors the single-location-update precedent at
  `service.server.ts:2596-2648`.
- **Move N units between two kits.** `moveAssetKitUnits` at
  `kit/service.server.ts:5115`. Same shape, plus **two BLOCK
  conditions decided 2026-06-10** (chose option (a) — block with
  helpful error — over silent cascade or confirm prompt):

  - **Active booking holds source kit** (status in
    DRAFT/RESERVED/ONGOING/OVERDUE) → 400 with the conflicting
    booking names + IDs in `additionalData`. User must release those
    bookings before moving.
  - **Source kit is in kit-inherited operator custody**
    (`Custody.kitCustody.kitId === fromKitId`) → 400 with the
    custodian's name. Release custody first.

  On the dest side, the kit-driven `BookingAsset.quantity` slices on
  any active bookings holding the destination kit get incremented in
  the same tx (mirrors the existing cascade pattern at
  `kit/service.server.ts:4127-4133`). Notes use new `createKitMoveNote`
  helper at `note/service.server.ts:385` rendering
  "moved {N units} from kit {KitX} to kit {KitY}".

- **Place N unplaced units at a location.** `placeUnplacedUnits` at
  `asset/service.server.ts:<near end>`. One-sided variant of
  `moveAssetLocationUnits` — no source row; just upserts the dest.
  Computes unplaced from
  `Asset.quantity - sum(AssetLocation.quantity WHERE assetKitId IS NULL)`
  (manual rows only — kit-driven rows live on the orthogonal AssetKit
  axis per the 2026-06-02 trigger realignment). Single
  `ASSET_LOCATION_CHANGED` event with `meta.placeUnplaced: true`.
  `Asset.quantity` null-coerced to 0 so a misconfigured asset returns a
  clear 400 instead of writing a `NaN`-comparison row.

**Generic dialog component.** `MoveUnitsDialog` at
`components/assets/move-units-dialog.tsx:202` — axis-parameterized
(`'location' | 'kit' | 'place-unplaced'`). Used the static-list `Select`
primitive (Radix) over `DynamicSelect` since destinations are
pre-computed in the loader, not query-driven. Re-validates client-side
via react-zorm + server-side via `getValidationErrors` fallback per the
CLAUDE.md form-validation rule. Smoke-test at `move-units-dialog.test.tsx`
covers axis-specific header copy + the disable conditions; assertion
style adapted to happy-dom's constraint-validation API
(`validity.rangeOverflow` + `value` / `min` inspection instead of
unreliable `requestSubmit` blocking).

**Entry points (single route file).**
`routes/_layout+/assets.$assetId.overview.tsx` — three insertion points
all guarded by `isQty && canEditAsset`:

- Sidebar "Placed at locations" card per manual `AssetLocation` row
  → `<MoveUnitsDialog axis="location" ... />`. Kit-driven rows
  excluded (`!viaKit`) per orthogonal-axes invariant — they have to be
  moved via the kit instead.
- Sidebar "Included in kit(s)" card per `AssetKit` row
  → `<MoveUnitsDialog axis="kit" ... />`.
- New "X units unplaced" CTA card after `QuantityOverviewCard` when
  `unplacedQuantity > 0` → `<MoveUnitsDialog axis="place-unplaced" ... />`.
- Loader computes `moveDestinations.locations` + `moveDestinations.kits`
  (org-scoped, tight `select: { id, name }`) and `unplacedQuantity`.
- Action gains a single early dispatch on `MOVE_UNITS_INTENT_FIELD`
  routed to `handleMoveUnitsIntent`, which zod-validates per-axis and
  calls the matching service.

**Tests added (Wave 2 Agent-G).** 36 new tests across:

- `modules/asset/service.server.test.ts` — 12 for
  `moveAssetLocationUnits` (happy paths, source-exhausted, dest-exists,
  all negative paths, orthogonal-axes invariant assertion) + 9 for
  `placeUnplacedUnits`.
- `modules/kit/service.server.test.ts` — 15 for `moveAssetKitUnits`
  including both the **active-booking BLOCK** and the
  **kit-inherited-custody BLOCK**, plus the dest-side BookingAsset
  cascade verification.
- Each new Prisma client mock carries the `// why:` justification per
  the CLAUDE.md Mock Justification Rule.

**Cross-axis invariant verified.** AWK-pattern grep over each new service
confirms no unintended cross-pivot writes: `moveAssetLocationUnits` →
zero `tx.assetKit` / `tx.custody` / `tx.bookingAsset` writes;
`placeUnplacedUnits` → zero cross-axis writes; `moveAssetKitUnits` → zero
`tx.assetLocation` writes (the only `tx.bookingAsset` calls are the
expected `findMany` for the active-booking BLOCK check + the `updateMany`
for the dest-side cascade).

**Linting.** Four `local-rules/require-org-scope-on-id-queries` warnings
on the post-findFirst `tx.assetLocation.delete/update where id: source.id`
calls (and one analogous in the kit service) carry the required
`// eslint-disable-next-line ... -- idor-safe: <id was just retrieved
via the org+asset-scoped findFirst above, inside this same tx>`
justification per the rule's escape hatch. These are NOT cross-org IDOR
risks.

**Validate result.** `pnpm webapp:validate` exit 0 — 191 test files /
2588 tests pass, 1 pre-existing skip. Baseline was 2421 (Phase 4e);
this PR brings Shelf to **2588 / 2589** (+36 Phase 4c tests plus
unmeasured carry-overs since the last local validate).

**Pending pre-PR-merge:** the manual walk-through of
`TESTING-PHASE-4C.md` (9 sections, ~480 lines — seed data shopping list

- §1-§8 flow verification + §9 validate-green) against a real dev DB.
  Not gating the PR on the manual pass since service-level tests cover the
  correctness matrix; the manual pass is for browser/UI verification.

**Plan-file housekeeping.** Delete
`superpowers/PHASE-4C-SPLIT-MERGE-UX.md` before PR merge (per
`feedback_plans_location` memory).

#### Phase 4e — Quantity-aware notes + activity events (2026-05-31) — COMMITTED (`f07abe29d`)

**Done in five chunks (C0–C4) on `feat-quantities`:**

- **C0 — shared helpers + tests.** `app/utils/asset-quantity.ts` —
  `formatUnitCount(asset, qty)` → `"50 units"` for QUANTITY_TRACKED
  (using `Asset.unitOfMeasure ?? "units"`), `null` for INDIVIDUAL or
  missing qty; `assetQtyMeta(asset, qty)` → `{ quantity }` for
  qty-tracked positive qty (spread into existing `recordEvent` `meta`),
  `{}` otherwise so INDIVIDUAL event meta stays clean. Plus
  `wrapAssetWithCountForNote(asset, qty)` in `markdoc-wrappers.ts`
  composing `"N units of {asset link}"` for the common single-asset
  per-asset-note case. 11 unit tests.
- **C1 — Custody axis.** Kit-cascade custody notes (7 sites in
  `kit/service.server.ts`: `performKitDeletion`, `releaseCustody`,
  `bulkAssignKitCustody`, `bulkReleaseKitCustody`, `updateKitAssets`
  add + remove, `bulkRemoveAssetsFromKits`) now render
  `"granted/released ${custodian} custody of N units …"` for qty-tracked,
  byte-for-byte unchanged for INDIVIDUAL. Per-(asset, kitCustody)
  quantity map built from the inherited / released `Custody` rows
  (NOT `Asset.quantity`). `CUSTODY_ASSIGNED/RELEASED` events get
  `meta.quantity` via `assetQtyMeta`. The asset-index bulk
  give/release-custody paths filter qty-tracked out upstream
  (individual-only by construction, `// why:` comments at the sites).
  The direct quantity-custody dialog (`checkOutQuantity` + qty release)
  writes a `ConsumptionLog` + event (already qty-aware), no `Note` —
  untouched.
- **C2 — Kit-membership axis.** `createBulkKitChangeNotes` /
  `createKitChangeNote` (`note/service.server.ts`) take `type`,
  `unitOfMeasure`, `quantity` per asset; render
  `"added N units to {kit}"` / `"removed N units from {kit}"` for
  qty-tracked (INDIVIDUAL keeps `added asset to …`). Move case
  (cross-kit) deliberately untouched — moves keep identical qty on
  both sides; counting them would just add noise. `updateKitAssets`
  caller widens its asset/`assetKits` select with `quantity` +
  `unitOfMeasure` and attaches per-asset `kitQuantity`. Four
  `ASSET_KIT_CHANGED` event sites (`kit/service.server.ts:1354`/
  `4140`/`4154`/`4910`) get `meta.quantity = AssetKit.quantity`.
- **C3 — Location axis.** `getLocationUpdateNoteContent` +
  `getKitLocationUpdateNoteContent` (`asset/utils.server.ts`) take
  `type`/`unitOfMeasure`/`quantity` and render
  `"placed N units at L"` / `"moved N units from A to B"` /
  `"removed N units from L"` (kit-cascade suffixes preserved).
  Threaded through `createLocationChangeNote` /
  `createBulkLocationChangeNotes` (`location/service.server.ts`), the
  `updateAsset` single-location dialog path, and the kit-cascade
  location writers in `kit/service.server.ts`. 11
  `ASSET_LOCATION_CHANGED` event sites get `meta.quantity` from
  `AssetLocation.quantity`. `replaceAssetPlacements` writes NO notes
  by design (replace-set semantics) — events only.
  `bulkUpdateAssetLocation` filters qty-tracked out (individual-only,
  `// why:` comment). 14 new unit tests in `utils.server.test.ts`.
- **C4 — Booking axis.** Per-asset booking notes (asset-add,
  asset-remove, scan-add standalone/kit-driven) use
  `wrapAssetWithCountForNote` for qty-tracked → `"added 50 units of
{asset} to {booking link}"`; INDIVIDUAL preserves
  `"added asset to {bookingLink}"`. 8 `BOOKING_*` event sites
  (`booking/service.server.ts:588`/`2028`/`2394`/`3405`/`4861`/`6307`/
  `7934`/`8427`) get `meta.quantity` from `BookingAsset.quantity`
  (per-row; multi-row qty-tracked per Polish-7b stays correct). The
  multi-asset booking-level summary popovers (`{% assets_list %}` /
  `{% kits_list %}`) are deliberately unchanged — per-asset qty isn't
  inline-renderable there; `// why:` comments at each site. The
  dispositions note (`buildQtyPerAssetFragment` ~3570) and the
  partial-checkin `qtyTail` notes (Phase 3c) were already qty-aware
  and untouched.

**Shared rules used throughout:**
quantity always sourced from the PIVOT row
(`Custody.quantity` / `AssetKit.quantity` / `AssetLocation.quantity` /
`BookingAsset.quantity`) — NEVER `Asset.quantity`; INDIVIDUAL phrasing

- event meta byte-for-byte unchanged (helpers no-op for it);
  multi-asset `{% assets_list %}` / `{% kits_list %}` popovers are
  out-of-scope (per-asset qty would need a component change — deferred);
  no new `ActivityAction` enum values — events get richer meta only.

**Verification:** `pnpm webapp:validate` green at **2382 / 2382** tests
(+28 from 4e: 11 helper + 14 location builder + 3 booking + a kit-qty
case). Detailed manual walk-through: `TESTING-PHASE-4E.md` at the
worktree root.

**Reports forward-compat note:** no report currently reads
`meta.quantity` (audited before the sweep). Contract going forward:
`meta.quantity` present ⇒ qty-tracked unit count; absent ⇒
INDIVIDUAL / "whole asset" (treat as 1 when aggregating).

**Hex security follow-up (2026-06-01):** `unitOfMeasure` is the only
user-controlled string the 4e sweep interpolates into Markdoc-rendered
note content (`Note.content` is parsed by `MarkdownViewer` → `Markdoc`
on the client, and by `sanitizeNoteContent` for CSV / audit-PDF). Without
guards a label like `{% link to="/login" text="Click" /%}` would render
as a Shelf-styled link inside every qty-tracked system note for that
asset — credible audit-log spoof / phishing. Patched in two layers:

- **Output:** new `sanitizeUnitOfMeasureLabel(value)` in
  `app/utils/asset-quantity.ts` strips `{`, `%`, `}` from the label;
  used by `formatUnitCount` (every Phase 4e note site) and by
  `createAssetQuantityChangeNote`'s `unit of measure from **X** to
**Y**` interpolation.
- **Input:** `NewAssetFormSchema.unitOfMeasure` rejects values
  containing `{%` or `%}` via a Zod refinement
  (`apps/webapp/app/components/assets/form.tsx`).

+6 tests (2 in `asset-quantity.test.ts` covering strip + new helper
describe block, 4 in `form.test.ts` covering refinement accept/reject
cases). Validate green at **2388 / 2388**.

#### Phase 4e tail closeout — Booking-notes sweep (2026-06-15)

Pre-release residual surfaced by a grep over `booking/service.server.ts`
for `createNote*` paths that still emitted bare integers. Three writers
still rendered "returned **10**" instead of the canonical Phase 4e
"returned **10 boxes**" for qty-tracked dispositions:

- Per-asset final check-in note (`checkinBooking`, line ~3610) — the
  `${actor} via check-in on {booking}: returned **N**, consumed **N**…`
  loop fed by `qtySummariesRef.value`.
- Per-asset partial check-in note (`partialCheckinBooking`, line ~4477) —
  same shape, fed by `aggregatedQtySummaries`.
- `buildQtyPerAssetFragment` helper (line ~3792) used by both the
  booking-side `Pens (10 returned, 2 consumed)` summary line and the
  partial-checkin `qtyTail`.

Closeout: widened the local `CheckinQtySummary` + `QtyDispositionSummary`
type defs to carry the asset's `type` + `unitOfMeasure`, plumbed those
fields through from the row-locked asset at the two summary-build sites
(line 3319 + 4252), then routed all four rendering paths through
`formatUnitCount` with a bare-integer fallback (defence-in-depth — the
loops only see QUANTITY_TRACKED in practice). Activity events were
already qty-aware via `assetQtyMeta` since the original 4e sweep and
were not touched. Checkout flow has no per-asset note, only a
booking-level `createStatusTransitionNote` — also not touched.

`pnpm webapp:validate` green at **2588 / 2589** (1 pre-existing skip).
No new tests; existing `booking/service.server.test.ts` cases assert
note content at higher level so the wording change rides through.

This closes the row in the post-release backlog table; **Phase 4e is
fully done** — every qty-tracked note + ActivityEvent.meta path now
surfaces the affected unit count.

#### Phase 4e — Quantity-aware notes + activity-feed audit (original scope)

Cross-cutting polish. Today every UPDATE-type note + `ActivityEvent.meta`
rendering path treats qty-tracked actions as if the whole asset row
were affected (e.g. _"released custody via kit assignment Camera Kit"_
omits that this was 76 Pens out of 80). Custody is 1:N + carries
`quantity` since Phase 2; 4a–4c add `AssetKit.quantity` and
`AssetLocation.quantity`. 4e threads the unit count through the
rendering layer one PR per axis:

- **Custody notes** (`createCustodyNote`, `createCustodyReleaseNote`,
  kit-cascade notes from `performKitDeletion` /
  `bulkRemoveAssetsFromKits`) include unit count for qty-tracked.
- **Kit-membership notes** (add/remove/cross-kit-move) include
  `AssetKit.quantity`. **UNBLOCKED 2026-05-19** — multi-kit allocation
  shipped in Phase 4a-Polish-2 (`bebaf4ec6`); `AssetKit.quantity` is
  now the meaningful source, so this bullet is ready to build. Sweep
  `createBulkKitChangeNotes` + the cross-kit-move / removal note
  writers in `kit/service.server.ts`.
- **Location-change notes** include moved unit count from
  `AssetLocation.quantity`. **UNBLOCKED 2026-05-20** — Phase 4b shipped
  the `AssetLocation` pivot with `quantity` populated; the
  `ASSET_LOCATION_CHANGED` events already fire per-asset with
  `meta.viaKit` where relevant. Sweep `getLocationUpdateNoteContent` +
  the `updateAsset` / `bulkUpdateLocation` / `updateKitLocations` note
  writers to render the unit count.
- **Booking notes** (checkout, partial check-in, check-in) — sweep
  remaining note-writers to match the existing "× N" rendering on
  sidebar / email / PDF.
- **Activity-feed rendering** — surface `meta.quantity` where present
  on the asset / booking / kit activity feeds.

Acceptance: walking the §1–§13 testing-doc flows on a fresh dev DB,
every qty-tracked note + activity-feed entry shows the affected count.

Flagged 2026-05-13 from manual testing of §5 — the kit-custody
release note read _"released Self Service's custody via kit assignment
Camera Kit"_ with no indication it was 76 units out of 80. Detailed
scope in `docs/proposals/quantitative-assets.md` → Phase 4e.

#### Phase 4e end-to-end validation pass (2026-06-02 → 2026-06-03)

`TESTING-PHASE-4E.md` walked §0–§7 end-to-end against a fresh dev DB,
driven via the Claude-in-Chrome extension for the §4–§6 UI sections
(Custody / Kit / Location / Booking / Activity Feed) with Supabase MCP
SQL spot-checks on Note rows + `ActivityEvent.meta`. Two structural
regressions + seven sweep gaps surfaced and were fixed before PR review.
All three commits landed on top of `f07abe29d`; branch is
`feat-quantities` at `91a5a9ff6` (3 ahead of `origin/feat-quantities`).

**Structural fixes (`30a549329`):**

- **AssetLocation orthogonal-axes restoration.** Phase 4b's
  `assetlocation_sum_within_total` trigger summed across all rows
  including kit-driven ones, which violated the orthogonal-axes design
  (Location and Kit are independent axes, each capped at `Asset.quantity`).
  Adding to a kit while the location pool was full failed with a
  trigger 500 even though the location axis had capacity. Trigger
  rewritten to filter `WHERE "assetKitId" IS NULL` so only the manual
  rows enter the sum — migration
  `20260602100000_assetlocation_sum_exclude_kit_driven`. Removed the
  now-redundant `updateKitAssets` location cascade that mirrored kit
  rows into AssetLocation (no longer needed once the trigger ignores
  them).
- **Custody partial-unique split (operator vs kit).** The original
  `Custody_assetId_teamMemberId_key` constraint (legacy from when
  Custody was 1:1) blocked the legitimate "operator Custody row +
  kit-cascade Custody row for the same (asset, custodian) pair" case —
  P2002 thrown when assigning kit custody to a team member already
  holding the asset. Migration
  `20260603100000_custody_partial_uniques_split_operator_kit` drops the
  composite unique and replaces it with two partial-unique indexes:
  `Custody_operator_unique` (`WHERE kitCustodyId IS NULL`) and
  `Custody_kit_unique` (`WHERE kitCustodyId IS NOT NULL`). The four
  `checkOutQuantity` / `releaseQuantity` call sites in
  `asset/service.server.ts` were refactored off `findUnique` / `upsert`
  by composite key (which no longer exists) onto `findFirst` with
  `kitCustodyId: null` + write by `Custody.id`. Migration is plain
  `CREATE UNIQUE INDEX IF NOT EXISTS` — calibrated to actual table
  scale (sub-100k rows), no `CONCURRENTLY` runbook needed.

**Sweep gaps filled across two commits (`39e29d18b` + `91a5a9ff6`):**

- **Kit-detail 3-dot remove.** `kits.$kitId.tsx` removal slice was
  writing generic phrasing — widened the `assetKit.findMany` to include
  `quantity` + asset `type` / `unitOfMeasure` and routed through
  `formatUnitCount(slice.asset, slice.quantity)`.
- **`replaceAssetPlacements` per-row Notes.** Manage-placements toCreate
  / toDelete / toUpdate branches each emit a qty-aware Note now
  (asset/service.server.ts) — replacing the previous "events-only"
  policy because the user-visible `assets.$assetId.activity` feed is
  Note-driven, not event-driven.
- **Qty-change Note in manage-placements.** Editing a per-row quantity
  inline at `manage-placements` now emits
  `"changed quantity at {L} from X units to Y units"` instead of
  silently mutating with no audit row.
- **`updateLocationAssets` phrasing fix.** When adding qty-tracked
  units at a location while the asset already exists at another
  location, the note used to read `"moved 25 boxes from Christmas Event
to Chambers of Xeric"` — wrong, because the original 50 are still at
  Christmas Event. Resolution now branches on `isQtyTracked`: for
  QUANTITY_TRACKED non-removal paths, `currentLocation` stays `null` so
  the writer renders `"placed 25 boxes at Chambers of Xeric"`.
  INDIVIDUAL keeps the single-location move semantics.
- **`bookings.$bookingId.overview.manage-assets.tsx`.** Per-asset Note
  was using the legacy `"added asset to {booking} with quantity **N**"`
  inline construction; routed through `wrapAssetWithCountForNote` so
  it matches the rest of the sweep
  (`"added 50 units of {asset} to {booking}"`).
- **`bookings.$bookingId.overview.manage-kits.tsx`.** Only wrote the
  kit-level summary Note via `createKitBookingNote`; per-asset timeline
  was silent. Added a per-asset Note loop after `updateBookingAssets`
  mirroring the kit-add branch of `addAssetsToBooking`
  (`"added 22 units of {asset} via {kit} to {booking}"`).
- **Bulk add-to-kit qty warning parity.** Bulk-action add-to-kit on a
  qty-tracked asset selection was silent about full-pool default;
  warning now mirrors the bulk-location-update dialog
  (`bulk-kit-update-dialog.tsx`).
- **Kit-assign custody Note parity.** Assign-side note was thinner than
  the release-side; now reads with the same custodian / kit / count
  template.

**Hex security follow-up (2026-06-01).** `unitOfMeasure` is the only
user-controlled string the 4e sweep interpolates into Markdoc-rendered
Note content. `sanitizeUnitOfMeasureLabel` strips `{`, `%`, `}` from
the label (`asset-quantity.ts`); `NewAssetFormSchema.unitOfMeasure`
rejects `{%` / `%}` via Zod refinement. Both layers covered by
`asset-quantity.test.ts` + `form.test.ts`.

**Migration cadence reminders captured:** never apply DDL via Supabase
MCP — always go through `db:deploy-migration` with a proper Prisma
migration file (so prod has a deploy path). Mitigations are calibrated
to actual table scale; no elaborate `CONCURRENTLY` runbook for
sub-100k-row Custody / AssetLocation tables.

**Validate-clean across all three commits.** Final state: `pnpm
webapp:validate` green at **2421 / 2422** tests (one pre-existing skip,
unchanged from main). Typecheck + lint + Prettier + security-review +
commitlint hooks green on each commit.

### Out of Phase 4 scope (still gated)

- Open follow-ups (low-stock email recipient UI, backfill verification
  on prod snapshot) — independent.
- Post-Phase-4 backlog (Sub-phase 3e calendar polish, Sub-phase 3d
  follow-ups, reports verification) — pick up after **all** of 4a-4c
  are stable. Reports verification specifically cares about both
  pivots being in place.

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
9. `20260430100759_add_kit_custody_id_to_custody` — Phase 3d-Polish-2: discriminator FK + one-shot backfill UPDATE for kit-allocated rows
10. `20260504132547_enable_rls_for_booking_model_request` — RLS policy for `BookingModelRequest` (auto-generated alongside session work)
11. `20260511120000_add_asset_kit_pivot` — Phase 4a: introduce `AssetKit` pivot, backfill from `Asset.kitId`, drop the column, ENABLE RLS
12. `20260514100000_drop_asset_kit_unique_add_triggers` — Phase 4a-Polish-2: `DROP INDEX "AssetKit_assetId_key"`, add `enforce_individual_asset_single_kit` (BEFORE) + `enforce_asset_kit_sum_within_total` (CONSTRAINT, `DEFERRABLE INITIALLY DEFERRED`) triggers, backfill QUANTITY_TRACKED pivot rows to `quantity = Asset.quantity`. Committed in `bebaf4ec6`.
13. `20260519143054_add_asset_location_pivot` — Phase 4b: introduce `AssetLocation` pivot, backfill from `Asset.locationId` (qty-tracked → `Asset.quantity`, INDIVIDUAL → 1), add `enforce_individual_asset_single_location` (BEFORE) + `enforce_asset_location_sum_within_total` (CONSTRAINT, `DEFERRABLE INITIALLY DEFERRED`) triggers, drop `Asset.locationId` column + FK + index, ENABLE RLS. Single migration (no structural-only intermediate; final shape ships day one). **Applied to dev DB; staged not committed (see Phase 4b status).**
14. `20260521133643_assetlocation_kit_discriminator` — Phase 4b-Polish-4: add nullable `AssetLocation.assetKitId` FK (cascade delete from AssetKit), drop the `(assetId, locationId)` unique, replace with two partial uniques (`AssetLocation_manual_unique` WHERE `assetKitId IS NULL`, `AssetLocation_kit_unique` WHERE `assetKitId IS NOT NULL`). No data backfill — historical rows stay manual. Mirror of the `Custody.kitCustodyId` discriminator pattern from Phase 2. **Applied to dev DB; staged not committed (see Phase 4b-Polish-4 status).**
15. `20260602100000_assetlocation_sum_exclude_kit_driven` — Realign `enforce_asset_location_sum_within_total` with the spec's orthogonal-axes model (`docs/proposals/quantitative-assets.md` lines 783-794). Trigger now sums only manual rows (`WHERE "assetKitId" IS NULL`); kit-driven rows stay bounded by the AssetKit axis trigger. Companion change in `kit/service.server.ts`: the kit-cascade-to-AssetLocation block inside `updateKitAssets` is removed — adding an asset to a kit writes only the AssetKit pivot. Manual placements survive untouched. Unblocks "add a fully-placed qty-tracked asset to a kit" (the previous code synthesised an additional kit-driven row at the kit's location, which pushed `sum(AssetLocation.quantity)` past `Asset.quantity`).

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

| When                 | Merge commit | What main brought                                                                                                                                                                        | Pre-merge HEAD |
| -------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 2026-04-29 (earlier) | `a613f4231`  | Misc churn pre-PR-2495                                                                                                                                                                   | `1a5a12ffe`    |
| 2026-04-29 (later)   | `a64d8c22e`  | **PR #2495 — Activity Events / Reports system** + React Doctor integration + audit bulk-actions + 4 new `.claude/rules/` files                                                           | `a613f4231`    |
| 2026-05-07 (earlier) | `197b51c8c`  | **PR #2412 — Mobile companion app** (Expo + Maestro flows) + reports review-feedback fixes (main tip `5afc116833`)                                                                       | `4c340063d`    |
| 2026-05-07 (later)   | `d66b6cd34`  | Tiny pickup of `ddb104b98` — mobile path-to-regexp wildcard fix that landed on main mid-merge                                                                                            | `197b51c8c`    |
| 2026-05-29           | `8f9f14de6`  | Mobile companion + reports + pending migrations (incl. `Kit.preferredBarcodeId`) — 27 conflicts; post-merge fixes in `21ce040a0` (advanced-search FROM-clause, custodian EXISTS rewrite) | `f457757d1`    |

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

**Conflicted files in the `197b51c8c` merge** (mobile companion app

- reports review fixes): `apps/webapp/app/modules/asset/service.server.ts`,
  `apps/webapp/app/modules/asset/service.server.test.ts`,
  `apps/webapp/app/modules/reports/helpers.server.ts`,
  `apps/webapp/app/routes/_layout+/reports.tsx`,
  `apps/webapp/app/routes/api+/assets.bulk-{assign,release}-custody.ts`,
  `apps/webapp/test/routes-tests/api.assets.bulk-assign-custody.test.ts`.
  Plus 4 mobile-route fix-ups (no conflict markers but Phase-2/3a
  schema-incompatible code came in from main):
  `apps/webapp/app/routes/api+/mobile+/bookings.{,$bookingId}.ts`,
  `mobile+/dashboard.ts`, plus three sed-renames of
  `bulkAssignCustody`/`bulkReleaseCustody` →
  `bulkCheckOutAssets`/`bulkCheckInAssets` across `mobile+/bulk-{assign,
release}-custody.ts`, `mobile+/custody.assign.ts`, and their three
  matching test files. Notable resolution decisions documented in the
  body of `197b51c8c`. **Highest-risk merged region:**
  `reports/helpers.server.ts` overdue-items KPI math — combined HEAD's
  BookingAsset pivot walk with main's partial-checkin-intersection +
  outstanding-only `valueAtRisk` redesign; numerics differ from
  pre-merge HEAD (semantic change main intended), no integration tests
  cover this path so the change is validate-only. Other resolutions
  documented inline; main's `bulkAssignCustody`/`bulkReleaseCustody`
  function bodies were dropped wholesale in favour of HEAD's renamed
  `bulkCheckOutAssets`/`bulkCheckInAssets` (which carry the qty-tracked
  skip + activity events Phase 2 introduced).

---

## Files created in this feature

### New modules:

- `app/modules/asset-model/service.server.ts`
- `app/modules/consumption-log/service.server.ts`
- `app/modules/consumption-log/quantity-lock.server.ts`
- `app/modules/consumption-log/low-stock.server.ts`
- `app/modules/custody/utils.ts`
- `app/modules/booking-model-request/service.server.ts` (+ `.test.ts`) — Phase 3d
- `app/modules/kit/picker-meta.server.ts` — Phase 4a-Polish-2: `getKitPickerMeta()` + `PickerAssetMeta`, the canonical strict-available formula for the kit picker

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
- `app/components/assets/assets-index/custody-column.test.tsx` — Phase 3d-Polish-2: multi-custodian rendering
- `test/routes-tests/kits.$kitId.test.tsx` — Phase 3d-Polish-2: route smoke test

---

## Current testing status

**Pre-merge baseline at `a613f4231`:** full `pnpm webapp:validate` green
— **1865 / 1865** tests across 133 files (up from 1747 before
Phase 3c/3d/3d-Polish unit-test additions). `TESTING-PHASE-3D.md`
manual checklist is current.

**Post-merge at `a64d8c22e`:** Phase 3a/Phase 2 incompatibility errors
in main's reports + scripts were resolved in commit `12f2e8257`. Lint
warnings cleared in `c4316b0ca`. ActivityEvent flows wired in
`e97bb85db`.

**Phase 3d-Polish-2 baseline at `4f0d9d69b`:** `pnpm webapp:validate`
green — **138 / 1930** tests passing across all suites. Lint +
typecheck + tests all clean. New tests added: 4 in
`kit/service.server.test.ts` (Option B), 2 in
`asset/service.server.test.ts` (releaseQuantity status flip), 1 new
in `kits.$kitId.assets.assign-custody.test.tsx` (Option B route),
plus updated `query.server.test.ts` assertions.

**Phase 3d-Polish-3 + main merge baseline:** `pnpm webapp:validate`
green — **164 / 2103** tests passing across all suites. The +173 vs
Phase 3d-Polish-2 baseline breaks down as: ~150 mobile-companion-
related route + utility tests inherited from main's PR #2412, plus
new Phase 3d-Polish-3 coverage (15 IDOR-guard regression tests on
booking phase-3 endpoints, 5 SELF_SERVICE-bulk-custody guard tests
on the centralised service, 5 `performKitDeletion` helper tests, 4
mobile route role-forwarding regression tests).

**Phase 4a-Polish-2 baseline (committed `bebaf4ec6` + `d27ade085`):**
`pnpm webapp:validate` green — **2177 / 2177** tests across 166
files. The +6 vs the Phase 4a-shipped 2171 are the new
`kit/service.server.test.ts` picker contract tests. Lint +
typecheck clean. `pnpm webapp:doctor --diff main` 95/100 (one
accepted `no-giant-component` finding on the picker route).

**Current baseline (Phase 4b, STAGED + reviewed — uncommitted):**
`pnpm webapp:validate` green — **2177 / 2177** tests across 166
files (no count delta vs Polish-2: 4b's tests modify existing files
rather than adding new ones; the test suite was reshaped to match
the pivot, not extended). Lint + typecheck clean.
**54 files staged**, +1735 / -586. Pre-commit hooks not yet run.
Branch: `feat-quantities`, ahead of `origin/feat-quantities` by 2
commits (Polish-2 + docs).

The 4b staged diff covers:

- Schema + migration `20260519143054_add_asset_location_pivot`
- ~37 production files swept off `Asset.location`/`locationId` →
  `assetLocations` pivot + `getPrimaryLocation` reads
- 14 existing tests updated to the new pivot fixture shape
- `getPrimaryLocation` + `getPrimaryKit` signature change (inference
  works; no explicit generic at any call site in app code)
- 7 latent loader-include bugs uncovered + fixed (see Phase 4b status)
- `AdvancedIndexAsset.locationId` / SQL `'locationId'` projection /
  `??` fallback redundancy removed — single canonical path
  (`item.location.id`)
- 4 `primaryLocOf` local wrappers + their per-function type aliases
  removed; all 30+ call sites use the bare `getPrimaryLocation`
- ~80 phase-prefix comments cleaned up (22 deleted, ~58 rewritten to
  describe permanent design intent rather than the PR)
- `TESTING-PHASE-4B.md` (15 sections) — manual test plan, NOT yet
  walked through

`TESTING-KIT-CUSTODY-CORRECTNESS.md` manual walkthrough complete —
all sections ticked off or marked as covered-by-unit-test (6b: kit
helpers' Option-B-skip branch is unreachable via UI, fenced by
route + picker guards; 11a: `@@unique([assetId, teamMemberId])` is
unreachable via UI, fenced by custody-assignment guards). 4d's
wording was corrected to point at the assets-index "Remove from
kit" bulk action (the bulk function isn't surfaced on the kits
listing). Section 13 final checks ticked.

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

All three previously-tracked correctness bugs (duplicate rows on
advanced index, kit custody = 1 unit, kit removal wipes ALL custody)
were resolved in **Sub-phase 3d-Polish-2**. See that section above
for the details.

The four hex-security findings on PR #2337 + the two correctness
bugs surfaced during the Polish-2 manual testing pass (operator-side
`checkOutQuantity` missing status flip, `deleteKit` /
`bulkDeleteKits` skipping app logic) were all closed in
**Sub-phase 3d-Polish-3**. No outstanding correctness issues at
session end.

**Open follow-up work** (not bugs, deferred features):

- **Reports end-to-end verification — DEFERRED to post-Phase-4.**
  Main's reports renderers + helpers + seed scripts were ported for
  compile cleanliness in `12f2e8257` and the substantial 3-way
  merge resolution on `helpers.server.ts` (overdue-items KPI math)
  landed in `197b51c8c`. Phase 4 will reshape kit + location qty
  data flows again (kit-aware utilisation, location split/merge,
  group-by-model index), so running the full reports walkthrough
  now would just have to be redone. The reports-testing scaffold
  (`TESTING-REPORTS.md` at the worktree root) is ready to run
  whenever Phase 4 schema settles. **Two seed bugs discovered during
  the deferred-verification setup** were already fixed in `3f9a521f9`
  so the next walkthrough can start with realistic data:
  - `completedAt = to` exactly for COMPLETE / ARCHIVED outcomes
    (Booking Compliance always showed 100%).
  - `ONGOING_OVERDUE` outcome resolved to status `ONGOING` not
    `OVERDUE` (Overdue Items report returned zero rows).
- **Phase 4 rebalance** — assigning operator custody on a fully
  kit-allocated qty-tracked asset is currently blocked (`Assign`
  button disabled). Phase 4 should auto-decrement the kit row.
  Bullet inline in `docs/proposals/quantitative-assets.md`.
- **Backfill verification on production snapshot** — the migration's
  one-shot UPDATE was vacuously verified locally (0 KitCustody on
  dev DB). Path B in `TESTING-KIT-CUSTODY-CORRECTNESS.md` covers
  staging/prod-snapshot validation of the 628 prod KitCustody rows.
