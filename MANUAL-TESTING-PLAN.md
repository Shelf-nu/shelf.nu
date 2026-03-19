# Manual Testing Plan — Mobile Companion App

> This plan tracks what needs manual testing after each implementation step.
> Update after each step is completed. Check off items as they're verified.

---

## Changes Made

### P0 (Complete)

1. RBAC Permission Checks (12 endpoints)
2. Org Access Standardization (add-note)
3. Service Layer Rewrite (custody, bulk ops)
4. Audit Assignee Check (complete endpoint)
5. Function Rename (bulkCheckOutAssets → bulkAssignCustody, bulkCheckInAssets → bulkReleaseCustody)
6. Scanner UI Role Filtering

### P1 (Complete)

7. Design Cleanup — reduced orange from 173 → 34 usages, added neutral color tokens
8. Unit Tests — 16 test files, 42 new tests (130 files / 1566 tests total)
9. Dev Setup Docs — companion README with Xcode compat, LAN IPs, HTTP mode, device setup

---

## Test Scenarios

### A. Role-Based Access (RBAC)

Test with three different user roles: **ADMIN/OWNER**, **SELF_SERVICE**, and **BASE**.

#### Scanner Actions Visibility

- [ ] **BASE user**: Scanner only shows "View" action
- [ ] **SELF_SERVICE user**: Scanner shows "View", "Assign", "Release" (no "Location")
- [ ] **ADMIN/OWNER user**: Scanner shows all 4 actions (View, Assign, Release, Location)
- [ ] Swipe navigation between actions only cycles through available actions per role

#### Custody — Assign (single + bulk)

- [ ] **ADMIN**: Can assign custody to any team member via scanner
- [ ] **SELF_SERVICE**: Can assign custody (should auto-select self per webapp behavior)
- [ ] **BASE**: Cannot see assign action; API returns 403 if called directly
- [ ] Verify activity note is created in asset history after assign

#### Custody — Release (single + bulk)

- [ ] **ADMIN**: Can release custody on any asset
- [ ] **SELF_SERVICE**: Can release custody (webapp restricts to own custody — verify same behavior)
- [ ] **BASE**: Cannot see release action; API returns 403 if called directly
- [ ] Verify activity note is created in asset history after release

#### Location Update (bulk)

- [ ] **ADMIN**: Can update location via scanner and bulk action
- [ ] **SELF_SERVICE**: Cannot see location action in scanner; API returns 403
- [ ] **BASE**: Cannot see location action; API returns 403
- [ ] Kit-managed assets are rejected with proper error message

#### Asset Image Update

- [ ] **ADMIN**: Can update asset image from asset detail screen
- [ ] **SELF_SERVICE**: API returns 403 (no `asset:update` permission)
- [ ] **BASE**: API returns 403

#### Asset Notes

- [ ] **ADMIN**: Can add a note to an asset
- [ ] **SELF_SERVICE**: API returns 403 (no `asset:update` permission)
- [ ] **BASE**: API returns 403
- [ ] Note is scoped to the selected organization (not cross-org)

#### Booking Checkout

- [ ] **ADMIN**: Can checkout a RESERVED booking
- [ ] **SELF_SERVICE**: Can checkout a RESERVED booking
- [ ] **BASE**: API returns 403
- [ ] Assets transition to CHECKED_OUT status

#### Booking Checkin (full + partial)

- [ ] **ADMIN**: Can checkin an ONGOING booking
- [ ] **SELF_SERVICE**: Can checkin an ONGOING booking
- [ ] **BASE**: API returns 403
- [ ] Full checkin: all assets return to AVAILABLE, booking → COMPLETE
- [ ] Partial checkin: only selected assets return

#### Audit Record Scan

- [ ] **ADMIN**: Can scan assets during an audit
- [ ] **SELF_SERVICE**: Can scan assets during an audit
- [ ] **BASE**: API returns 403
- [ ] Expected assets marked as "found", unexpected assets flagged

#### Audit Complete

- [ ] **ADMIN (assignee)**: Can complete an audit they're assigned to
- [ ] **ADMIN (not assignee, audit has assignees)**: Cannot complete — gets 403
- [ ] **ADMIN (not assignee, audit has NO assignees)**: Can complete (bypass)
- [ ] **SELF_SERVICE (assignee)**: Can complete
- [ ] **SELF_SERVICE (not assignee)**: Cannot complete — gets 403
- [ ] **BASE**: API returns 403
- [ ] Unscanned expected assets marked as MISSING on completion

### B. Service Layer Consistency

These verify the rewritten routes produce identical results to the webapp.

#### Custody Assign via Mobile vs Webapp

- [ ] Assign custody on mobile → check webapp asset detail shows same custody info
- [ ] Activity note format matches webapp format
- [ ] Asset status is IN_CUSTODY

#### Custody Release via Mobile vs Webapp

- [ ] Release custody on mobile → check webapp shows asset as AVAILABLE
- [ ] Activity note format matches webapp format

#### Bulk Assign Custody

- [ ] Select multiple assets in scanner → assign custody → all assets in custody
- [ ] Assets that are already in custody are properly rejected/skipped

#### Bulk Release Custody

- [ ] Bulk release → all assets return to AVAILABLE
- [ ] Assets without custody are properly rejected

#### Bulk Update Location

- [ ] Bulk location update → all assets moved to new location
- [ ] Kit-managed assets are excluded with proper error
- [ ] Activity notes created for each asset

### C. Webapp Regression

These verify the rename didn't break existing webapp functionality.

- [ ] Webapp: Bulk assign custody from asset list works
- [ ] Webapp: Bulk release custody from asset list works
- [ ] Webapp: Scanner assign/release custody works
- [ ] Webapp: Booking checkout/checkin works
- [ ] Webapp: Audit complete works
- [ ] `pnpm webapp:validate` passes (lint + typecheck + tests)

### D. Design / Visual QA

Test each screen in **both light and dark mode**. Orange should only appear on primary CTA buttons and key brand moments.

#### Global checks

- [ ] ActivityIndicators and pull-to-refresh spinners are gray (not orange)
- [ ] Filter pills use dark gray (active) / light gray (inactive), not orange
- [ ] Progress bars (audits) are green, not orange
- [ ] "View all" links and similar are gray, not orange
- [ ] Tab bar active icon is orange (this is correct — brand accent)

#### Per-screen checks

- [ ] **Login**: Sign In button is orange; "Forgot password?" link is gray
- [ ] **Home**: Quick action icons are orange (brand moment); "View All" links are gray; audit progress is green; pull-to-refresh is gray
- [ ] **Assets list**: Filter pills are neutral; FAB is orange; loading spinners are gray
- [ ] **Asset detail**: Note avatar is gray (not orange); loading spinners gray; "Assign Custody" CTA is orange
- [ ] **Asset edit**: Category/location checkmarks are gray; loading spinners gray; "Save" button is orange; switch toggle keeps orange (acceptable)
- [ ] **Asset create**: Same pattern as edit; "Create" button is orange
- [ ] **Bookings list**: Filter pills neutral; loading spinners gray; retry button orange
- [ ] **Booking detail**: Checkout/Checkin buttons orange; outline buttons gray; selection checkboxes orange (acceptable)
- [ ] **Audits list**: Filter pills neutral; progress bars GREEN; action hints gray
- [ ] **Audit detail**: Progress bar green; "Complete Audit" outline button gray; "Start Scanning" CTA orange
- [ ] **Audit scan**: Progress bar green; segmented control neutral; "Complete Audit" CTA orange
- [ ] **Scanner**: Action pills use neutral colors on camera overlay; scan frame corners white; primary action button orange
- [ ] **Custody**: Loading spinners gray; retry button orange
- [ ] **Settings**: Avatar background gray (not orange); theme/start page toggles use neutral colors

#### Dark mode specific

- [ ] All neutral colors have proper dark mode variants (no white-on-white or dark-on-dark)
- [ ] Filter pills readable in dark mode
- [ ] Progress bars visible on dark backgrounds
- [ ] Orange CTAs still have good contrast in dark mode

### E. Edge Cases

- [ ] Expired JWT token → returns 401, app redirects to login
- [ ] User removed from organization → returns 403
- [ ] Asset deleted between scan and action → returns 404
- [ ] Network error during bulk operation → proper error message shown
- [ ] Scanning same asset twice in batch mode → no duplicate

---

## Test Accounts Needed

| Role         | Description                                      |
| ------------ | ------------------------------------------------ |
| OWNER        | Full access to all features                      |
| ADMIN        | Full access (same as owner for permissions)      |
| SELF_SERVICE | Limited: can view, custody (self only), bookings |
| BASE         | Read-only: can only view assets                  |

---

## Status

### P0

| Step                      | Implemented | Tests Pass | Manual QA |
| ------------------------- | :---------: | :--------: | :-------: |
| RBAC (12 endpoints)       |     ✅      |     ✅     |    ⬜     |
| Org access fix (add-note) |     ✅      |     ✅     |    ⬜     |
| Service layer rewrite     |     ✅      |     ✅     |    ⬜     |
| Audit assignee check      |     ✅      |     ✅     |    ⬜     |
| Function rename           |     ✅      |     ✅     |    ⬜     |
| Scanner role filtering    |     ✅      |     ✅     |    ⬜     |

### P1

| Step                      | Implemented | Tests Pass | Manual QA |
| ------------------------- | :---------: | :--------: | :-------: |
| Design cleanup (orange)   |     ✅      |     ✅     |    ⬜     |
| Unit tests (16 endpoints) |     ✅      |     ✅     |    N/A    |
| Dev setup docs (README)   |     ✅      |    N/A     |    ⬜     |
