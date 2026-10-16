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

describe("decorateBookingsForList", () => {
  const BOOKINGS = [
    { id: "booking-1", status: "RESERVED", from: null, to: null },
    { id: "booking-2", status: "RESERVED", from: null, to: null },
  ] as unknown as Parameters<typeof decorateBookingsForList>[0]["bookings"];

  it("attaches both flags, preserving the row's own fields", async () => {
    findManyMock.mockResolvedValue([{ id: "booking-2" }]);

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
      }),
      expect.objectContaining({
        id: "booking-2",
        hasStockConflict: false,
        hasUnavailableAssets: true,
      }),
    ]);
  });

  it("renders the list unflagged rather than throwing when the lookup fails", async () => {
    // A decorative badge must never 500 a bookings list.
    findManyMock.mockRejectedValue(new Error("connection lost"));

    const rows = await decorateBookingsForList({
      bookings: BOOKINGS,
      organizationId: ORG_ID,
    });

    expect(rows.map((row) => row.hasUnavailableAssets)).toEqual([false, false]);
  });
});
