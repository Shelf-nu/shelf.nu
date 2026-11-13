/**
 * Real-database harness self-test
 *
 * Proves the harness itself works before feature tests rely on it: the
 * migrations ran, {@link withRollback} leaves no rows behind, and
 * {@link commitAndExpect} reports errors raised by deferred constraint
 * triggers at COMMIT.
 *
 * @see {@link file://./client.ts}
 * @see {@link file://./fixtures.ts}
 */

import { afterAll, describe, expect, it } from "vitest";

import {
  commitAndExpect,
  disconnectTestDb,
  getTestDb,
  withRollback,
} from "./client";
import { seedOrgWithPool } from "./fixtures";

afterAll(async () => {
  await disconnectTestDb();
});

describe("real-database harness", () => {
  it("applies the migrations", async () => {
    const rows = await getTestDb().$queryRaw<Array<{ table: string | null }>>`
      SELECT to_regclass('public."AssetKit"')::text AS "table"
    `;
    expect(rows[0]?.table).toBe('"AssetKit"');
  });

  it("withRollback leaves nothing behind", async () => {
    const seeded = await withRollback((tx) =>
      seedOrgWithPool(tx, {
        total: 10,
        placements: [{ name: "Shelf A", quantity: 4 }],
      })
    );

    const db = getTestDb();
    expect(
      await db.organization.findUnique({
        where: { id: seeded.organizationId },
      })
    ).toBeNull();
    expect(
      await db.asset.findUnique({ where: { id: seeded.assetId } })
    ).toBeNull();
    expect(await db.user.findUnique({ where: { id: seeded.userId } })).toBe(
      null
    );
  });

  it("commitAndExpect surfaces a deferred trigger error", async () => {
    // Two kits each claim 6 of the asset's 10 units. Each insert is valid on
    // its own; the deferred `asset_kit_sum_within_total` trigger rejects the
    // 12 > 10 total at COMMIT, so nothing from this transaction persists.
    const result = await commitAndExpect(async (tx) => {
      const { organizationId, assetId, userId } = await seedOrgWithPool(tx, {
        total: 10,
        placements: [],
      });
      for (const name of ["Kit A", "Kit B"]) {
        const kit = await tx.kit.create({
          data: { name, organizationId, createdById: userId },
          select: { id: true },
        });
        await tx.assetKit.create({
          data: { assetId, kitId: kit.id, organizationId, quantity: 6 },
        });
      }
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("AssetKit total 12 exceeds");
      expect(result.message).toContain("Asset.quantity 10");
    }
  });
});
