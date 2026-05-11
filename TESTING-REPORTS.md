# Reports — Manual Testing Checklist

**Goal:** verify all 10 reports render and compute correctly against the
post-merge schema (Phase 2 multi-custody, Phase 3a `BookingAsset` pivot,
Phase 3d `BookingModelRequest`, ActivityEvent flows from PR #2495).

The reports renderers + helpers came in from main via PR #2495, were
ported in `12f2e8257` for compile cleanliness, and the high-risk pieces
(`reports/helpers.server.ts` overdue-items KPI math) had a substantial
3-way merge resolution in `197b51c8c` combining HEAD's pivot walk with
main's partial-checkin-intersection + outstanding-only `valueAtRisk`.

This is the first end-to-end exercise of those code paths.

> **Highest-risk reports, watch closely:**
>
> 1. **Overdue Items** — KPI math was redesigned in the merge (now shows
>    "Assets Outstanding" = booked − checked-in, not "Assets at Risk" =
>    just booked). Per-row `valueAtRisk` now excludes checked-in
>    assets. Subtle — wrong numbers will look plausible.
> 2. **Asset Utilization** — walks `BookingAsset` pivot for
>    asset-vs-booking math. Day-overlap math + `daysInUse` aggregation
>    crosses the migration boundary.
> 3. **Top Booked Assets** — pivot walk + `uniqueAssetsById` map for
>    thumbnail refresh; the type plumbing was reshuffled during the
>    merge.

---

## Prerequisites

- [x] Seed script ran successfully against a dedicated org:
      `    pnpm webapp:seed:reporting-demo -- --org-id <org-id>`
- [x] Dev server running on port 3000 (`pnpm webapp:dev`)
- [x] Logged in as a user with `reports:read` permission in that org
- [x] Workspace switched to the seeded org
- [x] Have a clean browser console open — capture any client-side
      errors from chart renderers / number formatters

---

## 0. Reports listing page (`/reports`)

- [x] Page loads without 500 / runtime error
- [x] All 10 report cards render with their titles + descriptions
- [x] No console errors
- [x] Clicking a card navigates to `/reports/<reportId>`
- [x] Breadcrumb shows `Reports` linking back to `/reports`

---

## 1. Booking Compliance — `/reports/booking-compliance` 🟡

**What it shows:** how often bookings were checked in on time vs late
within a timeframe, KPIs for compliance rate and value-at-risk,
custodian leaderboard.

**Risk profile:** a TEAM merge brought review-feedback fixes in main
that adjusted compliance math (PR-review feedback chain
`b01d8226d → 68655f621`). Our merge picked up those changes wholesale.
Verify the numbers look plausible against the seed's known
distributions.

- [ ] Page loads with non-empty hero KPIs
- [ ] **"Compliance Rate"** KPI is a percentage 0-100 (not NaN, not
      negative)
- [ ] **"On-time Returns"** + **"Late Returns"** + **"Outstanding"**
      sum equals the total booked count for the timeframe
- [ ] Bar chart at top renders with date buckets (no empty axes, no
      runtime error)
- [ ] Custodian leaderboard table populates with rows
- [ ] Each row shows: custodian, total bookings, compliance %, late
      count
- [ ] Timeframe picker (top right) — change to "Last 30 days",
      numbers shrink. Change back to "Last 12 months", numbers grow.
- [ ] No console errors during interaction

---

## 2. Overdue Items — `/reports/overdue-items` 🔴 HIGH RISK

**What it shows:** currently-overdue bookings (live snapshot, no
timeframe), counts of assets still outstanding, value at risk.

**Risk profile:** This was the biggest merge resolution. Pre-merge
HEAD walked the BookingAsset pivot for `totalAssetsAtRisk = count of
all booked assets`. Main introduced a different concept:
`totalAssetsOutstanding = booked − checkedInViaPartial`, with
`valueAtRisk` summing only outstanding assets. My resolution combined
both — KPI labels are now main's, math walks HEAD's pivot. **This is
where you'll find bugs if any exist.**

### Hero KPIs

- [ ] **"Overdue Bookings"** — count of OVERDUE-status bookings in the
      org (sanity-check against `SELECT count(*) FROM "Booking" WHERE
organizationId = '...' AND status = 'OVERDUE'`)
- [ ] **"Assets Outstanding"** — should be `total_booked −
checked_in_via_partial` across all overdue bookings
- [ ] Subtitle on Assets Outstanding reads `"X still out across Y
total"` with `Y >= X`. If any partial check-ins exist on overdue
      bookings, `Y > X` strictly. If none, `Y == X`.
- [ ] **"Value at Risk"** — sum of valuations for **outstanding only**
      (a partially-checked-in asset's valuation should NOT contribute
      if it's already returned)
- [ ] **"Avg Days Overdue"** + **"Longest Overdue"** — non-negative
      integers if overdue bookings exist; "—" if none

### Table rows

- [ ] Each row shows: booking name, custodian, asset count,
      checked-in count, unchecked count, days overdue, value at risk
- [ ] `assetCount` = total booked (NOT outstanding — this is the
      historical count)
- [ ] `checkedInCount + uncheckedCount = assetCount`
- [ ] Rows sorted by most-overdue-first (earliest `to` date)
- [ ] Per-row `valueAtRisk` excludes the checked-in assets'
      valuations

### Edge case (if seed produced one)

- [ ] Find a booking that has a partial check-in including an asset
      that was later **removed** from the booking (the seed may
      generate this — it's a known edge case the merge fix targeted).
      For that booking, `checkedInCount` should reflect only assets
      still in `bookingAssets`, NOT the removed one. If
      `checkedInCount` includes the removed asset, the
      `currentAssetIds` intersection in `fetchOverdueRows` is broken.

### Filters / interaction

- [ ] No timeframe picker (correct — this is a "live" snapshot
      report, fenced off from timeframe filtering by
      `liveOrSnapshotReports` in `report-filter-bar.tsx`)
- [ ] Pagination works if seed generated >50 overdue bookings

---

## 3. Idle Assets — `/reports/idle-assets`

**What it shows:** assets that haven't been booked recently (>= N
days, where N is selectable: 30 / 60 / 90).

**Risk profile:** filter walks the `BookingAsset` pivot. Sub-query
shape changed during merge. Lower risk than Overdue because the
math is simpler.

- [ ] Page loads with **threshold selector** at top (30 / 60 / 90
      days), not a timeframe picker
- [ ] Hero KPI shows "Idle Assets" count
- [ ] Each row: asset, category, location, last booking end date,
      days idle
- [ ] Last-booking column populates correctly (most-recent COMPLETE
      booking's `to` date) — sanity check 1-2 rows by clicking
      through to the asset, viewing its booking history
- [ ] Switch threshold from 30 → 60 → 90: row count should
      monotonically decrease (90-day idle is a subset of 30-day)
- [ ] Asset never booked → still shows up with "Never booked"
      indicator (the helper handles this — `lastBookedAt = null`)

---

## 4. Custody Snapshot — `/reports/custody-snapshot`

**What it shows:** who currently holds what across the org (live
snapshot of all `Custody` rows).

**Risk profile:** Phase 2 made `Asset.custody` a 1:many array. Code
needs to render multi-custody assets correctly.

- [ ] Hero KPI shows total assets in custody
- [ ] Multi-custody asset (e.g. Pens with multiple custodians from
      yesterday's testing — if seeded similarly) renders with each
      custodian as a separate row OR aggregated correctly
- [ ] Each row: asset, custodian, quantity (for qty-tracked),
      since-when
- [ ] No timeframe picker (live state)
- [ ] Custodian column shows the team-member name correctly
      (formerly `asset.custody.custodian` singular access — should
      now correctly handle the array shape)

---

## 5. Top Booked Assets — `/reports/top-booked-assets` 🟡

**What it shows:** assets ranked by booking frequency in the
timeframe.

**Risk profile:** the merge reshuffled the type plumbing on
`uniqueAssetsById` Map (changed from `assets[number]` to
`bookingAssets[number]["asset"]`). Verify thumbnails refresh and the
ranking is stable.

- [ ] Page loads with hero KPI showing "Top Asset" + booking count
- [ ] Table rows ranked by `bookingCount` descending
- [ ] Each row shows: thumbnail, asset name, category, location,
      booking count, total days booked, time-booked %
- [ ] Time-booked % is between 0-100, plausible (an asset booked
      30 days in a 90-day window should be ~33%)
- [ ] Thumbnails render — if any are broken/missing the
      `refreshExpiredAssetImages` integration regressed
- [ ] Timeframe picker — switch to a window with no bookings, table
      empties cleanly (no error)

---

## 6. Asset Distribution — `/reports/distribution`

**What it shows:** breakdown of assets by category, location, status.

**Risk profile:** snapshot report; lower risk. Donut charts.

- [ ] All three breakdowns render (category / location / status
      donuts)
- [ ] Numbers in each donut sum to total asset count
- [ ] Hero KPI shows total assets
- [ ] No timeframe picker (live state — fenced)
- [ ] Hovering a donut segment shows tooltip with count + %
- [ ] Legend renders ≤5 items + "(N more)" overflow

---

## 7. Asset Inventory — `/reports/asset-inventory`

**What it shows:** flat list of all assets with current status,
custodian, location.

**Risk profile:** Phase 2 multi-custody — code at
`fetchInventoryRows:2666` uses `a.custody[0]?.custodian?.name` for
the array shape. Sanity check that multi-custody assets show
_something_ for the custodian (it'll be the first row, which is
acceptable).

- [ ] Hero KPI shows total inventory count + total value
- [ ] Each row: asset, category, location, status, custodian,
      valuation
- [ ] Multi-custody qty-tracked asset → custodian column shows the
      first custodian (acceptable; full list is on the asset detail
      page)
- [ ] Asset with no custody → custodian column is empty/`—`
- [ ] No timeframe picker (snapshot)

---

## 8. Monthly Booking Trends — `/reports/monthly-booking-trends`

**What it shows:** booking volume per calendar month over the
timeframe.

**Risk profile:** time-series rollup. Lower risk — single bar chart.

- [ ] Hero KPI shows total bookings in window
- [ ] Bar chart renders one bar per month in the window
- [ ] X-axis labels are month names (e.g. "Jan 2026")
- [ ] Y-axis is booking count
- [ ] Hovering a bar shows tooltip with month + count
- [ ] Timeframe picker — switch to "Last 90 days", chart shrinks to
      ~3 months

---

## 9. Asset Utilization — `/reports/asset-utilization` 🟡

**What it shows:** per-asset utilization rate within the timeframe
(% of days booked).

**Risk profile:** walks the `BookingAsset` pivot, computes day-overlap
between booking windows and timeframe. Math is non-trivial and
crosses the schema migration boundary.

- [ ] Hero KPI shows average utilization across the org
- [ ] Each row: asset, category, location, total days in use,
      utilization %, booking count
- [ ] Utilization bars render with brand color (no good/bad
      thresholds — per `reports-styling.md` rule)
- [ ] Utilization % is between 0-100
- [ ] Asset booked across two overlapping windows → days are NOT
      double-counted (the `bookingIds.add(booking.id)` Set
      deduplication should handle this)
- [ ] Asset never booked in window → shows up at 0% utilization

---

## 10. Asset Activity — `/reports/asset-activity`

**What it shows:** activity feed across all assets in the timeframe,
grouped by activity type.

**Risk profile:** reads `ActivityEvent` table. The schema came in
from main; our new flows (qty-tracked custody, kit deletion) emit
events with `meta.viaKit` / `meta.viaQuantity` / `meta.viaKitDelete`
flags that the renderer should handle gracefully.

- [ ] Hero KPI shows total events in window
- [ ] Each row: timestamp, asset, action, actor, kit (if applicable)
- [ ] Activity-type badges colored per the `reports-styling.md`
      rule (CREATED green, UPDATED blue, CUSTODY\_\* violet,
      BOOKING_CHECKED_OUT orange, BOOKING_CHECKED_IN green)
- [ ] `CUSTODY_ASSIGNED` events with `meta.viaKit: true` — render
      cleanly (the renderer might surface a "via kit" badge or
      similar)
- [ ] `CUSTODY_RELEASED` events with `meta.viaKitDelete: true`
      (from yesterday's `performKitDeletion` work) — render
      cleanly, no console errors from unknown meta keys

---

## 11. Cross-cutting — CSV export

The reports module supports CSV export via `/reports/export/<file>.csv`
routes. Spot-check 2-3 reports.

- [ ] Booking Compliance → "Export CSV" button → file downloads with
      header row + data rows matching what's on screen
- [ ] Asset Inventory → CSV downloads, opens in spreadsheet app
      without column drift
- [ ] Special characters in asset titles (commas, quotes) are
      escaped correctly in the CSV
- [ ] Custody Snapshot → CSV custodian column populates correctly
      (multi-custody asset → which row is exported?)

---

## 12. Cross-cutting — permissions + scoping

- [ ] Logged in as SELF_SERVICE in the seeded org → reports listing
      page **either** filters down to reports that work for that
      role **or** is hidden entirely. Either is acceptable; flag
      whichever happens. (Reports are typically admin/owner only.)
- [ ] Switch to a different organization (one without seed data) →
      navigate to a report URL directly → page should render with
      empty states, **not** show data from the seeded org. This is
      the main cross-org leak guard.

---

## 13. Final gate

- [ ] No new TS / lint errors introduced (we haven't edited code,
      so this should be inherent — verify by running `pnpm
webapp:validate` once at the end)
- [ ] No new react-doctor findings on the report files
      (`pnpm webapp:doctor` advisory)
- [ ] Browser console is clean across all 10 reports
- [ ] Server console (`pnpm webapp:dev` terminal) is clean — no
      Prisma "field does not exist" or "type mismatch" warnings
- [ ] Cleanup: if you want to delete the seeded org's synthetic data,
      the seed script supports it via the `SEED_RUN_ID` markers.
      Otherwise the dedicated reports-demo org just stays around as
      a fixture for next time.

---

## Sign-off

- [ ] All 10 reports load without 500 / runtime errors
- [ ] Hero KPIs have plausible values across the matrix
- [ ] No regression in any specific report flagged (especially the
      🔴 high-risk Overdue Items)
- [ ] Browser + server console clean
- [ ] Decision: **(a)** reports are good to ship as-is, **(b)** we
      need follow-up fixes (file as new issues), **(c)** something
      bigger is broken — pause and discuss

---

## Out of scope

- Performance under load (the seed script generates ~12 months
  of data; if a report takes >5s on this fixture flag it, but
  serious perf testing is a separate exercise)
- Visual / a11y polish — fixing those is on the reports module
  owner's queue, not ours
- Mobile companion app's reports surface (if any) — out of this
  PR's scope
