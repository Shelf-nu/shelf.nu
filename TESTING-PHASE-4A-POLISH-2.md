# Phase 4a-Polish-2 — Multi-Kit Allocation Enabler + Kit-Picker Qty UI

Per-phase verification flow. Phase 4a-Polish-2 turns the structural-only
`AssetKit` pivot from Phase 4a into a real allocation pivot: drops the
one-kit-per-asset constraint for QUANTITY_TRACKED, ships two DB triggers
(INDIVIDUAL guard + sum-within-total), refactors
`buildKitCustodyInheritData` to read `AssetKit.quantity`, and adds a
per-row qty input to the kit manage-assets picker with strict-available
MAX, multi-kit indicator, and in-custody cascade.

> **Highest-risk areas, watch closely:**
>
> 1. **DB triggers** — `enforce_individual_asset_single_kit` (BEFORE INSERT/UPDATE) and `enforce_asset_kit_sum_within_total` (DEFERRABLE INITIALLY DEFERRED CONSTRAINT). Wrong sum aggregation would corrupt allocations silently.
> 2. **`buildKitCustodyInheritData`** — now reads `AssetKit.quantity` instead of inferring "asset.quantity − operator custody". Strict-available picker MAX guarantees no over-allocation; the helper's residual cap (line 211) is a safety net only.
> 3. **`updateKitAssets` qty-edit cascade** — when a qty-tracked asset's quantity changes inside an in-custody kit, both `AssetKit.quantity` AND the kit-allocated `Custody.quantity` must shift atomically with a paired `CUSTODY_ASSIGNED`/`CUSTODY_RELEASED` event.
> 4. **Server-side strict-available re-check** — picker enforces MAX client-side; tampered submissions must be rejected with 400, not surface as a generic 500 from the DEFERRED constraint.
> 5. **Multi-kit qty-tracked** — same asset in two kits at distinct qtys. INDIVIDUAL stays single-kit (DB trigger guards).

## Prerequisites

- [x] Migration applied: `20260514100000_drop_asset_kit_unique_add_triggers`. Verify via `SELECT * FROM _prisma_migrations WHERE migration_name LIKE '%drop_asset_kit_unique%';`
- [x] `pnpm webapp:validate` green (typecheck + lint + 2177 tests).
- [x] Dev/staging server running.
- [x] Workspace with realistic data:
  - [x] One INDIVIDUAL asset NOT in any kit
  - [x] One QUANTITY_TRACKED asset NOT in any kit (e.g. Pens, quantity=100)
  - [x] One kit (Kit A) holding the QUANTITY_TRACKED asset
  - [x] One kit (Kit B) empty, ready to receive
  - [x] One kit currently in custody to a team member
  - [x] One operator-allocated Custody row on the qty-tracked asset (10–20 units)
  - [x] One ongoing booking holding 5–10 units of the qty-tracked asset
- [x] Browser console open for runtime errors.
- [x] Network tab open to inspect responses on rejection cases.

---

## §0 Schema + trigger verification (MCP / SQL)

Run via supabase-local MCP or psql. Expected outcomes are documented inline.

- [x] **Unique index dropped:**

  ```sql
  SELECT indexname FROM pg_indexes
  WHERE tablename = 'AssetKit' AND indexname = 'AssetKit_assetId_key';
  ```

  Expected: zero rows.

- [x] **Triggers exist:**

  ```sql
  SELECT trigger_name, event_manipulation, action_timing
  FROM information_schema.triggers
  WHERE event_object_table = 'AssetKit'
  ORDER BY trigger_name;
  ```

  Expected: rows for `asset_kit_individual_single_row` (BEFORE INSERT/UPDATE) and `asset_kit_sum_within_total` (AFTER INSERT/UPDATE/DELETE).

- [x] **Backfill correct:** for every QUANTITY_TRACKED asset with one pivot row, `AssetKit.quantity = Asset.quantity`:

  ```sql
  SELECT ak.id, ak."assetId", ak.quantity AS ak_qty, a.quantity AS asset_qty, a.type
  FROM "AssetKit" ak
  JOIN "Asset" a ON a.id = ak."assetId"
  WHERE a.type = 'QUANTITY_TRACKED' AND ak.quantity <> a.quantity
  LIMIT 20;
  ```

  Expected: zero rows.

- [x] **INDIVIDUAL trigger rejects multi-kit:**

  ```sql
  BEGIN;
  -- Try to insert a 2nd AssetKit row for an INDIVIDUAL asset. Replace IDs.
  INSERT INTO "AssetKit" (id, "assetId", "kitId", "organizationId", "createdAt", "updatedAt", quantity)
  VALUES ('test-violation', '<individual_asset_id>', '<different_kit_id>', '<org>', NOW(), NOW(), 1);
  ROLLBACK;
  ```

  Expected: `ERROR: INDIVIDUAL asset … already linked to a kit` with `ERRCODE = 'check_violation'`.

- [x] **Sum-within-total trigger rejects over-allocation at COMMIT:**

  ```sql
  BEGIN;
  -- Replace IDs with a qty-tracked asset whose Asset.quantity = 100
  -- and whose current sum(AssetKit.quantity) = 60. Try to insert a
  -- new pivot row with quantity = 50 → total would be 110.
  INSERT INTO "AssetKit" (id, "assetId", "kitId", "organizationId", "createdAt", "updatedAt", quantity)
  VALUES ('test-over', '<qty_asset_id>', '<empty_kit_id>', '<org>', NOW(), NOW(), 50);
  COMMIT;
  ```

  Expected: `ERROR: AssetKit total 110 exceeds Asset.quantity 100 …` at COMMIT.

- [x] **DEFERRED check allows mid-tx overshoot:**

  ```sql
  BEGIN;
  -- Same asset, current sum = 60. Move 30 from Kit A to Kit B in a single tx.
  UPDATE "AssetKit" SET quantity = 90 WHERE "assetId" = '<qty_asset_id>' AND "kitId" = '<kit_a>';
  -- Mid-tx sum = 90 (transiently 90 > 60, fine).
  UPDATE "AssetKit" SET quantity = 10 WHERE "assetId" = '<qty_asset_id>' AND "kitId" = '<kit_a>';
  COMMIT;
  ```

  Expected: commit succeeds even though the first UPDATE momentarily had sum > Asset.quantity.

---

## §1 Picker UI — empty kit + new add (happy path)

- [x] Open Kit B (empty). Click **Manage assets**.
- [x] Verify the qty-tracked asset (Pens) shows in the list with Status badge = "Available" (forced AVAILABLE for qty-tracked rows even if status is otherwise).
- [x] Click Pens to select. **Verify** the qty input appears with:
  - [x] Pre-filled value = strict-available MAX (Asset.quantity − operator custody − ongoing bookings = e.g. 100 − 10 − 5 = 85)
  - [x] `/ max` suffix matches that value
  - [x] No "Also in" indicator (Pens isn't in any other kit yet)
- [x] Change qty to 30. Click **Confirm**.
- [x] Verify the dialog opens with **no** "Quantity change notice" yellow box (kit not in custody, no existing pens).
- [x] Confirm. Redirected to Kit B's asset list.
- [x] DB check:
  ```sql
  SELECT * FROM "AssetKit" WHERE "kitId" = '<kit_b_id>' AND "assetId" = '<pens_id>';
  ```
  Expected: one row, `quantity = 30`.

## §2 Picker UI — existing-in-kit qty edit (kit NOT in custody)

- [x] Open Kit A (already holds Pens at 60). Click **Manage assets**.
- [x] **Verify** Pens row pre-fills with qty = 60.
- [x] **Verify** MAX = Asset.quantity − other kits − operator − bookings = e.g. 100 − 30 (Kit B from §1) − 10 (operator) − 5 (booking) = 55. **But** because currentInThisKit = 60 > spaceWithoutMe = 55, MAX = max(60, 55) = 60.
- [x] Change qty to 50. **Verify** "was 60" mini-badge appears below the input.
- [x] **Confirm**. Verify the dialog opens with **no** in-custody warning (kit not in custody).
- [x] Confirm. Redirected.
- [x] DB:
  ```sql
  SELECT quantity FROM "AssetKit" WHERE "kitId" = '<kit_a>' AND "assetId" = '<pens>';
  ```
  Expected: `50`.
- [ ] No `Custody` row mutations (kit not in custody).

## §3 Picker UI — deselect existing qty-tracked

- [x] Open Kit A. Pens currently at 50.
- [x] Click Pens to deselect. **Verify** the qty input disappears.
- [x] Confirm.
- [x] DB:
  ```sql
  SELECT * FROM "AssetKit" WHERE "kitId" = '<kit_a>' AND "assetId" = '<pens>';
  ```
  Expected: zero rows.

## §4 Picker UI — multi-kit allocation

(After §1 + §2 + §3, re-seed: re-add Pens to Kit A at 60.)

- [x] Open Kit B. Click **Manage assets**.
- [x] **Verify** Pens row shows "Also in: Kit A (60)" subtitle below the asset title.
- [x] **Verify** MAX = Asset.quantity − Kit A − operator − bookings = 100 − 60 − 10 − 5 = 25.
- [x] Change qty to 25. Confirm.
- [x] DB:
  ```sql
  SELECT "kitId", quantity FROM "AssetKit" WHERE "assetId" = '<pens>';
  ```
  Expected: two rows — Kit A: 60, Kit B: 25. sum = 85 ≤ Asset.quantity (100). ✓

## §5 Picker UI — INDIVIDUAL stays single-kit

- [ ] Place Drill (INDIVIDUAL) in Kit A.
- [ ] Open Kit B. Click **Manage assets**.
- [ ] **Verify** Drill is selectable but with the usual "in other kit" treatment (it gets removed from Kit A on cross-kit move).
- [ ] Select Drill. **No qty input** appears (INDIVIDUAL).
- [ ] Confirm. Drill moves from Kit A to Kit B.
- [ ] DB:
  ```sql
  SELECT "kitId" FROM "AssetKit" WHERE "assetId" = '<drill>';
  ```
  Expected: one row, `kitId = <kit_b>`.

## §6 Picker UI — in-custody kit qty edit (cascade + info-box)

(Prerequisite: Kit A is in custody to Bob. AssetKit row for Pens in Kit A at 60. Bob's Custody row for Pens at 60 with `kitCustodyId` pointing to Kit A's KitCustody.)

- [ ] Open Kit A's manage-assets. Pens shows qty input at 60.
- [ ] Change qty to 80.
- [ ] **Verify** "was 60" mini-badge appears.
- [ ] Click **Confirm**. **Verify** the dialog now shows a yellow **"Quantity change notice"** box stating "You changed the quantity for 1 asset already in this kit. The custodian's allocation will be adjusted by the same amount when you confirm."
- [ ] Confirm. Redirect.
- [ ] DB:
  ```sql
  SELECT quantity FROM "AssetKit" WHERE "kitId" = '<kit_a>' AND "assetId" = '<pens>';
  SELECT quantity, "kitCustodyId" FROM "Custody"
    WHERE "assetId" = '<pens>' AND "kitCustodyId" = '<kit_a_custody_id>';
  ```
  Expected: `AssetKit.quantity = 80`, `Custody.quantity = 80`.
- [ ] Activity events:
  ```sql
  SELECT action, meta FROM "ActivityEvent"
    WHERE "assetId" = '<pens>' ORDER BY "createdAt" DESC LIMIT 5;
  ```
  Expected: one `CUSTODY_ASSIGNED` row with `meta -> 'viaKit' = true` and `meta -> 'quantity' = 20`.

## §7 Picker UI — in-custody kit qty decrease

- [ ] Same setup. Pens AssetKit = 80, Bob's Custody = 80.
- [ ] Open picker, change qty to 50. Confirm. (Info-box should appear.)
- [ ] DB: `AssetKit.quantity = 50`, `Custody.quantity = 50`.
- [ ] Activity event: one `CUSTODY_RELEASED` with `meta.viaKit = true` and `meta.quantity = 30`.

## §8 Picker UI — in-custody kit deselect

- [ ] Same setup. Pens AssetKit = 50, Bob's Custody = 50.
- [ ] Deselect Pens. Confirm.
- [ ] DB:
  ```sql
  SELECT * FROM "AssetKit" WHERE "kitId" = '<kit_a>' AND "assetId" = '<pens>';
  SELECT * FROM "Custody"
    WHERE "assetId" = '<pens>' AND "kitCustodyId" = '<kit_a_custody_id>';
  ```
  Expected: zero rows in both.
- [ ] Activity: `CUSTODY_RELEASED` with `meta.viaKit = true`, full 50.

## §9 Picker MAX cap — input bounds & strict-available math

- [ ] Reset: Pens AssetKit-Kit-A = 60, operator Pleb has 20 units, ongoing booking has 5 units.
- [ ] Open Kit B picker. Select Pens.
- [ ] **Verify** MAX = 100 − 60 − 20 − 5 = 15.
- [ ] Try to type **100** in the input. **Verify** the value caps to 15 on blur or change.
- [ ] Confirm with qty = 15. Verify AssetKit Kit B = 15.

## §10 Server-side strict-available validation

- [ ] Reset to a known state: Pens AssetKit-Kit-A = 60, operator 20, booking 5 → MAX for Kit B = 15.
- [ ] In the network tab, intercept the form POST to `/kits/<kit-b>/assets/manage-assets` and modify the `assetQuantities` JSON to `{"<pens-id>": 99}` before sending.
- [ ] **Verify** response: HTTP 400 with the error message **"Quantity exceeds available pool"** containing detail like `Pens (requested 99, max 15)`.
- [ ] No AssetKit row created. DB unchanged.

(Easier alternative: temporarily set the input `max` attribute to something larger via DevTools, then submit a too-large value.)

## §11 DB CONSTRAINT TRIGGER — safety net (rare path)

The picker + server-side validation should prevent reaching this. Test only to confirm the safety net works.

- [ ] In SQL, simulate the picker bypass: a tx that inserts a pivot row exceeding the asset pool.
- [ ] Expected: `ERROR: AssetKit total … exceeds Asset.quantity …` at COMMIT.

## §12 Overcommitted edge case

Theoretical edge: kit holds X units, but independent operator/booking growth pushed the strict-available pool below X. Picker should still let the user keep or reduce.

- [ ] Place Pens in Kit A at AssetKit.quantity = 80.
- [ ] Manually create operator Custody for Pens at 30 (bypassing the picker via SQL or another flow). Now AssetKit (80) + operator (30) = 110 > Asset.quantity (100). Real-world creation paths shouldn't allow this, but if you've reached this state somehow:
- [ ] Open Kit A picker. Pens shows qty = 80. MAX = max(80, 100 − 0 − 30 − 0) = max(80, 70) = 80.
- [ ] User can reduce to any value ≤ 80, but not grow.
- [ ] Submit qty = 70 → succeeds.

## §13 Cross-kit move INDIVIDUAL

- [ ] Drill (INDIVIDUAL) in Kit A.
- [ ] Open Kit B picker. Select Drill. **Verify** no qty input.
- [ ] Submit. Drill moves to Kit B. (One AssetKit row, kitId = B.)
- [ ] Try to add Drill to Kit C via SQL `INSERT` — DB trigger rejects with `check_violation`.

## §14 Pre-existing flows — regression check

Verify nothing broke in unchanged behaviour:

- [ ] Add a single INDIVIDUAL asset to an empty kit. Confirm AssetKit row created (qty=1).
- [ ] Remove an INDIVIDUAL asset from a kit. Confirm AssetKit row deleted.
- [ ] Assign kit custody to a member. Confirm `buildKitCustodyInheritData` creates Custody rows with `kitCustodyId` and correct quantities (qty from AssetKit.quantity for qty-tracked, 1 for INDIVIDUAL).
- [ ] Release kit custody. Confirm Custody rows for `kitCustodyId = …` are deleted.
- [ ] Kit location cascade — adding assets to a kit with a location updates the assets' location.
- [ ] Bulk delete kit. No orphan AssetKit rows.

## §15 Activity events sanity

- [ ] After all the above, query:
  ```sql
  SELECT action, COUNT(*) FROM "ActivityEvent"
    WHERE "createdAt" > NOW() - INTERVAL '1 hour'
    GROUP BY action ORDER BY action;
  ```
  Expected categories: `ASSET_KIT_CHANGED` (adds/removes), `CUSTODY_ASSIGNED` (kit-in-custody qty increase or new add), `CUSTODY_RELEASED` (qty decrease or deselect inside in-custody kit).
- [ ] **Negative:** no `ASSET_KIT_QUANTITY_CHANGED` events (decision baked into the plan: rely on note text + paired custody events for now).

---

## Sign-off

- [ ] All §0 SQL checks pass on dev.
- [ ] §1–§9 happy paths pass on the UI.
- [ ] §10 (tampered request) returns clean 400.
- [ ] §11 (constraint trigger safety net) verified.
- [ ] §12 (overcommitted edge case) handled.
- [ ] §13 (INDIVIDUAL single-kit rule) enforced both UI + DB.
- [ ] §14 (regression checks) all pass.
- [ ] §15 (activity events) match expectations.

If all checks pass: ready to commit. Bundle into a single conventional-commit PR titled e.g. `feat(kits): multi-kit allocation + per-row qty input (Phase 4a-Polish-2)`.
