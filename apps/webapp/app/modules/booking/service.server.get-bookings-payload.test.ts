/**
 * Payload-shape tests for `getBookings`.
 *
 * `getBookings` feeds surfaces with wildly different appetites: the CSV export
 * reads every booked asset, while the calendar, the dashboard widgets and the
 * five bookings-list loaders render nothing but booking scalars and a count.
 * Two knobs express that difference — `includeAssets` (attach the
 * `bookingAssets` subtree at all) and `takeCap` (fetch one bounded set instead
 * of a page of it).
 *
 * Both are invisible in the returned rows when they work and expensive when
 * they silently stop working: a regression that re-attaches `bookingAssets`
 * costs payload on six loaders without changing a single pixel, and a
 * regression that drops `takeCap` re-introduces the `perPage` clamp bug that
 * had the dashboard computing "top custodians" from 20 bookings. So these
 * tests assert on the arguments handed to Prisma, the same way
 * `service.server.get-bookings-permissions.test.ts` asserts on the `where`.
 *
 * @see {@link file://./service.server.ts} — `getBookings`
 * @see {@link file://./constants.ts} — `BOOKINGS_LIST_ASSETS_INCLUDE`
 */
import type { Prisma } from "@prisma/client";

import { db } from "~/database/db.server";
import { getBookings } from "./service.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// why: `getBookings` executes real Prisma queries, but the subject under test
// is the include/take it builds, not what a database returns. Mocking the
// client lets us capture those arguments; `count` is mocked because
// `getBookings` issues it alongside `findMany` in a `Promise.all`.
vitest.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findMany: vitest.fn().mockResolvedValue([]),
      count: vitest.fn().mockResolvedValue(0),
    },
  },
}));

const findManyMock = db.booking.findMany as unknown as ReturnType<
  typeof vitest.fn
>;
const countMock = db.booking.count as unknown as ReturnType<typeof vitest.fn>;

/** The arguments `getBookings` handed to `db.booking.findMany`. */
type CapturedFindManyArgs = {
  include: Prisma.BookingInclude;
  take?: number;
  skip?: number;
};

/**
 * Runs `getBookings` and returns the arguments it handed to `findMany`.
 *
 * @param params - Overrides merged over the minimal required arguments
 * @returns The captured `findMany` arguments
 */
async function captureFindManyArgs(
  params: Partial<Parameters<typeof getBookings>[0]> = {}
): Promise<CapturedFindManyArgs> {
  await getBookings({
    organizationId: "org-1",
    page: 1,
    userId: "user-1",
    canSeeAllBookings: true,
    ...params,
  } as Parameters<typeof getBookings>[0]);

  return findManyMock.mock.calls[0][0] as CapturedFindManyArgs;
}

beforeEach(() => {
  // why: `clearAllMocks` resets call history but NOT queued `*Once` values;
  // these mocks use plain resolved values, so history is all that needs
  // clearing between cases.
  vitest.clearAllMocks();
});

describe("getBookings — asset payload", () => {
  it("attaches the bookingAssets subtree by default", async () => {
    const { include } = await captureFindManyArgs();

    expect(include).toHaveProperty("bookingAssets");
  });

  it("omits the bookingAssets key entirely when includeAssets is false", async () => {
    const { include } = await captureFindManyArgs({ includeAssets: false });

    // `toHaveProperty` would pass for an explicit `bookingAssets: undefined`,
    // which Prisma treats differently from an absent key in some positions.
    // Assert on the key set so the include is genuinely narrower.
    expect(Object.keys(include)).not.toContain("bookingAssets");
  });

  it("still attaches whatever the caller asked for via extraInclude when assets are skipped", async () => {
    const { include } = await captureFindManyArgs({
      includeAssets: false,
      extraInclude: { _count: { select: { bookingAssets: true } } },
    });

    expect(Object.keys(include)).not.toContain("bookingAssets");
    expect(include._count).toEqual({ select: { bookingAssets: true } });
  });

  it("selects the asset-code fields the drawer's chip needs on the eager path", async () => {
    const { include } = await captureFindManyArgs();

    // The drawer resolves its code chip from these four fields
    // (`~/modules/barcode/display`). Losing one degrades the chip silently on
    // every list surface, so pin them rather than only the top-level key.
    const assetSelect = (
      include.bookingAssets as {
        select: { asset: { select: Record<string, unknown> } };
      }
    ).select.asset.select;

    expect(assetSelect).toMatchObject({
      sequentialId: true,
      preferredBarcodeId: true,
      qrCodes: { take: 1, select: { id: true } },
      barcodes: { select: { id: true, type: true, value: true } },
    });
  });
});

describe("getBookings — row cap", () => {
  it("clamps an out-of-range perPage to 20, which is why takeCap exists", async () => {
    const { take } = await captureFindManyArgs({ perPage: 1000 });

    expect(take).toBe(20);
  });

  it("uses takeCap instead of the clamped perPage", async () => {
    const { take } = await captureFindManyArgs({
      perPage: 1000,
      takeCap: 1000,
    });

    expect(take).toBe(1000);
  });

  it("leaves an in-range perPage alone when no takeCap is given", async () => {
    const { take } = await captureFindManyArgs({ perPage: 50 });

    expect(take).toBe(50);
  });

  it("ignores takeCap under takeAll, which fetches unbounded", async () => {
    const args = await captureFindManyArgs({ takeAll: true, takeCap: 10 });

    expect(args.take).toBeUndefined();
    expect(args.skip).toBeUndefined();
  });
});

describe("getBookings — count companion query", () => {
  it("issues the count query by default", async () => {
    await captureFindManyArgs();

    expect(countMock).toHaveBeenCalledTimes(1);
  });

  it("skips the count query when the caller never reads the total", async () => {
    await captureFindManyArgs({ skipCount: true });

    expect(countMock).not.toHaveBeenCalled();
  });
});
