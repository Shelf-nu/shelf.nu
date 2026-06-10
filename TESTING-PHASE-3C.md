# Phase 3c Manual Testing Checklist

**Quantity-aware check-in.** Scope covered:

- New `CONSUME` + `DAMAGE` consumption categories
- Per-asset disposition inputs in the check-in drawer (Returned / Consumed / Lost / Damaged / Pending)
- Multi-session partial check-ins via ConsumptionLog
- Pool decrement for `CONSUME` / `LOSS` / `DAMAGE` (`RETURN` leaves pool alone)
- Manage-assets lower-bound guardrail when units have already been checked in
- Row-lock + over-return rejection
- Activity notes on both asset and booking sides

> ⚠ Before testing, run `pnpm db:deploy-migration` to apply the
> `20260416100000_add_consume_and_damage_categories` migration.
> Without it, any write path will fail at runtime with a Postgres
> enum error.

---

## Prerequisites

- Phase 3b fixtures (from `TESTING-PHASE-3B.md`) still set up
- **"Pens"** — QUANTITY_TRACKED, `consumptionType = TWO_WAY`
  (returnable), total 100. Used for every "TWO_WAY" scenario below.
- **"AA Batteries"** — QUANTITY_TRACKED, `consumptionType = ONE_WAY`
  (consumable), total 50. Used for every "ONE_WAY" scenario below.
  Create this if it doesn't exist, or flip an existing asset's
  consumption type.
- **One INDIVIDUAL asset** (any) for mixed-booking tests
- Booking permissions set up so you can check in

> Unless a section explicitly says ONE_WAY, every "Pens" scenario
> assumes TWO_WAY. Every "AA Batteries" scenario assumes ONE_WAY.

---

## 0. Migration + baseline smoke

- [x] `pnpm db:deploy-migration` runs cleanly
- [x] `pnpm webapp:dev` starts with no runtime errors
- [x] Enum values `CONSUME` and `DAMAGE` exist in the database
      (`SELECT enum_range(NULL::"ConsumptionCategory");`)
- [x] Opening an existing booking's check-in scanner renders without
      regression (no crash when no qty-tracked assets are involved)

---

## 1. Happy path — TWO_WAY (return everything)

- [x] Create a booking for 10 "Pens", reserve, check out
- [x] Open check-in scanner, scan the Pens QR
- [x] The drawer row shows a "Returned" input pre-filled to `10`
- [x] Sub-panel for Lost/Damaged is NOT visible (returned == remaining)
- [x] Click Check-in assets — submit succeeds
- [x] Booking transitions to COMPLETE
- [x] `Asset.quantity` for Pens is unchanged (still 100)
- [x] Asset activity feed has: "…via partial check-in: returned **10**."
- [x] Booking activity feed has: "…performed a partial check-in: Pens
      (x10) (10 returned)…"
- [x] `ConsumptionLog` has exactly one `RETURN` row for this booking +
      asset (`SELECT * FROM "ConsumptionLog" WHERE "bookingId"=… AND
"assetId"=…;`)

## 2. Happy path — ONE_WAY (consume everything)

- [x] Create a booking for 20 "AA Batteries", reserve, check out
- [x] Open check-in scanner, scan the Batteries QR
- [x] Drawer row label says **"Consumed"** (not "Returned")
- [x] Primary input pre-filled to `20`
- [x] Submit check-in
- [x] Booking transitions to COMPLETE
- [x] `Asset.quantity` for Batteries drops by 20 (50 → 30)
- [x] `ConsumptionLog` has one `CONSUME` row for this booking + asset
- [x] Asset note shows "consumed **20**"

## 3. Partial return with Lost

- [x] Booking with 10 Pens, checked out
- [x] Scan Pens; set Returned = 8
- [x] Shortfall panel AUTO-EXPANDS (returned < remaining)
- [x] Enter Lost = 2 (Damaged stays 0)
- [x] "Pending return: **0**" is shown
- [x] Submit — booking transitions to COMPLETE
- [x] `Asset.quantity` drops by 2 (100 → 98)
- [x] ConsumptionLog rows: one `RETURN qty=8`, one `LOSS qty=2`
- [x] Asset note: "returned **8**, **2** lost"

## 4. Partial return with Damaged

- [x] Booking with 10 Pens, checked out
- [x] Scan, Returned = 7, Lost = 0, Damaged = 3
- [x] Submit — booking → COMPLETE
- [x] `Asset.quantity` drops by 3
- [x] ConsumptionLog rows: `RETURN qty=7`, `DAMAGE qty=3`
- [x] Asset note: "returned **7**, **3** damaged"
- [x] Booking note mentions "3 damaged"

## 5. Split shortfall (Lost + Damaged + Pending)

- [x] Booking with 10 Pens, checked out
- [x] Returned = 5, Lost = 2, Damaged = 1 → Pending shows 2
- [x] Submit — **booking does NOT transition to COMPLETE** (2 units pending)
- [x] Booking status stays ONGOING (or OVERDUE)
- [x] `Asset.quantity` drops by 3 (lost + damaged; NOT the pending 2)
- [x] ConsumptionLog: `RETURN 5`, `LOSS 2`, `DAMAGE 1`. NO entry for pending.
- [x] Asset note: "returned **5**, **2** lost, **1** damaged, **2** still pending"

## 6. Multi-session partial check-ins (pending carry-over)

- [x] Continue from the booking in section 5 (2 units pending, ONGOING)
- [x] Open check-in scanner again
- [x] Scan Pens — drawer shows remaining = **2** (not 10)
- [x] Default primary input = 2
- [x] Submit with Returned = 2
- [x] Booking transitions to COMPLETE
- [x] Second check-in session writes a second `RETURN qty=2` log
- [x] Final `Asset.quantity` still reflects only lost+damaged decrements
      from session 1 (no double-decrement)

## 7. Over-return rejection (client + server)

- [x] Booking with 10 Pens, checked out
- [x] In the drawer, type Returned = 12
- [x] Input shows red border; drawer blocker appears:
      "N quantity-tracked asset exceeds the remaining quantity…"
- [x] Submit is disabled
- [x] Open DevTools, manually remove the client-side blocker, submit
- [x] Server rejects with 400 and a clear message ("Cannot check in 12
      units…, only 10 remaining")
- [x] No ConsumptionLog rows are written
- [x] No `Asset.quantity` change

## 8. Zero-disposition blocker

- [x] Booking with 10 Pens, checked out
- [x] Scan Pens; clear all inputs (primary = "", lost = "", damaged = "")
- [x] Drawer blocker appears: "N quantity-tracked asset has no quantity entered"
- [x] Resolve the blocker by entering any value — blocker disappears
- [x] Alternatively, resolve by removing the scan — also works

## 9. Drawer UI behaviors

- [x] On first scan, primary input auto-fills to `remaining`
- [x] Shortfall disclosure opens automatically when primary drops below
      remaining (not just on toggle)
- [x] Typing in Lost does not reset Damaged
- [x] "Entered: N" counter at the top updates as values change
- [x] "Entered" counter turns red when sum > remaining
- [x] Removing the scan clears the state for that asset

## 10. Pool-drain guardrail

> **Setup note.** The original scenario ("95 in custody AND a 10-unit
> booking") isn't reachable through normal UI — Phase 3b availability
> already blocks you from booking units that are in custody. To put the
> asset into the "custody exceeds what the booking is trying to flow
> back" state, we intentionally bypass the custody cap via direct SQL.
> This is a deliberate test of the **server-side** invariant.

### Preconditions

- [x] Pens: total 100, in-custody 0, no active bookings. Reset via SQL
      if needed: `UPDATE "Asset" SET status='AVAILABLE', quantity=100 WHERE id=...;`
      and `DELETE FROM "Custody" WHERE "assetId"=...;`

### Steps

- [x] Create a booking for **10 Pens**, reserve, check out. Confirm the
      booking is ONGOING and `BookingAsset.quantity = 10`.
- [x] Without leaving the booking, open a SQL console and insert an
      oversized custody record directly:

  ```sql
  INSERT INTO "Custody" ("id", "assetId", "teamMemberId", "quantity", "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    '<pens-asset-id>',
    '<any-team-member-id-in-same-org>',
    95,
    NOW(), NOW()
  );
  ```

  State now: `Asset.quantity = 100`, `inCustody = 95`, `checkedOut = 10`.
  The booking is a pre-existing allocation the server must respect.

- [x] Open the check-in scanner for the booking, scan Pens. Shortfall
      disclosure opens.
- [x] Set **Lost = 10** (would push `Asset.quantity` from 100 → 90,
      below the 95 in custody).
- [x] Submit.

### Expected

- [x] Server rejects with a ShelfError (HTTP 400), message along the
      lines of:
      _"Cannot remove 10 units from 'Pens' — 95 are currently in custody
      and would be left uncovered."_
- [x] No `ConsumptionLog` rows are written for this check-in attempt
      (`SELECT * FROM "ConsumptionLog" WHERE "bookingId"='<id>' AND
category IN ('RETURN','CONSUME','LOSS','DAMAGE');` returns
      unchanged).
- [x] `Asset.quantity` unchanged at 100.
- [x] Booking remains in its pre-submit status (ONGOING / OVERDUE).
- [x] Retry the check-in with `Lost = 5` — should pass (projected pool
      95 = inCustody 95, not strictly below → allowed).

### Cleanup

- [x] Delete the synthetic custody row when done:
      `DELETE FROM "Custody" WHERE "assetId" = '<pens-asset-id>' AND quantity = 95;`

## 11. Manage-assets lower-bound guardrail

- [x] Booking with 10 Pens
- [x] Partial check-in: return 6 (4 pending)
- [x] Open manage-assets for the same booking
- [x] Try to reduce Pens quantity from 10 → 4 → submit
- [x] Server rejects: "Cannot reduce booked quantity for 'Pens' below 6
      — 6 units have already been dispositioned…"
- [x] Set quantity = 6 → accepted (equal to logged sum)
- [x] Set quantity = 10 again → accepted (increase always allowed)

## 12. Quick check-in auto-default (big button)

- [x] Booking with 10 Pens + 20 AA Batteries (mixed types), checked out
- [x] Hit the top-level "Check in booking" button (NOT the scanner)
- [x] Pens auto-return (RETURN 10, pool unchanged)
- [x] Batteries auto-consume (CONSUME 20, pool drops by 20)
- [x] Booking transitions to COMPLETE
- [x] Both assets have ConsumptionLog rows with the correct categories

## 13. Mixed booking (INDIVIDUAL + QTY_TRACKED)

- [ ] Booking with 1 individual asset + 5 Pens, checked out
- [ ] Open scanner, scan the individual asset QR + Pens QR
- [ ] Individual row: no quantity inputs (just present = checking in)
- [ ] Pens row: quantity inputs, defaulted to 5
- [ ] Submit — booking → COMPLETE
- [ ] Individual asset status back to AVAILABLE
- [ ] Pens ConsumptionLog has `RETURN 5`

## 14. Mixed booking — check in only INDIVIDUAL first

- [x] Booking with 1 individual + 5 Pens, checked out
- [x] Session 1: scan ONLY the individual asset, submit
- [x] Booking stays ONGOING (Pens still has remaining=5)
- [x] PartialBookingCheckin row created with only the individual asset ID
- [x] Session 2: scan Pens, return 5
- [x] Booking → COMPLETE

## 15. Concurrency smoke

- [x] Open two tabs on the same booking's check-in scanner
- [x] Both scan Pens (10 units remaining)
- [x] Tab A: Returned = 10, submit → succeeds, booking COMPLETE
- [x] Tab B: Returned = 10, submit → **rejected** with 400 ("only 0 remaining")
- [x] No duplicate ConsumptionLog rows

## 16. Activity notes coverage

- [x] On any successful disposition, check the **asset** activity tab:
      per-asset note reflects only non-zero fields, rendered in the
      "returned **N**, lost **K**, damaged **J**, P pending" form
- [x] On the **booking** activity tab: one summary note per check-in
      session, showing totals across all assets touched
- [x] Note writes are best-effort — simulate a write failure
      (temporarily break markdoc wrapper) and confirm:
  - [x] Check-in still succeeds (ConsumptionLog rows present)
  - [x] Server logs show `Logger.error` for the failed note
  - [x] User sees success, no blocking error

## 17. Regression — INDIVIDUAL-only flow

- [x] Booking with only individual assets
- [x] Full flow: reserve → check out → check in (quick AND explicit)
- [x] Behavior IDENTICAL to pre-3c (no drawer inputs, no ConsumptionLog
      writes on check-in for these assets, status reset as before)
- [x] `PartialBookingCheckin.assetIds` still lists the scanned
      individual asset IDs

## 18. Regression — Phase 3b flows

- [x] Spot-check each section of `TESTING-PHASE-3B.md` still passes:
  - [x] Manage assets (add qty-tracked)
  - [x] Quantity editing
  - [x] Multi-bookings-on-same-asset
  - [x] Checkout with reduced availability
  - [x] Email / PDF / CSV export with qty-tracked assets

## 19. Early check-in interaction

- [ ] Booking with qty-tracked asset; current time is BEFORE booking's
      "to" date
- [ ] Check-in via scanner — early check-in dialog still appears
- [ ] Choose "Adjust date" — works as before
- [ ] Choose "Don't adjust date" — works as before
- [ ] Check-in completes with qty dispositions intact

## 20. Booking status transitions

- [x] Partial dispositions leave booking in its current status (ONGOING
      → ONGOING, OVERDUE → OVERDUE)
- [x] Only when `isBookingFullyCheckedIn` returns true does the booking
      flip to COMPLETE
- [x] COMPLETE status is not reverted if a later action touches the
      booking (e.g. a late ConsumptionLog insert)

## 21. Dashboard + calendar regression

- [x] Home widgets show correct counts for bookings with qty-tracked
      assets mid-check-in
- [x] Calendar renders without errors

---

## Unit test coverage (TODO)

> **Status: not implemented.** No unit tests were added for the Phase 3c
> changes. The existing `partialCheckinBooking` / `checkinBooking` tests
> in `apps/webapp/app/modules/booking/service.server.test.ts` still
> exercise the INDIVIDUAL paths; the new qty-tracked paths rely on the
> manual checklist above until tests are written.

Minimum test matrix to add (from the plan):

1. INDIVIDUAL asset — present in payload → AVAILABLE, note created.
2. QTY_TRACKED TWO_WAY, `returned === remaining` → RETURN log, pool unchanged.
3. QTY_TRACKED TWO_WAY, `returned < remaining`, all pending → booking stays ONGOING.
4. QTY_TRACKED TWO_WAY, returned+lost+damaged = remaining → three logs, pool drop = lost+damaged.
5. QTY_TRACKED ONE_WAY, `consumed === remaining` → CONSUME log, pool drops.
6. QTY_TRACKED ONE_WAY, consumed + lost → CONSUME + LOSS logs.
7. Over-return rejected → ShelfError 400.
8. Multi-session: session 1 RETURN 6 → ONGOING; session 2 RETURN 4 → COMPLETE.
9. Mixed booking (1 individual + 1 qty-tracked) fully reconciled → COMPLETE.
10. Pool-drain guard rejects LOSS that would push `Asset.quantity` below custody sum.
11. Concurrency: two transactions on the same asset serialize correctly.
12. Route-level: malformed `checkins` JSON → 400; disposition on INDIVIDUAL asset → ignored; full reconciliation → 302 + COMPLETE.

---

## Issues Found

| #   | Description | Severity | Status |
| --- | ----------- | -------- | ------ |
|     |             |          |        |
