/**
 * `createAssetsFromStock` around its transaction: the input it refuses
 * before touching the database, and the retry when another writer takes a
 * sequential id between allocation and insert.
 *
 * The transaction's own rows (the lock, the checks, the assets, the
 * rollback) need a real database and are pinned in
 * `create-from-stock.db.test.ts`.
 *
 * @see {@link file://./create-from-stock.server.ts}
 */

import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/database/db.server";
import { writeAdjustmentLocationNotes } from "~/modules/consumption-log/service.server";
import { createAssetsFromStock } from "./create-from-stock.server";

// why: the transaction is the boundary under test; each call either
// collides or returns what a committed conversion returns
vi.mock("~/database/db.server", () => ({
  db: { $transaction: vi.fn() },
}));

// why: the after-commit writers have their own tests and touch storage,
// notes and notifications
vi.mock("~/modules/consumption-log/service.server", () => ({
  applyQuantityAdjustment: vi.fn(),
  writeAdjustmentLocationNotes: vi.fn(),
}));
vi.mock("~/modules/consumption-log/low-stock.server", () => ({
  checkAndNotifyLowStock: vi.fn(),
}));
vi.mock("~/modules/location-note/service.server", () => ({
  createAssetLocationMoveNotes: vi.fn(),
  firstPlacementMove: vi.fn(),
}));

const mockTransaction = vi.mocked(db.$transaction);

const input = {
  poolId: "pool-1",
  organizationId: "org-1",
  userId: "user-1",
  count: 2,
  source: "unplaced",
  title: "Reel",
};

/** What a committed conversion hands to the after-commit step. */
const committed = {
  pool: { id: "pool-1", mainImage: null },
  created: [
    { id: "a1", title: "Reel 1", type: "INDIVIDUAL", unitOfMeasure: null },
    { id: "a2", title: "Reel 2", type: "INDIVIDUAL", unitOfMeasure: null },
  ],
  adjustment: {
    asset: { organizationId: "org-1" },
    location: { locationId: null, locationName: null, multiSource: false },
    placementChange: null,
  },
  actor: { id: "user-1", displayName: "Ana" },
};

function collision(target: string) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: [target] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAssetsFromStock", () => {
  it("tries again when a sequential id was taken, and returns the attempt that committed", async () => {
    mockTransaction
      .mockRejectedValueOnce(collision("sequentialId"))
      .mockResolvedValueOnce(committed as never);

    const result = await createAssetsFromStock(input);

    expect(mockTransaction).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      assets: [
        { id: "a1", title: "Reel 1" },
        { id: "a2", title: "Reel 2" },
      ],
      locationId: null,
    });
    expect(writeAdjustmentLocationNotes).toHaveBeenCalledTimes(1);
  });

  it("gives up after three collisions, with nothing written after a commit", async () => {
    mockTransaction.mockRejectedValue(collision("sequentialId"));

    await expect(createAssetsFromStock(input)).rejects.toMatchObject({
      status: 500,
    });
    expect(mockTransaction).toHaveBeenCalledTimes(3);
    expect(writeAdjustmentLocationNotes).not.toHaveBeenCalled();
  });

  it("does not retry any other unique violation", async () => {
    mockTransaction.mockRejectedValue(collision("value"));

    await expect(createAssetsFromStock(input)).rejects.toBeTruthy();
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("refuses a count outside 1 to 25 or a blank name without opening a transaction", async () => {
    for (const bad of [
      { count: 0 },
      { count: 26 },
      { count: 1.5 },
      { title: "   " },
    ]) {
      await expect(
        createAssetsFromStock({ ...input, ...bad })
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
