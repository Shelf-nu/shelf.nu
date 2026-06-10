# Phase 3b Manual Testing Checklist

## Prerequisites

- At least 2 QUANTITY_TRACKED assets (e.g., "Pens" with 100 units, "Cables" with 100 units)
- At least 2 INDIVIDUAL assets (e.g., "Hilti Rotary Hammer", "Bomag Roller")
- One qty-tracked asset with partial custody (e.g., 50 of 100 in custody)
- One qty-tracked asset fully in custody (0 available)

---

## 1. Manage Assets — Adding qty-tracked assets to a booking

- [x] Create a new booking (set dates, custodian)
- [x] Open "Manage Assets"
- [x] Qty-tracked assets show blue badge: "Qty tracked · N available"
- [x] Fully-allocated qty assets (0 available) do NOT appear in the list
- [x] Partially-allocated qty assets show correct available count in badge
- [x] Selecting a qty-tracked asset shows inline quantity picker
- [x] Quantity picker defaults to 1
- [x] Quantity picker max is clamped to available (not total)
- [x] Quantity picker shows "/ N" where N is available quantity
- [x] INDIVIDUAL assets show normal status badge (no quantity picker)
- [x] Can select a mix of INDIVIDUAL + QUANTITY_TRACKED assets
- [x] Confirm saves correctly

## 2. Manage Assets — Editing quantities

- [x] Re-open "Manage Assets" on a booking with qty-tracked assets
- [x] Existing qty-tracked assets show their previously saved quantity (not default 1)
- [x] Changing the quantity and saving updates correctly
- [x] Changing quantity triggers unsaved-changes alert if navigating away

## 3. Booking Overview — Quantity display

- [x] Booking overview shows qty-tracked assets with "x N" next to title
- [x] INDIVIDUAL assets do NOT show "x 1"
- [x] Sidebar asset list shows quantity for qty-tracked assets
- [x] Asset count in header reflects correct number of items (not units)

## 4. Multiple bookings on same qty asset

- [x] Create Booking A with 30 units of "Pens" (100 available)
- [x] Create Booking B — "Pens" should show 70 available (100 - 30 reserved)
- [x] Add 50 units to Booking B — should work (30 + 50 = 80 < 100)
- [x] Try adding 80 units to a third booking — should show only 20 available

## 5. Booking with custody interaction

- [x] Assign 40 units of "Pens" to custody
- [x] Create a booking — "Pens" should show 60 available (100 - 40 custody)
- [x] Reserve 30 in a booking, then create another booking — shows 30 available (100 - 40 custody - 30 reserved)

## 6. Reserve flow

- [x] Reserve the booking (set status to Reserved)
- [x] Booking reserves successfully with qty-tracked assets
- [x] No false conflict errors for qty-tracked assets

## 7. Checkout flow

- [x] Check out the booking
- [x] If all quantities are still available → checkout succeeds
- [x] INDIVIDUAL assets get status CHECKED_OUT
- [x] QUANTITY_TRACKED assets — verify no status change on the asset itself

### Checkout with reduced availability

- [x] Create a booking with 50 "Pens", reserve it
- [x] Before checkout: assign 60 units of "Pens" to custody (so only 40 available now)
- [x] Try to checkout — should get error: "requested 50, only 40 available"
- [x] Go to manage-assets, reduce to 40, checkout again — should succeed

## 8. Check-in flow

- [x] Check in the booking (full check-in)
- [x] INDIVIDUAL assets get status reset to AVAILABLE
- [x] Booking completes successfully

### Partial check-in

- [x] Create booking with mix of INDIVIDUAL + QUANTITY_TRACKED assets
- [x] Check out the booking
- [x] Partial check-in: check in only the INDIVIDUAL asset
- [x] Remaining qty-tracked asset stays in booking
- [x] Complete check-in with the qty-tracked asset
- [x] Booking completes

## 9. Email notifications

- [x] Reserve a booking with qty-tracked assets
- [x] Check email — qty-tracked assets should show "x N" (e.g., "Pens x 30")
- [x] INDIVIDUAL assets show normally (no "x 1")

## 10. PDF generation

- [x] Generate PDF for a booking with qty-tracked assets
- [x] PDF should have a "Qty" column
- [x] Qty-tracked assets show their booked quantity
- [x] INDIVIDUAL assets show 1

## 11. Regression — INDIVIDUAL assets

- [x] Full booking flow with ONLY individual assets works as before
- [x] Create → add assets → reserve → checkout → checkin
- [x] No quantity picker shown for individual assets
- [x] Status badges work correctly
- [x] Conflict detection works (overlapping bookings still blocked)

## 12. Dashboard

- [x] Home page booking widgets show correct asset counts
- [x] Active/upcoming/overdue booking cards display properly

## 13. Calendar

- [x] Calendar shows bookings with qty-tracked assets
- [x] No errors or visual glitches

## 14. Booking duplication

- [x] Duplicate a booking that has qty-tracked assets
- [x] New booking should have the same assets with same quantities

## 15. CSV export

- [x] Export bookings to CSV
- [x] Qty-tracked assets show correctly in export data

---

## Issues Found

| #   | Description | Severity | Status |
| --- | ----------- | -------- | ------ |
|     |             |          |        |
