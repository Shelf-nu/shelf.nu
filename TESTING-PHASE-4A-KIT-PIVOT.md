# Phase 4a — Kit Pivot: Manual Testing Checklist

Per-phase verification flow referenced from `RELEASE-CHECKLIST.md`
(§T-1h snapshot dry-run, §T-0 smoke test, §T+15m post-deploy walk).
The numbered sections `§0`–`§11` below are the anchor points the deploy
runbook calls out by reference.

Structural-only change: every existing asset gets exactly one
`AssetKit` row; a `@@unique([assetId])` constraint preserves the "at
most one kit per asset" invariant. The pivot's `quantity` defaults to
1 and stays at 1 in this phase. Quantity-aware behaviour (multi-kit
allocation, sum-within-total triggers) lands in a follow-up sub-phase.

The change should be **observable-equivalent** for end users — the
goal is to verify no regression on the kit-membership and kit-custody
flows shipped through Phase 3d-Polish-2.

> **Highest-risk areas, watch closely:**
>
> 1. **`updateKitAssets`** — the connect/disconnect block was rewritten as direct `AssetKit` upserts/deletes inside a `$transaction`. Add/remove flows + the kit-aware location cascade must still fire correctly.
> 2. **`bulkAssignKitCustody`** — the asset-via-kit traversal now flattens the pivot rows. Kit-custody Option B math (Phase 3d-Polish-2) still computes the remaining-pool quantity per asset.
> 3. **Raw SQL kit filter** (`asset/query.server.ts`) — rewritten to join through `AssetKit`. Filter behaviour on the asset index must be identical pre/post-migration.

## Prerequisites

- [x] Migration applied (T-0 confirmed; `_prisma_migrations` has the row).
- [x] `pnpm webapp:validate` green — typecheck + lint + tests all pass after the refactor.
- [x] Dev/staging server running so you can re-hit any failing flow.
- [x] Workspace with realistic data — at least 1 kit with 2+ assets, 1 kit in custody, 1 kit available, 1 asset not in any kit.
- [x] Browser console open for runtime errors.

## §0 Schema + backfill verification

Local dev DB verified via supabase-local MCP on 2026-05-12. Two checks
require a staging/prod snapshot with `Asset.kitId` restored — those
stay open under "Snapshot-only" below.

- [x] `AssetKit` table exists with the right columns:

  ```sql
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'AssetKit';
  ```

  Expected: `id text`, `assetId text`, `kitId text`, `organizationId text`, `quantity integer`, `createdAt timestamp`, `updatedAt timestamp`.
  Got: ✅ all 7 columns in the right shape.

- [x] No orphans:

  ```sql
  SELECT count(*) FROM "AssetKit" ak
  LEFT JOIN "Asset" a ON ak."assetId" = a.id
  WHERE a.id IS NULL;
  ```

  Expected 0. Got 0. ✅
  Bonus kit-side check: same query against `Kit` also returns 0 ✅.

- [x] FK enforcement (cascade) on all three FKs:

  ```sql
  SELECT constraint_name, delete_rule
  FROM information_schema.referential_constraints
  WHERE constraint_name LIKE 'AssetKit_%_fkey';
  ```

  Expected `CASCADE` on `assetId`, `kitId`, `organizationId`.
  Got: ✅ all three are `ON UPDATE CASCADE` + `ON DELETE CASCADE`.

- [x] Unique constraint functional — duplicate `assetId` insert rejected:

  ```sql
  INSERT INTO "AssetKit" ("id", "assetId", "kitId", "organizationId", "quantity", "createdAt", "updatedAt")
  VALUES ('test-dup', '<existing assetId>', '<some other kitId>', '<org>', 1, now(), now());
  ```

  Expected: violation on `AssetKit_assetId_key`. Got: ✅ rejected with
  `duplicate key value violates unique constraint "AssetKit_assetId_key"`; follow-up
  `SELECT count(*) FROM "AssetKit" WHERE id = 'test-dup'` returns 0.

- [x] RLS enabled:

  ```sql
  SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'AssetKit';
  ```

  Expected `relrowsecurity = t`. Got `t`. ✅

- [x] Indexes present (bonus):
  ```sql
  SELECT indexname FROM pg_indexes WHERE tablename = 'AssetKit';
  ```
  Got: ✅ `AssetKit_pkey`, `AssetKit_assetId_key` (unique),
  `AssetKit_assetId_kitId_key` (unique composite), `AssetKit_kitId_idx`,
  `AssetKit_organizationId_idx`.

**Snapshot-only (re-run before prod deploy)** — these need
`Asset.kitId` restored on a staging/prod snapshot, since the migration
already dropped the column:

- [ ] Backfill row count equals the pre-migration baseline of
      `Asset.kitId IS NOT NULL`:

  ```sql
  -- Pre-migration baseline captured at T-4h.
  -- Post-migration:
  SELECT count(*) FROM "AssetKit";
  -- Must match the baseline exactly.
  ```

  Local dev: `count = 5` (no baseline preserved; trust the developer
  who ran the migration). Production: validate against the T-4h
  snapshot count.

- [ ] Per-row match — every pre-migration `Asset.kitId` produced a
      corresponding `AssetKit` row (run on a snapshot copy where you can
      temporarily restore `Asset.kitId`):

  ```sql
  SELECT a.id AS asset_id, a."kitId" AS legacy_kit
  FROM "Asset" a
  WHERE a."kitId" IS NOT NULL
  EXCEPT
  SELECT ak."assetId", ak."kitId" FROM "AssetKit" ak;
  -- Expect 0 rows.
  ```

## §1 Kit detail page — read paths

- [x] Navigate to `/kits/<kitId>` for a kit with multiple assets.
- [x] Asset list renders all the kit's assets (verify count matches `SELECT count(*) FROM "AssetKit" WHERE "kitId" = '<kitId>'`).
- [x] Asset status badges and qty display (where applicable) render identically to pre-migration.
- [x] Click an asset → asset detail page loads; "Included in kit" card shows the kit name and links back correctly.
- [x] Kit detail page sub-tabs (assets, overview, bookings) all load without error.

## §2 Adding assets to a kit (`updateKitAssets` core path)

- [x] Go to `/kits/<kitId>/assets/manage-assets`. Pick 2-3 AVAILABLE assets that aren't currently in any kit. Click Save.
- [x] DB verification:
  ```sql
  SELECT * FROM "AssetKit" WHERE "kitId" = '<kitId>' AND "assetId" IN ('<a1>', '<a2>', '<a3>');
  ```
  Expect 3 rows, one per selected asset, all with `quantity = 1`.
  Got (Camera Kit, 4 assets): ✅ 4 rows, all `kitId = cmor5xj0t000gulal08v1nexc`,
  all `quantity = 1`, identical `createdAt` (single tx).
- [x] UI verification: kit detail page now shows the 3 added assets.
- [x] Activity feed shows one `ASSET_KIT_CHANGED` event per asset with `field: "kitId"`, `fromValue: null`, `toValue: <kitId>`.
      Got: ✅ 4 × `ASSET_KIT_CHANGED` (`field: kitId`, `fromValue: null`,
      `toValue: cmor5xj0t000gulal08v1nexc`), one per added asset.

### Edge — moving an asset between kits

- [x] Pick an asset already in Kit A. Go to Kit B's manage-assets picker and select that asset.
- [x] Save. Expectation: only ONE `AssetKit` row exists for that asset, now pointing at Kit B (the `@@unique([assetId])` constraint enforces this).
- [x] Activity event: `ASSET_KIT_CHANGED` with `fromValue: <kitA>`, `toValue: <kitB>`.

### Edge — location cascade

- [x] Kit B has a location set. Add an asset (currently at a different location) to Kit B.
- [x] Asset's `Asset.locationId` should auto-update to Kit B's location. Verify in DB and on the asset detail page.

### Edge — qty-tracked asset with partial operator custody is selectable

Phase 4a-Polish follow-up. Mirrors the manage-assets picker filter
fix from Phase 3d-Polish-2 (`asset/service.server.ts:638`) and the
kit ActionsDropdown guard fix later in this same release. Three
client-side guards in the kit picker (the `setDisabledBulkItems`
effect, the `<List navigate>` handler, and the `RowComponent`'s
`allowCursor` / "In custody" badge) used to treat any non-AVAILABLE
asset as a blocker. For QUANTITY*TRACKED rows, row-level status
flips to IN_CUSTODY as soon as \_any* units are operator-allocated;
Option B math (`buildKitCustodyInheritData`) handles the remaining
pool on assign. The guards now skip qty-tracked entirely.

- [x] Pick a qty-tracked asset (e.g. Pens qty 100) and assign **5
      units** to a team member from the asset detail page. `Pens.status`
      should now be `IN_CUSTODY` even though 95 units are still free.
- [x] Navigate to a kit's `/kits/<kitId>/assets/manage-assets`.
- [x] The Pens row in the picker should:
  - Be clickable (no `cursor-not-allowed`).
  - Not be disabled / greyed-out.
  - Not render the orange "In custody" badge.
  - **Render the green "Available" badge** — qty-tracked rows in the
    picker pass through `AssetStatusBadge` with status forced to
    `AVAILABLE` so the badge matches the row's actual selectability
    even when row-level `Asset.status` is `IN_CUSTODY` from partial
    allocation. Without this the row would render _no_ badge at all
    (regression caught in initial 4a-Polish testing).
- [x] Select Pens and Save. `AssetKit` row created with `quantity = 1`
      (Phase 4a invariant — qty stays 1 until the post-4b polish
      ships multi-kit allocation).
- [x] Verify on DB:
  ```sql
  SELECT ak.id, ak.quantity, c."teamMemberId", c.quantity AS custody_qty,
         c."kitCustodyId"
  FROM "AssetKit" ak
  LEFT JOIN "Custody" c ON c."assetId" = ak."assetId"
  WHERE ak."assetId" = '<pens-asset-id>';
  ```
  Expect 1 `AssetKit` row + the pre-existing operator Custody row
  (5 units, `kitCustodyId = NULL`) preserved.

## §3 Removing assets from a kit (`updateKitAssets` removal path)

- [x] Go to a kit's manage-assets picker. Deselect 2 assets currently in the kit. Save.
- [x] DB: the corresponding `AssetKit` rows are gone.
- [x] UI: the assets no longer appear in the kit's asset list.
- [x] Activity events: `ASSET_KIT_CHANGED` with `fromValue: <kitId>`, `toValue: null` per removed asset.

## §4 `bulkRemoveAssetsFromKits` (assets index → bulk action)

- [x] Go to the assets index, multi-select 2-3 assets that ARE in a kit. Click bulk-actions → "Remove from kit".
- [x] DB: pivot rows for those assets are gone.
- [x] UI: assets' "Included in kit" card disappears on the asset detail page.

## §5 Kit custody — Phase 3d-Polish-2 invariants (regression)

The kit-custody logic should be unaffected by the pivot — the
quantity-aware computation in `buildKitCustodyInheritData` still reads
`Asset.quantity` and existing `Custody` rows, not `AssetKit`.

### §5a Assign a kit's custody — Option B math intact

- [x] Kit with 2 qty-tracked assets (Pens qty 100, Drill qty 50) and one operator pre-allocated (Alice / Pens / 4).
- [x] Assign kit custody to Bob.
- [x] Expected `Custody` rows for the kit: Pens / Bob / 96 / `kitCustodyId` set (Option B: 100 − 4 = 96); Drill / Bob / 50 / `kitCustodyId` set.
      Got on Camera Kit (Pens qty 80, AA batteries qty 460, Dell Latitude
      #4 individual; 4 Pens pre-allocated to Mr. Pleb Plebsson) →
      kit-custody `cmp40a67c001pulll0htd99tp` to Self Service: ✅ Pens / 76
      (80 − 4), AA batteries / 460, Dell Latitude #4 / 1 — all three tagged
      with the correct `kitCustodyId` + the kit custodian's `teamMemberId`.
      Option B formula intact.
- [x] Alice's operator row (4 units) survives.
      Got: ✅ Mr. Pleb Plebsson's Pens / 4 row preserved with
      `kitCustodyId = NULL` (operator-origin).

### §5b Release kit custody

- [x] Release the kit's custody from §5a.
- [x] Pens kit-allocated row gone (cascade); Alice's operator row preserved.
- [x] Drill kit-allocated row gone; Drill status flips to AVAILABLE.

### §5c Delete a kit while in custody

- [x] Re-assign kit custody (set up like §5a).
- [x] Delete the kit from the kits listing.
- [x] `AssetKit` rows cascade-deleted; kit-allocated Custody rows cascade-deleted; Alice's operator custody on Pens preserved.
- [x] Activity events: `CUSTODY_RELEASED` per kit-allocated row with `meta.viaKit: true, viaKitDelete: true`.

## §6 Bulk kit-custody operations

- [x] Kits index → bulk-select kits → "Assign custody" to a team member. Verify all kits' assets receive the right inherited Custody rows.
- [x] Bulk-release kit custody. Verify cleanup matches §5b across all kits.

## §7 Booking flows — regression check

- [x] Create a booking that includes assets currently in a kit. Verify the kit grouping in the booking overview renders correctly.
- [x] Check out, check in. Verify no errors.
- [x] Booking PDF (if exposed) — assets grouped by kit still group correctly.

### Edge — qty-tracked partial-custody asset does not block its kit

Phase 4a-Polish follow-up. `getKitAvailabilityStatus` in
`apps/webapp/app/components/booking/availability-label.tsx` flagged a
kit as "in custody" if any constituent asset had any Custody row. For
QUANTITY_TRACKED assets this is wrong — partial operator allocation
(e.g. Pleb holds 4 of 80 Pens) leaves the rest of the pool free, and
the kit overall is still bookable. The guard now skips qty-tracked
custody rows. Only INDIVIDUAL custody escalates to kit-level.

- [x] Pick a kit that contains at least one qty-tracked asset (e.g.
      Pens qty 80, 4 units pre-allocated to a team member).
- [x] Verify on the booking overview > Manage Kits picker:
  - The kit appears in the list (not filtered out).
  - The kit is **clickable / selectable** (not in the disabled list).
  - The kit's status badge is the normal status (Available), not
    the orange "In custody" badge.
- [x] Cross-check: a kit containing an INDIVIDUAL asset that's in
      custody to a team member should still show "In custody" and be
      disabled — INDIVIDUAL custody means the physical item is
      genuinely unavailable.
- [x] Add the qty-tracked kit to the booking. Save. Confirm the
      `BookingKit` (or its equivalent on the booking's kit grouping)
      row appears in the booking overview.

## §8 Asset index — kit filter (raw SQL rewrite)

- [x] Asset index → filter by "Kit: \<some kit name>". Verify only assets in that kit appear.
- [x] Filter by "Kit: Without kit". Verify only assets NOT in any kit appear.
- [x] Multi-kit filter (if exposed in advanced index) — pick 2 kits, verify union of their assets appears.
- [x] Sort by kit (if exposed) — verify ordering matches pre-migration.

## §9 Mobile API back-compat

Verified via curl against the local dev server on 2026-05-13, using a
Supabase JWT obtained from `http://127.0.0.1:54321` and the org-scoped
`orgId` query param.

- [x] Call `/api/mobile/bookings/<bookingId>` against a booking with assets in kits.
      Got: ✅ booking `cmp43k7f0006vulll9f5p773u` (5 assets, all in
      Camera kit) returns 200 with the booking payload + `assets`
      array.
- [x] Response shape: each asset still has singular `kit: { id, name }` and `kitId: string` fields (synthesised from the primary `AssetKit` row).
      Got: ✅ all 5 in-kit assets have `kit: { id, name }` populated
      (Camera kit), `kitId` matches `kit.id`. No `assetKits` array
      leaks into the response (the route strips it at
      `bookings.$bookingId.ts:111-119`).
- [x] Asset NOT in any kit: `kit: null`, `kitId: null` (unchanged).
      Got: ✅ booking `cmo8rc4fu003aulpa6ielz0wk` (mixed: 2 non-kit +
      1 kit) — the two non-kit Dells render `kit: null`,
      `kitId: null`; the third Dell (in Camera kit) renders the
      singular kit object as above.

## §10 Scanner drawer flows (regression)

- [x] Scan an asset that's in a kit. Drawer renders kit chip correctly.
- [x] Add-to-booking scanner drawer renders the asset's kit name.
- [x] Bulk-assign-custody scanner — select via QR an asset that's in a kit. Drawer surfaces the kit's name in the row metadata.

## §11 Final gate

- [x] `pnpm webapp:validate` green.
- [x] `pnpm webapp:doctor` — no new react-doctor findings.
- [x] Browser console clean across all the flows above.
- [x] Server console (`pnpm webapp:dev` terminal) clean — no Prisma "field does not exist" warnings.
      </content>
