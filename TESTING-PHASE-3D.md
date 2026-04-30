# Phase 3d Manual Testing Checklist — Book-by-Model

**Book-by-Model.** Operators reserve N units of an `AssetModel`
without picking specific assets upfront; concrete `BookingAsset`
rows are created at scan-to-assign time. Scope covered:

- New `BookingModelRequest` table + migration
  (`20260421125426_add_booking_model_request`)
- `getAssetModelAvailability` / `upsertBookingModelRequest` /
  `removeBookingModelRequest` / `materializeModelRequestForAsset`
  service surface
- `POST / DELETE /api/bookings/:id/model-requests` HTTP surface
- Manage-assets gains a **Models** tab (picker + per-model
  availability hints + remove buttons)
- Booking overview sidebar shows an **Unassigned model
  reservations** section above the asset list
- Reservation email + booking overview PDF both gain a **Requested
  models** section
- Checkout **hard-blocks** with outstanding model requests — no
  `forcePartial` escape hatch
- Scan-to-assign decrements matching requests inside the same tx
  as the `BookingAsset.create`; unmatched scans fall through to
  the existing "direct BookingAsset create" path (no regression
  for model-free bookings)

> **Phase 3d-polish (fulfil-and-checkout):** Checkout now routes
> through a dedicated fulfil scanner when outstanding model
> requests exist on a booking. The generic scan-assets drawer
> still works for "add extras" on a DRAFT/RESERVED booking. See
> §11 / §12 / §12b–§12d below for the updated flow.

> ⚠ Before testing, apply the new migration:
> `pnpm db:deploy-migration`. Without it, anything touching
> `BookingModelRequest` fails at runtime with a Prisma error.

---

## Prerequisites

- Phase 3a–3c + drawer refactor fixtures still set up (from
  `TESTING-PHASE-3C.md` and `TESTING-CHECKIN-DRAWER-REFACTOR.md`)
- **Create a new `AssetModel`** via Settings → Asset Models:
  - Name: **"Dell Latitude 5550"** (used throughout below)
  - Default category / valuation can be blank
- **Create 5 INDIVIDUAL assets** linked to that model (via the
  Asset create form or asset-model quick-create if available):
  - Titles: `Dell Latitude 5550 #1` through `#5`
  - Type: `INDIVIDUAL` (not QUANTITY_TRACKED — model requests
    only count INDIVIDUAL assets by design)
  - Same organization as the test user
- **Create a second `AssetModel`** ("HP LaserJet 2020") with
  1 INDIVIDUAL asset linked, for the multi-model test
- Booking permissions set up so the test user can create,
  reserve, and check out bookings
- An existing org with zero `AssetModel` rows for the
  tab-hidden regression test (if your test org has models, use
  a different org or temporarily delete them)

---

## 0. Baseline smoke

- [x] `pnpm db:deploy-migration` applies the new migration
      cleanly. Run:
      `SELECT * FROM "BookingModelRequest" LIMIT 1;` — no error,
      empty result.
- [x] `pnpm webapp:dev` starts with no runtime errors
- [x] `pnpm webapp:validate` exits 0 (130+ test files, 1742+
      tests, typecheck + lint clean)
- [x] Open the booking list — no regressions in rendering; a
      booking with no model requests renders exactly as before

---

## 1. Manage-assets "Models" tab — visibility

- [x] Open a DRAFT booking. Click "Manage assets"
- [x] With your test org having ≥ 1 `AssetModel` — the **Models** tab is visible next to Assets (and Kits if present)
- [x] Switch to an org without any `AssetModel` rows — the Models
      tab is **hidden** (regression for small orgs)
- [x] Back on the test org: click Models tab → picker is shown
      with Dell Latitude 5550 + HP LaserJet 2020

## 2. Reserve a model — happy path

- [x] On a fresh DRAFT booking with a valid `from` / `to` window:
      switch to Models tab
- [x] Dell Latitude 5550 picker shows availability `5 / 5` (or
      similar — total and available match for an unreserved pool)
- [x] Enter quantity `3` → click "Add"
- [x] Row appears in the "Existing reservations" section:
      `Dell Latitude 5550 — 3` with a Remove button
- [x] Picker excludes Dell Latitude from the Add dropdown (can't
      double-add the same model)
- [x] Booking activity log has:
      `{actor} reserved **3 × Dell Latitude 5550** for this booking.`
- [x] DB: one row in `BookingModelRequest` with `quantity: 3`
      (SQL below)

## 3. Over-reserve rejection

- [x] Same booking: try to add **6 × Dell Latitude 5550**
- [x] Server rejects with a clear error mentioning "Only 5
      available" (or exact phrasing — match on substring)
- [x] No row written (DB still shows `quantity: 3` from §2)
- [x] Try to add **3 × HP LaserJet 2020** (model has only 1
      asset) → rejected with "Only 1 available"

## 4. Edit the request (upsert)

- [x] Change the existing Dell Latitude row to `quantity: 5`
      (re-submit with the same model) → updated to 5
- [x] Try to upsert `quantity: 0` → rejected ("Quantity must be a
      positive integer")
- [x] Try to upsert `quantity: -1` → rejected (same)

## 5. Remove a request

- [x] Click the Remove button on the Dell Latitude row
- [x] Row disappears immediately
- [x] Picker now includes Dell Latitude again (re-addable)
- [x] Booking note:
      `{actor} cancelled the model-level reservation for **Dell Latitude 5550**.`
- [x] DB: row is gone from `BookingModelRequest`

## 6. Reserve the booking → sidebar + email

- [x] Add back `3 × Dell Latitude 5550`
- [x] Click **Reserve** — booking transitions to RESERVED without
      error (status guard allows RESERVED for edits via
      manage-assets; Reserve itself has no model-request guard)
- [x] Booking overview page opens; sidebar shows an
      **"Unassigned model reservations (3)"** section above the
      asset list
- [ ] Row renders: `Dell Latitude 5550` + amber chip
      `3 remaining`, plus a blue **"Scan to assign"** link. The
      link routes to the generic scan-assets drawer — scans
      materialise the matching model request via the shared
      `materializeModelRequestForAsset` helper. Exposed on any
      status where assets can still be managed (DRAFT / RESERVED /
      ONGOING / OVERDUE).
- [x] The booking overview **Reserved models** section (above
      the Assets & Kits list) also shows a primary
      **"Scan to assign"** button alongside **Manage** — same
      gating, same destination (generic scan-assets drawer).
- [x] The _checkout_ flow (fulfil enforcement + early-date alert)
      lives on the main booking's **Check out** button and
      routes to `/fulfil-and-checkout` — that's the only path
      that transitions the booking to ONGOING.
- [x] Reservation confirmation email sent to custodian lists a
      **"Requested models"** section:
      `3 × Dell Latitude 5550`
- [x] HTML email renders the section in a gray panel; plain-text
      email has the same list under `Requested models:` with
      `- 3 × Dell Latitude 5550`

## 7. Audit trail + edit refusal on ONGOING bookings

> Schema note: `BookingModelRequest` rows are **never deleted** on
> fulfilment (audit trail). `quantity` preserves the original
> reservation intent; `fulfilledQuantity` counts scan-materialised
> units; `fulfilledAt` is stamped when the two match. "Outstanding"
> means `fulfilledAt IS NULL`. The Models tab on an ONGOING booking
> shows fulfilled rows as read-only history.

- [x] While RESERVED: open manage-assets → Models tab → "Active
      reservations" section shows the Dell Latitude row with
      edit / remove controls. "Fulfilled reservations" section
      is absent / empty.
- [x] Fulfil via §12 (scan-and-check-out). After fulfil-and-checkout
      completes, booking is ONGOING.
- [x] SQL verification:
      `SELECT quantity, "fulfilledQuantity", "fulfilledAt" FROM
"BookingModelRequest" WHERE "bookingId" = '<id>';`
      → one row, `quantity = 3`, `fulfilledQuantity = 3`,
      `fulfilledAt` = recent timestamp. Row is NOT deleted.
- [x] Models tab on the now-ONGOING booking: - **Active reservations** section is empty (or only shows
      rows you added extras to) - **Fulfilled reservations** section lists `Dell Latitude
5550` with a green **"Fulfilled"** chip and
      `3 of 3 fulfilled` subtext. No edit / remove controls.
- [x] Booking overview has no "Reserved models" section and the
      sidebar has no "Unassigned model reservations" block —
      both filter on `fulfilledAt === null`.
- [x] **Partial-fulfil remove refusal**: on a DRAFT booking with
      `3 × Dell` reserved, scan 1 Dell (`fulfilledQuantity = 1`).
      Then from the Models tab click **Remove** on the Dell row
      → server returns 400 "Cannot cancel — 1 unit(s) have already
      been assigned. Edit the quantity down to 1 to close out,
      or remove the assigned assets from the booking first."
- [x] **Shrink-below-fulfilled refusal**: same setup, try to edit
      `quantity` from 3 to 0 → rejected (must be positive). Try
      from 3 to 1 → succeeds; row moves to "Fulfilled reservations"
      (fulfilledAt stamped, fulfilledQuantity == quantity).
- [x] For the guard test: add a fresh `1 × HP LaserJet 2020`
      request on the **already-ONGOING** booking via a direct
      `POST` to `/api/bookings/:id/model-requests` → server
      returns 400 with status-guard error ("Model-level
      reservations can only be edited while DRAFT or RESERVED")
- [x] `DELETE` against the same endpoint on an ONGOING booking
      also returns 400 with the same guard

## 8. Scan-to-assign CTA surfaces on every manage-eligible status

- [x] With the booking DRAFT: both the sidebar's "Unassigned
      model reservations" rows and the overview's "Reserved
      models" header expose a **Scan to assign** CTA
- [x] Walk to RESERVED — same CTAs still present
- [x] Walk to ONGOING (after draining via §9) — CTAs still
      present on any additional requests you might add
- [x] On a CANCELLED / COMPLETE / ARCHIVED booking, CTAs are
      disabled (reuses `manageAssetsButtonDisabled` gating)

## 9. Scan-to-assign — happy path

- [x] From scan-assets, scan `Dell Latitude 5550 #1` QR
- [x] Asset appears in the scanned list; booking asset is
      created; **request quantity drops to 2**
- [x] Sidebar (if still visible in another tab) shows
      `2 remaining`
- [x] Per-asset activity log on `Dell Latitude 5550 #1` shows:
      `{actor} assigned {asset link} (Dell Latitude 5550) to
this booking — 2 × Dell Latitude 5550 remaining.`
- [x] Scan `#2` and `#3` in sequence — `fulfilledQuantity`
      ticks 1 → 2 → 3. On the last scan, `fulfilledAt` gets
      stamped (the row is **NOT deleted** under the audit-trail
      schema; verify with `SELECT quantity, "fulfilledQuantity",
"fulfilledAt" FROM "BookingModelRequest" WHERE "bookingId" = '<id>';`)
- [x] Three `BookingAsset` rows now exist for this booking
      (Dell #1, #2, #3)

## 10. Scan an asset that doesn't match (unmatched scan)

- [x] Back on an ONGOING booking with an outstanding request for
      `Dell Latitude 5550` (add `2 × Dell` fresh, reserve + check
      out)
- [x] Scan an INDIVIDUAL asset that is **not** a Dell Latitude —
      e.g. a Bomag roller or the HP LaserJet model's single asset
- [x] The asset is added to the booking as a direct
      `BookingAsset` (not via request materialization) — the
      Dell Latitude request quantity is **unchanged**
- [x] Only Dell Latitude scans decrement the Dell Latitude
      request — confirmed via SQL (ConsumptionLog + request table)
- [x] This is the regression guard: model-free / off-model scans
      still land through the existing path

## 11. Checkout routes to fulfil scanner

- [x] Create a fresh DRAFT booking, reserve `3 × Dell Latitude
5550`, click Reserve (booking is now RESERVED with the model
      request outstanding)
- [x] Click **Check out** on the booking overview action bar
- [x] Instead of the generic alert dialog, the browser navigates
      to `/bookings/:id/overview/fulfil-and-checkout`
- [x] Page renders as a dedicated scanner shell (no header, full-
      viewport — same chrome pattern as `overview.scan-assets`)
- [x] Drawer shows the following, top to bottom:
  - Header: **"Fulfil reservations & check out"**
  - Per-model progress strip: `Dell Latitude 5550 — 0/3`
  - 3 pending rows (one per outstanding Dell unit), each with
    model name + `Package` placeholder icon + gray **"Pending"**
    badge
  - An **"Already included"** section (collapsed by default;
    expanding reveals any concrete `BookingAsset` rows already
    on the booking, rendered with a green "Already included"
    chip)
- [x] Submit button reads **"Scan 3 more units to continue"**
      and is disabled
- [x] No DB writes happen just from landing on this page

## 12. Fulfil-and-checkout — happy path

- [x] Continuing from §11: scan `Dell Latitude 5550 #1` QR
- [x] One Pending row flips to **MATCHED** (shows real asset
      thumbnail + title + green **"Ready"** chip)
- [x] Progress strip ticks to `Dell Latitude 5550 — 1/3`
- [x] Submit button now reads **"Scan 2 more units to continue"**,
      still disabled
- [x] Scan `Dell Latitude 5550 #2` → strip hits `2/3`, copy
      reads "Scan 1 more unit to continue", still disabled
- [x] Scan `Dell Latitude 5550 #3` → strip hits `3/3`, submit
      enables, copy reads **"Check Out"**
- [x] Click **Check Out**:
  - If `booking.from` is **> 15 min in the future**: the existing
    early-checkout alert appears with the "Adjust Date?" /
    "Don't Adjust" choices
    - Pick **"Adjust Date"** → submit; server updates `from = now`,
      transitions to ONGOING, creates 3 `BookingAsset` rows,
      drains all matching `BookingModelRequest` rows
    - Pick **"Don't Adjust"** → submit; server keeps `from` as-is,
      still transitions to ONGOING, same asset creation + request
      drain
  - If `booking.from` is **within 15 min or in the past**: no
    alert — submit goes straight through with the same server
    behaviour (minus the `from` rewrite)
- [x] Post-submit browser lands on `/bookings/:id` with booking
      in ONGOING state and no outstanding model requests
- [x] SQL verification for the "Adjust Date" branch:
  - N new `BookingAsset` rows exist for this booking (one per
    unit in the reservation — 3 for a `3 × Dell` booking)
  - `BookingModelRequest` row is **NOT deleted** — under the
    audit-trail schema the row stays, with
    `fulfilledQuantity === quantity` and `fulfilledAt`
    stamped to a recent timestamp. Correct SQL:
    `SELECT quantity, "fulfilledQuantity", "fulfilledAt" FROM
"BookingModelRequest" WHERE "bookingId" = '<id>';`
  - `Booking.status = 'ONGOING'`
  - `Booking.from` is within a few seconds of now (rewritten)
  - `Booking.originalFrom` preserves the original reservation
    start time
- [x] SQL verification for the "Don't Adjust" branch: same as
      above except `Booking.from` is unchanged

## 12b. Fulfil-and-checkout — off-model scan with warning

- [x] Fresh RESERVED booking with `2 × Dell Latitude 5550`
      outstanding. Click **Check out** → fulfil scanner opens
- [x] Scan `Dell Latitude 5550 #1` → one pending row flips to
      MATCHED; strip reads `1/2`
- [x] Scan a **Bomag roller** (different model — there is no
      request for it) → it appears in the **UNMATCHED** bucket
      with a yellow badge: **"Will be added to booking and
      checked out"**
- [x] Copy MUST make clear the asset will BOTH be added to the
      booking AND checked out in the same submit (not just
      silently attached)
- [x] Submit button is still **DISABLED** — progress is `1/2`,
      one Dell Latitude unit still pending. Copy reads
      "Scan 1 more unit to continue"
- [x] Scan `Dell Latitude 5550 #2` → strip hits `2/2`, submit
      enables, copy reads "Check Out"
- [x] Click **Check Out** (+ the early-checkout alert if
      applicable, pick either branch)
- [x] Server creates **3 `BookingAsset` rows** (2 Dell + 1
      Bomag), drains the 2 Dell requests, transitions to
      ONGOING. The Bomag is just added as a fresh BookingAsset
      — no model request existed for it, none is created
- [x] SQL: `BookingAsset` count = 3; `BookingModelRequest` count
      for this booking = 0; `Booking.status = 'ONGOING'`

## 12c. Fulfil-and-checkout — submit disabled while pending

- [x] Fresh RESERVED booking with `3 × Dell Latitude 5550`
      outstanding. Click **Check out** → fulfil scanner opens
- [x] Scan only `Dell Latitude 5550 #1`. Progress: `1/3`
- [x] Click **Check Out** → button is **disabled**; copy reads
      **"Scan 2 more units to continue"** (no submit happens —
      not even a spinner flash)
- [x] Close the drawer / navigate away without submitting
- [x] SQL: no `BookingAsset` rows created for this booking; the
      `BookingModelRequest` row for Dell Latitude still has
      `quantity: 3`; `Booking.status` is still `RESERVED`

## 12d. Fulfil-and-checkout — server-side defence

- [x] Fresh RESERVED booking with `3 × Dell Latitude 5550`
      outstanding. Open the fulfil scanner page to get a valid
      session cookie
- [x] Manually POST to `/bookings/:id/overview/fulfil-and-checkout`
      with a form payload that includes **only 1 of the 3**
      required Dell `assetIds` (bypass the client-side disabled
      guard — e.g. via curl / Postman / DevTools Network tab
      with the session cookie replayed)
- [x] Server returns **400** with a clear error listing the
      deficit, e.g.
      `"Cannot check out — 2 × Dell Latitude 5550 still
unassigned"`
- [x] Transaction rolls back cleanly:
  - No `BookingAsset` rows created for this booking
  - `BookingModelRequest` row for Dell Latitude still has
    `quantity: 3`
  - `Booking.status` still `RESERVED`
  - No notes / emails emitted
- [x] This confirms the guard enforces fulfil-completeness on
      the server even if the client-side disabled button is
      defeated

## 13. Recovery path — reduce via manage-assets

- [x] Fresh DRAFT with `3 × Dell Latitude`. Reserve it
- [x] In manage-assets → Models tab: edit the request from `3`
      to `1`
- [x] Try Check out — succeeds (only the `1 × Dell` unit is
      still outstanding)

  Wait — this step must fail per the hard-block rule. Verify:

- [x] Check out actually **fails** with "1 × Dell Latitude 5550
      still unassigned"
- [x] Remove the request entirely (`quantity: 0` → delete)
- [x] Retry Check out — now succeeds (zero outstanding model
      requests)

## 14. Mixed booking — concrete assets + model requests

- [x] New DRAFT booking. Assets tab: add `Dell Latitude 5550 #4`
      directly (pick a specific asset). Models tab: add
      `2 × Dell Latitude 5550`
- [x] Availability picker for Dell Latitude should now show
      `3 / 5 available` (1 concrete + 2 model-level reserved =
      3 units claimed; 5 - 3 = 2 still pickable)
- [x] Reserve → Check out → guard fires because the 2 model-
      level units are still unassigned
- [x] Scan `#1` + `#2` → both decrement the request; after the
      second scan, request is deleted; booking now has 3
      concrete `BookingAsset` rows (#4, #1, #2)
- [x] Retry Check out — succeeds

## 15. Other bookings' model reservations reduce availability

- [x] Create booking A with `3 × Dell Latitude`, reserve it
- [x] Create booking B with an overlapping window
- [x] In booking B, Models tab: availability for Dell Latitude
      shows `2 / 5 available` (5 total − 3 reserved by A)
- [x] Try to reserve `3 × Dell Latitude` on B → rejected
      ("Only 2 available")
- [x] Reserve `2 × Dell Latitude` on B → accepted
- [x] Non-overlapping windows (bookings that don't intersect in
      time): availability for the second booking is **not**
      reduced by the first — the `from/to` overlap filter lets
      concurrent pools share capacity. Verify by moving B's
      dates to after A's `to`: availability resets to `5 / 5`

## 16. Cross-tenant isolation (IDOR guard)

- [x] As user in Org A, try to `POST /api/bookings/<B's-booking-id>/model-requests`
      with `{assetModelId: <A's-model-id>}` via DevTools
- [x] Server returns 404 "Booking not found in current
      workspace" (requirePermission + org scope)
- [x] Try with a valid booking in A but `assetModelId` from Org B
      → server returns 404 "Asset model not found in current
      workspace"
- [x] No rows written

## 17. Regression — model-free bookings

- [x] Create a booking with ONLY concrete assets (no model
      requests). Reserve → Check out → normal flow
- [x] Sidebar does **not** render the "Unassigned model
      reservations" section (empty state = nothing rendered,
      not an empty heading)
- [x] Reservation email does **not** include "Requested models"
      (section omitted when empty)
- [x] PDF: no "Requested models" section
- [x] Submit payload + ConsumptionLog writes on check-in are
      byte-identical to Phase 3c behavior

## 18. Regression — check-in flow unchanged

- [x] From a booking whose model requests have been fully
      materialized (they're now concrete `BookingAsset` rows):
      open the check-in drawer
- [x] The check-in drawer shows each concrete asset as
      INDIVIDUAL (just like any scanned asset). No references to
      the original model request anywhere in the drawer
- [x] Partial check-in, full check-in, and quick-checkin flows
      all behave exactly as in Phase 3c — materialization
      happened at checkout, so check-in sees ordinary assets

## 19. PDF — booking overview

- [x] On the booking from §2 (or any booking with outstanding
      model requests), open the Share / Download PDF option
- [x] Generated PDF includes a **Requested models** section
      after the assets table, with rows like
      `3 × Dell Latitude 5550`
- [x] For a booking with zero model requests, the section is
      absent (no empty heading)
- [x] Styling matches the Qty column added in Phase 3b
      (`text-gray-600` base, `font-medium text-gray-900` accent)

## 22. Concurrency sanity (optional — requires two tabs, two bookings)

> ⚠ The meaningful concurrency test is two **different** bookings
> racing for the same pool. Upsert on the same (booking, model)
> pair from two tabs is idempotent (same unique row, second tab's
> submit is an UPDATE not a new claim) and availability correctly
> excludes the current booking's own reservations — so same-booking
> concurrency "doesn't fail" because there's nothing to conflict.

- [ ] Create booking **A** (DRAFT, overlapping window). Open it in
      tab A → Models tab.
- [ ] Create booking **B** (DRAFT, overlapping window with A). Open
      it in tab B → Models tab.
- [ ] Both tabs currently see `Dell Latitude 5550` availability as
      `5 / 5`.
- [ ] In tab A: reserve `3 × Dell Latitude` → succeeds. Tab A now
      shows `2 / 5 available`.
- [ ] In tab B (stale availability, still thinks `5 / 5`): try to
      reserve `3 × Dell Latitude`.
- [ ] Tab B's submit is rejected by the server's in-tx availability
      re-check with "Only 2 more available in this window" — the
      `getAssetModelAvailability` call inside the upsert tx sees
      A's freshly-committed row and refuses to oversubscribe.
- [ ] Tab B reducing to `2 × Dell Latitude` → accepted.
- [ ] Confirms the in-tx upsert guard catches the race without
      needing explicit row-level locking — Prisma's default
      read-committed isolation + the re-read inside the tx is
      sufficient for the 99% case (a pathological exact-same-
      moment race may still slip through, but that's acceptable
      given the pool-level nature of these reservations).

---

## Server/DB spot checks (run during/after each section)

```sql
-- Section 2 / 4 / 5: model-request row state
SELECT
  mr.id,
  mr."bookingId",
  mr.quantity,
  am.name AS model_name,
  mr."createdAt",
  mr."updatedAt"
FROM "BookingModelRequest" mr
JOIN "AssetModel" am ON am.id = mr."assetModelId"
WHERE mr."bookingId" = '<booking-id>';

-- Section 9 / 10 / 14: after scan-to-assign, check the concrete rows
-- + the remaining request quantity
SELECT ba.id, a.title, a."assetModelId", am.name AS model_name
FROM "BookingAsset" ba
JOIN "Asset" a ON a.id = ba."assetId"
LEFT JOIN "AssetModel" am ON am.id = a."assetModelId"
WHERE ba."bookingId" = '<booking-id>'
ORDER BY ba."createdAt";

-- Section 11: checkout guard must not have persisted anything
-- (BookingAsset rows count + BookingModelRequest quantity unchanged)
SELECT
  (SELECT COUNT(*) FROM "BookingAsset" WHERE "bookingId" = '<booking-id>') AS concrete_assets,
  (SELECT SUM(quantity) FROM "BookingModelRequest" WHERE "bookingId" = '<booking-id>') AS outstanding_qty,
  (SELECT status FROM "Booking" WHERE id = '<booking-id>') AS status;

-- Section 15: compute availability for a model over a window
SELECT
  (SELECT COUNT(*) FROM "Asset" WHERE "assetModelId" = '<model-id>' AND type = 'INDIVIDUAL' AND "organizationId" = '<org-id>') AS total,
  COALESCE((
    SELECT SUM(ba.quantity) FROM "BookingAsset" ba
    JOIN "Asset" a ON a.id = ba."assetId"
    JOIN "Booking" b ON b.id = ba."bookingId"
    WHERE a."assetModelId" = '<model-id>'
      AND b.status IN ('RESERVED','ONGOING','OVERDUE')
      AND b."from" <= '<to>' AND b."to" >= '<from>'
  ), 0) AS reserved_concrete,
  COALESCE((
    SELECT SUM(mr.quantity) FROM "BookingModelRequest" mr
    JOIN "Booking" b ON b.id = mr."bookingId"
    WHERE mr."assetModelId" = '<model-id>'
      AND b.status IN ('RESERVED','ONGOING','OVERDUE')
      AND b."from" <= '<to>' AND b."to" >= '<from>'
  ), 0) AS reserved_via_request;

-- Section 16: no cross-tenant leakage
SELECT organization_id_from_booking = organization_id_from_model
FROM (...); -- adapt per your DB structure
```

---

## Out of scope (do not test here)

- **Calendar polish** (tooltip model info, overdue UX) — Phase 3e,
  separate plan
- **Kit integration with model-level bookings** — Phase 4
- **Partial-checkin UX refactor to audit pattern** — already
  shipped as a separate commit (`TESTING-CHECKIN-DRAWER-REFACTOR.md`)
- **Consumption-log view on asset page** — explicitly skipped per
  user ("we skip for now")
- **Bulk model-request admin** (copy N requests from one booking
  to another) — not in scope
- **Model search / pagination beyond 50** — `TODO(3d)` in the
  loader; can test manually by creating 51+ models but the plan
  flagged it as a known cap

## Sign-off

- [ ] All sections above pass with no regressions
- [ ] `pnpm webapp:validate` exits 0 (1742+ tests green)
- [ ] Screenshot / recording of sections 2, 6, 9, 11 attached to
      PR description
- [ ] Manual migration + data cleanup on staging matches expected
      state (zero `BookingModelRequest` rows after a full test
      cycle of "reserve → scan all → check out")
