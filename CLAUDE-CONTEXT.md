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

### Shipping plan

**Single production release.** Intermediate states where one relation
is pivoted and the other isn't would break the inventory equation
and the kit-custody Option B math, so the schema migration + the
service / loader / route / UI changes ship together.

Dev-order sub-phases (organisational only — single migration on
production):

1. **Schema + invariant layer.** Single Prisma migration introduces
   `AssetLocation` + `AssetKit`, backfills from existing
   `Asset.locationId` / `Asset.kitId` FKs, then drops those columns.
   DB triggers enforce INDIVIDUAL-single-row + `sum ≤ Asset.quantity`
   per pivot (constraint triggers so multi-row tx updates work).
2. **Service layer.** `asset/service.server.ts` pivot upserts;
   kit-custody Option B math refactored to read `AssetKit.quantity`
   directly; custody propagation re-grounded; restock unchanged.
3. **Query / loader layer.** Location detail, kit detail, asset list
   columns, filters, pickers, scan drawers — all sourced from pivots.
   Multi-placement display reuses the `+N more` chip pattern from the
   Phase 3d-Polish-2 multi-custodian column.
4. **Mobile API.** Decide at implementation time: synthesise a
   "primary placement" for backward compat, or ship a mobile-app PR
   in lockstep.
5. **User-facing split / merge UX.** "Move N units from Loc A to Loc
   B" and "Move N units from Kit X to Kit Y" — two-row updates in a
   single tx. Optional "Place N unplaced units at Location L" flow
   for the gap. Gated on `Asset.type = QUANTITY_TRACKED`.

### Auxiliary items (independent of pivot work)

- Kit integration polish + checkout/check-in with quantity handling
- Model grouping tool (bulk assign existing assets to a model)
- Import/export with quantity columns
- Bulk operations awareness of asset types
- **Rebalance kit allocation** when assigning operator custody on a
  fully kit-allocated qty asset (auto-decrement kit row, paired
  events; edge case: kit row hits 0). After this lands, update the
  in-kit copy in `QuantityCustodyDialog` (currently says "kit count
  unaffected"; will be wrong post-rebalance).

### Out of pivot scope (still gated)

- Open follow-ups (low-stock email recipient UI, backfill verification
  on prod snapshot) — independent.
- Post-Phase-4 backlog (Sub-phase 3e calendar polish, Sub-phase 3d
  follow-ups, reports verification) — pick up after Phase 4 lands.

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
| 2026-05-07 (earlier) | `197b51c8c`  | **PR #2412 — Mobile companion app** (Expo + Maestro flows) + reports review-feedback fixes (main tip `5afc116833`)             | `4c340063d`    |
| 2026-05-07 (later)   | `d66b6cd34`  | Tiny pickup of `ddb104b98` — mobile path-to-regexp wildcard fix that landed on main mid-merge                                  | `197b51c8c`    |

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

**Current baseline (Phase 3d-Polish-3 + main merge, all shipped):**
`pnpm webapp:validate` green — **164 / 2103** tests passing across
all suites. Lint + typecheck + tests all clean. The +173 vs
Phase 3d-Polish-2 baseline breaks down as: ~150 mobile-companion-
related route + utility tests inherited from main's PR #2412, plus
new Phase 3d-Polish-3 coverage (15 IDOR-guard regression tests on
booking phase-3 endpoints, 5 SELF_SERVICE-bulk-custody guard tests
on the centralised service, 5 `performKitDeletion` helper tests, 4
mobile route role-forwarding regression tests).

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
