/**
 * Test suite for GET /api/mobile/assets/:assetId.
 *
 * Pins what the companion's asset detail screen may be sent:
 *
 * - Custody visibility. Viewers without custody-view permission
 *   (SELF_SERVICE/BASE without the org override) receive only their OWN
 *   `custodyList` entries plus a hidden-holders count
 *   (`custodyListOthersCount`), and the legacy single `custody` field is null
 *   unless the viewer can see all custody or IS the primary custodian. The web
 *   behaves the same way: `QuantityCustodyList` filters and counts its rows,
 *   and the asset overview hides `CustodyCard` through its `hasPermission`.
 * - Custody through a booking. `activeBooking` names the booking an INDIVIDUAL
 *   asset is checked out on, picked and gated the way the web asset overview
 *   picks the booking its `CustodyCard` shows.
 * - The projection. Rows destructured off the query result stay off the wire.
 *
 * The visibility helpers from `mobile-custody-visibility.server`, the booking
 * read gate and the name resolvers are NOT mocked, so the real logic runs end
 * to end through the loader.
 *
 * @see {@link file://../../../app/routes/api+/mobile+/assets.$assetId.ts}
 */
import { loader } from "~/routes/api+/mobile+/assets.$assetId";
import { createLoaderArgs } from "@mocks/remix";

// @vitest-environment node

// why: mocking Remix's data() function to return Response objects for React Router v7 single fetch
const createDataMock = vitest.hoisted(() => {
  return () =>
    vitest.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

vitest.mock("react-router", async () => {
  const actual = await vitest.importActual("react-router");
  return {
    ...actual,
    data: createDataMock(),
  };
});

// why: external auth — we don't want to hit Supabase in tests. The whole
// module is mocked to keep Supabase out, so the pure shape helper must be
// re-provided; it mirrors the real one (flatten pivots + build custodyList).
// The per-custodian aggregation is skipped because the fixtures below carry
// exactly one custody row per custodian.
vitest.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vitest.fn(),
  requireOrganizationAccess: vitest.fn(),
  getMobileUserContext: vitest.fn(),
  shapeMobileAssetResponse: (asset: any) => {
    const { assetKits, assetLocations, custody, ...rest } = asset;
    const kit = assetKits[0]?.kit ?? null;
    return {
      ...rest,
      kitId: kit?.id ?? null,
      kit,
      location: assetLocations[0]?.location ?? null,
      custody: custody[0] ? { custodian: custody[0].custodian } : null,
      custodyList: custody.map((c: any) => ({
        custodian: { id: c.custodian.id, name: c.custodian.name },
        quantity: c.quantity,
      })),
    };
  },
}));

// why: external database — we don't want to hit the real database in tests
vitest.mock("~/database/db.server", () => ({
  db: {
    asset: { findUnique: vitest.fn() },
  },
}));

// why: the quantity-rows fetcher hits the database AND drags the heavy
// booking-service (scanner/lottie) import graph into the test — mock it and
// feed the pure `getQuantityData` reducer a minimal quantity-aware shape
vitest.mock("~/modules/asset/quantity-breakdown.server", () => ({
  getAssetQuantityRows: vitest.fn().mockResolvedValue({
    type: "QUANTITY_TRACKED",
    quantity: 10,
    custody: [{ quantity: 5 }, { quantity: 3 }, { quantity: 1 }],
    bookingAssets: [],
  }),
}));

// why: we need to control error formatting without running real error logic
vitest.mock("~/utils/error", () => ({
  makeShelfError: vitest.fn((cause: any) => ({
    message: cause?.message || "Unknown error",
    status: cause?.status || 500,
  })),
  ShelfError: class ShelfError extends Error {
    status: number;
    constructor(opts: any) {
      super(opts.message);
      this.status = opts.status || 500;
    }
  },
}));

import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { db } from "~/database/db.server";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
  profilePicture: null,
  onboarded: true,
};

/**
 * A QUANTITY_TRACKED asset with three holders: two other people (one with a
 * linked user, one non-registered) and the caller (`user-1`). The caller's
 * row is deliberately NOT first, so the legacy `custody` (= custody[0])
 * belongs to someone else.
 */
function buildAsset() {
  return {
    id: "asset-1",
    title: "Bolts",
    sequentialId: "SAM-0017",
    description: null,
    status: "IN_CUSTODY",
    // Selected with the image columns so the shaper can resolve the cover-image
    // cascade; the response must expose the NAME only.
    assetModel: {
      name: "M8 Hex Bolt",
      image: "https://example.test/model.jpg",
      thumbnailImage: "https://example.test/model-thumb.jpg",
    },
    mainImage: null,
    mainImageExpiration: null,
    thumbnailImage: null,
    availableToBook: true,
    valuation: null,
    type: "QUANTITY_TRACKED",
    quantity: 10,
    minQuantity: null,
    unitOfMeasure: "pcs",
    consumptionType: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    userId: "owner-user",
    category: null,
    assetLocations: [],
    custody: [
      {
        createdAt: new Date("2026-01-01T10:00:00Z"),
        quantity: 5,
        custodian: {
          id: "tm-alice",
          name: "Alice Holder",
          userId: "user-9",
          user: {
            firstName: "Alice",
            lastName: "Holder",
            email: "alice@example.com",
            profilePicture: null,
          },
        },
      },
      {
        createdAt: new Date("2026-01-01T11:00:00Z"),
        quantity: 3,
        custodian: {
          id: "tm-me",
          name: "Test User",
          userId: "user-1",
          user: {
            firstName: "Test",
            lastName: "User",
            email: "test@example.com",
            profilePicture: null,
          },
        },
      },
      {
        createdAt: new Date("2026-01-01T12:00:00Z"),
        quantity: 1,
        custodian: {
          id: "tm-nrm",
          name: "Bob NonRegistered",
          userId: null,
          user: null,
        },
      },
    ],
    assetKits: [],
    // Active booking rows; none for this asset
    bookingAssets: [],
    tags: [],
    qrCodes: [],
    organization: { currency: "USD" },
    notes: [],
    customFields: [],
  };
}

/** The booking custody links a fixture booking may override. */
type BookingCustodianOverrides = {
  custodianTeamMember?: {
    id: string;
    name: string;
    userId: string | null;
  } | null;
  custodianUser?: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
  } | null;
};

/**
 * An INDIVIDUAL asset checked out on an ONGOING booking. A booking checkout
 * writes no Custody row, so `custody` is empty and the holder is known only
 * through the booking. The default custodian is a registered user whose
 * display name, team-member name and legal name all differ, so an assertion
 * can tell which one the response used.
 *
 * @param booking - Overrides for the booking's custody links
 */
function buildCheckedOutAsset(booking: BookingCustodianOverrides = {}) {
  return {
    ...buildAsset(),
    title: "Camera A",
    status: "CHECKED_OUT",
    type: "INDIVIDUAL",
    quantity: null,
    unitOfMeasure: null,
    custody: [],
    bookingAssets: [
      {
        booking: {
          id: "booking-1",
          name: "Field shoot",
          from: new Date("2026-03-02T09:30:00Z"),
          custodianTeamMember: {
            id: "tm-carol",
            name: "Carol Member",
            userId: "user-7",
          },
          custodianUser: {
            id: "user-7",
            firstName: "Carol",
            lastName: "Legal",
            displayName: "Caz",
          },
          ...booking,
        },
      },
    ],
  };
}

function createDetailRequest(orgId = "org-1") {
  return new Request(
    `http://localhost/api/mobile/assets/asset-1?orgId=${orgId}`,
    {
      headers: { Authorization: "Bearer token" },
    }
  );
}

describe("GET /api/mobile/assets/:assetId — custody visibility", () => {
  beforeEach(() => {
    vitest.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });

    (requireOrganizationAccess as any).mockResolvedValue("org-1");

    (getMobileUserContext as any).mockResolvedValue({
      role: "ADMIN",
      canUseBarcodes: false,
      canUseAudits: false,
      canSeeAllCustody: true,
      canSeeAllBookings: true,
    });

    (db.asset.findUnique as any).mockResolvedValue(buildAsset());
  });

  it("shows a self-service caller only their own custody rows + the hidden count", async () => {
    (getMobileUserContext as any).mockResolvedValue({
      role: "SELF_SERVICE",
      canUseBarcodes: false,
      canUseAudits: false,
      canSeeAllCustody: false,
      canSeeAllBookings: false,
    });

    const result = await loader(
      createLoaderArgs({
        request: createDetailRequest(),
        params: { assetId: "asset-1" },
      })
    );

    expect((result as unknown as Response).status).toBe(200);
    const body = await (result as unknown as Response).json();

    // Only the caller's own entry survives the filter
    expect(body.asset.custodyList).toEqual([
      { custodian: { id: "tm-me", name: "Test User" }, quantity: 3 },
    ]);
    // Two other holders were hidden
    expect(body.asset.custodyListOthersCount).toBe(2);

    // Legacy custody (= custody[0]) belongs to Alice, not the caller —
    // hidden, matching the web's CustodyCard hasPermission behavior
    expect(body.asset.custody).toBeNull();

    // Hard privacy assertion: nothing about the hidden holders leaks
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("Alice");
    expect(serialized).not.toContain("alice@example.com");
    expect(serialized).not.toContain("Bob NonRegistered");
  });

  it("keeps the legacy custody visible when the restricted caller IS the primary custodian", async () => {
    (getMobileUserContext as any).mockResolvedValue({
      role: "SELF_SERVICE",
      canUseBarcodes: false,
      canUseAudits: false,
      canSeeAllCustody: false,
      canSeeAllBookings: false,
    });
    // Reorder so the caller's row is the primary (oldest) one
    const asset = buildAsset();
    asset.custody = [asset.custody[1], asset.custody[0], asset.custody[2]];
    (db.asset.findUnique as any).mockResolvedValue(asset);

    const result = await loader(
      createLoaderArgs({
        request: createDetailRequest(),
        params: { assetId: "asset-1" },
      })
    );

    const body = await (result as unknown as Response).json();

    // The caller may always see their OWN custody record (web:
    // userCanViewSpecificCustody), so the legacy field stays populated
    expect(body.asset.custody).not.toBeNull();
    expect(body.asset.custody.custodian.id).toBe("tm-me");

    expect(body.asset.custodyList).toEqual([
      { custodian: { id: "tm-me", name: "Test User" }, quantity: 3 },
    ]);
    expect(body.asset.custodyListOthersCount).toBe(2);
  });

  it("returns the full custody list to callers who can see all custody", async () => {
    const result = await loader(
      createLoaderArgs({
        request: createDetailRequest(),
        params: { assetId: "asset-1" },
      })
    );

    expect((result as unknown as Response).status).toBe(200);
    const body = await (result as unknown as Response).json();

    expect(body.asset.custodyList).toHaveLength(3);
    expect(body.asset.custodyListOthersCount).toBe(0);
    // Legacy custody stays the primary (oldest) record
    expect(body.asset.custody.custodian.id).toBe("tm-alice");
  });
});

/**
 * The response is assembled by destructuring fields OFF the row and re-attaching
 * narrowed copies — the projection shape this repo gets wrong most often, and
 * one typecheck cannot see: dropping a key from the destructure or the return
 * literal leaves `validate` green and the field simply gone from the wire.
 */
describe("GET /api/mobile/assets/:assetId — payload projection", () => {
  beforeEach(() => {
    vitest.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });
    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (getMobileUserContext as any).mockResolvedValue({
      role: "ADMIN",
      canUseBarcodes: false,
      canUseAudits: false,
      canSeeAllCustody: true,
      canSeeAllBookings: true,
    });
    (db.asset.findUnique as any).mockResolvedValue(buildAsset());
  });

  it("sends the SAM ID, which the scanner's manual entry accepts", async () => {
    const result = await loader(
      createLoaderArgs({
        request: createDetailRequest(),
        params: { assetId: "asset-1" },
      })
    );

    const body = await (result as unknown as Response).json();

    expect(body.asset.sequentialId).toBe("SAM-0017");
  });

  it("sends the model NAME only — no id, no image columns", async () => {
    const result = await loader(
      createLoaderArgs({
        request: createDetailRequest(),
        params: { assetId: "asset-1" },
      })
    );

    const body = await (result as unknown as Response).json();

    // Exactly `{ name }`: an id has nothing to navigate to on mobile, and the
    // image columns would be a second source of truth for a cascade the shaper
    // has already resolved into mainImage/thumbnailImage.
    expect(body.asset.assetModel).toEqual({ name: "M8 Hex Bolt" });
  });

  it("returns a null model rather than omitting the field when the asset has none", async () => {
    (db.asset.findUnique as any).mockResolvedValue({
      ...buildAsset(),
      assetModel: null,
    });

    const result = await loader(
      createLoaderArgs({
        request: createDetailRequest(),
        params: { assetId: "asset-1" },
      })
    );

    const body = await (result as unknown as Response).json();

    expect(body.asset.assetModel).toBeNull();
  });
});

/**
 * `activeBooking` follows the web asset overview's `CustodyCard` for custody
 * held through a booking: the same gate (the asset is CHECKED_OUT), the same
 * booking (the `bookingAssets` filter, first row), the same visibility (the
 * viewer may see all custody), and INDIVIDUAL assets only.
 */
describe("GET /api/mobile/assets/:assetId — custody through a booking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });
    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (getMobileUserContext as any).mockResolvedValue({
      role: "ADMIN",
      canUseBarcodes: false,
      canUseAudits: false,
      canSeeAllCustody: true,
      canSeeAllBookings: true,
    });
    (db.asset.findUnique as any).mockResolvedValue(buildCheckedOutAsset());
  });

  /** Runs the loader for `asset-1` and returns the parsed body. */
  async function loadDetail() {
    const result = await loader(
      createLoaderArgs({
        request: createDetailRequest(),
        params: { assetId: "asset-1" },
      })
    );
    expect((result as unknown as Response).status).toBe(200);
    return (result as unknown as Response).json();
  }

  /**
   * Signs the caller in as a SELF_SERVICE member whose workspace grants the
   * given overrides.
   */
  function asSelfServiceViewer(overrides: {
    canSeeAllCustody: boolean;
    canSeeAllBookings: boolean;
  }) {
    (getMobileUserContext as any).mockResolvedValue({
      role: "SELF_SERVICE",
      canUseBarcodes: false,
      canUseAudits: false,
      ...overrides,
    });
  }

  it("names the booking and its holder for a viewer who may see all custody", async () => {
    const body = await loadDetail();

    expect(body.asset.activeBooking).toEqual({
      id: "booking-1",
      name: "Field shoot",
      from: "2026-03-02T09:30:00.000Z",
      // The user's display name: the web card resolves the user link first
      custodianName: "Caz",
      canOpen: true,
    });
    // The raw rows only feed the field above
    expect(body.asset).not.toHaveProperty("bookingAssets");
  });

  it("names a team-member custodian that has no user account", async () => {
    (db.asset.findUnique as any).mockResolvedValue(
      buildCheckedOutAsset({
        custodianUser: null,
        custodianTeamMember: {
          id: "tm-dana",
          name: "Dana Contractor",
          userId: null,
        },
      })
    );

    const body = await loadDetail();

    expect(body.asset.activeBooking.custodianName).toBe("Dana Contractor");
  });

  it("sends a null custodian name when the booking has no custodian", async () => {
    (db.asset.findUnique as any).mockResolvedValue(
      buildCheckedOutAsset({ custodianUser: null, custodianTeamMember: null })
    );

    const body = await loadDetail();

    expect(body.asset.activeBooking.id).toBe("booking-1");
    expect(body.asset.activeBooking.custodianName).toBeNull();
  });

  it("withholds the booking from a viewer who may not see custody", async () => {
    asSelfServiceViewer({ canSeeAllCustody: false, canSeeAllBookings: false });

    const body = await loadDetail();

    expect(body.asset.activeBooking).toBeNull();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("Field shoot");
    expect(serialized).not.toContain("Caz");
    expect(serialized).not.toContain("Carol");
  });

  it("withholds it from the booking's own custodian as well, like the web card", async () => {
    asSelfServiceViewer({ canSeeAllCustody: false, canSeeAllBookings: false });
    (db.asset.findUnique as any).mockResolvedValue(
      buildCheckedOutAsset({
        custodianTeamMember: {
          id: "tm-me",
          name: "Test User",
          userId: "user-1",
        },
        custodianUser: {
          id: "user-1",
          firstName: "Test",
          lastName: "User",
          displayName: null,
        },
      })
    );

    const body = await loadDetail();

    // The web card's "is it yours" check reads the CUSTODY row's user, and a
    // booking checkout writes no custody row, so only the permission counts.
    expect(body.asset.activeBooking).toBeNull();
  });

  it("ignores booking rows on a quantity-tracked asset", async () => {
    (db.asset.findUnique as any).mockResolvedValue({
      ...buildAsset(),
      status: "CHECKED_OUT",
      bookingAssets: buildCheckedOutAsset().bookingAssets,
    });

    const body = await loadDetail();

    expect(body.asset.activeBooking).toBeNull();
    // Its custody is the quantity breakdown, which still arrives
    expect(body.asset.quantityBreakdown).not.toBeNull();
    expect(body.asset).not.toHaveProperty("bookingAssets");
  });

  it("sends null, and no raw rows, when the asset is on no active booking", async () => {
    (db.asset.findUnique as any).mockResolvedValue({
      ...buildCheckedOutAsset(),
      bookingAssets: [],
    });

    const body = await loadDetail();

    expect(body.asset.activeBooking).toBeNull();
    expect(body.asset).not.toHaveProperty("bookingAssets");
  });

  it("sends null for an asset staged onto an ongoing booking but not checked out", async () => {
    (db.asset.findUnique as any).mockResolvedValue({
      ...buildCheckedOutAsset(),
      // Assets added to an ONGOING booking stay AVAILABLE until checked out
      status: "AVAILABLE",
    });

    const body = await loadDetail();

    expect(body.asset.activeBooking).toBeNull();
  });

  it("shows the booking as closed to a viewer who may see custody but not other people's bookings", async () => {
    asSelfServiceViewer({ canSeeAllCustody: true, canSeeAllBookings: false });

    const body = await loadDetail();

    expect(body.asset.activeBooking).toEqual({
      id: "booking-1",
      name: "Field shoot",
      from: "2026-03-02T09:30:00.000Z",
      custodianName: "Caz",
      canOpen: false,
    });
  });

  it.each([
    [
      "user link",
      {
        custodianTeamMember: {
          id: "tm-me",
          name: "Test User",
          userId: null,
        },
        custodianUser: {
          id: "user-1",
          firstName: "Test",
          lastName: "User",
          displayName: null,
        },
      },
    ],
    [
      "team-member link",
      {
        custodianTeamMember: {
          id: "tm-me",
          name: "Test User",
          userId: "user-1",
        },
        custodianUser: null,
      },
    ],
  ] satisfies [string, BookingCustodianOverrides][])(
    "lets the booking's custodian open it through the %s",
    async (_link, booking) => {
      asSelfServiceViewer({ canSeeAllCustody: true, canSeeAllBookings: false });
      (db.asset.findUnique as any).mockResolvedValue(
        buildCheckedOutAsset(booking)
      );

      const body = await loadDetail();

      expect(body.asset.activeBooking.canOpen).toBe(true);
    }
  );
});
