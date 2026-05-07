# Kit ↔ Qty-Tracked Custody Correctness Fixes — Manual Testing Checklist

**Three correctness bugs in the kit ↔ asset-custody interaction +
the asset-index query.** All originate from a single missing
discriminator: pre-fix, the `Custody` table had no way to tell apart
"operator-assigned to this asset directly" from "inherited because
the asset's kit is in custody." This PR adds `Custody.kitCustodyId`,
a nullable FK that tags each Custody row with its origin (kit ID or
NULL for operator-assigned).

Scope covered:

- **Issue A** — Advanced asset index showed duplicate rows for
  qty-tracked assets with multiple custodians. Replaced the
  per-custody LEFT JOIN with a `LEFT JOIN LATERAL` + `jsonb_agg`
  so each asset is one row, with the full custody list aggregated.
  The custody column now renders the primary custodian inline +
  `+N more` chip with a tooltip listing every custodian.
- **Issue B** — Adding a qty-tracked asset to a kit-in-custody
  created the inherited `Custody` row with `quantity: 1` regardless
  of the asset's actual qty. Fixed across all 5 kit→asset custody
  write sites.
- **Issue C** — Removing a qty-tracked asset from an in-custody kit
  (or releasing the kit's custody) deleted ALL Custody rows for the
  affected assets, including operator-assigned per-unit custody.
  Fixed by filtering deletes by `kitCustodyId` (or relying on FK
  cascade for the kit-level releases). Asset status flip is now
  conditional — only flips to `AVAILABLE` when no remaining custody
  rows exist.

Side effect (deliberate):

- All kit-custody flows now emit `CUSTODY_ASSIGNED` /
  `CUSTODY_RELEASED` activity events with `meta: { viaKit: true,
quantity }` — for `bulkReleaseKitCustody`, `releaseCustody` (kit),
  `bulkRemoveAssetsFromKits`, and `updateKitAssets` removal paths.
  Cascade-driven deletes still emit events first, then let the FK
  do the cleanup.

Folded-in fixes (caught during testing of this PR):

- **Picker visibility** — The asset picker (`/kits/:id/assets/manage-assets?status=AVAILABLE`,
  `/locations/:id/assets/manage-assets?status=AVAILABLE`, etc.) now
  includes qty-tracked assets when filtering by `status=AVAILABLE`.
  Previously, a qty-tracked asset whose row-level `Asset.status`
  flipped to `IN_CUSTODY` (because _any_ unit was allocated) was
  excluded entirely, even though the asset still had free units.
  IN_CUSTODY / CHECKED_OUT filters keep their original semantic.
  > **Visibility only — selection / sharing is Phase 4.** A qty-tracked
  > asset that's already in another kit (or that has any custody) will
  > render in the picker but the row stays disabled. The
  > `disabledBulkItems` guard in `kits.$kitId.assets.manage-assets.tsx`
  > blocks selection when `asset.status !== AVAILABLE` AND the asset
  > isn't already in this kit. Even if the disable were lifted, the
  > current schema (`Asset.kitId` is a single FK) would **move** the
  > whole asset to the new kit rather than share units across kits.
  > The "split N units of Pens into Kit A and the rest into Kit B"
  > flow is the **split mechanic** under PRD principle #3 — Phase 4,
  > gated on Open Question #6. So the test for this PR is "Pens
  > _appears_ in the picker"; selecting it is intentionally
  > out-of-scope.
- **Qty display on lists** — Location detail (`/locations/:id`)
  asset rows show `· N units` (or `· N <unitOfMeasure>`) inline
  with qty-tracked asset titles. The add-to-kit scanner drawer
  shows the same suffix when scanning qty-tracked items. The kit
  detail page shows kit-aware format — see next bullet.
- **Kit-aware qty display on kit detail page** — When the kit is in
  custody, qty-tracked rows show `· N / M units in kit` where N is
  the kit-allocated count (sum of `Custody.quantity` rows tagged
  with the kit's `KitCustody.id`) and M is the asset's total stock.
  When the kit is not in custody, falls back to `· M units`. INDIVIDUAL
  rows are unaffected (no suffix).
- **Option B — kit-custody quantity is the remaining pool**
  (`buildKitCustodyInheritData`). When you assign a kit's custody
  and an asset already has operator-allocated custody, the kit row
  claims `asset.quantity − sum(existing custody)` rather than the
  full `asset.quantity`. Fully-allocated assets are silently skipped
  (no kit row created). Drill (INDIVIDUAL) always gets 1.
- **Out of scope (Phase 4):** splitting a qty-tracked asset across
  multiple kits or locations (e.g. "10 pens here, 20 there"). Per
  PRD principle #3, that's the **split** mechanic, gated on Open
  Question #6 and deferred. Whole-asset semantics applies for now.

Production deploy notes:

- Migration includes a one-shot backfill that tags all pre-existing
  kit-allocated Custody rows by walking
  `KitCustody → Kit → Asset` and matching `Custody.teamMemberId =
KitCustody.custodianId`. **Run the migration before serving the
  new code** (maintenance window OK per Nikolay).
- 628 KitCustody rows currently in production → roughly that many
  Custody children to be tagged.

---

## Prerequisites

- Local dev DB at the migration commit (`pnpm db:deploy-migration`
  applied, including the backfill `UPDATE`)
- Two team-member custodians for testing dual-custody scenarios:
  - **Alice** (a real User, e.g. yourself)
  - **Bob** (could be a non-user TeamMember or a second User)
- An asset model **"Pens"** marked QUANTITY_TRACKED with `quantity:
100` (start state)
- An asset **"Drill"** marked INDIVIDUAL (start state: AVAILABLE)
- A **kit "Camera Kit"** containing both Drill + Pens
- Permissions set so you can assign / release custody from the kit
  and from the asset overview pages
- A booking permission set up for regression tests in section 11

> Set `Pens.quantity = 100` at the start of testing. Each section
> notes the expected pool size so you can spot drift.

---

## 0. Baseline smoke

- [x] `pnpm webapp:dev` starts without runtime errors
- [x] `pnpm webapp:validate` is green (138 test files / 1925 tests)
- [x] Open the advanced asset index — it loads without duplicate
      rows or runtime errors (regression: assets without custody
      still render the empty cell)
- [x] Open Camera Kit detail page — loads with both Drill + Pens
      visible, no console errors
- [x] **Qty display (folded-in fix):** when Camera Kit is NOT in
      custody, the Pens row on the kit detail page shows
      `· 100 units` inline with the title (subtle gray suffix).
      Drill (INDIVIDUAL) shows the title only — no suffix. Once
      you assign Camera Kit's custody (later sections), the format
      switches to `· N / 100 units in kit` where N reflects the
      kit-allocated count.
- [x] Open Pens asset overview — loads, custody breakdown panel
      shows zero custody (start state)
- [x] Open the location detail page (whichever location Pens lives
      at) → the Pens row in the location's asset list shows
      `· 100 units` after the title. INDIVIDUAL rows unchanged.

---

## 1. Migration + backfill — verify pre-existing kit custody is tagged

**Goal:** confirm the migration's backfill UPDATE correctly tagged
old Custody rows. Critical for production because all 628 prod
KitCustody parents have child Custody rows that pre-date the
discriminator.

> ⚠️ **This section can only be meaningfully tested on a DB that
> had KitCustody rows _before_ the migration ran.** A fresh local
> dev DB usually has zero KitCustody parents at the time of
> `db:deploy-migration`, so the backfill UPDATE touches zero rows
> — vacuously "passing" without proving anything. Use one of the
> two paths below.

### Quick local check — is backfill validation even applicable?

Run this against your local DB before continuing:

```sql
SELECT
  (SELECT COUNT(*) FROM "Custody")::int                       AS total_custody,
  (SELECT COUNT(*) FROM "Custody" WHERE "kitCustodyId" IS NOT NULL)::int AS tagged_custody,
  (SELECT COUNT(*) FROM "KitCustody")::int                    AS kit_custody_parents;
```

- **`kit_custody_parents = 0`** → there's nothing for the backfill
  to act on locally. Skip path A; do path B against
  staging/prod snapshot. Confirm only the schema bits (column +
  FK + index exist; see the schema check below).
- **`kit_custody_parents > 0`** → continue with path A.

### Path A — Local DB had pre-existing KitCustody (rare on dev DBs)

- [x] Pick one KitCustody row that pre-dates the migration. Inspect
      its child Custody rows:
  ```sql
  SELECT c.id, c."teamMemberId", c."kitCustodyId", kc.id AS expected
  FROM "Custody" c
  JOIN "Asset" a ON c."assetId" = a.id
  JOIN "KitCustody" kc ON kc."kitId" = a."kitId"
  WHERE kc.id = '<kc.id>';
  ```
  All rows whose `c."teamMemberId" = kc."custodianId"` should now
  have `c."kitCustodyId" = kc.id`.
- [x] Re-run the global "misses" query (path C below). Should be 0.
- [x] Re-run the "mismatches" query. Should be 0.

### Path B — Production / staging snapshot (the load-bearing one)

The 628 prod KitCustody rows are the actual data this PR's backfill
exists for. Validate by:

1. Take a staging or read-only prod snapshot (or restore one to a
   throwaway DB).
2. Apply the migration there.
3. Run the same "misses" + "mismatches" + "operator stays NULL"
   queries (see path C). Verify all three are 0 / clean.

This is the gating test before we ship to prod. Local dev DB is not
a substitute.

### Path C — Schema-level verification (always applicable)

These queries don't depend on backfilled data and confirm the
migration's structural changes:

- [ ] **Column exists, nullable, text type:**
  ```sql
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'Custody' AND column_name = 'kitCustodyId';
  ```
  Expected: `text`, `is_nullable = 'YES'`.
- [ ] **FK exists with cascade:**
  ```sql
  SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
  WHERE conrelid = '"Custody"'::regclass
    AND conname = 'Custody_kitCustodyId_fkey';
  ```
  Expected: definition includes `ON UPDATE CASCADE ON DELETE CASCADE`.
- [ ] **Migration recorded:**
  ```sql
  SELECT migration_name, finished_at FROM "_prisma_migrations"
  WHERE migration_name = '20260430100759_add_kit_custody_id_to_custody';
  ```
- [ ] **No misses** (Custody rows whose asset is in a kit-with-
      KitCustody and tm matches kc.custodianId, but kitCustodyId
      is NULL):
  ```sql
  SELECT COUNT(*) FROM "Custody" c
  JOIN "Asset" a ON a.id = c."assetId"
  JOIN "KitCustody" kc ON kc."kitId" = a."kitId"
  WHERE c."kitCustodyId" IS NULL
    AND c."teamMemberId" = kc."custodianId";
  ```
  Expected: `0`.
- [ ] **No mismatches** (kitCustodyId set but parent's custodianId
      differs from row's teamMemberId — would mean the backfill
      tagged the wrong parent):
  ```sql
  SELECT COUNT(*) FROM "Custody" c
  JOIN "KitCustody" kc ON kc.id = c."kitCustodyId"
  WHERE c."teamMemberId" <> kc."custodianId";
  ```
  Expected: `0`.

### Operator-assigned rows MUST stay NULL

- [ ] Any Custody row whose asset is NOT in a kit (i.e.
      `Asset.kitId IS NULL`) → `kitCustodyId IS NULL` after
      migration.
- [ ] Any Custody row whose asset IS in a kit BUT the kit has no
      KitCustody (kit not in custody) → `kitCustodyId IS NULL`.

---

## 2. Issue A — Asset-index: one row per asset with all custodians

### Single-custodian (regression — must look identical to before)

- [x] Drill (INDIVIDUAL) is in custody to Alice. Open the advanced
      asset index. Drill row shows Alice's badge with no `(qty)`
      suffix, no `+N more` chip. **Single-custody rendering is
      unchanged.**
- [x] Asset without any custody → empty cell (regression).

### Multi-custodian qty-tracked (the bug fix)

- [x] Pens (QUANTITY_TRACKED, 100 total) — assign 4 units to Alice
      directly via the qty-custody route on the Pens overview page.
      Assign 7 units to Bob.
- [x] Open the advanced asset index. **Pens shows ONE row** (was
      duplicating before the fix).
- [x] The custody cell renders Alice's badge with `(4)` suffix +
      a `+1 more` chip.
- [x] Hover the `+1 more` chip → tooltip appears listing both
      custodians on separate lines:
  - `Alice (4)`
  - `Bob (7)`
- [x] The Pens row sort and filter behaviour is unchanged
      (regression: filter by category / location / status all still
      work; sort by title still works).

### Multi-custodian INDIVIDUAL (edge case — schema enforces 1, but

sanity check)

- [x] An INDIVIDUAL asset can only have one Custody row per
      custodian via `@@unique([assetId, teamMemberId])`. Confirm the
      column still renders correctly when only 1 entry exists.

### Asset index pagination + total counts unaffected

- [x] If the org has many assets, paginate through. Total count at
      the top of the index reflects assets, not Custody rows
      (was: inflated count due to duplicates).

---

## 3. Issue B — Quantity threading on kit→asset custody writes

### 3a. Adding a qty-tracked asset to a kit-in-custody (`updateKitAssets`)

- [x] Camera Kit currently NOT in custody. Pens is NOT in the kit.
- [x] Assign Camera Kit to Alice's custody (whole kit). Drill →
      `IN_CUSTODY`, single Custody row for Drill, `quantity: 1`,
      `kitCustodyId = <kc.id>`.
- [x] **Picker visibility (folded-in fix):** Open the kit's
      manage-assets picker (`/kits/<kitId>/assets/manage-assets`).
      The default URL filter is `?status=AVAILABLE`. Verify Pens
      appears in the picker even though Camera Kit is in custody
      (regression — pre-fix, `?status=AVAILABLE` excluded any
      qty-tracked row whose `Asset.status` had flipped). For this
      step, Pens may still be `AVAILABLE` because it's not yet in
      any kit; the more telling case is in section 4a where Pens
      already has operator custody yet should still appear.
- [x] Now add Pens to Camera Kit (manage assets on the kit).
- [x] **Expectation:** Pens has a NEW Custody row, `teamMemberId =
Alice`, `quantity = 100` (Pens has no operator custody, so Option
      B's remaining-pool subtraction doesn't reduce the count),
      `kitCustodyId = <kc.id>`. Pens.status → `IN_CUSTODY`.
- [x] (Pre-fix the row would have had `quantity: 1` — confirm new
      behaviour persists.)
- [x] Verify on the Pens overview page: custody breakdown shows
      Alice with 100 units.
- [x] **Qty display:** the kit detail page now shows
      `Pens · 100 / 100 units in kit` (kit-aware format, since
      Camera Kit is in custody).

### 3b. `bulkAssignKitCustody` — mixed-asset kit

- [x] Reset state: Camera Kit not in custody, Pens removed from
      Camera Kit. Add Drill + Pens to Camera Kit. Add a second
      kit "Drone Kit" with another INDIVIDUAL asset.
- [x] From the kits listing, multi-select Camera Kit + Drone Kit.
      Bulk-assign custody to Alice.
- [x] **Expectation:** Drill gets `quantity: 1, kitCustodyId =
<kcCamera.id>`. Pens gets `quantity: 100, kitCustodyId =
<kcCamera.id>`. Drone Kit asset gets `quantity: 1,
kitCustodyId = <kcDrone.id>`.
- [x] Each KitCustody row has the correct kit ↔ custodian linkage.

### 3c. Direct kit-custody route (`kits.$kitId.assets.assign-custody`)

- [x] Reset. Open Camera Kit detail page → "Assign custody" action.
- [x] Pick Bob as custodian, confirm.
- [x] **Expectation:** KitCustody row created with custodian = Bob.
      Per-asset Custody rows created with the right `quantity`
      (Drill: 1, Pens: 100) AND `kitCustodyId = <kc.id>`.
- [x] Pens overview shows Bob with 100 units in custody.

---

## 4. Issue C — Asset removal from in-custody kit preserves operator custody

**This is the headline correctness fix. Multiple combinations to
exercise.**

### 4a. Operator + kit custody on the same qty-tracked asset

- [x] Reset Pens to AVAILABLE (release any prior custody).
- [x] Step 1: Assign 4 units of Pens to Alice directly (qty-custody
      route on the Pens overview). Pens.status → `IN_CUSTODY`,
      Custody row: `Alice / 4 / kitCustodyId: NULL`.
- [x] Step 2: Pens is in Camera Kit. Assign Camera Kit's custody to
      Bob. Pens now has TWO Custody rows:
  - `Alice / 4 / kitCustodyId: NULL` (operator-assigned)
  - `Bob / 96 / kitCustodyId: <kcCamera.id>` (kit-allocated —
    **Option B: kit row claims `asset.quantity − operator-allocated`
    = 100 − 4 = 96**, not the full 100).
- [ ] Confirm the stored row matches: `Bob / 96 / kitCustodyId =
<kcCamera.id>`. Total in custody = 4 + 96 = 100 = `asset.quantity`,
      no over-allocation. If you see 100 instead of 96, the helper
      isn't subtracting — flag it.
- [x] **Kit detail page** shows `Pens · 96 / 100 units in kit`
      (kit-aware format reflects the kit-allocated 96, not the
      asset total).
- [x] **Pens overview page** shows the breakdown: Alice 4 (operator,
      no kit tag) + Bob 96 (kit-allocated).
- [x] **Advanced asset index** — Pens shows ONE row, tooltip lists
      `Alice (4)` and `Bob (96)`.
- [x] **Picker visibility (folded-in fix):** open another kit's
      manage-assets picker with `?status=AVAILABLE`. Pens should
      still appear (its row-level status is now IN_CUSTODY, but the
      AVAILABLE filter is qty-aware after the fix). Pre-fix this
      would have hidden Pens entirely. **The row will stay disabled
      (checkbox locked), and the count shows asset's total stock
      (e.g. `80 pcs`) rather than free units. Both are intentional
      — sharing a qty-tracked asset across kits requires the split
      mechanic (Phase 4). This step is "visibility only".**

### 4b. Remove asset from kit → operator custody survives

- [x] On Camera Kit detail page, remove Pens from the kit (X button
      or kit-asset removal action).
- [x] **Expectation:**
  - Pens still has `Alice / 4 / kitCustodyId: NULL` (operator row
    intact).
  - Pens does NOT have the `Bob / 96 / kitCustody.id` row anymore
    (kit-allocated row removed by the filtered deleteMany).
  - Pens.status stays `IN_CUSTODY` (Alice still holds 4 units).
- [x] Verify on Pens overview page: Alice shown, Bob gone.

### 4c. Remove last kit-allocated row, no operator custody → status flips

- [x] Reset Pens. Add Pens to Drone Kit. Assign Drone Kit to Bob.
      Pens has ONE Custody row, `Bob / 100 / kitCustody = kcDrone`.
- [x] Remove Pens from Drone Kit.
- [x] **Expectation:** Pens has zero Custody rows. Pens.status →
      `AVAILABLE`. (Old behaviour matched, but new code is now
      conditional rather than unconditional.)

### 4d. `bulkRemoveAssetsFromKits` — dual custody preserved

- [x] Setup: Pens in Camera Kit (in custody to Bob, 96 units — kit
      row reflects Option B's remaining-pool subtraction), Drill in
      Camera Kit (kit custody to Bob, 1 unit). Pens also has operator
      custody to Alice (4 units, NULL kitCustodyId).
- [x] Go to `/assets` (the asset index, **not** `/kits`). Multi-select
      Pens + Drill, open the bulk-actions dropdown, click
      **"Remove from kit"**. (`bulkRemoveAssetsFromKits` is wired only
      to the assets index — it removes each selected asset from
      whichever kit it's currently in. There is no equivalent action
      on the kits listing.)
- [x] **Expectation:** Pens row for Bob gone (kit-allocated), Pens
      row for Alice intact, Drill back to AVAILABLE (no operator
      custody, kit custody removed). Camera Kit still has KitCustody
      to Bob but contains 0 assets after the action.

---

## 5. Issue C continued — Releasing kit custody preserves operator custody

### 5a. `releaseCustody` (single kit) — emit-before-cascade

- [x] Setup: Pens has Alice / 4 / NULL (operator) + Bob / 96 / kc.id
      (Camera Kit kc, custodian Bob — Option B subtracts the 4
      already with Alice from the 100-unit pool). The kit's
      custodian must be Bob, not Alice — the unique constraint
      `@@unique([assetId, teamMemberId])` prevents one team member
      from holding both an operator and a kit row on the same asset.
- [x] Release Camera Kit's custody (whole-kit release).
- [x] **Expectation:**
  - `recordEvents("CUSTODY_RELEASED", …)` fires with rows that
    INCLUDE the kit-allocated Pens row (verify via Activity feed
    or DB query on `ActivityEvent` table).
  - The release events fire BEFORE the KitCustody row is deleted
    (order matters — captured in the bookings/asset activity
    feed).
  - KitCustody row deleted; FK cascade removes the Bob/Pens kit
    row.
  - Alice / Pens / 4 / NULL operator row INTACT.
  - Drill: was Bob/1/kc.id → cascade deletes it → Drill has 0
    Custody rows → status → `AVAILABLE`.
  - Pens stays `IN_CUSTODY` (Alice still holds 4 units).

### 5b. `bulkReleaseKitCustody` — same emit-before-cascade

- [x] Setup: Camera Kit + Drone Kit both in custody (Bob and Carol
      respectively). Drill is in Camera Kit; Pens is in Drone Kit;
      Pens additionally has operator custody to Alice.
- [x] From kits listing, bulk-select both kits, bulk-release
      custody.
- [x] **Expectation:** activity events fire for the kit-released
      assets, KitCustody rows for both kits deleted, FK cascades
      remove the kit-allocated Custody rows. Operator-assigned Pens
      row for Alice intact. Pens stays `IN_CUSTODY`. Drill status
      flips to `AVAILABLE`.

### 5c. Kit deletion (`deleteKit`)

- [ ] Setup: Camera Kit in custody to Bob, contains Drill + Pens
      (kit custody only — no operator custody on either).
- [ ] Delete Camera Kit.
- [ ] **Expectation:**
  - Activity events `CUSTODY_RELEASED` fire for Drill + Pens
    BEFORE Kit row deleted.
  - Kit row deleted → cascade through KitCustody → cascade through
    Custody. All custody rows for this kit's assets gone.
  - Drill + Pens status → `AVAILABLE`.

---

## 6. Asset status conditional flip — explicit edge cases

The new code only flips `Asset.status = AVAILABLE` when zero Custody
rows remain. Verify each branch.

### 6a. Asset with multiple operator custodies — kit removal doesn't touch status

- [ ] Pens has operator custody: `Alice / 30 / NULL` and `Bob / 20 /
NULL` (50 units assigned across two operators). Pens NOT in
      any kit. Pens.status = `IN_CUSTODY`.
- [ ] Add Pens to a fresh kit, assign that kit's custody to Carol.
      Now: 3 Custody rows on Pens (Alice op, Bob op, Carol kit).
- [ ] Release Carol from the kit. Carol's row gone (cascade).
      `Asset.quantity` stays as 50 in custody (30 + 20). Pens.status
      stays `IN_CUSTODY`.

### 6b. Asset fully operator-allocated, kit assigned — kit row skipped

- [ ] Pens: Alice / 100 / NULL only (full pool to Alice).
- [ ] Add Pens to a kit, assign kit to Bob.
- [ ] **Expectation (Option B's "skip when remaining ≤ 0" branch):**
  - Pens does NOT get a kit-allocated Custody row. Custody count
    stays at 1 (Alice's operator row only).
  - The kit's other assets (e.g. Drill INDIVIDUAL) DO get their
    kit-custody rows normally.
  - Total in custody on Pens = 100 = `asset.quantity`. No
    over-allocation.
  - Pens.status remains `IN_CUSTODY` (Alice still holds it). No
    activity event fires for Pens (since no kit-custody row was
    created); Drill's event still fires.
- [ ] Now release the kit's custody. Drill becomes AVAILABLE.
      Pens stays IN_CUSTODY (Alice's 100 untouched).

### 6c. Asset with only kit custody, kit released — status flips

- [ ] Drill: zero operator custody, in Camera Kit, kit in custody to
      Alice. Status `IN_CUSTODY`.
- [ ] Release kit. Drill custody count → 0. Status → `AVAILABLE`.

---

## 7. Activity events — kit-custody flows emit correctly

- [ ] Open the asset activity feed (or DB query
      `SELECT * FROM "ActivityEvent" WHERE "assetId" = '...'`).
- [ ] After 3a (adding Pens to Camera Kit which is in custody to
      Alice): event `CUSTODY_ASSIGNED`, `assetId = pens.id`,
      `teamMemberId = alice.id`, `meta.viaKit = true`,
      `meta.quantity = 100`.
- [ ] After 4b (remove Pens from kit): event `CUSTODY_RELEASED`,
      assetId = pens.id, teamMemberId = bob.id (kit custodian),
      meta.viaKit = true.
- [ ] After 5a / 5b (kit release): one `CUSTODY_RELEASED` event per
      kit-allocated Custody row removed.
- [ ] Events that come from the new flow have `viaKit: true` in
      meta; existing operator-assigned events do NOT (regression
      check — operator releaseCustody flow continues to emit
      without `viaKit`).

---

## 8. UI — `+N more` chip with tooltip on advanced asset index

### 8a. Tooltip content correctness

- [ ] Pens has 3 custodians: Alice (4), Bob (10), Carol (5).
- [ ] Open advanced asset index. Pens row → primary badge `Alice
(4)` + chip `+2 more`.
- [ ] Hover the chip — tooltip shows three lines:
  - `Alice (4)`
  - `Bob (10)`
  - `Carol (5)`
- [ ] Sort order in the tooltip matches DB order (typically by
      Custody.createdAt ASC). Acceptable as long as it's
      deterministic.

### 8b. `(qty)` suffix conditional

- [ ] Asset has 1 custodian with quantity = 1 → no `(1)` suffix.
- [ ] Asset has 1 custodian with quantity = 7 → suffix `(7)`.
- [ ] Tooltip lines suppress `(qty)` when quantity = 1 (consistent
      with primary).

### 8c. Tooltip accessibility

- [ ] Keyboard-focus the chip (tab) — tooltip appears.
- [ ] Esc / focus-out — tooltip dismisses.
- [ ] Screen reader: chip has accessible name like "+2 more
      custodians" (or whatever the implementation chose).

---

## 9. Regression — INDIVIDUAL asset flows untouched

### 9a. Standard custody assign/release

- [ ] Drill (INDIVIDUAL, AVAILABLE). Use the operator-assign-custody
      flow (asset overview → assign custody). Drill → IN_CUSTODY,
      one Custody row, `quantity: 1, kitCustodyId: NULL`.
- [ ] Use the operator-release-custody flow. Drill → AVAILABLE,
      Custody row gone.

### 9b. Kit with INDIVIDUAL assets only

- [ ] A kit containing only INDIVIDUAL assets. Assign + release kit
      custody. All inherit status correctly.

### 9c. Booking → checkout → checkin (regression)

- [ ] Create a booking with Drill + Pens. Reserve, check out. Both
      assets → CHECKED_OUT. (Custody rows for booking are separate;
      this exercises the booking-derived custody column branch in
      the asset index SQL.)
- [ ] Open the advanced asset index — Drill + Pens show their
      booking's custodian in the custody column (not the kit
      custodian, because they're checked out).
- [ ] Check the booking back in. Assets back to AVAILABLE.

---

## 10. Cascade behaviour — schema-level verification

### 10a. Manual `KitCustody.delete` triggers cascade

- [ ] Camera Kit has KitCustody. Pens has a Custody row with
      `kitCustodyId = kc.id`.
- [ ] Manually delete the KitCustody row via SQL:
      `DELETE FROM "KitCustody" WHERE id = '<kc.id>';`
- [ ] **Expectation:** the Pens Custody row with that kitCustodyId
      is gone (FK cascade fired). Operator-assigned rows on the
      same asset (kitCustodyId IS NULL) untouched.

### 10b. `Kit.delete` triggers double cascade (Kit → KitCustody →

Custody)

- [ ] Camera Kit + KitCustody + child Custody rows. Manually:
      `DELETE FROM "Kit" WHERE id = '<kit.id>';`
- [ ] All KitCustody rows for that kit gone. All child Custody rows
      with those kitCustodyIds gone.

---

## 11. Edge cases & data integrity

### 11a. `@@unique([assetId, teamMemberId])` interaction

- [ ] An asset cannot have TWO Custody rows for the same custodian.
      If you try to create a kit-allocated row for an asset that
      already has an operator-assigned row to the same person → DB
      throws `P2002` (unique violation). Verify the new code
      handles this gracefully (clear error message, no partial
      writes). Likely already handled by existing kit-custody
      assignment code; this is a regression check.

### 11b. Asset removed from kit while NOT in custody

- [ ] Camera Kit is NOT in custody. Remove Pens from the kit. No
      Custody rows existed for Pens via the kit, so nothing to
      delete. Pens.status stays whatever it was (AVAILABLE if no
      operator custody). No errors.

### 11c. Concurrent kit-custody operations

- [ ] (If feasible) Two browser tabs: one releases kit custody,
      other tries to add an asset to the same kit. Whichever wins
      the race; the loser sees an error or stale-state recovery.
      Standard concurrency check; nothing kit-specific should
      regress.

---

## 12. Browser-side / UI smoke for the column changes

- [ ] Asset index loads with custody column visible. No
      console errors related to `formatCustodyList`,
      `TooltipProvider`, or `TeamMemberBadge`.
- [ ] Resize the column / window → tooltip stays anchored to the
      chip.
- [ ] Dark mode (if the project has one) → custody column readable;
      tooltip background contrasts with content.

### 12a. Folded-in display fixes (qty visibility on lists + pickers)

- [ ] **Kit page asset list** (`/kits/:id`):
  - Kit NOT in custody: Pens row shows `· 100 units` (asset total).
  - Kit IN custody: Pens row shows `· N / 100 units in kit` where
    N is the kit-allocated count (e.g. `96 / 100 units in kit`
    when Pens has 4 already with an operator).
  - Drill (INDIVIDUAL) never shows a suffix.
  - Long titles don't wrap awkwardly.
- [ ] **Location asset list** (`/locations/:id`) — qty-tracked rows
      show `· N units` (asset total). Locations don't have custody,
      so the kit-aware variant doesn't apply here.
- [ ] **Manage-assets picker** for kits and locations — qty-tracked
      assets are visible when `?status=AVAILABLE` is applied, even
      after their `Asset.status` flips to `IN_CUSTODY`. Pre-fix
      they were excluded entirely. (Spot-check by: 1. Setting Pens to have any custody so its row.status is
      IN_CUSTODY. 2. Opening any kit's manage-assets picker. 3. Confirming Pens appears in the list.)
      **NOT in scope here:** selecting the row, or seeing free-unit
      count next to the title (e.g. `30 of 80 free`). The row stays
      disabled because of the existing `disabledBulkItems` guard,
      and even if it weren't, the current `Asset.kitId` single FK
      would move (not share) the asset. Both belong to the Phase 4
      split mechanic (Open Question #6). Test this step as
      "visibility only" and tick it once Pens appears in the list.
- [ ] **Strict status filters unchanged** — apply
      `?status=IN_CUSTODY` on the main asset list. Qty-tracked rows
      whose `Asset.status` actually = IN_CUSTODY appear; rows whose
      status is AVAILABLE don't. Apply `?status=CHECKED_OUT` —
      same pattern. Only `AVAILABLE` had its semantic widened to be
      qty-aware.
- [ ] **Add-to-kit scanner drawer** — scan a Pens QR. The asset row
      in the drawer shows `Pens · 100 units`. Drill shows just
      `Drill`. No regression on availability blockers.

---

## 13. Final checks before merging

- [ ] `pnpm webapp:validate` green
- [ ] `pnpm webapp:doctor` — no new react-doctor findings on the
      changed UI files (`advanced-asset-columns.tsx`,
      `custody-column.test.tsx`)
- [ ] No new TypeScript warnings from `tsc --noEmit`
- [ ] Migration applies cleanly on a fresh DB (`pnpm db:reset` then
      `pnpm db:deploy-migration`)
- [ ] Migration's backfill UPDATE applies cleanly on a snapshot of
      production data (test on staging if available)

---

## Out of scope (explicitly NOT covered)

- Reports module changes — quantity-specific reports are a separate
  follow-up PR per CLAUDE-CONTEXT.md.
- `bulkDeleteKits` activity-event emission — pre-existing gap;
  flagged in T2 agent's report. Filing as follow-up.
- New `ActivityAction` enum values — this PR uses existing
  `CUSTODY_ASSIGNED` / `CUSTODY_RELEASED` actions only (Strategy C
  from prior PR).
- Quantity backfill for kit-allocated Custody rows on legacy
  data — old INDIVIDUAL assets correctly default to `quantity: 1`,
  and qty-tracked assets are new in this PR so there's no legacy
  data to fix.
- **Splitting a qty-tracked asset across multiple kits / locations**
  (e.g. 10 Pens in Kit A, 20 in Kit B). Per PRD principle #3, the
  design is split-into-separate-records, gated on Open Question #6
  (in-flight bookings + custody + consumption-log attribution).
  Phase 4 work, separate PR with its own design pass.
  > Practical fallout for testers in this PR: in the manage-assets
  > picker, a qty-tracked asset that's already in another kit (or
  > has any custody) will _appear_ in the list (visibility fix
  > working) but the row stays **disabled** (existing guard) and the
  > count shows the asset's **total** stock (e.g. `80 pcs`) rather
  > than free units. Both are by design — sharing/splitting requires
  > Phase 4. Don't file these as bugs; tick the picker-visibility
  > step as soon as the asset appears.
- **Rebalancing kit allocation when assigning operator custody on a
  fully-allocated asset.** Today: if a qty-tracked asset has its
  full pool already kit-allocated (e.g. all 80 Pens are in Camera
  Kit's custody), the Assign button on the asset's Custody Breakdown
  is disabled (`noneAvailable` because free = 0). The user must
  release the kit's custody (or partially decrement it) to free up
  units before assigning operator custody. **Future Phase 4 feature:**
  re-enable Assign in this state, surface a confirmation that the
  assignment will pull units _from_ the kit's allocation, then have
  the service automatically decrement the kit's `Custody.quantity`
  and emit `CUSTODY_RELEASED` (kit) + `CUSTODY_ASSIGNED` (operator)
  in one transaction. Out of scope here because it's a new
  allocation-shuffling capability, not just UX polish — needs server
  logic, activity-event design, and edge-case handling
  (kit row hits 0 → delete vs keep). Today's workaround: release the
  kit, do the operator assignment, re-assign the kit (Option B's
  remaining-pool subtraction will produce the right kit quantity).
- **Re-balancing the kit row when operator custody changes _after_
  the kit was assigned.** Option B subtracts at assign time only.
  If a user later assigns operator custody on an asset that's
  already in a kit's custody, the kit row's quantity is **not**
  retroactively reduced. The Phase 2 operator-custody guards
  prevent over-allocation at write time (qty validations), so
  this isn't a data-integrity hazard, but the UX could be tighter.
  Tracked as a follow-up.

---

## Verification: post-merge in production

After deploy + maintenance window ends:

- [ ] Pick a known kit-in-custody from production (one of the 628).
      Verify on the kit detail page: assets show as IN_CUSTODY to
      the kit's custodian, custody column on advanced index shows
      that custodian.
- [ ] Release one such kit's custody. Verify all assets status
      flips correctly + activity events fire.
- [ ] Spot-check 5 random assets that are in kit custody — confirm
      their Custody rows have `kitCustodyId` populated.
