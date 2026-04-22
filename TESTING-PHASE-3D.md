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

- [ ] On a fresh DRAFT booking with a valid `from` / `to` window:
      switch to Models tab
- [ ] Dell Latitude 5550 picker shows availability `5 / 5` (or
      similar — total and available match for an unreserved pool)
- [ ] Enter quantity `3` → click "Add"
- [ ] Row appears in the "Existing reservations" section:
      `Dell Latitude 5550 — 3` with a Remove button
- [ ] Picker excludes Dell Latitude from the Add dropdown (can't
      double-add the same model)
- [ ] Booking activity log has:
      `{actor} reserved **3 × Dell Latitude 5550** for this booking.`
- [ ] DB: one row in `BookingModelRequest` with `quantity: 3`
      (SQL below)

## 3. Over-reserve rejection

- [ ] Same booking: try to add **6 × Dell Latitude 5550**
- [ ] Server rejects with a clear error mentioning "Only 5
      available" (or exact phrasing — match on substring)
- [ ] No row written (DB still shows `quantity: 3` from §2)
- [ ] Try to add **3 × HP LaserJet 2020** (model has only 1
      asset) → rejected with "Only 1 available"

## 4. Edit the request (upsert)

- [ ] Change the existing Dell Latitude row to `quantity: 5`
      (re-submit with the same model) → updated to 5
- [ ] Try to upsert `quantity: 0` → rejected ("Quantity must be a
      positive integer")
- [ ] Try to upsert `quantity: -1` → rejected (same)

## 5. Remove a request

- [ ] Click the Remove button on the Dell Latitude row
- [ ] Row disappears immediately
- [ ] Picker now includes Dell Latitude again (re-addable)
- [ ] Booking note:
      `{actor} cancelled the model-level reservation for **Dell Latitude 5550**.`
- [ ] DB: row is gone from `BookingModelRequest`

## 6. Reserve the booking → sidebar + email

- [ ] Add back `3 × Dell Latitude 5550`
- [ ] Click **Reserve** — booking transitions to RESERVED without
      error (status guard allows RESERVED for edits via
      manage-assets; Reserve itself has no model-request guard)
- [ ] Booking overview page opens; sidebar shows an
      **"Unassigned model reservations (3)"** section above the
      asset list
- [ ] Row renders: `Dell Latitude 5550` + amber chip
      `3 remaining`. **No "Scan to assign" CTA** (booking is
      RESERVED, not yet ONGOING)
- [ ] Reservation confirmation email sent to custodian lists a
      **"Requested models"** section:
      `3 × Dell Latitude 5550`
- [ ] HTML email renders the section in a gray panel; plain-text
      email has the same list under `Requested models:` with
      `- 3 × Dell Latitude 5550`

## 7. Edit refusal on RESERVED → ONGOING boundary

- [ ] While RESERVED: open manage-assets → Models tab → can still
      edit / remove the request
- [ ] Check out the booking (walk it to ONGOING)
- [ ] Navigate back to manage-assets → Models tab: existing row
      shows read-only or the edit action fails with
      "Model-level reservations can only be edited while DRAFT
      or RESERVED" (UI should hide the form; if bypassed server
      still rejects)
- [ ] Bypass the UI via a direct `POST` / `DELETE` to
      `/api/bookings/:id/model-requests` → server returns 400
      with status-guard error

## 8. Sidebar CTA on ONGOING / OVERDUE

- [ ] With the booking ONGOING: sidebar's "Unassigned model
      reservations" section now shows a blue **"Scan to assign"**
      link on each row
- [ ] Click the link → navigates to
      `/bookings/<id>/overview/scan-assets`

## 9. Scan-to-assign — happy path

- [ ] From scan-assets, scan `Dell Latitude 5550 #1` QR
- [ ] Asset appears in the scanned list; booking asset is
      created; **request quantity drops to 2**
- [ ] Sidebar (if still visible in another tab) shows
      `2 remaining`
- [ ] Per-asset activity log on `Dell Latitude 5550 #1` shows:
      `{actor} assigned {asset link} (Dell Latitude 5550) to
this booking — 2 × Dell Latitude 5550 remaining.`
- [ ] Scan `#2` and `#3` in sequence — quantity ticks down
      to 1, then 0; the `BookingModelRequest` row is **deleted**
      on the last scan (verify via SQL)
- [ ] Three `BookingAsset` rows now exist for this booking
      (Dell #1, #2, #3)

## 10. Scan an asset that doesn't match (unmatched scan)

- [ ] Back on an ONGOING booking with an outstanding request for
      `Dell Latitude 5550` (add `2 × Dell` fresh, reserve + check
      out)
- [ ] Scan an INDIVIDUAL asset that is **not** a Dell Latitude —
      e.g. a Bomag roller or the HP LaserJet model's single asset
- [ ] The asset is added to the booking as a direct
      `BookingAsset` (not via request materialization) — the
      Dell Latitude request quantity is **unchanged**
- [ ] Only Dell Latitude scans decrement the Dell Latitude
      request — confirmed via SQL (ConsumptionLog + request table)
- [ ] This is the regression guard: model-free / off-model scans
      still land through the existing path

## 11. Checkout hard-block — outstanding requests

- [ ] Create a fresh DRAFT booking, reserve `3 × Dell Latitude
5550`, click Reserve, then try to **Check out**
- [ ] Checkout is **refused** with a 400 response. Error message
      lists outstanding models, e.g.
      `"Cannot check out — 3 × Dell Latitude 5550 still
unassigned. Scan matching assets to fulfil the reservation."`
- [ ] Booking stays in RESERVED status (no partial ONGOING)
- [ ] No `BookingAsset` rows created
- [ ] DB check: `_prisma_migrations` shows no side-effects;
      `BookingModelRequest` row still has `quantity: 3`

## 12. Recovery path — scan to drain, then check out

- [ ] From the booking in §11 (RESERVED, Dell Latitude request
      outstanding): open Scan assets (manual walk if the UI
      blocks entry pre-checkout — you may need to flip to
      ONGOING via a different reservation first, or open the
      scan-assets-pre-checkout route if it exists on this
      branch; if not, see §13 as the simpler recovery)
- [ ] Alternatively, simpler path: reduce the request via
      manage-assets → Models tab from `3` to `0` via Remove
      (allowed on RESERVED)
- [ ] Retry Check out — succeeds (now there are no outstanding
      requests)

## 13. Recovery path — reduce via manage-assets

- [ ] Fresh DRAFT with `3 × Dell Latitude`. Reserve it
- [ ] In manage-assets → Models tab: edit the request from `3`
      to `1`
- [ ] Try Check out — succeeds (only the `1 × Dell` unit is
      still outstanding)

  Wait — this step must fail per the hard-block rule. Verify:

- [ ] Check out actually **fails** with "1 × Dell Latitude 5550
      still unassigned"
- [ ] Remove the request entirely (`quantity: 0` → delete)
- [ ] Retry Check out — now succeeds (zero outstanding model
      requests)

## 14. Mixed booking — concrete assets + model requests

- [ ] New DRAFT booking. Assets tab: add `Dell Latitude 5550 #4`
      directly (pick a specific asset). Models tab: add
      `2 × Dell Latitude 5550`
- [ ] Availability picker for Dell Latitude should now show
      `3 / 5 available` (1 concrete + 2 model-level reserved =
      3 units claimed; 5 - 3 = 2 still pickable)
- [ ] Reserve → Check out → guard fires because the 2 model-
      level units are still unassigned
- [ ] Scan `#1` + `#2` → both decrement the request; after the
      second scan, request is deleted; booking now has 3
      concrete `BookingAsset` rows (#4, #1, #2)
- [ ] Retry Check out — succeeds

## 15. Other bookings' model reservations reduce availability

- [ ] Create booking A with `3 × Dell Latitude`, reserve it
- [ ] Create booking B with an overlapping window
- [ ] In booking B, Models tab: availability for Dell Latitude
      shows `2 / 5 available` (5 total − 3 reserved by A)
- [ ] Try to reserve `3 × Dell Latitude` on B → rejected
      ("Only 2 available")
- [ ] Reserve `2 × Dell Latitude` on B → accepted
- [ ] Non-overlapping windows (bookings that don't intersect in
      time): availability for the second booking is **not**
      reduced by the first — the `from/to` overlap filter lets
      concurrent pools share capacity. Verify by moving B's
      dates to after A's `to`: availability resets to `5 / 5`

## 16. Cross-tenant isolation (IDOR guard)

- [ ] As user in Org A, try to `POST /api/bookings/<B's-booking-id>/model-requests`
      with `{assetModelId: <A's-model-id>}` via DevTools
- [ ] Server returns 404 "Booking not found in current
      workspace" (requirePermission + org scope)
- [ ] Try with a valid booking in A but `assetModelId` from Org B
      → server returns 404 "Asset model not found in current
      workspace"
- [ ] No rows written

## 17. Regression — model-free bookings

- [ ] Create a booking with ONLY concrete assets (no model
      requests). Reserve → Check out → normal flow
- [ ] Sidebar does **not** render the "Unassigned model
      reservations" section (empty state = nothing rendered,
      not an empty heading)
- [ ] Reservation email does **not** include "Requested models"
      (section omitted when empty)
- [ ] PDF: no "Requested models" section
- [ ] Submit payload + ConsumptionLog writes on check-in are
      byte-identical to Phase 3c behavior

## 18. Regression — check-in flow unchanged

- [ ] From a booking whose model requests have been fully
      materialized (they're now concrete `BookingAsset` rows):
      open the check-in drawer
- [ ] The check-in drawer shows each concrete asset as
      INDIVIDUAL (just like any scanned asset). No references to
      the original model request anywhere in the drawer
- [ ] Partial check-in, full check-in, and quick-checkin flows
      all behave exactly as in Phase 3c — materialization
      happened at checkout, so check-in sees ordinary assets

## 19. PDF — booking overview

- [ ] On the booking from §2 (or any booking with outstanding
      model requests), open the Share / Download PDF option
- [ ] Generated PDF includes a **Requested models** section
      after the assets table, with rows like
      `3 × Dell Latitude 5550`
- [ ] For a booking with zero model requests, the section is
      absent (no empty heading)
- [ ] Styling matches the Qty column added in Phase 3b
      (`text-gray-600` base, `font-medium text-gray-900` accent)

## 20. Availability when booking has no dates yet

- [ ] Create a DRAFT booking **without** setting `from` / `to`
      dates
- [ ] In Models tab: availability shows the **conservative**
      count (all active-status bookings competing, regardless of
      their date window). This is expected per the service's
      date-overlap guard falling through when `from/to` are
      missing
- [ ] Once dates are set and saved: availability recomputes and
      may expand (non-overlapping bookings no longer compete)

## 21. Keyboard accessibility

- [ ] Models tab is keyboard-navigable (tab order: picker →
      quantity input → Add button → existing rows' Remove
      buttons)
- [ ] Every `<button>` has `type="submit"` or `type="button"`
      per the project lint rule
- [ ] Focus rings visible on picker + buttons
- [ ] Submit-disabled state shown while the `useDisabled`
      fetcher is in-flight

## 22. Concurrency sanity (optional — requires two tabs)

- [ ] Open two browser tabs on the same DRAFT booking, same
      Models tab
- [ ] In tab A: reserve `3 × Dell Latitude`
- [ ] In tab B (stale availability): try to reserve `3 × Dell
Latitude` again
- [ ] Tab B's submit is rejected by the server's in-tx
      availability check with "Only 2 available" (5 total − 3
      just reserved in tab A)
- [ ] Confirms the in-tx upsert guard works without additional
      row-level locking (availability is re-computed inside the
      tx right before the upsert)

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
