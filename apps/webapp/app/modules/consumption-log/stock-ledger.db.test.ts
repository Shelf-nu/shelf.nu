// @vitest-environment node
/**
 * Stock ledger replay against a real database.
 *
 * Runs every kind of stock change through the real services on quantity
 * pools spread across locations and unplaced units, and after each one
 * replays the pool's ledger rows (`stockChange IS NOT NULL`) and compares the
 * result with the live stock: per location, unplaced, and in total. A write
 * path that changes stock without its ledger rows fails here, which a mocked
 * suite cannot see.
 *
 * It also shows that the ledger readers (availability, checked-out counts,
 * stock conflicts, booking remaining, check-in attribution) give the same
 * numbers whether a disposition is one row or split over two places.
 *
 * Needs a database with every migration applied, so it is skipped unless
 * `STOCK_LEDGER_TEST_DATABASE_URL` is set. It creates its own user and
 * workspace and deletes both at the end:
 *
 *   STOCK_LEDGER_TEST_DATABASE_URL="$DATABASE_URL" \
 *     pnpm webapp:test -- --run app/modules/consumption-log/stock-ledger.db.test.ts
 *
 * @see {@link file://./stock-ledger.server.ts}
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// Types only: the modules are imported inside `beforeAll`, once the database
// URL points at the real database.
import type * as DbModule from "~/database/db.server";
import type * as Availability from "~/modules/asset/availability.server";
import type * as AssetService from "~/modules/asset/service.server";
import type * as CheckedOut from "~/modules/booking/checked-out.server";
import type * as BookingService from "~/modules/booking/service.server";
import type * as StockConflicts from "~/modules/booking/stock-conflicts.server";
import type * as UnitsOutBySource from "~/modules/booking/units-out-by-source.server";
import type * as LocationService from "~/modules/location/service.server";
import type * as ConsumptionLogService from "./service.server";
import type * as Ledger from "./stock-ledger";

const DATABASE_URL = process.env.STOCK_LEDGER_TEST_DATABASE_URL;

// why: a full check-in emails the booking's creator; there is no mail server
// here, and the email has nothing to do with stock.
vi.mock("~/emails/mail.server", () => ({ sendEmail: vi.fn() }));

describe.skipIf(!DATABASE_URL)("stock ledger replay (real database)", () => {
  let db: typeof DbModule.db;
  let asset: typeof AssetService;
  let ledger: typeof Ledger;
  let consumption: typeof ConsumptionLogService;
  let location: typeof LocationService;
  let booking: typeof BookingService;
  let availability: typeof Availability;
  let checkedOut: typeof CheckedOut;
  let conflicts: typeof StockConflicts;
  let bookedOut: typeof UnitsOutBySource;

  const stamp = Date.now().toString(36);
  const hints = { timeZone: "UTC", locale: "en-US" };
  const request = () => new Request("http://localhost");
  let userId = "";
  let organizationId = "";
  let teamMemberId = "";
  const loc = { camera: "", studio: "", spare: "" };

  beforeAll(async () => {
    // The test environment points Prisma at a placeholder; the client is
    // built on first import, so switch the URL before importing anything.
    process.env.DATABASE_URL = DATABASE_URL ?? "";
    process.env.DIRECT_URL = DATABASE_URL ?? "";
    delete (globalThis as { __db__?: unknown }).__db__;

    ({ db } = await import("~/database/db.server"));
    asset = await import("~/modules/asset/service.server");
    ledger = await import("./stock-ledger");
    consumption = await import("./service.server");
    location = await import("~/modules/location/service.server");
    booking = await import("~/modules/booking/service.server");
    availability = await import("~/modules/asset/availability.server");
    checkedOut = await import("~/modules/booking/checked-out.server");
    conflicts = await import("~/modules/booking/stock-conflicts.server");
    bookedOut = await import("~/modules/booking/units-out-by-source.server");

    const user = await db.user.create({
      data: {
        email: `stock-ledger-test-${stamp}@example.com`,
        firstName: "Ledger",
        lastName: "Test",
      },
    });
    userId = user.id;
    const organization = await db.organization.create({
      data: { name: `Stock ledger test ${stamp}`, userId },
    });
    organizationId = organization.id;
    teamMemberId = (
      await db.teamMember.create({
        data: { name: "Ahmed", organizationId },
      })
    ).id;
    for (const key of Object.keys(loc) as Array<keyof typeof loc>) {
      loc[key] = (
        await db.location.create({
          data: { name: `Ledger ${key}`, userId, organizationId },
        })
      ).id;
    }
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    if (organizationId) {
      await db.organization.delete({ where: { id: organizationId } });
      await db.$executeRawUnsafe(
        `DROP SEQUENCE IF EXISTS "org_${organizationId}_asset_sequence"`
      );
    }
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  }, 60_000);

  /** The live stock of a pool, in the shape a ledger replay returns. */
  async function liveStock(assetId: string) {
    const [row, placements] = await Promise.all([
      db.asset.findUniqueOrThrow({
        where: { id: assetId, organizationId },
        select: { quantity: true },
      }),
      db.assetLocation.findMany({
        where: { assetId, organizationId, assetKitId: null },
        select: { locationId: true, quantity: true },
      }),
    ]);
    const total = row.quantity ?? 0;
    const byPlace = new Map<string, number>();
    let placed = 0;
    for (const placement of placements) {
      byPlace.set(placement.locationId, placement.quantity);
      placed += placement.quantity;
    }
    if (total - placed !== 0) byPlace.set("", total - placed);
    return { total, byPlace };
  }

  /** The pool's ledger rows, oldest first. */
  function ledgerRows(assetId: string) {
    return db.consumptionLog.findMany({
      where: { assetId, stockChange: { not: null } },
      select: {
        category: true,
        quantity: true,
        stockChange: true,
        locationId: true,
        bookingAssetId: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * The definition of done: the rows replay to the live stock, a move never
   * changes the total, and every row's quantity is the size of its change.
   */
  async function expectLedgerMatchesLive(assetId: string) {
    const rows = await ledgerRows(assetId);
    expect(ledger.replayStockLedger(rows)).toEqual(await liveStock(assetId));
    const moved = rows
      .filter((row) => row.category === "MOVE")
      .reduce((sum, row) => sum + (row.stockChange ?? 0), 0);
    expect(moved).toBe(0);
    for (const row of rows) {
      if (row.category === "CHECKOUT" || row.category === "RETURN") {
        expect(row.stockChange).toBe(0);
      } else {
        expect(row.quantity).toBe(Math.abs(row.stockChange ?? 0));
      }
    }
    return rows;
  }

  /** Rows added by the step that just ran, as `[category, locationId, stockChange]`. */
  function lastRows(
    rows: Awaited<ReturnType<typeof ledgerRows>>,
    count: number
  ) {
    return rows
      .slice(-count)
      .map((row) => [row.category, row.locationId, row.stockChange]);
  }

  async function createPool({
    title,
    quantity,
    locationId,
    consumptionType = "ONE_WAY",
  }: {
    title: string;
    quantity: number;
    locationId?: string;
    consumptionType?: "ONE_WAY" | "TWO_WAY";
  }) {
    return asset.createAsset({
      title,
      description: null,
      userId,
      organizationId,
      categoryId: null,
      valuation: null,
      type: "QUANTITY_TRACKED",
      quantity,
      consumptionType,
      unitOfMeasure: "pcs",
      locationId,
    });
  }

  /** An ONGOING booking with one standalone slice already checked out. */
  async function bookingWithSlice({
    assetId,
    quantity,
    sourceLocationId,
  }: {
    assetId: string;
    quantity: number;
    sourceLocationId: string | null;
  }) {
    const created = await db.booking.create({
      data: {
        name: `Ledger booking ${stamp}`,
        creatorId: userId,
        organizationId,
        status: "ONGOING",
        from: new Date(Date.now() - 86_400_000),
        to: new Date(Date.now() + 86_400_000),
        custodianTeamMemberId: teamMemberId,
      },
    });
    const slice = await db.bookingAsset.create({
      data: {
        bookingId: created.id,
        assetId,
        quantity,
        checkedOutAt: new Date(),
        checkedOutById: userId,
        checkedOutQuantity: quantity,
        sourceLocationId,
      },
    });
    return { bookingId: created.id, sliceId: slice.id };
  }

  it("records every stock change of a new pool, and replays to its live stock", async () => {
    const pool = await createPool({
      title: "Gloves",
      quantity: 100,
      locationId: loc.camera,
    });
    const id = pool.id;
    let rows = await expectLedgerMatchesLive(id);
    expect(lastRows(rows, 1)).toEqual([["INITIAL", loc.camera, 100]]);

    // Adjust quantity: restock at a location, a total-only correction, a
    // total-only loss (from the unplaced units).
    const adjust = (
      args: Partial<Parameters<typeof consumption.adjustQuantity>[0]>
    ) =>
      consumption.adjustQuantity({
        assetId: id,
        userId,
        organizationId,
        quantity: 1,
        category: "RESTOCK",
        direction: "add",
        ...args,
      });
    await adjust({ quantity: 20, locationId: loc.studio });
    await adjust({ quantity: 5, category: "ADJUSTMENT" });
    await adjust({ quantity: 3, category: "LOSS", direction: "subtract" });
    rows = await expectLedgerMatchesLive(id);
    expect(lastRows(rows, 3)).toEqual([
      ["RESTOCK", loc.studio, 20],
      ["ADJUSTMENT", null, 5],
      ["LOSS", null, -3],
    ]);

    // Move between locations, then place the unplaced units.
    await asset.moveAssetLocationUnits({
      assetId: id,
      organizationId,
      userId,
      fromLocationId: loc.camera,
      toLocationId: loc.studio,
      quantity: 30,
    });
    await asset.placeUnplacedUnits({
      assetId: id,
      organizationId,
      userId,
      toLocationId: loc.camera,
      quantity: 2,
    });
    rows = await expectLedgerMatchesLive(id);
    expect(lastRows(rows, 4)).toEqual([
      ["MOVE", loc.camera, -30],
      ["MOVE", loc.studio, 30],
      ["MOVE", null, -2],
      ["MOVE", loc.camera, 2],
    ]);

    // Manage placements: lower both locations, the rest becomes unplaced.
    await asset.replaceAssetPlacements({
      assetId: id,
      organizationId,
      userId,
      placements: [
        { locationId: loc.camera, quantity: 60 },
        { locationId: loc.studio, quantity: 40 },
      ],
    });
    await expectLedgerMatchesLive(id);

    // Location page: add the pool at a third location, change its count
    // there, then remove it.
    const locationPage = (
      args: Partial<Parameters<typeof location.updateLocationAssets>[0]>
    ) =>
      location.updateLocationAssets({
        organizationId,
        userId,
        locationId: loc.spare,
        request: request(),
        assetIds: [id],
        removedAssetIds: [],
        ...args,
      });
    await locationPage({ assetQuantities: { [id]: 10 } });
    await expectLedgerMatchesLive(id);
    await locationPage({ assetQuantities: { [id]: 6 } });
    await expectLedgerMatchesLive(id);
    await locationPage({ assetIds: [], removedAssetIds: [id] });
    await expectLedgerMatchesLive(id);

    // Custody: hand-out and return change no stock; consumed units leave
    // the location the custody came from.
    const assign = (quantity: number, locationId: string | null) =>
      asset.checkOutQuantity({
        assetId: id,
        teamMemberId,
        quantity,
        userId,
        organizationId,
        role: "ADMIN",
        locationId: locationId ?? "",
      });
    await assign(10, loc.studio);
    await asset.releaseQuantity({
      assetId: id,
      teamMemberId,
      quantity: 10,
      consumed: 6,
      userId,
      organizationId,
      role: "ADMIN",
    });
    rows = await expectLedgerMatchesLive(id);
    expect(
      rows
        .filter((row) => row.category === "CONSUME")
        .map((row) => [row.locationId, row.stockChange])
    ).toEqual([[loc.studio, -6]]);

    // Custody from the unplaced units, consumed there.
    await assign(4, null);
    await asset.releaseQuantity({
      assetId: id,
      teamMemberId,
      quantity: 4,
      userId,
      organizationId,
      role: "ADMIN",
    });
    rows = await expectLedgerMatchesLive(id);
    expect(lastRows(rows, 1)).toEqual([["CONSUME", null, -4]]);

    // Edit form: the total up, then down; then the location dialog
    // collapsing every placement into one; then a total change and a new
    // location in one save.
    const current = async () =>
      (
        await db.asset.findUniqueOrThrow({
          where: { id, organizationId },
          select: { quantity: true },
        })
      ).quantity ?? 0;
    const edit = (args: Partial<Parameters<typeof asset.updateAsset>[0]>) =>
      asset.updateAsset({
        id,
        userId,
        organizationId,
        request: request(),
        ...args,
      });
    await edit({ quantity: (await current()) + 10 });
    await edit({ quantity: (await current()) - 5 });
    rows = await expectLedgerMatchesLive(id);
    expect(lastRows(rows, 2)).toEqual([
      ["ADJUSTMENT", null, 10],
      ["ADJUSTMENT", null, -5],
    ]);
    await edit({
      currentLocationId: loc.camera,
      newLocationId: loc.camera,
      newLocationQuantity: 50,
    });
    await expectLedgerMatchesLive(id);
    await edit({
      quantity: (await current()) + 8,
      currentLocationId: loc.camera,
      newLocationId: loc.studio,
    });
    rows = await expectLedgerMatchesLive(id);
    expect(rows.filter((row) => row.category === "ADJUSTMENT").at(-1)).toEqual(
      expect.objectContaining({ locationId: loc.studio, stockChange: 8 })
    );

    // Booking check-in: a partial check-in with every disposition, then
    // the rest consumed by the full check-in.
    const { bookingId, sliceId } = await bookingWithSlice({
      assetId: id,
      quantity: 10,
      sourceLocationId: loc.studio,
    });
    await booking.partialCheckinBooking({
      id: bookingId,
      organizationId,
      userId,
      hints,
      checkins: [
        {
          assetId: id,
          bookingAssetId: sliceId,
          returned: 2,
          consumed: 3,
          lost: 1,
          damaged: 1,
        },
      ],
    });
    rows = await expectLedgerMatchesLive(id);
    expect(lastRows(rows, 3)).toEqual([
      ["CONSUME", loc.studio, -3],
      ["LOSS", loc.studio, -1],
      ["DAMAGE", loc.studio, -1],
    ]);
    await booking.checkinBooking({
      id: bookingId,
      organizationId,
      userId,
      hints,
    });
    rows = await expectLedgerMatchesLive(id);
    expect(lastRows(rows, 1)).toEqual([["CONSUME", loc.studio, -3]]);

    // Deleting a location: its placement goes, and its rows fall to the
    // unplaced units with it.
    await asset.replaceAssetPlacements({
      assetId: id,
      organizationId,
      userId,
      placements: [
        { locationId: loc.studio, quantity: 20 },
        { locationId: loc.spare, quantity: 7 },
      ],
    });
    await expectLedgerMatchesLive(id);
    await location.deleteLocation({ id: loc.spare, organizationId });
    await expectLedgerMatchesLive(id);
  }, 120_000);

  it("takes an opening balance before the first change of a pool from before the ledger", async () => {
    // Written straight to the tables, as a pool created before the ledger.
    const legacy = await db.asset.create({
      data: {
        title: "Spanner",
        type: "QUANTITY_TRACKED",
        quantity: 40,
        consumptionType: "TWO_WAY",
        userId,
        organizationId,
        assetLocations: {
          create: [
            { locationId: loc.camera, organizationId, quantity: 25 },
            { locationId: loc.studio, organizationId, quantity: 10 },
          ],
        },
      },
    });

    await consumption.adjustQuantity({
      assetId: legacy.id,
      userId,
      organizationId,
      quantity: 2,
      category: "LOSS",
      direction: "subtract",
      locationId: loc.camera,
    });

    const rows = await expectLedgerMatchesLive(legacy.id);
    expect(
      rows.map((row) => [row.category, row.locationId, row.stockChange])
    ).toEqual([
      ["OPENING_BALANCE", null, 5],
      ["OPENING_BALANCE", loc.camera, 25],
      ["OPENING_BALANCE", loc.studio, 10],
      ["LOSS", loc.camera, -2],
    ]);
    const started = await db.asset.findUniqueOrThrow({
      where: { id: legacy.id, organizationId },
      select: { stockLedgerStartedAt: true },
    });
    expect(started.stockLedgerStartedAt).toBeInstanceOf(Date);

    // The next change writes no second opening balance.
    await asset.moveAssetLocationUnits({
      assetId: legacy.id,
      organizationId,
      userId,
      fromLocationId: loc.studio,
      toLocationId: loc.camera,
      quantity: 4,
    });
    const after = await expectLedgerMatchesLive(legacy.id);
    expect(
      after.filter((row) => row.category === "OPENING_BALANCE")
    ).toHaveLength(3);
  }, 60_000);

  it("replays a pool whose placements exceed its total, with negative unplaced units", async () => {
    const drifted = await db.asset.create({
      data: {
        title: "Drifted",
        type: "QUANTITY_TRACKED",
        quantity: 13,
        consumptionType: "ONE_WAY",
        userId,
        organizationId,
        assetLocations: {
          create: [
            { locationId: loc.camera, organizationId, quantity: 8 },
            { locationId: loc.studio, organizationId, quantity: 5 },
          ],
        },
      },
    });
    // No trigger fires on an Asset write, which is how pools drift.
    await db.asset.update({
      where: { id: drifted.id, organizationId },
      data: { quantity: 10 },
    });

    // A restock on the total brings it back above the placements. (A move
    // is refused while the pool is drifted: the placement trigger checks
    // the sum on every placement write.)
    await consumption.adjustQuantity({
      assetId: drifted.id,
      userId,
      organizationId,
      quantity: 5,
      category: "RESTOCK",
      direction: "add",
    });

    const rows = await expectLedgerMatchesLive(drifted.id);
    expect(
      rows.map((row) => [row.category, row.locationId, row.stockChange])
    ).toEqual([
      ["OPENING_BALANCE", null, -3],
      ["OPENING_BALANCE", loc.camera, 8],
      ["OPENING_BALANCE", loc.studio, 5],
      ["RESTOCK", null, 5],
    ]);
    expect(rows[0].quantity).toBe(3);
  }, 60_000);

  it("records the stock a backup restores", async () => {
    await asset.createAssetsFromBackupImport({
      userId,
      organizationId,
      data: [
        {
          id: "backup-row",
          title: `Restored cable ${stamp}`,
          description: "",
          category: {},
          tags: [],
          location: {},
          custody: {},
          customFields: [],
          notes: [],
          status: "AVAILABLE",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          valuation: null,
          mainImage: null,
          type: "QUANTITY_TRACKED",
          quantity: "12",
          consumptionType: "TWO_WAY",
        },
      ] as unknown as Parameters<
        typeof asset.createAssetsFromBackupImport
      >[0]["data"],
    });
    const restored = await db.asset.findFirstOrThrow({
      where: { organizationId, title: `Restored cable ${stamp}` },
      select: { id: true },
    });
    const rows = await expectLedgerMatchesLive(restored.id);
    expect(lastRows(rows, 1)).toEqual([["INITIAL", null, 12]]);
  }, 60_000);

  it("gives the ledger readers the same numbers whether a disposition is one row or split", async () => {
    // 17 at Camera, 3 unplaced. A slice with no recorded source consumes 5:
    // the unplaced units go first, then Camera, so the ledger splits the
    // CONSUME over two places.
    const pool = await createPool({ title: "Tape", quantity: 20 });
    await asset.placeUnplacedUnits({
      assetId: pool.id,
      organizationId,
      userId,
      toLocationId: loc.camera,
      quantity: 17,
    });
    const { bookingId, sliceId } = await bookingWithSlice({
      assetId: pool.id,
      quantity: 10,
      sourceLocationId: null,
    });
    await booking.partialCheckinBooking({
      id: bookingId,
      organizationId,
      userId,
      hints,
      checkins: [{ assetId: pool.id, bookingAssetId: sliceId, consumed: 5 }],
    });
    const rows = await expectLedgerMatchesLive(pool.id);
    expect(lastRows(rows, 2)).toEqual([
      ["CONSUME", null, -3],
      ["CONSUME", loc.camera, -2],
    ]);

    const bookingRow = await db.booking.findUniqueOrThrow({
      where: { id: bookingId, organizationId },
      select: { id: true, status: true, from: true, to: true },
    });
    const readAll = async () => {
      const dispositions = await db.consumptionLog.findMany({
        where: {
          bookingId,
          category: { in: ["RETURN", "CONSUME", "LOSS", "DAMAGE"] },
        },
        select: { bookingAssetId: true, category: true, quantity: true },
      });
      return {
        availability: await availability.getAssetAvailability({
          assetId: pool.id,
          organizationId,
        }),
        availabilityBatch: [
          ...(
            await availability.getAssetAvailabilityBatch([pool.id], {
              organizationId,
              window: null,
            })
          ).entries(),
        ],
        bookingAvailable: await consumption.computeBookingAvailableQuantity(
          pool.id
        ),
        checkedOut: await checkedOut.computeCheckedOutForAsset(
          db,
          pool.id,
          organizationId
        ),
        checkedOutByBooking: [
          ...(
            await checkedOut.computeCheckedOutByBookingForAsset(
              db,
              pool.id,
              organizationId
            )
          ).entries(),
        ],
        conflicts: [
          ...(await conflicts.flagBookingStockConflicts({
            organizationId,
            bookings: [{ ...bookingRow, qtyAssetIds: [pool.id] }],
          })),
        ],
        remaining: await booking.computeBookingAssetRemaining(
          db,
          bookingId,
          pool.id
        ),
        sliceRemaining: await booking.computeBookingAssetSliceRemaining(
          db,
          bookingId,
          sliceId
        ),
        bookedOutBySource: [
          ...(
            await bookedOut.loadBookedOutBySource(db, {
              assetIds: [pool.id],
              organizationId,
            })
          ).entries(),
        ],
        attribution: [
          ...booking
            .attributeCategorizedDispositionsByBookingAsset({
              bookingAssetRows: [
                { id: sliceId, quantity: 10, assetKitId: null },
              ],
              consumptionLogs: dispositions as Array<{
                bookingAssetId: string | null;
                category: "RETURN" | "CONSUME" | "LOSS" | "DAMAGE";
                quantity: number;
              }>,
            })
            .entries(),
        ],
      };
    };

    const split = await readAll();
    expect(split.remaining).toBe(5);
    expect(split.sliceRemaining).toBe(5);
    expect(split.bookingAvailable).toEqual(
      expect.objectContaining({ total: 15, reserved: 5, available: 10 })
    );

    // The same disposition as one row, the shape the log had before the
    // ledger recorded places.
    const consumeRows = await db.consumptionLog.findMany({
      where: { bookingId, category: "CONSUME" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    await db.consumptionLog.delete({ where: { id: consumeRows[1].id } });
    await db.consumptionLog.update({
      where: { id: consumeRows[0].id },
      data: { quantity: 5, stockChange: null, locationId: null },
    });
    const single = await readAll();

    expect(single).toEqual(split);
  }, 60_000);
});
