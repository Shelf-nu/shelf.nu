/**
 * Tests for the bookings-list row flags.
 *
 * The "Includes unavailable assets" badge used to be computed in the browser
 * by walking each row's `bookingAssets`; it now lives in a Prisma `where`.
 * That move is exactly why these tests assert on MEANING and not only on
 * shape: a clause can be present and still be composed so that something else
 * widens it away, and a badge that silently starts flagging every
 * quantity-tracked booking is the regression this file exists to prevent — it
 * scared a customer off a booking that had already checked out cleanly.
 *
 * The three asset cases below are ported from
 * `list-bookings-content.test.tsx`, which owned them while the check was
 * client-side.
 *
 * @see {@link file://./list-flags.server.ts}
 */
import type { Prisma } from "@prisma/client";

import { db } from "~/database/db.server";
import {
  getBookingIdsWithItemsToCheckOut,
  decorateBookingsForList,
  getBookingIdsWithUnavailableAssets,
} from "./list-flags.server";
import { decorateBookingsWithStockConflicts } from "./stock-conflicts.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// why: the subject is the `where` this module builds, not what a database
// returns, so the client is mocked to capture the argument.
vitest.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findMany: vitest.fn().mockResolvedValue([]),
    },
    // A field reference, compared by identity in the captured `where`.
    bookingAsset: { fields: { quantity: "BookingAsset.quantity" } },
  },
}));

// why: `decorateBookingsForList` composes the stock-conflict decorator, which
// has its own 1000-line suite. Mocking it keeps these tests about the second
// flag and the composition, not about stock maths.
vitest.mock("./stock-conflicts.server", () => ({
  decorateBookingsWithStockConflicts: vitest.fn(),
}));

const findManyMock = db.booking.findMany as unknown as ReturnType<
  typeof vitest.fn
>;
const stockDecoratorMock =
  decorateBookingsWithStockConflicts as unknown as ReturnType<typeof vitest.fn>;

const ORG_ID = "org-1";

/** The subset of asset columns the unavailability predicate reads. */
type CandidateAsset = {
  type: "INDIVIDUAL" | "QUANTITY_TRACKED";
  availableToBook: boolean;
  custody: unknown[];
};

/**
 * Evaluates the captured asset predicate against a candidate asset.
 *
 * Models only the operator subset {@link getBookingIdsWithUnavailableAssets}
 * emits and **throws on anything else**, so an unmodelled operator fails
 * loudly instead of quietly reporting a match.
 *
 * @param clause - A node of the captured `asset` where-input
 * @param asset - The candidate asset
 * @returns Whether the clause matches
 */
function assetMatches(
  clause: Prisma.AssetWhereInput,
  asset: CandidateAsset
): boolean {
  const entries = Object.entries(clause);
  if (entries.length === 0) {
    return true;
  }

  return entries.every(([key, value]) => {
    switch (key) {
      case "OR":
        return (value as Prisma.AssetWhereInput[]).some((sub) =>
          assetMatches(sub, asset)
        );
      case "AND":
        return (value as Prisma.AssetWhereInput[]).every((sub) =>
          assetMatches(sub, asset)
        );
      case "availableToBook":
        return asset.availableToBook === value;
      case "type": {
        const operator = value as { not?: string };
        if (typeof operator?.not !== "string") {
          throw new Error(`Unmodelled type operator: ${JSON.stringify(value)}`);
        }
        return asset.type !== operator.not;
      }
      case "custody": {
        const operator = value as { some?: Record<string, unknown> };
        if (!operator?.some || Object.keys(operator.some).length > 0) {
          throw new Error(
            `Unmodelled custody operator: ${JSON.stringify(value)}`
          );
        }
        return asset.custody.length > 0;
      }
      default:
        throw new Error(`Unmodelled asset clause: ${key}`);
    }
  });
}

/**
 * Runs the lookup and returns the `asset` predicate it handed to Prisma.
 *
 * @returns The captured asset where-input
 */
async function captureAssetPredicate(): Promise<Prisma.AssetWhereInput> {
  await getBookingIdsWithUnavailableAssets({
    bookingIds: ["booking-1"],
    organizationId: ORG_ID,
  });

  const where = findManyMock.mock.calls[0][0].where as Prisma.BookingWhereInput;

  return (
    where.bookingAssets as {
      some: { asset: Prisma.AssetWhereInput };
    }
  ).some.asset;
}

beforeEach(() => {
  vitest.clearAllMocks();
  findManyMock.mockResolvedValue([]);
  stockDecoratorMock.mockImplementation(
    ({ bookings }: { bookings: Array<{ id: string }> }) =>
      Promise.resolve(
        bookings.map((booking) => ({ ...booking, hasStockConflict: false }))
      )
  );
});

describe("getBookingIdsWithUnavailableAssets — which assets count", () => {
  it("does NOT flag a quantity-tracked asset that merely has units on custody", async () => {
    const predicate = await captureAssetPredicate();

    // 20 of 29 units are with a custodian; the booking drew on the free 9.
    expect(
      assetMatches(predicate, {
        type: "QUANTITY_TRACKED",
        availableToBook: true,
        custody: [{ id: "custody-1", quantity: 20 }],
      })
    ).toBe(false);
  });

  it("DOES flag an individual asset in custody — one custodian holds the one thing", async () => {
    const predicate = await captureAssetPredicate();

    expect(
      assetMatches(predicate, {
        type: "INDIVIDUAL",
        availableToBook: true,
        custody: [{ id: "custody-1" }],
      })
    ).toBe(true);
  });

  it("DOES flag a quantity-tracked asset marked as not available to book", async () => {
    const predicate = await captureAssetPredicate();

    // `availableToBook` is type-agnostic: the flag means "never bookable".
    expect(
      assetMatches(predicate, {
        type: "QUANTITY_TRACKED",
        availableToBook: false,
        custody: [],
      })
    ).toBe(true);
  });

  it("does NOT flag a bookable asset nobody holds", async () => {
    const predicate = await captureAssetPredicate();

    expect(
      assetMatches(predicate, {
        type: "INDIVIDUAL",
        availableToBook: true,
        custody: [],
      })
    ).toBe(false);
  });
});

describe("getBookingIdsWithUnavailableAssets — scoping", () => {
  it("scopes to the caller's organization", async () => {
    await getBookingIdsWithUnavailableAssets({
      bookingIds: ["booking-1"],
      organizationId: ORG_ID,
    });

    const where = findManyMock.mock.calls[0][0]
      .where as Prisma.BookingWhereInput;

    expect(where.organizationId).toBe(ORG_ID);
    expect(where.id).toEqual({ in: ["booking-1"] });
  });

  it("leaves settled bookings unflagged — a finished booking has no problem to report", async () => {
    await getBookingIdsWithUnavailableAssets({
      bookingIds: ["booking-1"],
      organizationId: ORG_ID,
    });

    const where = findManyMock.mock.calls[0][0]
      .where as Prisma.BookingWhereInput;

    expect(where.status).toEqual({
      notIn: ["COMPLETE", "CANCELLED", "ARCHIVED"],
    });
  });

  it("issues no query at all for an empty page", async () => {
    const flagged = await getBookingIdsWithUnavailableAssets({
      bookingIds: [],
      organizationId: ORG_ID,
    });

    expect(findManyMock).not.toHaveBeenCalled();
    expect(flagged.size).toBe(0);
  });

  it("returns the ids the query matched", async () => {
    findManyMock.mockResolvedValue([{ id: "booking-2" }]);

    const flagged = await getBookingIdsWithUnavailableAssets({
      bookingIds: ["booking-1", "booking-2"],
      organizationId: ORG_ID,
    });

    expect([...flagged]).toEqual(["booking-2"]);
  });
});

/**
 * The row's "Check out remaining" button is offered only when the server's
 * "Check out remaining" would find something to send: a quantity-tracked
 * slice with units left, or an individual item that is Available and was not
 * returned by a partial check-in. The query narrows to candidate slices; the
 * partial check-in exclusion runs on its result.
 */
describe("getBookingIdsWithItemsToCheckOut", () => {
  /** One slice as the lookup returns it. */
  type Slice = {
    id: string;
    assetId: string;
    quantity: number;
    assetKitId: string | null;
    checkedOutAt: Date | null;
    checkedInAt: Date | null;
    asset: { type: "INDIVIDUAL" | "QUANTITY_TRACKED"; status: string };
  };

  const OUT = new Date("2026-10-01T09:00:00Z");
  const BACK = new Date("2026-10-02T09:00:00Z");

  /** A slice with sensible defaults: one unit, standalone, never sent out. */
  function slice(overrides: Partial<Slice> & Pick<Slice, "id" | "assetId">) {
    return {
      quantity: 1,
      assetKitId: null,
      checkedOutAt: null,
      checkedInAt: null,
      asset: { type: "INDIVIDUAL" as const, status: "AVAILABLE" },
      ...overrides,
    };
  }

  /** A booking as the lookup returns it. */
  function lookupRow(
    id: string,
    {
      slices = [],
      checkouts = [],
      returned = [],
    }: {
      slices?: Slice[];
      checkouts?: {
        assetIds: string[];
        quantities: number[];
        bookingAssetIds: string[];
      }[];
      returned?: string[];
    } = {}
  ) {
    return {
      id,
      bookingAssets: slices,
      partialCheckouts: checkouts,
      partialCheckins: returned.length ? [{ assetIds: returned }] : [],
    };
  }

  async function flagged(row: ReturnType<typeof lookupRow>) {
    findManyMock.mockResolvedValue([row]);
    return getBookingIdsWithItemsToCheckOut({
      bookingIds: [row.id],
      organizationId: ORG_ID,
    });
  }

  it("flags a booking with an individual item that is free to go out", async () => {
    const ids = await flagged(
      lookupRow("b1", { slices: [slice({ id: "s1", assetId: "a1" })] })
    );

    expect(ids).toEqual(new Set(["b1"]));
  });

  it("does not flag an item a partial check-in already returned", async () => {
    const ids = await flagged(
      lookupRow("b1", {
        slices: [slice({ id: "s1", assetId: "a1" })],
        returned: ["a1"],
      })
    );

    expect(ids.size).toBe(0);
  });

  it("does not flag a booking with no candidate slice, such as an item busy elsewhere", async () => {
    // An individual item in custody or out on another booking is not
    // Available, so the query returns no slice for it.
    const ids = await flagged(lookupRow("b1"));

    expect(ids.size).toBe(0);
  });

  it("does not flag a quantity-tracked slice sent out in full with one click", async () => {
    const ids = await flagged(
      lookupRow("b1", {
        slices: [
          slice({
            id: "s1",
            assetId: "q1",
            quantity: 10,
            checkedOutAt: OUT,
            asset: { type: "QUANTITY_TRACKED", status: "CHECKED_OUT" },
          }),
        ],
      })
    );

    expect(ids.size).toBe(0);
  });

  it("flags a quantity-tracked slice only partly sent out by scanning", async () => {
    const ids = await flagged(
      lookupRow("b1", {
        slices: [
          slice({
            id: "s1",
            assetId: "q1",
            quantity: 10,
            checkedOutAt: OUT,
            asset: { type: "QUANTITY_TRACKED", status: "CHECKED_OUT" },
          }),
        ],
        checkouts: [
          { assetIds: ["q1"], quantities: [3], bookingAssetIds: ["s1"] },
        ],
      })
    );

    expect(ids).toEqual(new Set(["b1"]));
  });

  it("flags a quantity-tracked slice that came back in full while a sibling slice is still out", async () => {
    // Two slices of one pool, sent out together with one click. A partial
    // check-in returned the kit slice in full; the standalone slice still
    // owes its units, so the asset is not on the check-in's list. The server
    // offers to send the returned slice again, so the row has to as well.
    const ids = await flagged(
      lookupRow("b1", {
        slices: [
          slice({
            id: "s-loose",
            assetId: "q1",
            quantity: 4,
            checkedOutAt: OUT,
            asset: { type: "QUANTITY_TRACKED", status: "CHECKED_OUT" },
          }),
          slice({
            id: "s-kit",
            assetId: "q1",
            quantity: 2,
            assetKitId: "ak1",
            checkedOutAt: OUT,
            checkedInAt: BACK,
            asset: { type: "QUANTITY_TRACKED", status: "CHECKED_OUT" },
          }),
        ],
      })
    );

    expect(ids).toEqual(new Set(["b1"]));
  });

  it("asks for underway bookings, their candidate slices and both kinds of session", async () => {
    findManyMock.mockResolvedValue([]);

    await getBookingIdsWithItemsToCheckOut({
      bookingIds: ["booking-1", "booking-2"],
      organizationId: ORG_ID,
    });

    const [{ where, select }] = findManyMock.mock.calls[0] as [
      { where: Record<string, unknown>; select: Record<string, unknown> },
    ];
    expect(where).toEqual({
      id: { in: ["booking-1", "booking-2"] },
      organizationId: ORG_ID,
      status: { in: ["ONGOING", "OVERDUE"] },
    });
    expect(select).toMatchObject({
      bookingAssets: {
        // Every slice of a quantity-tracked pool (the claim attribution needs
        // the siblings), and individual items only while they are Available.
        where: {
          OR: [
            { asset: { type: "QUANTITY_TRACKED" } },
            { asset: { type: "INDIVIDUAL", status: "AVAILABLE" } },
          ],
        },
      },
      partialCheckouts: {
        select: { assetIds: true, quantities: true, bookingAssetIds: true },
      },
      partialCheckins: { select: { assetIds: true } },
    });
  });

  it("skips the query for an empty page", async () => {
    const ids = await getBookingIdsWithItemsToCheckOut({
      bookingIds: [],
      organizationId: ORG_ID,
    });

    expect(ids.size).toBe(0);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});

describe("decorateBookingsForList", () => {
  const BOOKINGS = [
    { id: "booking-1", status: "RESERVED", from: null, to: null },
    { id: "booking-2", status: "RESERVED", from: null, to: null },
  ] as unknown as Parameters<typeof decorateBookingsForList>[0]["bookings"];

  /**
   * The two lookups share `db.booking.findMany`; tell them apart by what each
   * one selects. The items lookup also reads the partial check-ins.
   */
  function answerLookups({
    unavailable,
    itemsToCheckOut,
  }: {
    unavailable: string[];
    itemsToCheckOut: string[];
  }) {
    findManyMock.mockImplementation(
      ({ select }: { select: Record<string, unknown> }) => {
        if ("partialCheckins" in select) {
          return Promise.resolve(
            itemsToCheckOut.map((id) => ({
              id,
              bookingAssets: [
                {
                  id: `${id}-slice`,
                  assetId: `${id}-asset`,
                  quantity: 1,
                  assetKitId: null,
                  checkedOutAt: null,
                  checkedInAt: null,
                  asset: { type: "INDIVIDUAL", status: "AVAILABLE" },
                },
              ],
              partialCheckouts: [],
              partialCheckins: [],
            }))
          );
        }
        return Promise.resolve(unavailable.map((id) => ({ id })));
      }
    );
  }

  it("attaches all three flags, preserving the row's own fields", async () => {
    answerLookups({
      unavailable: ["booking-2"],
      itemsToCheckOut: ["booking-1"],
    });

    const rows = await decorateBookingsForList({
      bookings: BOOKINGS,
      organizationId: ORG_ID,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        id: "booking-1",
        status: "RESERVED",
        hasStockConflict: false,
        hasUnavailableAssets: false,
        hasItemsToCheckOut: true,
      }),
      expect.objectContaining({
        id: "booking-2",
        hasStockConflict: false,
        hasUnavailableAssets: true,
        hasItemsToCheckOut: false,
      }),
    ]);
  });

  it("renders the list unflagged rather than throwing when a lookup fails", async () => {
    // A decorative flag must never 500 a bookings list.
    findManyMock.mockRejectedValue(new Error("connection lost"));

    const rows = await decorateBookingsForList({
      bookings: BOOKINGS,
      organizationId: ORG_ID,
    });

    expect(rows.map((row) => row.hasUnavailableAssets)).toEqual([false, false]);
    expect(rows.map((row) => row.hasItemsToCheckOut)).toEqual([false, false]);
  });
});
