/**
 * Archive Lock Helper
 *
 * Row-level locking that serializes archiving an asset against writing it into
 * a booking. Kept in its own module — mirroring
 * `~/modules/consumption-log/quantity-lock.server` — so unit tests can stub the
 * raw `FOR UPDATE` (which a mocked tx cannot execute) without also stubbing the
 * real archived guard in `~/utils/org-validation.server`.
 *
 * @see {@link file://./../../utils/org-validation.server.ts} — `assertAssetsAreNotArchived`
 */

import type { Asset } from "@prisma/client";

/**
 * The only capability this helper needs from a transaction client: a
 * tagged-template `$queryRaw`.
 *
 * Structural rather than Prisma's own tx type because that type is generated
 * from the extended client and drags the whole model surface in — which is
 * both unnecessary here and awkward for a test double to satisfy. Prisma's
 * `$queryRaw` accepts a wider first parameter (`TemplateStringsArray | Sql`)
 * and returns a `PrismaPromise`, so the real client satisfies this.
 */
type ArchiveLockTx = {
  $queryRaw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
};

/**
 * Takes a row-level lock on the given assets so an archive and a booking write
 * cannot interleave (issue #382).
 *
 * The archive check and the booking check are symmetric reads, and each side's
 * write is invisible to the other until it commits. Without a shared lock both
 * can pass their own check and then commit, leaving an archived asset sitting
 * in an active booking. Whoever takes the lock first wins; the other blocks and
 * re-reads committed state, so it sees the archive (and refuses) or sees the
 * booking row (and refuses to archive).
 *
 * Must be called inside an interactive transaction, before the check it is
 * protecting. Ids are locked in a deterministic order so two transactions
 * locking overlapping sets cannot deadlock against each other.
 *
 * Org-scoped for the same reason {@link lockAssetForQuantityUpdate} is: a
 * foreign-org id must not be able to take a real lock on another org's row.
 * Missing / foreign ids simply match nothing — the caller's own org guard
 * reports them.
 *
 * @param tx - Prisma interactive transaction client.
 * @param assetIds - Asset ids to lock. Deduped and sorted here.
 * @param organizationId - The caller's validated organization id.
 */
export async function lockAssetsForArchiveGuard(
  tx: ArchiveLockTx,
  assetIds: Asset["id"][],
  organizationId: string
): Promise<void> {
  const ids = [...new Set(assetIds)].sort();
  if (ids.length === 0) return;

  await tx.$queryRaw`
    SELECT id FROM "Asset"
    WHERE id = ANY(${ids}::text[]) AND "organizationId" = ${organizationId}
    ORDER BY id
    FOR UPDATE
  `;
}
