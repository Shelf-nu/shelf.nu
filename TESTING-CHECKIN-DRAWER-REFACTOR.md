# Partial-Checkin Drawer Refactor — Manual Testing Checklist

**Expected-list preview + "Check in without scanning" for qty-tracked
assets.** Scope covered:

- Drawer now shows every expected asset upfront (pending +
  scanned + already-reconciled) instead of an empty list
- Gray "Pending" badge on unscanned rows; green "Checked in" on
  previously-reconciled rows
- **"Check in without scanning"** button on qty-tracked pending rows
  — inserts a synthetic scan (keyed `qty-checkin:<assetId>`) so the
  operator can enter dispositions inline without a physical QR
- Unit-weighted progress indicator (`N/M units checked in`) instead
  of asset-row count
- Partially-reconciled qty rows stay in Pending with a "`N/M
reconciled`" badge
- `zeroDispositionQtyIds` blocker copy extended to mention the new
  quick-checkin path
- Server contract (`partialCheckinBooking`, submit payload shape)
  **unchanged** — regression test for non-qty bookings must stay
  byte-identical

Follow-up fixes added after first round of manual testing (covered
by sections 21–28 below):

- Section headers — "Checked in this session (N)" + "Pending (N)" —
  between drawer buckets so active rows visually pop
- Positive status badges on active rows — green "Scanned" for QR
  scans, indigo "Checked in without scan" for quick-checkin synthetic
  rows (absence of "Pending" is no longer the only signal)
- No opacity on pending or already-reconciled rows — rolled back the
  initial dim treatment that the operator found noisy
- Scanner-mode text-input submit — bucket sort no longer drops
  items whose `type` hasn't hydrated yet, so the API fetch actually
  fires and the row appears
- Mixed INDIVIDUAL + qty-tracked submit — `partialCheckinBooking`
  now merges `assetIds` and `checkins` instead of treating them as
  mutually exclusive
- Disposition breakdown in the qty tooltip — Returned / Consumed /
  Lost / Damaged are split so lost-and-damaged units don't read as
  "checked in back to the pool"
- Qty-tracked Reserve blocker — `getBookingFlags` no longer treats
  `CHECKED_OUT` as all-or-nothing for qty-tracked assets
- Crash on partial-checkin details — qty-tracked partials skip the
  "Checked in on / by" cells that only individuals populate
- ONE_WAY consumables can now be partly Returned to the pool — the
  shortfall panel on a ONE_WAY row adds a Returned field alongside
  Lost / Damaged, so operators can say "5 of 20 batteries consumed,
  15 unused going back to stock"

---

## Prerequisites

- Phase 3b + 3c fixtures still set up (from `TESTING-PHASE-3C.md`)
- **"Pens"** — QUANTITY_TRACKED, TWO_WAY (returnable), total 100
- **"AA Batteries"** — QUANTITY_TRACKED, ONE_WAY (consumable), total 50
- **Two INDIVIDUAL assets** (any) — one that will be scanned, one that
  will stay pending
- At least one **Kit** on the booking for kit-row regression (optional
  but valuable)
- Booking permissions set up so you can check in

> Unless a section explicitly calls it out, "Pens" = TWO_WAY,
> "AA Batteries" = ONE_WAY throughout.

---

## 0. Baseline smoke

- [x] `pnpm webapp:dev` starts with no runtime errors
- [x] `pnpm webapp:validate` passes (1725+ tests, typecheck + lint clean)
- [x] Open any booking's check-in scanner without error (regression:
      no crash when booking has zero qty-tracked assets)

---

## 1. Expected-list render — mixed booking

- [x] Create a booking with: 2 INDIVIDUAL + 1 Pens (booked=10) + 1 AA
      Batteries (booked=20). Reserve, check out. Status = ONGOING.
- [x] Click "Check in assets" → drawer opens **expanded by default**
- [x] Four rows are visible **without any scan yet**:
  - 2 INDIVIDUAL rows with gray "Pending" badge, **no button**
  - 1 Pens row with gray "Pending" badge + blue "needs 10" chip +
    **"Check in without scanning"** button
  - 1 AA Batteries row with gray "Pending" badge + blue "needs 20" chip +
    **"Check in without scanning"** button
- [x] Progress indicator reads `0/32 units checked in` (0 individual + 0
      qty logged; denominator = 2 individuals + 10 Pens + 20 Batteries)

## 2. Scanning an INDIVIDUAL flips Pending → Scanned

- [x] Scan one of the INDIVIDUAL QRs
- [x] The row moves to the top of the list (scanned section)
- [x] It no longer shows "Pending" — shows the normal asset status
      badge
- [x] The other INDIVIDUAL stays in the Pending section
- [x] Progress indicator ticks to `1/32 units checked in`

## 3. Quick-checkin for qty — happy path (full return)

- [x] On the Pens row (still Pending), click **"Check in without
      scanning"**
- [x] The Pens row moves to the scanned section
- [x] The disposition block renders inline, primary input
      pre-filled to `10`, focus is on the primary input
- [x] The view auto-scrolls so the row is visible (smooth scroll)
- [x] Progress ticks to `11/32` as the primary `10` counts toward
      units checked in
- [x] No shortfall section (returned == remaining)
- [x] Submit — server accepts, booking stays ONGOING (AA Batteries
      still outstanding)
- [x] Refresh the drawer (navigate away + back) — Pens row now shows
      green "Checked in" badge, collapsed into the "Already checked in
      (N)" collapser at the bottom

## 4. Quick-checkin for qty — partial with shortfall

- [x] Continue on the same booking. Click "Check in without scanning"
      on AA Batteries
- [x] Primary input pre-fills to `20`, focus lands there
- [x] Change primary to `15` — shortfall section auto-expands (for
      TWO_WAY) OR stays hidden (for ONE_WAY, since there's no split)
      — **AA Batteries is ONE_WAY, so shortfall is not applicable,
      progress should just be `26/32`** (11 from Pens + 15 from AA)
- [x] Submit — ConsumptionLog gets one `CONSUME qty=15` row; AA
      `Asset.quantity` drops by 15 (50 → 35)
- [x] Booking stays ONGOING (5 AA pending)

## 5. Quick-checkin for qty — Partial + Shortfall (TWO_WAY)

- [x] Create a fresh booking with just 10 Pens. Reserve + check out
- [x] Open check-in drawer. Click "Check in without scanning" on Pens
- [x] Primary input = `10`, change to `7` — shortfall panel opens
- [x] Enter Lost = 2, Damaged = 1. Pending = 0
- [x] Progress reads `10/10 units checked in` (full reconciliation)
- [x] Submit — ConsumptionLog gets RETURN=7, LOSS=2, DAMAGE=1
- [x] Booking → COMPLETE; Pens `Asset.quantity` drops by 3 (Lost+Damaged
      only)

## 6. Remove synthetic row → pending round-trips

- [x] Fresh booking with 10 Pens, check out. Open drawer.
- [x] Click "Check in without scanning" on Pens → row moves to scanned
      section with disposition inputs
- [x] Click the trash icon on that row
- [x] Row **goes back to the Pending section**
- [x] "Check in without scanning" button reappears
- [x] Progress indicator returns to `0/10`
- [x] No ConsumptionLog rows written yet (submit not hit)

## 7. Partially-reconciled qty row (multi-session pending)

- [x] Using the booking from section 4 (5 AA pending after the first
      session), navigate back to the check-in drawer
- [x] AA Batteries row is **in the Pending section** (not at the
      bottom), with badge "**15/20 reconciled**" instead of plain
      "Pending"
- [x] Quick-checkin button is still there
- [x] Click it — primary pre-fills to `5` (the remaining)
- [x] Submit → booking → COMPLETE; second `CONSUME qty=5` log; AA
      `Asset.quantity` drops another 5 (35 → 30)
- [x] No double-decrement

## 8. INDIVIDUAL assets have NO quick-checkin button

- [x] Verify across all scenarios above: INDIVIDUAL pending rows
      show only "Pending" badge, never a button
- [x] Attempting to `document.querySelector('button')` on an individual
      row returns none relevant to check-in
- [x] (Explicit design decision — preserves scan-to-verify paradigm)

## 9. Already-reconciled collapser

- [x] On a booking where some assets are already reconciled (from a
      prior check-in session), the reconciled rows are **NOT visible
      by default** — collapsed behind "Already checked in (N)"
- [x] Click the collapser → rows appear, dimmed (opacity-60), with
      green "Checked in" badges, **no action buttons**
- [x] Click again → re-collapses

## 10. Unexpected scan (asset not on booking)

- [x] On any booking, scan an INDIVIDUAL asset that is NOT part of that
      booking
- [x] Row appears in the scanned section with error/blocker treatment
      — "Not on this booking"
- [x] Submit is blocked until user removes the offending scan
- [x] This matches pre-refactor behavior — no UX regression

## 11. Zero-disposition blocker on quick-checkin row

- [x] Fresh booking with 10 Pens. Click "Check in without scanning"
- [x] Clear the primary input (delete the `10` so it reads empty)
- [x] Blocker appears: copy now mentions "… or click Check in on the
      pending row" (verify the copy tweak landed)
- [x] Submit is disabled
- [x] Re-enter `10` in primary — blocker disappears

## 12. Over-return on quick-checkin row

- [x] Fresh booking with 10 Pens. Click quick-checkin.
- [x] Change primary to `12` → red border + blocker ("exceeds the
      remaining quantity")
- [x] Submit disabled. Bypass via DevTools, send POST — **server still
      rejects with 400** (server contract unchanged — important
      regression check)

## 13. Unit-weighted progress indicator — INDIVIDUAL-only booking

- [x] Create a booking with 2 INDIVIDUAL assets only (no qty-tracked)
- [x] Open drawer → progress shows `0/2 units checked in`
- [x] Scan one → `1/2`
- [x] Scan the other → `2/2`, progress bar fills
- [x] (Should look equivalent to the pre-refactor UX — graceful
      degradation)

## 14. Kit rows — regression

- [x] Create a booking that includes a kit containing 3 assets
- [x] Open drawer → the kit row renders first (as before), not
      duplicated in the pending list
- [x] Kit pending assets are shown once each, either via the kit row
      or via the pending list (whichever matches pre-refactor
      rendering)
- [x] Scanning the kit QR works as before — no regression
- [x] Submit payload for kit check-in matches pre-refactor shape

## 15. Submit payload regression — non-qty booking

- [x] Booking with 3 INDIVIDUAL assets. Scan all 3. Submit.
- [x] Check network tab: `POST` body has the same
      `assetIds[]` shape as before the refactor, `checkins` field is
      absent or empty
- [x] Server accepts, booking → COMPLETE as before

## 16. Submit payload regression — qty booking

- [x] Booking with 10 Pens. Click quick-checkin, keep defaults, submit
- [x] `POST` body: `checkins` JSON has one entry with
      `{assetId, returned: 10}`. Shape matches pre-refactor scanned
      path. `assetIds[]` also contains the asset's id.

## 17. Server contract — no leaked synthetic keys

- [x] In the scenarios above, inspect `ConsumptionLog` rows written:
      none of them reference `qty-checkin:<id>` as a QR or anywhere
      else
- [x] `PartialBookingCheckin.assetIds` contains only real asset IDs
      (never the synthetic prefix)
- [x] Activity notes reference assets by title, not by synthetic key

## 18. Loader refresh keeps state in sync

- [x] Open a booking's check-in drawer. Scan + quick-checkin some
      items but don't submit yet
- [x] In another tab, modify the booking (e.g. add/remove an asset
      via manage-assets)
- [x] Return to the original tab, trigger a loader refresh (navigate
      away + back, or explicit refresh)
- [x] Expected list updates to reflect the new booking contents
- [x] Already-scanned items that are still on the booking stay in the
      scanned section

## 19. Drawer unmount cleans up atoms

- [x] Open drawer, scan/quick-checkin 2 items (don't submit)
- [x] Navigate away from the check-in route
- [x] Navigate back to a DIFFERENT booking's check-in drawer
- [x] The scanned items from the previous booking are NOT visible
      (atoms cleared on unmount)

## 20. Keyboard accessibility

- [x] Tab to the "Check in without scanning" button → visible focus
      ring
- [x] Press Enter/Space → triggers the action, focus moves to the
      primary input as expected (per focus spec)
- [x] Tab through pending rows — no broken tab order
- [x] WCAG contrast ratios on the gray Pending / amber partial / green
      Checked-in badges all hit AA (4.5:1 normal text, 3:1 large text)

## 21. Section headers between buckets

- [x] Open a mixed booking drawer (INDIVIDUAL pending + qty pending +
      at least one reconciled asset from a prior session)
- [x] No scanned rows yet → only a `PENDING (N)` header is shown
      above the pending rows (no `CHECKED IN THIS SESSION` header)
- [x] Scan / quick-checkin one asset → a `CHECKED IN THIS SESSION (1)`
      header now appears **above** the scanned rows, in blue tint.
      `PENDING (N)` header still shown above the remaining pending
      rows, in gray tint
- [x] `Already checked in (N)` collapser stays at the bottom (closed
      by default)
- [x] Remove the only scan → `CHECKED IN THIS SESSION` header
      disappears (not rendered as "(0)")

## 22. Positive status badges on active rows

- [x] Scan an INDIVIDUAL asset via QR — the row shows the green
      **"Scanned"** badge in addition to the asset's normal status
- [x] Click "Check in without scanning" on a qty-tracked pending row
      — the row shows an indigo **"Checked in without scan"** badge
      (distinct from "Scanned") plus the disposition form
- [x] Scan a redundant kit-covered asset — the "Scanned" badge is
      NOT rendered (the "Already covered by kit QR" warning takes
      priority)
- [x] Scan an off-booking asset — "Scanned" badge NOT rendered (the
      "Not in this booking" warning takes priority)
- [x] Scan an already-checked-in asset — "Scanned" badge NOT
      rendered (the "Already checked in" warning takes priority)

## 23. No opacity on pending / reconciled rows

- [x] Pending INDIVIDUAL row renders at full opacity (no dim)
- [x] Pending qty-tracked row renders at full opacity (including
      the "Check in without scanning" button)
- [x] Expand the "Already checked in" collapser — the rows inside
      render at full opacity (no `opacity-60` dim from the earlier
      iteration)

## 24. Scanner-mode text input submits correctly

- [x] Focus the scanner-mode text field (desktop/barcode-scanner
      path — NOT the camera view)
- [x] Type a valid asset QR ID and press Enter / click the input's
      submit button
- [x] A loading row appears immediately under "Checked in this
      session" → resolves to the scanned asset within a second (API
      fetch happens once the row mounts)
- [x] Row does NOT stay stuck in Pending, and the API request does
      fire (verify via DevTools Network tab)
- [x] `assetIds[0]` hidden input in the form DOM matches the scanned
      asset's id — "Check in assets" submit is enabled

## 25. Mixed INDIVIDUAL + qty-tracked submit

- [x] Create a booking with 1 INDIVIDUAL + 1 qty-tracked asset
      (e.g. Ingersoll + Pens×10). Reserve, check out
- [x] Open check-in drawer
- [x] Scan the INDIVIDUAL asset via QR
- [x] Click "Check in without scanning" on Pens, keep the default
      primary = remaining (e.g. 10)
- [x] Submit
- [x] **Both** records land on the server:
  - `ConsumptionLog` has a `RETURN qty=10` for Pens (and no row for
    the INDIVIDUAL — individuals don't log consumption)
  - `PartialBookingCheckin.assetIds` contains the INDIVIDUAL asset's
    id — this is the regression guard. When Pens is also fully
    reconciled in the same session (`remaining=0`), its id will
    ALSO be in the array (per service design:
    `sessionReconciledAssetIds = [...individualAssetIds,
...fullyReconciledQtyAssetIds]`), and `checkinCount` equals the
    total length. Acceptable example: `["<ingersoll-id>",
"<pens-id>"]`, `checkinCount: 2`.
  - Ingersoll's `Asset.status` is `AVAILABLE` (was `CHECKED_OUT`)
  - Pens `Asset.status` may stay `CHECKED_OUT` (expected when Pens
    is on other active bookings — status is global). Pens
    `Asset.quantity` is **unchanged** for this session (RETURN
    doesn't decrement the pool; only CONSUME / LOSS / DAMAGE do)
  - Booking transitions to `COMPLETE` (everything reconciled)
- [x] **Regression the fix addresses:** the pre-fix bug was that
      when `checkins` (qty dispositions) was non-empty, `assetIds`
      (INDIVIDUAL ids) was ignored — so the INDIVIDUAL never
      appeared in `PartialBookingCheckin.assetIds` and its status
      stayed `CHECKED_OUT`. Verify this no longer happens: the
      INDIVIDUAL id MUST be in `PartialBookingCheckin.assetIds`.

## 26. Qty disposition breakdown in the tooltip

- [x] Continue from a booking where Pens had mixed dispositions
      (RETURN + LOSS + DAMAGE across one or more sessions)
- [x] Hover the `N/M` qty progress label on the Pens row (booking
      overview AND the bookings-index sidebar)
- [x] Tooltip shows the per-category split:
  - **Returned** — emerald, only rendered when > 0
  - **Consumed** — gray, only rendered when > 0 (ONE_WAY bookings)
  - **Lost** — rose, only rendered when > 0
  - **Damaged** — amber, only rendered when > 0
  - **Remaining** — summary row below a horizontal divider
- [x] ONE_WAY-only booking (AA Batteries fully consumed) → tooltip
      shows Consumed + Remaining only, no Returned/Lost/Damaged rows
- [x] TWO_WAY happy path (all returned) → Returned only, no Lost or
      Damaged rows
- [x] Numbers match a `SELECT category, SUM(quantity) FROM
"ConsumptionLog" GROUP BY category` for this (booking, asset)
      pair

## 27. Qty-tracked does NOT block Reserve

- [x] Find a qty-tracked asset that has units out via an ONGOING
      booking (so `Asset.status = CHECKED_OUT`), but pool capacity
      is not fully consumed (e.g. Pens: total 80, 22 out elsewhere,
      58 available)
- [x] Create a new DRAFT booking; add enough of that asset to fit
      within the available capacity (e.g. 10 Pens). Add a custodian,
      pick valid dates
- [x] The **Reserve** button is **enabled** — no "is already checked
      out" blocker shown at the top of the form
- [x] Click Reserve → booking moves to `RESERVED` without error
- [x] **Regression guard:** if the Reserve button is disabled when
      the only conflict is a qty-tracked asset being partially out,
      that's the bug. INDIVIDUAL assets in conflict should STILL
      block (see sub-check below)
- [x] Negative case — booking with 1 INDIVIDUAL asset that's
      currently CHECKED_OUT via another ONGOING booking → Reserve
      IS blocked, same as before

## 28. No crash on qty-tracked partial in the overview

- [x] Perform a partial qty check-in (e.g. 5 of 20 AA Batteries
      consumed, 15 pending). Booking stays ONGOING
- [x] Navigate back to `/bookings/<id>/overview`
- [x] Page renders without error (no red React error overlay, no
      `TypeError: can't access property "checkinDate"` in console)
- [ ] The AA Batteries row:
  - "Checked in on" cell is empty (`—`) — qty partials don't carry
    a single timestamp
  - "Checked in by" cell is empty (`—`)
  - Qty column shows `5/20` progress with the breakdown tooltip
  - Status badge reads "Partially checked in"
- [x] INDIVIDUAL partial on the same booking still shows the date + user in both cells (the existing path unchanged)

## 29. ONE_WAY consumable — return unused units to pool

Real-life case: 20 AA batteries booked, operator only used 5, the
other 15 are still sealed and go back to stock. Before this fix,
ONE_WAY assets could only be Consumed / Lost / Damaged; unused
units had nowhere to go.

- [x] Fresh booking with 20 AA Batteries (ONE_WAY), reserve + check
      out. Note starting `Asset.quantity` (e.g. 50)
- [x] Open check-in drawer, click "Check in without scanning" on AA
      Batteries
- [x] Primary input label reads **Consumed** (not "Returned" —
      ONE_WAY), pre-filled to `20`
- [x] Change Consumed to `5` → shortfall panel opens
- [x] Shortfall panel now shows three inputs: **Returned / Lost /
      Damaged** (on TWO_WAY it would only show Lost / Damaged).
      Plus the "N pending" label on the right
- [x] Enter Returned = `15`, leave Lost + Damaged at 0. Pending = 0
- [x] Progress ticks to `20/20 units checked in`
- [x] Submit — booking transitions to COMPLETE
- [ ] DB state (SQL spot-check below):
  - `ConsumptionLog` has **two** rows for AA Batteries:
    `CONSUME qty=5` and `RETURN qty=15`
  - AA Batteries `Asset.quantity` dropped by **5 only** (e.g. 50 →
    45). RETURN does NOT decrement the pool
- [x] Asset activity feed on AA Batteries reads
      `... via check-in on <booking>: consumed **5**, returned **15**.`
      (both categories named, no mention of Lost / Damaged)
- [x] Booking activity feed reads
      `... performed a partial check-in: ... — qty: [AA Batteries](…)
(5 consumed, 15 returned).`
      (asset linked, both categories listed)
- [x] Hover the `N/M` progress label on the booking overview —
      tooltip shows:
  - **Returned: 15** (emerald)
  - **Consumed: 5** (gray)
  - **Remaining: 0**
  - No Lost / Damaged rows (they were zero)

### Variant: ONE_WAY with a full split (consumed + returned + lost + damaged)

- [x] Fresh booking with 20 AA Batteries, check out
- [x] Click quick-checkin. Consumed 3, Returned 10, Lost 4, Damaged 3.
      Pending shows 0, Progress 20/20
- [ ] Submit → four `ConsumptionLog` rows (CONSUME 3, RETURN 10,
      LOSS 4, DAMAGE 3). `Asset.quantity` drops by `3 + 4 + 3 = 10`
      (only consumed+lost+damaged — RETURN is pool-neutral)
- [x] Tooltip renders all four category rows, each with its own
      color

### Regression guard: TWO_WAY drawer shape unchanged

- [x] Fresh booking with 10 Pens (TWO_WAY), check out
- [x] Quick-checkin, set primary Returned = 7
- [x] Shortfall panel shows ONLY **Lost** and **Damaged** inputs —
      **no "Returned" field in the shortfall** (TWO_WAY already uses
      the primary for Returned; a duplicate would confuse)
- [x] Over-return guard still fires if
      `primary + lost + damaged > remaining` (no `returned`
      contribution since the UI doesn't surface it for TWO_WAY)

---

## Server/DB spot checks (run during/after section 3–7)

```sql
-- All disposition logs for a booking
SELECT category, quantity, "createdAt"
FROM "ConsumptionLog"
WHERE "bookingId" = '<booking-id>'
ORDER BY "createdAt";

-- Partial sessions should only reference real asset IDs
SELECT "assetIds", "checkinCount", "createdAt"
FROM "PartialBookingCheckin"
WHERE "bookingId" = '<booking-id>';

-- Asset.quantity should only drop by consume+lost+damaged, never by
-- return — verify after each scenario:
SELECT quantity FROM "Asset" WHERE id = '<asset-id>';

-- Section 25: mixed INDIVIDUAL + qty-tracked submit persisted both sides
SELECT cl.category, cl.quantity, a.title
FROM "ConsumptionLog" cl JOIN "Asset" a ON a.id = cl."assetId"
WHERE cl."bookingId" = '<booking-id>';
SELECT "assetIds", "checkinCount"
FROM "PartialBookingCheckin" WHERE "bookingId" = '<booking-id>';

-- Section 26: tooltip totals match the DB split per asset
SELECT category, SUM(quantity)
FROM "ConsumptionLog"
WHERE "bookingId" = '<booking-id>' AND "assetId" = '<asset-id>'
GROUP BY category;

-- Section 29: ONE_WAY consumable with RETURN to pool.
-- Expect rows for both CONSUME and RETURN on the same asset, and
-- Asset.quantity dropped only by (CONSUME + LOSS + DAMAGE).
SELECT category, quantity, "createdAt"
FROM "ConsumptionLog"
WHERE "bookingId" = '<booking-id>' AND "assetId" = '<aa-batteries-id>'
ORDER BY "createdAt";
SELECT quantity FROM "Asset" WHERE id = '<aa-batteries-id>';
```

---

## Out of scope (do not test here)

- `checkinBooking` (full check-in, not partial) — not touched by this
  refactor
- `manage-assets` quantity guardrail — covered by Phase 3c tests
- `partialCheckinBooking` service logic — server contract unchanged,
  regression is already protected by unit tests
- Kit-level quick-checkin — not added, kits stay scan-only
- Book-by-model UX — separate Phase 3d

## Sign-off

- [ ] All sections above pass with no regressions
- [ ] No new `pnpm webapp:validate` failures introduced
- [ ] Manual screenshot / screen recording for scenarios 1, 3, 6, 9
      attached to the PR description
