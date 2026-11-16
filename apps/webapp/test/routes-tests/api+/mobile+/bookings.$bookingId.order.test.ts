/**
 * Response-contract test for the ORDER of the assets the mobile booking detail
 * endpoint sends. The companion renders `booking.assets` in the order it
 * receives them, so the order is a contract: it must be the web booking
 * overview's default order (Status, descending) — items still to check out
 * first, checked-out items last, each kit sorted as one unit with its members
 * kept together, ties A→Z by name.
 *
 * Where every asset holds a single slice, the route's order is asserted equal
 * to what `shapeBookingAssets` (the web overview's shaping) produces for the
 * same booking, fed the same per-slice counts, so the two cannot drift apart.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/bookings.$bookingId.ts} loader under test
 * @see {@link file://../../../../app/modules/booking/shape-booking-assets.ts} the web shaping
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import type * as MobileAuthServer from "~/modules/api/mobile-auth.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import {
  computeBookingSliceUnitCounts,
  type BookingDispositionLog,
} from "~/modules/booking/booking-slice-unit-counts.server";
import type { CheckoutSession } from "~/modules/booking/checkout-attribution";
import type * as BookingServiceServer from "~/modules/booking/service.server";
import {
  getDetailedPartialCheckinData,
  type PartialCheckinDetailsType,
} from "~/modules/booking/service.server";
import { shapeBookingAssets } from "~/modules/booking/shape-booking-assets";

import { loader } from "~/routes/api+/mobile+/bookings.$bookingId";

import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { mobileUserContext } from "@helpers/mobile-user-context";

// @vitest-environment node

// why: db is the integration boundary. The loader reads the booking and its
// slices via `booking.findFirst`, and counts each slice's units from the
// check-out sessions and disposition logs, which each test supplies. The slice
// markers and the kit lookup feed other contracts and stub to empty unless a
// test needs the kits.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
    bookingAsset: { findMany: vi.fn().mockResolvedValue([]) },
    partialBookingCheckout: { findMany: vi.fn().mockResolvedValue([]) },
    consumptionLog: { findMany: vi.fn().mockResolvedValue([]) },
    kit: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// why: JWT validation and org-membership resolution are out of scope; the
// remaining exports stay real so nothing else is silently replaced.
vi.mock("~/modules/api/mobile-auth.server", async () => {
  const actual = await vi.importActual<typeof MobileAuthServer>(
    "~/modules/api/mobile-auth.server"
  );
  return {
    ...actual,
    requireMobileAuth: vi.fn(),
    requireOrganizationAccess: vi.fn(),
    assertMobileCanUseBookings: vi.fn(),
    getMobileUserContext: vi.fn(),
  };
});

// why: the per-asset remaining helpers and the partial check-in read hit
// `tx.bookingAsset` / `tx.consumptionLog` / `db.partialBookingCheckin` directly
// rather than the delegates mocked above. Remaining feeds the action flags, not
// the order; the check-in records are supplied per test. The attribution
// helpers the order counts units with stay real.
vi.mock("~/modules/booking/service.server", async () => {
  const actual = await vi.importActual<typeof BookingServiceServer>(
    "~/modules/booking/service.server"
  );
  return {
    ...actual,
    computeBookingAssetRemaining: vi.fn().mockResolvedValue(0),
    computeBookingAssetRemainingToCheckOut: vi.fn().mockResolvedValue(0),
    getDetailedPartialCheckinData: vi
      .fn()
      .mockResolvedValue({ checkedInAssetIds: [], partialCheckinDetails: {} }),
  };
});

// why: the loader reads workspace booking settings for its check-in and
// kit-counting flags. They do not reach the order under test, so fixed values
// keep the response deterministic.
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn().mockResolvedValue({
    requireExplicitCheckinForAdmin: false,
    requireExplicitCheckinForSelfService: false,
    countKitsAsSingleUnit: false,
  }),
}));

// why: the loader resolves six booking permissions for its action flags, a
// different contract from the order under test; resolving them for real would
// need the permission tables.
vi.mock("~/utils/permissions/permission.validator.server", () => ({
  hasPermission: vi.fn().mockResolvedValue(false),
}));

const findFirstMock = vi.mocked(db.booking.findFirst);
const sessionsMock = vi.mocked(db.partialBookingCheckout.findMany);
const dispositionLogsMock = vi.mocked(db.consumptionLog.findMany);
const kitFindManyMock = vi.mocked(db.kit.findMany);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: { id: "user-1" },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
  vi.mocked(getMobileUserContext).mockResolvedValue(
    mobileUserContext({ roles: [OrganizationRoles.ADMIN] })
  );
});

type Kit = { id: string; name: string };

/** One `BookingAsset` slice as the loader's booking query returns it. */
type SliceFixture = {
  id: string;
  quantity: number;
  assetKitId: string | null;
  asset: {
    id: string;
    title: string;
    status: "AVAILABLE" | "CHECKED_OUT";
    type: "INDIVIDUAL" | "QUANTITY_TRACKED";
    unitOfMeasure: string | null;
    consumptionType: string | null;
    mainImage: string | null;
    category: null;
    assetKits: Array<{ id: string; kit: Kit }>;
  };
};

/**
 * A slice of `assetId`: kit-driven through `kit`, or standalone when `kit` is
 * omitted. `memberships` lists the asset's other kit memberships, so every
 * slice of one asset carries the same set.
 */
function slice({
  id,
  assetId,
  title,
  status = "AVAILABLE",
  type = "INDIVIDUAL",
  quantity = 1,
  kit,
  memberships = [],
}: {
  id: string;
  assetId: string;
  title: string;
  status?: SliceFixture["asset"]["status"];
  type?: SliceFixture["asset"]["type"];
  quantity?: number;
  kit?: { membershipId: string; kit: Kit };
  memberships?: Array<{ id: string; kit: Kit }>;
}): SliceFixture {
  const assetKits = kit
    ? [{ id: kit.membershipId, kit: kit.kit }, ...memberships]
    : memberships;
  return {
    id,
    quantity,
    assetKitId: kit?.membershipId ?? null,
    asset: {
      id: assetId,
      title,
      status,
      type,
      unitOfMeasure: null,
      consumptionType: null,
      mainImage: null,
      category: null,
      assetKits,
    },
  };
}

/** A booking row carrying `slices`, with everything else inert. */
function bookingRow(
  status: "RESERVED" | "ONGOING",
  slices: SliceFixture[]
): never {
  return {
    id: "booking-1",
    name: "Load-in",
    description: null,
    status,
    from: new Date("2026-09-01T09:00:00.000Z"),
    to: new Date("2026-09-30T17:00:00.000Z"),
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    creator: null,
    custodianUserId: null,
    custodianUser: null,
    custodianTeamMember: null,
    tags: [],
    bookingAssets: slices,
    modelRequests: [],
    _count: { bookingAssets: slices.length },
  } as never;
}

/** A persisted check-out session, one positional entry per claim. */
function session(
  claims: Array<{ assetId: string; quantity: number; bookingAssetId?: string }>
): CheckoutSession {
  return {
    assetIds: claims.map((c) => c.assetId),
    quantities: claims.map((c) => c.quantity),
    bookingAssetIds: claims.map((c) => c.bookingAssetId ?? ""),
  };
}

/** Runs the loader and returns the response body's booking. */
async function getBooking() {
  const response = await loader(
    createLoaderArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/bookings/booking-1"
      ),
      params: { bookingId: "booking-1" },
    })
  );
  assertIsDataWithResponseInit(response);
  const body = response.data as {
    booking: {
      assets: Array<{ id: string; kitId: string | null }>;
      kits: Array<{ id: string }>;
    };
  };
  return body.booking;
}

/**
 * The asset ids in the order the web booking overview lists the same booking
 * by default: one row per slice, shaped by `shapeBookingAssets`, with the
 * per-slice counts from the same sessions and logs the route reads.
 */
function websiteOrder({
  status,
  slices,
  sessions = [],
  dispositionLogs = [],
  partialCheckinDetails = {},
}: {
  status: "RESERVED" | "ONGOING";
  slices: SliceFixture[];
  sessions?: CheckoutSession[];
  dispositionLogs?: BookingDispositionLog[];
  partialCheckinDetails?: PartialCheckinDetailsType;
}): string[] {
  const bookingAssetRowsByAsset = new Map<
    string,
    Array<{ id: string; quantity: number; assetKitId: string | null }>
  >();
  for (const s of slices) {
    if (s.asset.type !== "QUANTITY_TRACKED") continue;
    const rows = bookingAssetRowsByAsset.get(s.asset.id) ?? [];
    rows.push({ id: s.id, quantity: s.quantity, assetKitId: s.assetKitId });
    bookingAssetRowsByAsset.set(s.asset.id, rows);
  }
  const counts = computeBookingSliceUnitCounts({
    bookingAssetRowsByAsset,
    dispositionLogs,
    checkoutSessions: sessions,
  });

  const rawAssets = slices.map((s) => {
    const kit =
      s.asset.assetKits.find((membership) => membership.id === s.assetKitId)
        ?.kit ?? null;
    return {
      id: s.asset.id,
      title: s.asset.title,
      status: s.asset.status,
      type: s.asset.type,
      category: null,
      location: null,
      kitId: kit?.id ?? null,
      kit,
      bookingAssetId: s.id,
      bookedQuantity: s.quantity,
      checkedOutQuantity: counts.checkedOutByBookingAsset.get(s.id) ?? 0,
      dispositionedQuantity: counts.dispositionedByBookingAsset.get(s.id) ?? 0,
    };
  });

  const { items } = shapeBookingAssets({
    rawAssets,
    rawKits: [],
    search: null,
    orderBy: "status",
    orderDirection: "desc",
    page: 1,
    perPage: rawAssets.length,
    partialCheckinDetails,
    bookingStatus: status,
  });
  return items.flatMap((item) => item.assets.map((asset) => asset.id));
}

const AUDIO_KIT: Kit = { id: "kit-audio", name: "Audio Kit" };
const VIDEO_KIT: Kit = { id: "kit-video", name: "Video Kit" };
const POWER_KIT: Kit = { id: "kit-power", name: "Power Kit" };
const CAMERA_KIT: Kit = { id: "kit-camera", name: "Camera Kit" };

describe("GET /api/mobile/bookings/:bookingId — asset order", () => {
  it("lists a checked-out asset after the assets still to check out", async () => {
    // The booking query returns checked-out rows first; the response must not.
    const slices = [
      slice({
        id: "ba-alpha",
        assetId: "alpha",
        title: "Alpha Monitor",
        status: "CHECKED_OUT",
      }),
      slice({ id: "ba-charlie", assetId: "charlie", title: "Charlie Tripod" }),
      slice({ id: "ba-bravo", assetId: "bravo", title: "Bravo Light" }),
    ];
    findFirstMock.mockResolvedValue(bookingRow("ONGOING", slices));

    const booking = await getBooking();
    const order = booking.assets.map((asset) => asset.id);

    expect(order).toEqual(["bravo", "charlie", "alpha"]);
    expect(order).toEqual(websiteOrder({ status: "ONGOING", slices }));
  });

  it("judges a quantity-tracked row by the units it has checked out, not by the asset's status", async () => {
    const slices = [
      slice({ id: "ba-tape", assetId: "tape", title: "Tape" }),
      // All four units are out, while the asset itself still reads AVAILABLE.
      slice({
        id: "ba-sandbags",
        assetId: "sandbags",
        title: "Sandbags",
        type: "QUANTITY_TRACKED",
        quantity: 4,
      }),
      // Two of six units are out: still work to do.
      slice({
        id: "ba-clamps",
        assetId: "clamps",
        title: "Clamps",
        type: "QUANTITY_TRACKED",
        quantity: 6,
      }),
    ];
    const sessions = [
      session([
        { assetId: "sandbags", quantity: 4, bookingAssetId: "ba-sandbags" },
        { assetId: "clamps", quantity: 2, bookingAssetId: "ba-clamps" },
      ]),
    ];
    findFirstMock.mockResolvedValue(bookingRow("ONGOING", slices));
    sessionsMock.mockResolvedValue(sessions as never);

    const order = (await getBooking()).assets.map((asset) => asset.id);

    expect(order).toEqual(["clamps", "tape", "sandbags"]);
    expect(order).toEqual(
      websiteOrder({ status: "ONGOING", slices, sessions })
    );
  });

  it("sinks a fully checked-out kit as one unit, its members together, and orders the kits to match", async () => {
    const slices = [
      slice({
        id: "ba-mic",
        assetId: "mic",
        title: "Mic",
        status: "CHECKED_OUT",
        kit: { membershipId: "ak-mic", kit: AUDIO_KIT },
      }),
      slice({
        id: "ba-cable",
        assetId: "cable",
        title: "Cable",
        status: "CHECKED_OUT",
      }),
      slice({
        id: "ba-camera",
        assetId: "camera",
        title: "Camera",
        status: "CHECKED_OUT",
        kit: { membershipId: "ak-camera", kit: VIDEO_KIT },
      }),
      slice({
        id: "ba-mixer",
        assetId: "mixer",
        title: "Mixer",
        status: "CHECKED_OUT",
        kit: { membershipId: "ak-mixer", kit: AUDIO_KIT },
      }),
      slice({ id: "ba-zoom", assetId: "zoom", title: "Zoom Lens" }),
      slice({
        id: "ba-tripod",
        assetId: "tripod",
        title: "Tripod",
        kit: { membershipId: "ak-tripod", kit: VIDEO_KIT },
      }),
    ];
    findFirstMock.mockResolvedValue(bookingRow("ONGOING", slices));
    kitFindManyMock.mockResolvedValue(
      [AUDIO_KIT, VIDEO_KIT].map((kit) => ({
        ...kit,
        organizationId: "org-1",
        status: "AVAILABLE",
        image: null,
        imageExpiration: null,
        category: null,
        location: null,
        _count: { assetKits: 2 },
      })) as never
    );

    const booking = await getBooking();
    const order = booking.assets.map((asset) => asset.id);

    // Audio Kit would lead by name, but every member is out, so it sinks
    // whole. Video Kit still has its Tripod to check out, so it stays on top,
    // with the member still to go first.
    expect(order).toEqual([
      "tripod",
      "camera",
      "zoom",
      "mic",
      "mixer",
      "cable",
    ]);
    expect(order).toEqual(websiteOrder({ status: "ONGOING", slices }));
    // The app places a kit's header where it first meets a member, and the
    // kits list follows the same order.
    expect(booking.kits.map((kit) => kit.id)).toEqual([
      VIDEO_KIT.id,
      AUDIO_KIT.id,
    ]);
  });

  describe("a quantity-tracked asset booked both standalone and through a kit", () => {
    const slices = [
      slice({
        id: "ba-adapter",
        assetId: "adapter",
        title: "Adapter",
        status: "CHECKED_OUT",
      }),
      slice({
        id: "ba-charger",
        assetId: "charger",
        title: "Charger",
        status: "CHECKED_OUT",
        kit: { membershipId: "ak-charger", kit: POWER_KIT },
      }),
      slice({
        id: "ba-batteries-kit",
        assetId: "batteries",
        title: "Batteries",
        type: "QUANTITY_TRACKED",
        quantity: 2,
        kit: { membershipId: "ak-batteries", kit: POWER_KIT },
      }),
      slice({
        id: "ba-batteries-standalone",
        assetId: "batteries",
        title: "Batteries",
        type: "QUANTITY_TRACKED",
        quantity: 3,
        memberships: [{ id: "ak-batteries", kit: POWER_KIT }],
      }),
    ];

    it("keeps it on top while its standalone slice still has units to check out, though its kit slice is fully out", async () => {
      findFirstMock.mockResolvedValue(bookingRow("ONGOING", slices));
      // Both kit units went out, tagged to the kit slice; none of the three
      // standalone units have.
      sessionsMock.mockResolvedValue([
        session([
          {
            assetId: "batteries",
            quantity: 2,
            bookingAssetId: "ba-batteries-kit",
          },
        ]),
      ] as never);

      const order = (await getBooking()).assets.map((asset) => asset.id);

      // The phone shows Batteries as one row of its own, so Power Kit holds
      // only the Charger, which is out: the kit sinks and Batteries leads.
      expect(order).toEqual(["batteries", "adapter", "charger"]);
    });

    it("sinks it once the standalone slice is out too", async () => {
      const allOut = slices.map((s) =>
        s.asset.id === "batteries"
          ? { ...s, asset: { ...s.asset, status: "CHECKED_OUT" as const } }
          : s
      );
      findFirstMock.mockResolvedValue(bookingRow("ONGOING", allOut));
      sessionsMock.mockResolvedValue([
        session([
          {
            assetId: "batteries",
            quantity: 2,
            bookingAssetId: "ba-batteries-kit",
          },
        ]),
        // Untagged: spread over the asset's slices, standalone first.
        session([{ assetId: "batteries", quantity: 3 }]),
      ] as never);

      const order = (await getBooking()).assets.map((asset) => asset.id);

      expect(order).toEqual(["adapter", "batteries", "charger"]);
    });

    it("brings it back on top once units come back, though every unit went out", async () => {
      const allOut = slices.map((s) =>
        s.asset.id === "batteries"
          ? { ...s, asset: { ...s.asset, status: "CHECKED_OUT" as const } }
          : s
      );
      findFirstMock.mockResolvedValue(bookingRow("ONGOING", allOut));
      sessionsMock.mockResolvedValue([
        session([{ assetId: "batteries", quantity: 5 }]),
      ] as never);
      dispositionLogsMock.mockResolvedValue([
        {
          assetId: "batteries",
          bookingAssetId: "ba-batteries-standalone",
          category: "RETURN",
          quantity: 1,
        },
      ] as never);

      const order = (await getBooking()).assets.map((asset) => asset.id);

      // A return underway is work still to do, so the row leaves the
      // checked-out bucket even though every unit went out.
      expect(order).toEqual(["batteries", "adapter", "charger"]);
      expect(dispositionLogsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            bookingId: "booking-1",
            assetId: { in: ["batteries"] },
          }),
        })
      );
    });
  });

  it("judges an item by this booking's check-in record, not by its status elsewhere", async () => {
    // Alpha came back on this booking and has since gone out on another one,
    // so its own status reads CHECKED_OUT. This booking's check-in record is
    // what says it is back here: it must not sink with the items still out.
    const slices = [
      slice({
        id: "ba-alpha",
        assetId: "alpha",
        title: "Alpha Monitor",
        status: "CHECKED_OUT",
      }),
      slice({ id: "ba-bravo", assetId: "bravo", title: "Bravo Light" }),
      slice({
        id: "ba-charlie",
        assetId: "charlie",
        title: "Charlie Tripod",
        status: "CHECKED_OUT",
      }),
    ];
    const partialCheckinDetails: PartialCheckinDetailsType = {
      alpha: {
        checkinDate: new Date("2026-09-10T12:00:00.000Z"),
        checkedInBy: {
          id: "user-1",
          firstName: "Test",
          lastName: "User",
          displayName: null,
          profilePicture: null,
        },
      },
    };
    findFirstMock.mockResolvedValue(bookingRow("ONGOING", slices));
    vi.mocked(getDetailedPartialCheckinData).mockResolvedValueOnce({
      checkedInAssetIds: ["alpha"],
      partialCheckinDetails,
    } as Awaited<ReturnType<typeof getDetailedPartialCheckinData>>);

    const order = (await getBooking()).assets.map((asset) => asset.id);

    expect(order).toEqual(["alpha", "bravo", "charlie"]);
    expect(order).toEqual(
      websiteOrder({ status: "ONGOING", slices, partialCheckinDetails })
    );
  });

  it("keeps a RESERVED booking in one group, ordered like the website", async () => {
    const slices = [
      // Its units are out on another booking; a reserved booking has not
      // checked anything out, so this row stays with the rest.
      slice({
        id: "ba-batteries",
        assetId: "batteries",
        title: "Batteries",
        type: "QUANTITY_TRACKED",
        status: "CHECKED_OUT",
        quantity: 4,
      }),
      slice({ id: "ba-zebra", assetId: "zebra", title: "Zebra Stand" }),
      slice({
        id: "ba-lens",
        assetId: "lens",
        title: "Lens",
        kit: { membershipId: "ak-lens", kit: CAMERA_KIT },
      }),
      slice({
        id: "ba-body",
        assetId: "body",
        title: "Body",
        kit: { membershipId: "ak-body", kit: CAMERA_KIT },
      }),
    ];
    findFirstMock.mockResolvedValue(bookingRow("RESERVED", slices));

    const order = (await getBooking()).assets.map((asset) => asset.id);

    expect(order).toEqual(["batteries", "body", "lens", "zebra"]);
    expect(order).toEqual(websiteOrder({ status: "RESERVED", slices }));
  });

  it("does not read disposition logs for a booking with no quantity-tracked asset", async () => {
    findFirstMock.mockResolvedValue(
      bookingRow("ONGOING", [
        slice({ id: "ba-alpha", assetId: "alpha", title: "Alpha" }),
      ])
    );

    await getBooking();

    expect(dispositionLogsMock).not.toHaveBeenCalled();
  });
});
