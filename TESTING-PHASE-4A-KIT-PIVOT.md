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

- [ ] Migration applied (T-0 confirmed; `_prisma_migrations` has the row).
- [ ] `pnpm webapp:validate` green — typecheck + lint + tests all pass after the refactor.
- [ ] Dev/staging server running so you can re-hit any failing flow.
- [ ] Workspace with realistic data — at least 1 kit with 2+ assets, 1 kit in custody, 1 kit available, 1 asset not in any kit.
- [ ] Browser console open for runtime errors.

## §0 Schema + backfill verification

- [ ] `AssetKit` table exists with the right columns:

  ```sql
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'AssetKit';
  ```

  Expect: `id text`, `assetId text`, `kitId text`, `organizationId text`, `quantity integer`, `createdAt timestamp`, `updatedAt timestamp`.

- [ ] Backfill row count equals pre-migration `Asset.kitId IS NOT NULL` count:

  ```sql
  -- Pre-migration baseline captured at T-4h.
  -- Post-migration:
  SELECT count(*) FROM "AssetKit";
  -- Must match the baseline exactly.
  ```

- [ ] Per-row match — every pre-migration `Asset.kitId` produced a corresponding `AssetKit` row (run on a snapshot copy where you can temporarily restore `Asset.kitId`):

  ```sql
  SELECT a.id AS asset_id, a."kitId" AS legacy_kit
  FROM "Asset" a
  WHERE a."kitId" IS NOT NULL
  EXCEPT
  SELECT ak."assetId", ak."kitId" FROM "AssetKit" ak;
  -- Expect 0 rows.
  ```

- [ ] No orphans:

  ```sql
  SELECT count(*) FROM "AssetKit" ak
  LEFT JOIN "Asset" a ON ak."assetId" = a.id
  WHERE a.id IS NULL;
  ```

  Expect 0.

- [ ] FK enforcement (cascade) on all three FKs:

  ```sql
  SELECT constraint_name, delete_rule
  FROM information_schema.referential_constraints
  WHERE constraint_name LIKE 'AssetKit_%_fkey';
  ```

  Expect `CASCADE` on `assetId`, `kitId`, `organizationId`.

- [ ] Unique constraint functional — attempt to insert a duplicate `assetId`:

  ```sql
  INSERT INTO "AssetKit" ("id", "assetId", "kitId", "organizationId", "quantity", "createdAt", "updatedAt")
  VALUES ('test-dup', '<existing assetId>', '<some other kitId>', '<org>', 1, now(), now());
  -- Expect: unique constraint violation on AssetKit_assetId_key.
  ```

  Then confirm no test row exists:

  ```sql
  SELECT count(*) FROM "AssetKit" WHERE id = 'test-dup';  -- Expect 0.
  ```

- [ ] RLS enabled:
  ```sql
  SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'AssetKit';
  ```
  Expect `relrowsecurity = t`.

## §1 Kit detail page — read paths

- [ ] Navigate to `/kits/<kitId>` for a kit with multiple assets.
- [ ] Asset list renders all the kit's assets (verify count matches `SELECT count(*) FROM "AssetKit" WHERE "kitId" = '<kitId>'`).
- [ ] Asset status badges and qty display (where applicable) render identically to pre-migration.
- [ ] Click an asset → asset detail page loads; "Included in kit" card shows the kit name and links back correctly.
- [ ] Kit detail page sub-tabs (assets, overview, bookings) all load without error.

## §2 Adding assets to a kit (`updateKitAssets` core path)

- [ ] Go to `/kits/<kitId>/assets/manage-assets`. Pick 2-3 AVAILABLE assets that aren't currently in any kit. Click Save.
- [ ] DB verification:
  ```sql
  SELECT * FROM "AssetKit" WHERE "kitId" = '<kitId>' AND "assetId" IN ('<a1>', '<a2>', '<a3>');
  ```
  Expect 3 rows, one per selected asset, all with `quantity = 1`.
- [ ] UI verification: kit detail page now shows the 3 added assets.
- [ ] Activity feed shows one `ASSET_KIT_CHANGED` event per asset with `field: "kitId"`, `fromValue: null`, `toValue: <kitId>`.

### Edge — moving an asset between kits

- [ ] Pick an asset already in Kit A. Go to Kit B's manage-assets picker and select that asset.
- [ ] Save. Expectation: only ONE `AssetKit` row exists for that asset, now pointing at Kit B (the `@@unique([assetId])` constraint enforces this).
- [ ] Activity event: `ASSET_KIT_CHANGED` with `fromValue: <kitA>`, `toValue: <kitB>`.

### Edge — location cascade

- [ ] Kit B has a location set. Add an asset (currently at a different location) to Kit B.
- [ ] Asset's `Asset.locationId` should auto-update to Kit B's location. Verify in DB and on the asset detail page.

## §3 Removing assets from a kit (`updateKitAssets` removal path)

- [ ] Go to a kit's manage-assets picker. Deselect 2 assets currently in the kit. Save.
- [ ] DB: the corresponding `AssetKit` rows are gone.
- [ ] UI: the assets no longer appear in the kit's asset list.
- [ ] Activity events: `ASSET_KIT_CHANGED` with `fromValue: <kitId>`, `toValue: null` per removed asset.

## §4 `bulkRemoveAssetsFromKits` (assets index → bulk action)

- [ ] Go to the assets index, multi-select 2-3 assets that ARE in a kit. Click bulk-actions → "Remove from kit".
- [ ] DB: pivot rows for those assets are gone.
- [ ] UI: assets' "Included in kit" card disappears on the asset detail page.

## §5 Kit custody — Phase 3d-Polish-2 invariants (regression)

The kit-custody logic should be unaffected by the pivot — the
quantity-aware computation in `buildKitCustodyInheritData` still reads
`Asset.quantity` and existing `Custody` rows, not `AssetKit`.

### §5a Assign a kit's custody — Option B math intact

- [ ] Kit with 2 qty-tracked assets (Pens qty 100, Drill qty 50) and one operator pre-allocated (Alice / Pens / 4).
- [ ] Assign kit custody to Bob.
- [ ] Expected `Custody` rows for the kit: Pens / Bob / 96 / `kitCustodyId` set (Option B: 100 − 4 = 96); Drill / Bob / 50 / `kitCustodyId` set.
- [ ] Alice's operator row (4 units) survives.

### §5b Release kit custody

- [ ] Release the kit's custody from §5a.
- [ ] Pens kit-allocated row gone (cascade); Alice's operator row preserved.
- [ ] Drill kit-allocated row gone; Drill status flips to AVAILABLE.

### §5c Delete a kit while in custody

- [ ] Re-assign kit custody (set up like §5a).
- [ ] Delete the kit from the kits listing.
- [ ] `AssetKit` rows cascade-deleted; kit-allocated Custody rows cascade-deleted; Alice's operator custody on Pens preserved.
- [ ] Activity events: `CUSTODY_RELEASED` per kit-allocated row with `meta.viaKit: true, viaKitDelete: true`.

## §6 Bulk kit-custody operations

- [ ] Assets index → bulk-select kits → "Assign custody" to a team member. Verify all kits' assets receive the right inherited Custody rows.
- [ ] Bulk-release kit custody. Verify cleanup matches §5b across all kits.

## §7 Booking flows — regression check

- [ ] Create a booking that includes assets currently in a kit. Verify the kit grouping in the booking overview renders correctly.
- [ ] Check out, check in. Verify no errors.
- [ ] Booking PDF (if exposed) — assets grouped by kit still group correctly.

## §8 Asset index — kit filter (raw SQL rewrite)

- [ ] Asset index → filter by "Kit: \<some kit name>". Verify only assets in that kit appear.
- [ ] Filter by "Kit: Without kit". Verify only assets NOT in any kit appear.
- [ ] Multi-kit filter (if exposed in advanced index) — pick 2 kits, verify union of their assets appears.
- [ ] Sort by kit (if exposed) — verify ordering matches pre-migration.

## §9 Mobile API back-compat

- [ ] Call `/api/mobile/bookings/<bookingId>` against a booking with assets in kits.
- [ ] Response shape: each asset still has singular `kit: { id, name }` and `kitId: string` fields (synthesised from the primary `AssetKit` row).
- [ ] Asset NOT in any kit: `kit: null`, `kitId: null` (unchanged).

## §10 Scanner drawer flows (regression)

- [ ] Scan an asset that's in a kit. Drawer renders kit chip correctly.
- [ ] Add-to-booking scanner drawer renders the asset's kit name.
- [ ] Bulk-assign-custody scanner — select via QR an asset that's in a kit. Drawer surfaces the kit's name in the row metadata.

## §11 Final gate

- [ ] `pnpm webapp:validate` green.
- [ ] `pnpm webapp:doctor` — no new react-doctor findings.
- [ ] Browser console clean across all the flows above.
- [ ] Server console (`pnpm webapp:dev` terminal) clean — no Prisma "field does not exist" warnings.
      </content>
