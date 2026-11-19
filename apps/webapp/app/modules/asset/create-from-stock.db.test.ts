// @vitest-environment node
/**
 * "Create assets from stock" against a real database.
 *
 * Runs `createAssetsFromStock` on quantity pools placed at two locations,
 * with units in custody and on a booking, and checks the rows it leaves: the
 * new assets and what they copied, the pool's total and placement, the stock
 * ledger, the notes that link both sides, and that a refusal or a failure
 * part-way leaves nothing behind. The row lock and the rollback are what is
 * under test, which a mocked suite cannot see.
 *
 * Needs a database with every migration applied, so it is skipped unless
 * `STOCK_LEDGER_TEST_DATABASE_URL` is set. It creates its own user and
 * workspace and deletes both at the end:
 *
 *   STOCK_LEDGER_TEST_DATABASE_URL="$DATABASE_URL" \
 *     pnpm webapp:test -- --run app/modules/asset/create-from-stock.db.test.ts
 *
 * @see {@link file://./create-from-stock.server.ts}
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// Types only: the modules are imported inside `beforeAll`, once the database
// URL points at the real database.
import type * as DbModule from "~/database/db.server";
import type * as ConsumptionLogService from "~/modules/consumption-log/service.server";
import type * as Ledger from "~/modules/consumption-log/stock-ledger";
import type * as FromStock from "./create-from-stock.server";
import type * as SequentialIds from "./sequential-id.server";
import type * as AssetService from "./service.server";

const DATABASE_URL = process.env.STOCK_LEDGER_TEST_DATABASE_URL;

/**
 * Hands out the sequential ids the next create should use, so one test can
 * make the third asset of a batch collide with an existing one.
 */
const sequentialIds = vi.hoisted(() => ({
  override: null as null | ((count: number) => string[]),
}));

// why: the only way to make a create fail part-way on a real database without
// changing the code under test is to give it an id that is already taken.
vi.mock("~/modules/asset/sequential-id.server", async (importOriginal) => {
  const original = await importOriginal<typeof SequentialIds>();
  return {
    ...original,
    getNextSequentialIds: (
      ...args: Parameters<typeof original.getNextSequentialIds>
    ) =>
      sequentialIds.override
        ? Promise.resolve(sequentialIds.override(args[1]))
        : original.getNextSequentialIds(...args),
  };
});

// why: the low-stock check may email the workspace; there is no mail server
// here, and the email has nothing to do with these rows.
vi.mock("~/emails/mail.server", () => ({ sendEmail: vi.fn() }));

describe.skipIf(!DATABASE_URL)(
  "create assets from stock (real database)",
  () => {
    let db: typeof DbModule.db;
    let fromStock: typeof FromStock;
    let asset: typeof AssetService;
    let consumption: typeof ConsumptionLogService;
    let ledger: typeof Ledger;

    const stamp = Date.now().toString(36);
    let userId = "";
    let organizationId = "";
    let otherOrganizationId = "";
    let teamMemberId = "";
    const loc = { shelf: "", van: "" };
    let modelId = "";
    let otherModelId = "";
    let categoryId = "";
    let tagId = "";

    beforeAll(async () => {
      process.env.DATABASE_URL = DATABASE_URL ?? "";
      process.env.DIRECT_URL = DATABASE_URL ?? "";
      delete (globalThis as { __db__?: unknown }).__db__;

      ({ db } = await import("~/database/db.server"));
      fromStock = await import("./create-from-stock.server");
      asset = await import("./service.server");
      consumption = await import("~/modules/consumption-log/service.server");
      ledger = await import("~/modules/consumption-log/stock-ledger");

      userId = (
        await db.user.create({
          data: {
            email: `from-stock-test-${stamp}@example.com`,
            firstName: "Stock",
            lastName: "Test",
          },
        })
      ).id;
      organizationId = (
        await db.organization.create({
          data: { name: `ZZ From stock ${stamp}`, userId },
        })
      ).id;
      otherOrganizationId = (
        await db.organization.create({
          data: { name: `ZZ From stock other ${stamp}`, userId },
        })
      ).id;
      teamMemberId = (
        await db.teamMember.create({
          data: { name: "ZZ Holder", organizationId },
        })
      ).id;
      for (const key of Object.keys(loc) as Array<keyof typeof loc>) {
        loc[key] = (
          await db.location.create({
            data: { name: `ZZ ${key}`, userId, organizationId },
          })
        ).id;
      }
      modelId = (
        await db.assetModel.create({
          data: { name: "ZZ Model", organizationId, userId },
        })
      ).id;
      otherModelId = (
        await db.assetModel.create({
          data: {
            name: "ZZ Foreign model",
            organizationId: otherOrganizationId,
            userId,
          },
        })
      ).id;
      categoryId = (
        await db.category.create({
          data: { name: "ZZ Cables", color: "#123456", userId, organizationId },
        })
      ).id;
      tagId = (
        await db.tag.create({
          data: { name: "ZZ Tag", userId, organizationId },
        })
      ).id;
    }, 60_000);

    afterAll(async () => {
      if (!db) return;
      for (const id of [organizationId, otherOrganizationId]) {
        if (!id) continue;
        await db.organization.delete({ where: { id } });
        await db.$executeRawUnsafe(
          `DROP SEQUENCE IF EXISTS "org_${id}_asset_sequence"`
        );
      }
      if (userId) await db.user.delete({ where: { id: userId } });
      await db.$disconnect();
    }, 60_000);

    /**
     * A pool of `shelf + van` units: `shelf` placed at the shelf, `van` at the
     * van, valued 12.5 per unit, with a category, a tag and a description.
     */
    async function createPool(title: string, shelf: number, van: number) {
      const pool = await asset.createAsset({
        title,
        description: "ZZ pool description",
        userId,
        organizationId,
        categoryId,
        valuation: 12.5,
        tags: { set: [{ id: tagId }] },
        type: "QUANTITY_TRACKED",
        quantity: shelf,
        consumptionType: "TWO_WAY",
        unitOfMeasure: "pcs",
        locationId: loc.shelf,
      });
      if (van > 0) {
        await consumption.adjustQuantity({
          assetId: pool.id,
          quantity: van,
          category: "RESTOCK",
          direction: "add",
          userId,
          organizationId,
          locationId: loc.van,
        });
      }
      return pool.id;
    }

    async function poolState(poolId: string) {
      const [row, placements] = await Promise.all([
        db.asset.findFirstOrThrow({
          where: { id: poolId, organizationId, archivedAt: null },
          select: { quantity: true },
        }),
        db.assetLocation.findMany({
          where: { assetId: poolId, organizationId, assetKitId: null },
          select: { locationId: true, quantity: true },
        }),
      ]);
      return {
        total: row.quantity,
        placed: Object.fromEntries(
          placements.map((p) => [p.locationId, p.quantity])
        ),
      };
    }

    async function expectLedgerMatchesLive(poolId: string) {
      const rows = await db.consumptionLog.findMany({
        where: { assetId: poolId, stockChange: { not: null } },
        select: {
          category: true,
          quantity: true,
          stockChange: true,
          locationId: true,
        },
        orderBy: { createdAt: "asc" },
      });
      const live = await poolState(poolId);
      const byPlace = new Map<string, number>(Object.entries(live.placed));
      const placedSum = [...byPlace.values()].reduce((a, b) => a + b, 0);
      if ((live.total ?? 0) - placedSum !== 0) {
        byPlace.set("", (live.total ?? 0) - placedSum);
      }
      expect(ledger.replayStockLedger(rows)).toEqual({
        total: live.total,
        byPlace,
      });
      return rows;
    }

    function assetsTitled(prefix: string) {
      return db.asset.findMany({
        where: {
          organizationId,
          title: { startsWith: prefix },
          archivedAt: null,
        },
        select: {
          id: true,
          title: true,
          type: true,
          quantity: true,
          valuation: true,
          description: true,
          categoryId: true,
          assetModelId: true,
          availableToBook: true,
          tags: { select: { id: true } },
          assetLocations: { select: { locationId: true, quantity: true } },
          qrCodes: { select: { id: true } },
          notes: { select: { content: true } },
        },
        orderBy: { title: "asc" },
      });
    }

    it("turns units at a location into placed individual assets with a model, and lowers the pool there", async () => {
      const poolId = await createPool("ZZ Pool A", 6, 4);

      const result = await fromStock.createAssetsFromStock({
        poolId,
        organizationId,
        userId,
        count: 3,
        source: loc.van,
        title: "  ZZ Cam  ",
        assetModelId: modelId,
      });

      const created = await assetsTitled("ZZ Cam");
      expect(created.map((a) => a.title)).toEqual([
        "ZZ Cam 1",
        "ZZ Cam 2",
        "ZZ Cam 3",
      ]);
      expect(result.assets.map((a) => a.id).sort()).toEqual(
        created.map((a) => a.id).sort()
      );
      for (const made of created) {
        expect(made).toMatchObject({
          type: "INDIVIDUAL",
          quantity: null,
          valuation: 12.5,
          description: "ZZ pool description",
          categoryId,
          assetModelId: modelId,
          availableToBook: true,
          tags: [{ id: tagId }],
          assetLocations: [{ locationId: loc.van, quantity: 1 }],
        });
        expect(made.qrCodes).toHaveLength(1);
        expect(made.notes).toHaveLength(1);
        expect(made.notes[0].content).toContain(`/assets/${poolId}`);
        expect(made.notes[0].content).toContain(
          "created this asset from the stock of"
        );
      }

      expect(await poolState(poolId)).toEqual({
        total: 7,
        placed: { [loc.shelf]: 6, [loc.van]: 1 },
      });
      const rows = await expectLedgerMatchesLive(poolId);
      expect(rows.at(-1)).toMatchObject({
        category: "CONVERTED",
        quantity: 3,
        stockChange: -3,
        locationId: loc.van,
      });

      const poolNotes = await db.note.findMany({
        where: { assetId: poolId, type: "UPDATE" },
        select: { content: true },
      });
      const conversionNote = poolNotes.find((n) =>
        n.content.includes("The stock went down by **3**.")
      );
      expect(conversionNote?.content).toContain(
        `ids="${created.map((a) => a.id).join(",")}"`
      );
    }, 60_000);

    it("keeps the name as typed for one asset, and leaves it unplaced when the units are unplaced", async () => {
      const poolId = await createPool("ZZ Pool B", 2, 0);
      await db.assetLocation.updateMany({
        where: { assetId: poolId, organizationId },
        data: { quantity: 1 },
      });

      await fromStock.createAssetsFromStock({
        poolId,
        organizationId,
        userId,
        count: 1,
        source: "unplaced",
        title: "ZZ Single",
      });

      const [made] = await assetsTitled("ZZ Single");
      expect(made).toMatchObject({
        title: "ZZ Single",
        assetModelId: null,
        assetLocations: [],
      });
      expect(await poolState(poolId)).toEqual({
        total: 1,
        placed: { [loc.shelf]: 1 },
      });
    }, 60_000);

    it("never takes units in custody or reserved by a booking, and refuses with nothing created", async () => {
      // 10 units: 4 in custody from the shelf, 3 reserved on a booking.
      const poolId = await createPool("ZZ Pool C", 6, 4);
      await db.custody.create({
        data: {
          assetId: poolId,
          teamMemberId,
          quantity: 4,
          locationId: loc.shelf,
        },
      });
      const booking = await db.booking.create({
        data: {
          name: `ZZ Reservation ${stamp}`,
          creatorId: userId,
          organizationId,
          status: "RESERVED",
          from: new Date(Date.now() + 86_400_000),
          to: new Date(Date.now() + 2 * 86_400_000),
          custodianTeamMemberId: teamMemberId,
        },
      });
      await db.bookingAsset.create({
        data: { bookingId: booking.id, assetId: poolId, quantity: 3 },
      });

      const choices = await fromStock.getAssetsFromStockChoices({
        assetId: poolId,
        organizationId,
        total: 10,
      });
      expect(choices.free).toBe(3);

      await expect(
        fromStock.createAssetsFromStock({
          poolId,
          organizationId,
          userId,
          count: 4,
          source: loc.van,
          title: "ZZ Too many",
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("committed"),
      });
      expect(await assetsTitled("ZZ Too many")).toEqual([]);
      expect((await poolState(poolId)).total).toBe(10);

      await fromStock.createAssetsFromStock({
        poolId,
        organizationId,
        userId,
        count: 3,
        source: loc.van,
        title: "ZZ Free",
      });
      expect(await assetsTitled("ZZ Free")).toHaveLength(3);
      expect((await poolState(poolId)).total).toBe(7);
      await expectLedgerMatchesLive(poolId);
    }, 60_000);

    it("caps the count at what the chosen location has left", async () => {
      const poolId = await createPool("ZZ Pool D", 6, 2);

      await expect(
        fromStock.createAssetsFromStock({
          poolId,
          organizationId,
          userId,
          count: 3,
          source: loc.van,
          title: "ZZ Van",
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("ZZ van has only 2 pcs"),
      });
      expect(await assetsTitled("ZZ Van")).toEqual([]);
      expect(await poolState(poolId)).toEqual({
        total: 8,
        placed: { [loc.shelf]: 6, [loc.van]: 2 },
      });
    }, 60_000);

    it("lets only one of two people take the same free units at the same time", async () => {
      const poolId = await createPool("ZZ Pool E", 3, 0);

      const outcomes = await Promise.allSettled(
        ["ZZ Race A", "ZZ Race B"].map((title) =>
          fromStock.createAssetsFromStock({
            poolId,
            organizationId,
            userId,
            count: 3,
            source: loc.shelf,
            title,
          })
        )
      );

      expect(outcomes.map((o) => o.status).sort()).toEqual([
        "fulfilled",
        "rejected",
      ]);
      expect(await assetsTitled("ZZ Race")).toHaveLength(3);
      expect(await poolState(poolId)).toEqual({ total: 0, placed: {} });
      await expectLedgerMatchesLive(poolId);
    }, 60_000);

    it("leaves no asset and the pool as it was when a create fails part-way", async () => {
      const poolId = await createPool("ZZ Pool F", 5, 0);
      const [taken] = await db.asset.findMany({
        where: {
          organizationId,
          sequentialId: { not: null },
          archivedAt: null,
        },
        select: { sequentialId: true },
        take: 1,
      });
      // The third asset's id is already in use, on every attempt.
      sequentialIds.override = (count) =>
        Array.from({ length: count }, (_, i) =>
          i === 2 ? taken.sequentialId! : `ZZ-${stamp}-${Math.random()}`
        );

      try {
        await expect(
          fromStock.createAssetsFromStock({
            poolId,
            organizationId,
            userId,
            count: 3,
            source: loc.shelf,
            title: "ZZ Broken",
          })
        ).rejects.toBeTruthy();
      } finally {
        sequentialIds.override = null;
      }

      expect(await assetsTitled("ZZ Broken")).toEqual([]);
      expect(await poolState(poolId)).toEqual({
        total: 5,
        placed: { [loc.shelf]: 5 },
      });
      const rows = await expectLedgerMatchesLive(poolId);
      expect(rows.some((r) => r.category === "CONVERTED")).toBe(false);
    }, 60_000);

    it("refuses another workspace's asset model", async () => {
      const poolId = await createPool("ZZ Pool G", 2, 0);

      await expect(
        fromStock.createAssetsFromStock({
          poolId,
          organizationId,
          userId,
          count: 1,
          source: loc.shelf,
          title: "ZZ Foreign",
          assetModelId: otherModelId,
        })
      ).rejects.toMatchObject({ status: 404 });
      expect(await assetsTitled("ZZ Foreign")).toEqual([]);
      expect((await poolState(poolId)).total).toBe(2);
    }, 60_000);
  }
);
