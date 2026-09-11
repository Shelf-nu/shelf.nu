/**
 * Response-contract test for the kits the mobile booking detail endpoint sends
 * alongside its assets. The companion groups a booking's assets under a kit
 * header built from this payload, so three things are a contract the app
 * depends on:
 *
 * 1. Every kit an asset unanimously belongs to appears once in `booking.kits`,
 *    carrying the kit's OWN membership size as `assetCount` — which is what
 *    tells the app whether the booking holds the whole kit and may therefore
 *    remove it by name.
 * 2. A booking with no kit-driven rows sends an empty array, not the field
 *    missing and not every kit in the workspace.
 * 3. The lookup is scoped to the caller's organization, so a kit id that does
 *    not belong to it can never be described back.
 * 4. A kit's `image` is a signed URL the app cannot renew, so the kit rows go
 *    through `refreshExpiredKitImages` before they are sent: a lapsed URL
 *    arrives re-signed, with the `imageExpiration` the helper returned.
 *
 * @see {@link file://./bookings.$bookingId.ts} loader under test
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
import type * as BookingServiceServer from "~/modules/booking/service.server";
import { refreshExpiredKitImages } from "~/modules/kit/service.server";

import { loader } from "~/routes/api+/mobile+/bookings.$bookingId";

import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { mobileUserContext } from "@helpers/mobile-user-context";

// @vitest-environment node

// why: db is the integration boundary — the loader reads the booking via
// `booking.findFirst` and the kits it groups under via `kit.findMany`, which
// is the query under test. The lifecycle-progress roll-up's two reads are
// orthogonal here, so they stub to empty.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
    kit: { findMany: vi.fn().mockResolvedValue([]) },
    bookingAsset: { findMany: vi.fn().mockResolvedValue([]) },
    partialBookingCheckout: { findMany: vi.fn().mockResolvedValue([]) },
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

// why: the QT-remaining helpers hit `tx.bookingAsset` / `tx.consumptionLog`
// directly rather than the delegates mocked above, and per-asset remaining is
// unrelated to the kit payload under test.
vi.mock("~/modules/booking/service.server", async () => {
  const actual = await vi.importActual<typeof BookingServiceServer>(
    "~/modules/booking/service.server"
  );
  return {
    ...actual,
    computeBookingAssetRemaining: vi.fn().mockResolvedValue(0),
    computeBookingAssetRemainingToCheckOut: vi.fn().mockResolvedValue(0),
    getPartiallyCheckedInAssetIds: vi.fn().mockResolvedValue([]),
  };
});

// why: the loader reads workspace booking settings to decide the check-in and
// kit-counting flags. They do not reach the kit payload under test, so fixed
// values keep the response deterministic.
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn().mockResolvedValue({
    requireExplicitCheckinForAdmin: false,
    requireExplicitCheckinForSelfService: false,
    countKitsAsSingleUnit: false,
  }),
}));

// why: the loader resolves six booking permissions to build its action flags.
// Those flags are a different contract from the kit payload under test, and
// resolving them for real would need the permission tables — so answer a fixed
// `false` and let the tests assert on `booking.kits` alone.
vi.mock("~/utils/permissions/permission.validator.server", () => ({
  hasPermission: vi.fn().mockResolvedValue(false),
}));

// why: re-signing calls Supabase Storage and writes the new URL back to the
// kit row. The helper has its own contract; the kit-image case below pins what
// the loader does with it, and every other case gets its rows back untouched.
vi.mock("~/modules/kit/service.server", () => ({
  refreshExpiredKitImages: vi.fn((kits: unknown[]) => Promise.resolve(kits)),
}));

const findFirstMock = vi.mocked(db.booking.findFirst);
const kitFindManyMock = vi.mocked(db.kit.findMany);
const requireMobileAuthMock = vi.mocked(requireMobileAuth);
const requireOrganizationAccessMock = vi.mocked(requireOrganizationAccess);
const getMobileUserContextMock = vi.mocked(getMobileUserContext);
const refreshExpiredKitImagesMock = vi.mocked(refreshExpiredKitImages);

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuthMock.mockResolvedValue({
    user: { id: "user-1" },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  requireOrganizationAccessMock.mockResolvedValue("org-1");
  getMobileUserContextMock.mockResolvedValue(
    mobileUserContext({ roles: [OrganizationRoles.ADMIN] })
  );
});

const AUDIO = { id: "kit-audio", name: "Audio Package" };
const RIG = { id: "kit-rig", name: "Projection Rig" };

/** One BookingAsset row: an asset booked through `membership`, or standalone. */
function slice({
  id,
  assetId,
  membership,
  kit,
}: {
  id: string;
  assetId: string;
  membership: string | null;
  kit: { id: string; name: string } | null;
}) {
  return {
    id,
    quantity: 1,
    assetKitId: membership,
    asset: {
      id: assetId,
      title: `Asset ${assetId}`,
      status: "AVAILABLE",
      type: "INDIVIDUAL",
      unitOfMeasure: null,
      consumptionType: null,
      mainImage: null,
      category: null,
      assetKits: membership && kit ? [{ id: membership, kit }] : [],
    },
  };
}

/** A booking row carrying the given slices, with everything else inert. */
function bookingRow(bookingAssets: ReturnType<typeof slice>[]) {
  return {
    id: "booking-1",
    name: "Load-in",
    description: null,
    // DRAFT keeps `getPartiallyCheckedInAssetIds` out of the path.
    status: "DRAFT",
    from: null,
    to: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    creator: null,
    custodianUserId: null,
    custodianUser: null,
    custodianTeamMember: null,
    tags: [],
    bookingAssets,
    modelRequests: [],
    _count: { bookingAssets: bookingAssets.length },
  } as never;
}

/** Runs the loader for the fixture booking. */
async function get() {
  return loader(
    createLoaderArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/bookings/booking-1"
      ),
      params: { bookingId: "booking-1" },
    })
  );
}

/** The kits half of the response body. */
function kitsFrom(response: unknown) {
  assertIsDataWithResponseInit(response);
  const body = response.data as {
    booking: {
      kits: Array<{
        id: string;
        name: string;
        status: string;
        assetCount: number;
        category: { id: string; name: string; color: string } | null;
        location: { id: string; name: string } | null;
      }>;
    };
  };
  return body.booking.kits;
}

describe("GET /api/mobile/bookings/:bookingId — the kits its assets group under", () => {
  it("describes every kit the booking holds, with the kit's own asset count", async () => {
    findFirstMock.mockResolvedValue(
      bookingRow([
        slice({ id: "ba1", assetId: "a1", membership: "ak1", kit: AUDIO }),
        slice({ id: "ba2", assetId: "a2", membership: "ak2", kit: AUDIO }),
        slice({ id: "ba3", assetId: "a3", membership: "ak3", kit: RIG }),
      ])
    );
    kitFindManyMock.mockResolvedValue([
      {
        ...AUDIO,
        status: "AVAILABLE",
        image: null,
        imageExpiration: null,
        category: { id: "cat-1", name: "Audio", color: "#111111" },
        location: { id: "loc-1", name: "Store" },
        _count: { assetKits: 3 },
      },
      {
        ...RIG,
        status: "CHECKED_OUT",
        image: "https://example.test/rig.png",
        imageExpiration: null,
        category: null,
        location: null,
        _count: { assetKits: 4 },
      },
    ] as never);

    const kits = kitsFrom(await get());

    expect(kits).toHaveLength(2);
    expect(kits[0]).toMatchObject({
      id: "kit-audio",
      name: "Audio Package",
      status: "AVAILABLE",
      // The kit holds three assets; the booking holds two of them. The count
      // describes the kit, so a partial booking is recognisable as partial.
      assetCount: 3,
      category: { id: "cat-1", name: "Audio", color: "#111111" },
      location: { id: "loc-1", name: "Store" },
    });
    expect(kits[1]).toMatchObject({ id: "kit-rig", assetCount: 4 });
    // `_count` is an implementation detail of the query, not of the contract.
    expect(kits[0]).not.toHaveProperty("_count");
  });

  it("sends no kits, and runs no kit query, for a booking of loose assets", async () => {
    findFirstMock.mockResolvedValue(
      bookingRow([
        slice({ id: "ba1", assetId: "a1", membership: null, kit: null }),
      ])
    );

    expect(kitsFrom(await get())).toEqual([]);
    expect(kitFindManyMock).not.toHaveBeenCalled();
  });

  it("scopes the kit lookup to the caller's organization", async () => {
    findFirstMock.mockResolvedValue(
      bookingRow([
        slice({ id: "ba1", assetId: "a1", membership: "ak1", kit: AUDIO }),
      ])
    );
    // The workspace does not own this kit, so the query returns nothing —
    // which is exactly what a cross-organization id must produce.
    kitFindManyMock.mockResolvedValue([] as never);

    const kits = kitsFrom(await get());

    expect(kits).toEqual([]);
    expect(kitFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["kit-audio"] }, organizationId: "org-1" },
      })
    );
  });

  it("leaves an asset whose slices disagree on a kit out of the grouping", async () => {
    // A quantity-tracked asset booked both standalone and through a kit has no
    // single kit to sit under, so neither its rows nor that kit are grouped.
    findFirstMock.mockResolvedValue(
      bookingRow([
        slice({ id: "ba1", assetId: "a1", membership: null, kit: AUDIO }),
        slice({ id: "ba2", assetId: "a1", membership: "ak1", kit: AUDIO }),
      ])
    );

    expect(kitsFrom(await get())).toEqual([]);
    expect(kitFindManyMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/mobile/bookings/:bookingId — kit images", () => {
  it("sends a lapsed kit image re-signed, with its new expiry", async () => {
    findFirstMock.mockResolvedValue(
      bookingRow([
        slice({ id: "ba1", assetId: "a1", membership: "ak1", kit: AUDIO }),
      ])
    );
    const storedKit = {
      ...AUDIO,
      organizationId: "org-1",
      status: "AVAILABLE",
      image: "https://example.test/sign/kits/audio.png?token=lapsed",
      imageExpiration: new Date("2020-01-01T00:00:00.000Z"),
      category: null,
      location: null,
      _count: { assetKits: 1 },
    };
    kitFindManyMock.mockResolvedValueOnce([storedKit] as never);
    const resignedImage =
      "https://example.test/sign/kits/audio.png?token=fresh";
    const newExpiration = new Date("2099-01-01T00:00:00.000Z");
    refreshExpiredKitImagesMock.mockResolvedValueOnce([
      { ...storedKit, image: resignedImage, imageExpiration: newExpiration },
    ]);

    const kits = kitsFrom(await get());

    // The rows go to the helper as the query returned them — `organizationId`
    // included, since the helper scopes its write-back by it.
    expect(refreshExpiredKitImagesMock).toHaveBeenCalledWith([storedKit]);
    expect(kits[0]).toMatchObject({
      id: "kit-audio",
      image: resignedImage,
      imageExpiration: newExpiration,
      assetCount: 1,
    });
    // Selected for the write-back only; the app's kit shape has no such field.
    expect(kits[0]).not.toHaveProperty("organizationId");
  });
});

describe("GET /api/mobile/bookings/:bookingId — which assets went out", () => {
  it("reports the assets carrying a check-out marker", async () => {
    findFirstMock.mockResolvedValue(
      bookingRow([
        slice({ id: "ba1", assetId: "a1", membership: null, kit: null }),
        slice({ id: "ba2", assetId: "a2", membership: null, kit: null }),
      ])
    );
    vi.mocked(db.bookingAsset.findMany).mockResolvedValue([
      {
        id: "ba1",
        assetId: "a1",
        quantity: 1,
        assetKitId: null,
        checkedOutAt: new Date("2026-01-02T00:00:00.000Z"),
        checkedInAt: null,
      },
      {
        id: "ba2",
        assetId: "a2",
        quantity: 1,
        assetKitId: null,
        checkedOutAt: null,
        checkedInAt: null,
      },
    ] as never);

    const response = await get();
    assertIsDataWithResponseInit(response);
    const body = response.data as { checkedOutAssetIds: string[] };

    expect(body.checkedOutAssetIds).toEqual(["a1"]);
  });
});
