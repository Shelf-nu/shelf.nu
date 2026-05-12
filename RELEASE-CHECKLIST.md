# Release Checklist

Reusable runbook for shipping the `feat-quantities` phases (4a → 4b →
4c → 4d) and any future structural release that needs a maintenance
window.

**How to use this doc:**

- The runbook structure (T-24h → T-0 → T+24h, rollback, sign-off) stays
  the same every release.
- Each release updates the **"Current Release"** block at the top + the
  **per-phase callouts** (look for `<!-- per-phase -->` markers in the
  source) + the **Verification Checklist** section at the bottom.
- Old per-release content gets archived in `## Past releases` at the
  bottom, not deleted.

---

## Current Release

<!-- per-phase: update everything in this section -->

| Field                         | Value                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| Phase                         | **4a — Kit Pivot**                                                                                    |
| Branch                        | `feat-quantities`                                                                                     |
| PR                            | _(fill in)_                                                                                           |
| Migration name                | `20260511120000_add_asset_kit_pivot`                                                                  |
| Migration scope               | Replace `Asset.kitId` 1:1 FK with an `AssetKit` pivot                                                 |
| User-visible behaviour change | None (observable-equivalent)                                                                          |
| Mobile contract change        | None (synthesised primary `kit`/`kitId` via the pivot's first row)                                    |
| Maintenance window required   | **Yes** — app is read-locked on `Asset` during backfill + `DROP COLUMN`                               |
| Highest-risk areas            | `updateKitAssets`, `bulkAssignKitCustody`, raw-SQL kit filter, mobile-API back-compat                 |
| Deferred to a later phase     | Drop `@@unique([assetId])`, `AssetType`-aware single-row trigger, sum-within-total CONSTRAINT TRIGGER |

### TL;DR — what could go wrong this release

`Asset` is the largest table. The migration runs in a single transaction
that touches it: `INSERT INTO AssetKit … FROM Asset` (backfill) + `ALTER
TABLE Asset DROP COLUMN kitId` (ACCESS EXCLUSIVE lock). With the app in
maintenance mode the lock window stops being user-visible — the real
risks are:

1. Bad pre-flight data (orphan or cross-org `kitId`) → mitigated by §T-4h.
2. Migration takes longer than the maintenance window → mitigated by the §T-1h snapshot dry-run.
3. Need to roll back → mitigated by the final `pg_dump` at §T-0.

---

## T-24h: Code freeze + prep

- [ ] PR opened and reviewed by at least one other engineer.
- [ ] `pnpm webapp:validate` green on the branch locally.
- [ ] CI green on the PR.
- [ ] Maintenance window scheduled — internal comms sent (Slack + status page).
- [ ] Mobile-app team aware. <!-- per-phase: flag if this release breaks the mobile contract -->
- [ ] You have prod database access via `psql` (or your usual tool), with a role that can run `pg_dump`.
- [ ] You can reach the Fly.io (or wherever the app deploys) dashboard and release a previous image if you need to roll back.

**Decision gate:** all boxes ticked → continue. Any unchecked → reschedule.

---

## T-4h: Pre-flight invariants (live prod, READ-ONLY)

Pure data checks. No locks, no writes. Run them now, well before the
window, so you have time to fix bad data if any.

<!-- per-phase: replace this block with the queries for the new schema change -->

### Phase 4a queries

- [ ] **Orphan `Asset.kitId`** (FK points at a deleted Kit):

  ```sql
  SELECT count(*) FROM "Asset" a
  LEFT JOIN "Kit" k ON a."kitId" = k.id
  WHERE a."kitId" IS NOT NULL AND k.id IS NULL;
  ```

  **Expect 0.** If non-zero: `UPDATE "Asset" SET "kitId" = NULL WHERE id IN (…);` before the window.

- [ ] **Cross-org `Asset.kitId`** (asset's org ≠ kit's org):

  ```sql
  SELECT count(*) FROM "Asset" a JOIN "Kit" k ON a."kitId" = k.id
  WHERE a."organizationId" != k."organizationId";
  ```

  **Expect 0.** If non-zero: investigate — pre-existing bug. Escalate before migrating.

- [ ] **Capture the baseline count** (to compare against the post-migration `AssetKit` row count):
  ```sql
  SELECT count(*) AS expected_pivot_rows FROM "Asset" WHERE "kitId" IS NOT NULL;
  ```
  Record this number: `____________`

**Decision gate:** all 0 + baseline captured → continue. Any non-zero → fix the data, repeat the queries until clean, then continue.

---

## T-1h: Snapshot dry-run

Goal: prove the migration applies cleanly on real prod data shape, and
measure how long it actually takes so the maintenance window is sized
correctly.

- [ ] Take a fresh snapshot of prod (Supabase dashboard → Database → Backups, or `pg_dump` directly).
- [ ] Restore it onto a scratch database (locally or a staging instance).
- [ ] Apply the migration:
  ```bash
  pnpm --filter @shelf/database run db:deploy-migration
  ```
  **Time it.** Record wall-clock: `____________`.
- [ ] Run the **Verification Checklist § 0 (Schema + backfill)** below against the restored DB. Every assertion must pass.
- [ ] Smoke read: load `/kits`, `/assets`, one booking overview. UI loads without error.

**Decision gate:**

- Migration completed in less than 50% of your maintenance window? → continue.
- All §0 assertions passed? → continue.
- Any backfill mismatch / orphan / unique violation? → **STOP.** Investigate before scheduling.

Record final wall-clock + the maintenance window you'll use: `____________`

---

## T-0: Maintenance window — deploy

Start the clock. Aim for the recorded snapshot time × 3-5 safety margin.

### Enable maintenance mode

- [ ] Toggle maintenance mode (your usual mechanism).
- [ ] Verify a normal user-agent hitting the site sees the maintenance page, not the app.
- [ ] Verify the mobile app (`/api/mobile/*`) returns the maintenance response, not data.
- [ ] Wait 30 seconds. Confirm no active in-flight requests:
  ```sql
  SELECT pid, state, query_start, query FROM pg_stat_activity
  WHERE state = 'active' AND datname = '<your-db-name>'
    AND query NOT LIKE '%pg_stat_activity%';
  ```
  Expect only your own session(s).

### Final safety net

- [ ] Take the final pre-migration `pg_dump` (the rollback source of truth):
  ```bash
  pg_dump \
    --table='public."Asset"' \
    --table='public."Kit"' \
    --table='public."AssetKit"' \
    --file=phase-4a-prerelease-$(date +%Y%m%d-%H%M%S).sql \
    "$DATABASE_URL"
  ```
  <!-- per-phase: update the --table args to the models that this release rewrites -->
  Verify file size > 0 and store somewhere durable (S3, local + cloud). Record filename: `____________`.

### Apply the migration

- [ ] Run the migration against prod:
  ```bash
  pnpm --filter @shelf/database run db:deploy-migration
  ```
- [ ] Confirm it's recorded:
  ```sql
  SELECT migration_name, finished_at FROM _prisma_migrations
  WHERE migration_name = '20260511120000_add_asset_kit_pivot';
  -- per-phase: update the migration_name above
  ```
  `finished_at` must be non-null.

### Verify against live prod

Run **Verification Checklist §0** below against live prod. Every assertion
must pass. Specifically watch:

- [ ] `AssetKit` row count matches your T-4h baseline (`expected_pivot_rows`). **They must be equal.** If they differ → start rollback.
- [ ] No orphan pivot rows.
- [ ] Unique constraint enforced (test insert fails, then no test row remains).
- [ ] RLS enabled on `AssetKit`.

**Decision gate:** all four checks pass → continue. Any fail → **rollback.**

### Deploy app code

- [ ] Push the new Docker image (or platform equivalent) to Fly.io.
- [ ] Wait for the rolling deploy to complete; all instances healthy.
- [ ] Hit one server route while still in maintenance mode (from an allowlisted IP) → confirm it returns the app HTML.

### Smoke test inside maintenance mode

You're allowlisted; users still see the maintenance page. Walk the
high-risk sections of the **Verification Checklist** below:

<!-- per-phase: pick the smoke-test sections most likely to surface a problem -->

- [ ] §1 Kit detail page reads — load one real kit.
- [ ] §2 Adding assets to a kit — pick a test kit, add an asset, verify pivot row in DB.
- [ ] §8 Asset index kit filter — filter assets by kit; verify result matches the pivot.
- [ ] §9 Mobile API back-compat — curl a booking; confirm singular `kit` / `kitId` still in the response.

**Decision gate:** all smoke checks pass → continue. Any fail → diagnose NOW; rollback decision in the next 10 minutes.

---

## T+15m: Exit maintenance, watch traffic

- [ ] Disable maintenance mode.
- [ ] Watch the first 10 minutes of live traffic:
  - Server logs (Fly / Sentry): no spike in 500s, no new Prisma errors.
  - Specifically grep for `assetKits`, `kit.assets`, `_count.assets` — Prisma will throw `Unknown field` if anything was missed. <!-- per-phase: grep for whatever model fields this release rewrote -->
  - DB queries: latency on `Asset` / `Kit` reads roughly matches pre-deploy. <!-- per-phase -->
- [ ] Spot-check one real user-flow end-to-end. <!-- per-phase: pick the flow most representative of the release -->

If the first 10 minutes look clean, finish the remaining sections of the **Verification Checklist** at a measured pace (§3 → §11).

---

## T+1h to T+24h: Watch window

- [ ] Sentry / error monitor checked periodically. Triage any new error class that mentions the touched fields immediately.
- [ ] Check a sample of records created in the last hour — confirm the new relationship still renders correctly across UI + PDF + mobile. <!-- per-phase -->
- [ ] At T+24h: if everything is clean, you can move on to the next phase. The `pg_dump` can be archived per your data-retention policy.

---

## Rollback

Trigger rollback if any of these are true:

- Pre/post-migration row-count baselines don't match.
- Smoke tests inside maintenance mode fail in a non-cosmetic way.
- Live traffic monitoring shows a new error class that you can't quickly diagnose.

### How to roll back

1. **Re-enable maintenance mode** if you'd already exited.
2. **Roll back the app code** to the previous Docker image (Fly: `fly releases --image …` → pick the previous, `fly deploy --image …`).
3. **Restore the database from your `pg_dump`** (or, easier: restore the most recent Supabase automatic backup taken before the migration ran). Surgical SQL restore is fragile; snapshot restore is the safer path. The `pg_dump` is your second-line option and your audit trail of the pre-migration state.
4. Verify the app works on the restored DB by curling a route.
5. Disable maintenance mode.
6. **Post-mortem:** open an issue with the failure cause + what to fix before the next attempt.

### Rollback decision cutoff

If smoke checks fail and you can't diagnose in 15 minutes, **roll back
rather than extend the window**. Structural-only migrations have no
user-visible upside to shipping half-broken.

---

## Sign-off (current release)

- [ ] All decision gates passed.
- [ ] All sections of the **Verification Checklist** ticked.
- [ ] No new error classes in monitoring for T+1h.
- [ ] PR description updated with the actual maintenance-window duration and any deviations from this runbook.
- [ ] `pg_dump` archived according to data-retention policy.
- [ ] Team notified that this phase is shipped; next phase unblocked.

| Field                                 | Value |
| ------------------------------------- | ----- |
| Deployer                              |       |
| Date / time of maintenance start      |       |
| Maintenance-window duration           |       |
| Migration wall-clock time             |       |
| Pivot row count at deploy             |       |
| `pg_dump` filename + storage location |       |
| Notes / deviations                    |       |

---

## Verification Checklist (current release)

<!-- per-phase: replace this entire section with the phase's manual-testing
     checklist. The structure (numbered sections referenced by §N from
     the deploy steps above) stays the same release-to-release. -->

### Phase 4a — Kit Pivot

Structural-only change: every existing asset gets exactly one `AssetKit`
row; a `@@unique([assetId])` constraint preserves the "at most one kit
per asset" invariant. The pivot's `quantity` defaults to 1 and stays at 1
in this phase. Quantity-aware behaviour (multi-kit allocation,
sum-within-total triggers) lands in a follow-up sub-phase.

The change should be **observable-equivalent** for end users — the goal
is to verify no regression on the kit-membership and kit-custody flows
shipped through Phase 3d-Polish-2.

> **Highest-risk areas, watch closely:**
>
> 1. **`updateKitAssets`** — the connect/disconnect block was rewritten as direct `AssetKit` upserts/deletes inside a `$transaction`. Add/remove flows + the kit-aware location cascade must still fire correctly.
> 2. **`bulkAssignKitCustody`** — the asset-via-kit traversal now flattens the pivot rows. Kit-custody Option B math (Phase 3d-Polish-2) still computes the remaining-pool quantity per asset.
> 3. **Raw SQL kit filter** (`asset/query.server.ts`) — rewritten to join through `AssetKit`. Filter behaviour on the asset index must be identical pre/post-migration.

#### Prerequisites

- [ ] Migration applied (T-0 confirmed; `_prisma_migrations` has the row).
- [ ] `pnpm webapp:validate` green — typecheck + lint + tests all pass after the refactor.
- [ ] Dev/staging server running so you can re-hit any failing flow.
- [ ] Workspace with realistic data — at least 1 kit with 2+ assets, 1 kit in custody, 1 kit available, 1 asset not in any kit.
- [ ] Browser console open for runtime errors.

#### §0 Schema + backfill verification

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

#### §1 Kit detail page — read paths

- [ ] Navigate to `/kits/<kitId>` for a kit with multiple assets.
- [ ] Asset list renders all the kit's assets (verify count matches `SELECT count(*) FROM "AssetKit" WHERE "kitId" = '<kitId>'`).
- [ ] Asset status badges and qty display (where applicable) render identically to pre-migration.
- [ ] Click an asset → asset detail page loads; "Included in kit" card shows the kit name and links back correctly.
- [ ] Kit detail page sub-tabs (assets, overview, bookings) all load without error.

#### §2 Adding assets to a kit (`updateKitAssets` core path)

- [ ] Go to `/kits/<kitId>/assets/manage-assets`. Pick 2-3 AVAILABLE assets that aren't currently in any kit. Click Save.
- [ ] DB verification:
  ```sql
  SELECT * FROM "AssetKit" WHERE "kitId" = '<kitId>' AND "assetId" IN ('<a1>', '<a2>', '<a3>');
  ```
  Expect 3 rows, one per selected asset, all with `quantity = 1`.
- [ ] UI verification: kit detail page now shows the 3 added assets.
- [ ] Activity feed shows one `ASSET_KIT_CHANGED` event per asset with `field: "kitId"`, `fromValue: null`, `toValue: <kitId>`.

##### Edge — moving an asset between kits

- [ ] Pick an asset already in Kit A. Go to Kit B's manage-assets picker and select that asset.
- [ ] Save. Expectation: only ONE `AssetKit` row exists for that asset, now pointing at Kit B (the `@@unique([assetId])` constraint enforces this).
- [ ] Activity event: `ASSET_KIT_CHANGED` with `fromValue: <kitA>`, `toValue: <kitB>`.

##### Edge — location cascade

- [ ] Kit B has a location set. Add an asset (currently at a different location) to Kit B.
- [ ] Asset's `Asset.locationId` should auto-update to Kit B's location. Verify in DB and on the asset detail page.

#### §3 Removing assets from a kit (`updateKitAssets` removal path)

- [ ] Go to a kit's manage-assets picker. Deselect 2 assets currently in the kit. Save.
- [ ] DB: the corresponding `AssetKit` rows are gone.
- [ ] UI: the assets no longer appear in the kit's asset list.
- [ ] Activity events: `ASSET_KIT_CHANGED` with `fromValue: <kitId>`, `toValue: null` per removed asset.

#### §4 `bulkRemoveAssetsFromKits` (assets index → bulk action)

- [ ] Go to the assets index, multi-select 2-3 assets that ARE in a kit. Click bulk-actions → "Remove from kit".
- [ ] DB: pivot rows for those assets are gone.
- [ ] UI: assets' "Included in kit" card disappears on the asset detail page.

#### §5 Kit custody — Phase 3d-Polish-2 invariants (regression)

The kit-custody logic should be unaffected by the pivot — the
quantity-aware computation in `buildKitCustodyInheritData` still reads
`Asset.quantity` and existing `Custody` rows, not `AssetKit`.

##### §5a Assign a kit's custody — Option B math intact

- [ ] Kit with 2 qty-tracked assets (Pens qty 100, Drill qty 50) and one operator pre-allocated (Alice / Pens / 4).
- [ ] Assign kit custody to Bob.
- [ ] Expected `Custody` rows for the kit: Pens / Bob / 96 / `kitCustodyId` set (Option B: 100 − 4 = 96); Drill / Bob / 50 / `kitCustodyId` set.
- [ ] Alice's operator row (4 units) survives.

##### §5b Release kit custody

- [ ] Release the kit's custody from §5a.
- [ ] Pens kit-allocated row gone (cascade); Alice's operator row preserved.
- [ ] Drill kit-allocated row gone; Drill status flips to AVAILABLE.

##### §5c Delete a kit while in custody

- [ ] Re-assign kit custody (set up like §5a).
- [ ] Delete the kit from the kits listing.
- [ ] `AssetKit` rows cascade-deleted; kit-allocated Custody rows cascade-deleted; Alice's operator custody on Pens preserved.
- [ ] Activity events: `CUSTODY_RELEASED` per kit-allocated row with `meta.viaKit: true, viaKitDelete: true`.

#### §6 Bulk kit-custody operations

- [ ] Assets index → bulk-select kits → "Assign custody" to a team member. Verify all kits' assets receive the right inherited Custody rows.
- [ ] Bulk-release kit custody. Verify cleanup matches §5b across all kits.

#### §7 Booking flows — regression check

- [ ] Create a booking that includes assets currently in a kit. Verify the kit grouping in the booking overview renders correctly.
- [ ] Check out, check in. Verify no errors.
- [ ] Booking PDF (if exposed) — assets grouped by kit still group correctly.

#### §8 Asset index — kit filter (raw SQL rewrite)

- [ ] Asset index → filter by "Kit: \<some kit name>". Verify only assets in that kit appear.
- [ ] Filter by "Kit: Without kit". Verify only assets NOT in any kit appear.
- [ ] Multi-kit filter (if exposed in advanced index) — pick 2 kits, verify union of their assets appears.
- [ ] Sort by kit (if exposed) — verify ordering matches pre-migration.

#### §9 Mobile API back-compat

- [ ] Call `/api/mobile/bookings/<bookingId>` against a booking with assets in kits.
- [ ] Response shape: each asset still has singular `kit: { id, name }` and `kitId: string` fields (synthesised from the primary `AssetKit` row).
- [ ] Asset NOT in any kit: `kit: null`, `kitId: null` (unchanged).

#### §10 Scanner drawer flows (regression)

- [ ] Scan an asset that's in a kit. Drawer renders kit chip correctly.
- [ ] Add-to-booking scanner drawer renders the asset's kit name.
- [ ] Bulk-assign-custody scanner — select via QR an asset that's in a kit. Drawer surfaces the kit's name in the row metadata.

#### §11 Final gate

- [ ] `pnpm webapp:validate` green.
- [ ] `pnpm webapp:doctor` — no new react-doctor findings.
- [ ] Browser console clean across all the flows above.
- [ ] Server console (`pnpm webapp:dev` terminal) clean — no Prisma "field does not exist" warnings.

---

## Past releases

<!-- After this release ships, move the "Current Release" block + the
     phase-specific Verification Checklist here as an archive entry.
     Keep the runbook structure (T-24h → T+24h) intact for the next
     release to reuse. -->

_None yet — Phase 4a is the first release using this runbook._
