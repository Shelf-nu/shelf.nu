-- Split the Custody (assetId, teamMemberId) global unique into two partial
-- uniques so a custodian can legitimately hold the same asset both as an
-- operator allocation AND through one or more kit allocations.
--
-- Background: today's `@@unique([assetId, teamMemberId])` enforces "at most
-- one Custody row per (asset, custodian)". That blocks a legitimate
-- real-world flow — e.g. a custodian takes a kit containing 10 batteries,
-- and ALSO takes 10 standalone batteries for personal use. Both are valid
-- claims on the same physical pool, but the schema can't store them as
-- separate rows. The current code path surfaces this as an opaque
-- `PrismaClientKnownRequestError: P2002` from `tx.custody.createMany` in
-- the kit-assign-custody flow when the chosen custodian already has an
-- operator-allocated Custody row for any of the kit's assets.
--
-- After this change:
--   • Operator-allocated rows (`kitCustodyId IS NULL`) — at most one per
--     (asset, custodian). Enforced by `Custody_operator_unique`.
--   • Kit-allocated rows (`kitCustodyId IS NOT NULL`) — at most one per
--     (asset, kitCustody). Enforced by `Custody_kit_unique`. The
--     custodian is implicit via `KitCustody.custodianId`, so this allows
--     multiple kit-allocated rows for the same (asset, custodian) when
--     that custodian holds custody of multiple kits each containing the
--     same asset.
--
-- The asset's total cap (`sum(Custody.quantity) <= Asset.quantity`) is
-- still enforced at the application layer by `buildKitCustodyInheritData`
-- and `checkOutQuantity` — those readers sum every Custody row on the
-- asset before computing the new slice's headroom.
--
-- The existing `Custody_assetId_teamMemberId_idx` lookup index stays in
-- place for "find all of this custodian's rows on this asset" reads.
--
-- The `DROP IF EXISTS` / `CREATE IF NOT EXISTS` guards make this file
-- safe to re-apply (e.g. after a dev-side recovery that manually rolled
-- back the migration's ledger row).
--
-- Pre-deploy sanity (run on a staging snapshot): both queries below
-- should return 0 rows. Any duplicates would abort the index build.
--
--   SELECT "assetId", "teamMemberId", COUNT(*)
--     FROM "Custody"
--    WHERE "kitCustodyId" IS NULL
--    GROUP BY "assetId", "teamMemberId"
--   HAVING COUNT(*) > 1;
--
--   SELECT "assetId", "kitCustodyId", COUNT(*)
--     FROM "Custody"
--    WHERE "kitCustodyId" IS NOT NULL
--    GROUP BY "assetId", "kitCustodyId"
--   HAVING COUNT(*) > 1;

DROP INDEX IF EXISTS "Custody_assetId_teamMemberId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Custody_operator_unique"
  ON "Custody" ("assetId", "teamMemberId")
  WHERE "kitCustodyId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Custody_kit_unique"
  ON "Custody" ("assetId", "kitCustodyId")
  WHERE "kitCustodyId" IS NOT NULL;
