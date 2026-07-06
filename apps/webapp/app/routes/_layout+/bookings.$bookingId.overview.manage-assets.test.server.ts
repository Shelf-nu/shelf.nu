import { AssetStatus, BookingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs, createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import * as assetService from "~/modules/asset/service.server";
import * as bookingService from "~/modules/booking/service.server";
import * as modelRequestService from "~/modules/booking-model-request/service.server";
import * as noteService from "~/modules/note/service.server";
import * as userService from "~/modules/user/service.server";
import * as bookingAssets from "~/utils/booking-assets";
import * as httpServer from "~/utils/http.server";
import * as rolesServer from "~/utils/roles.server";

// Import the action + loader functions
import { action, loader } from "./bookings.$bookingId.overview.manage-assets";
import { assertIsDataWithResponseInit } from "../../../test/helpers/assertions";

// @vitest-environment node

// Mock external dependencies
vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findUniqueOrThrow: vi.fn(),
    },
    asset: {
      findMany: vi.fn(),
    },
    // Phase 3c: the quantity-reduction guardrail groupBys over ConsumptionLog
    // to figure out how many units have already been dispositioned on this
    // booking. Mocked here so the new describe block can override it per-test.
    consumptionLog: {
      groupBy: vi.fn(),
    },
  },
}));

vi.mock("~/modules/booking/service.server", () => ({
  getDetailedPartialCheckinData: vi.fn(),
  updateBookingAssets: vi.fn(),
  removeAssets: vi.fn(),
  // Loader-only — used by the F2 loader tests below.
  getBooking: vi.fn(),
  getKitIdsByAssets: vi.fn(),
}));

// Loader-only — `getPaginatedAndFilterableAssets` backs the Assets tab list.
vi.mock("~/modules/asset/service.server", () => ({
  getPaginatedAndFilterableAssets: vi.fn(),
}));

// why: mock the shared Models-tab payload helper as a unit so the loader
// test isolates "does the loader wire the helper's output into the payload"
// from the helper's own DB logic, which has its own unit test in
// `booking-model-request/service.server.test.ts`.
vi.mock("~/modules/booking-model-request/service.server", () => ({
  getBookingModelTabData: vi.fn(),
}));

vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn(),
}));

vi.mock("~/modules/note/service.server", () => ({
  createNotes: vi.fn(),
}));

// The manage-assets action writes system booking notes for add/remove/adjust
// activity. Mocked here so it doesn't try to hit the real `db.bookingNote`.
vi.mock("~/modules/booking-note/service.server", () => ({
  createSystemBookingNote: vi.fn().mockResolvedValue({}),
}));

vi.mock("~/utils/booking-assets", () => ({
  isAssetPartiallyCheckedIn: vi.fn(),
}));

vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

vi.mock("~/utils/http.server", async (importOriginal) => {
  const actual = await importOriginal<typeof httpServer>();
  return {
    getParams: vi.fn(),
    parseData: vi.fn(),
    json: vi.fn((data) => data),
    getCurrentSearchParams: vi.fn(),
    error: vi.fn((reason) => reason),
    // why: mirror the real `payload()` shape (`{ error: null, ...data }`) so
    // the Models-tab loader tests can inspect the returned keys directly.
    payload: vi.fn((data) => ({ error: null, ...data })),
    // why: use the REAL safeRedirect so the redirect tests exercise the actual
    // origin-allowlist sanitization the action now depends on (safeRedirect's
    // own edge cases are unit-tested in http.server.test.ts).
    safeRedirect: actual.safeRedirect,
  };
});

vi.mock("~/modules/asset/utils.server", () => ({
  getAssetsWhereInput: vi.fn(),
}));

// Mock request and context objects
const mockContext = {
  getSession: () => ({ userId: "user123" }),
  appVersion: "1.0.0",
  isAuthenticated: true,
  setSession: vi.fn(),
  destroySession: vi.fn(),
  errorMessage: null,
} as any;

const mockRequest = {
  formData: () => Promise.resolve(new FormData()),
  cache: "default",
  credentials: "same-origin",
  destination: "",
  headers: new Headers(),
  integrity: "",
  method: "POST",
  mode: "cors",
  redirect: "follow",
  referrer: "",
  url: "http://localhost",
} as any;

const mockParams = { bookingId: "booking123" };

describe("manage-assets route validation", () => {
  const mockUser = {
    id: "user123",
    firstName: "John",
    lastName: "Doe",
    email: "john@example.com",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;

  // Phase 3a renamed the implicit M2M to the explicit BookingAsset pivot;
  // the action reads `booking.bookingAssets` now, so the mock shape follows.
  const mockBooking = {
    id: "booking123",
    status: BookingStatus.ONGOING,
    bookingAssets: [
      { asset: { id: "asset1" }, assetId: "asset1", quantity: 1, id: "ba1" },
      { asset: { id: "asset2" }, assetId: "asset2", quantity: 1, id: "ba2" },
    ],
    from: new Date(),
    to: new Date(),
    name: "Test Booking",
    organizationId: "org123",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({
      organizationId: "org123",
      isSelfServiceOrBase: false,
      organizations: [],
      currentOrganization: {} as any,
      role: {} as any,
      userOrganizations: [],
      canSeeAllBookings: false,
      canSeeAllCustody: false,
      canUseBarcodes: false,
      canUseAudits: false,
    });

    vi.mocked(httpServer.getParams).mockReturnValue({
      bookingId: "booking123",
    });

    vi.mocked(userService.getUserByID).mockResolvedValue(mockUser);
    vi.mocked(db.booking.findUniqueOrThrow).mockResolvedValue(mockBooking);
    vi.mocked(bookingService.getDetailedPartialCheckinData).mockResolvedValue({
      checkedInAssetIds: [],
      partialCheckinDetails: {},
    });
    vi.mocked(bookingService.updateBookingAssets).mockResolvedValue({
      id: "booking123",
      name: "Test Booking",
      status: BookingStatus.ONGOING,
    });
    vi.mocked(noteService.createNotes).mockResolvedValue({ count: 0 });
    vi.mocked(bookingService.removeAssets).mockResolvedValue({} as any);
  });

  describe("validation scope - only newly added assets", () => {
    it("should only validate assets that are NEW to the booking", async () => {
      const mockAssets = [
        {
          id: "asset3", // new asset
          title: "Asset 3",
          status: AssetStatus.CHECKED_OUT,
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "asset4", // new asset
          title: "Asset 4",
          status: AssetStatus.CHECKED_OUT,
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;

      vi.mocked(httpServer.parseData).mockReturnValue({
        assetIds: ["asset1", "asset2", "asset3", "asset4"], // asset1,2 existing, asset3,4 new
        removedAssetIds: [],
        redirectTo: null,
      });

      vi.mocked(db.asset.findMany).mockResolvedValue(mockAssets);
      vi.mocked(bookingAssets.isAssetPartiallyCheckedIn).mockReturnValue(false);

      const response = await action(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      // Should return error response for checked out assets
      assertIsDataWithResponseInit(response);
      expect(response.init?.status).toBe(500);

      // Should only validate newly added assets (asset3, asset4).
      // Phase 3c added bookingStatus as the 3rd arg so the helper can
      // differentiate active bookings from COMPLETE/ARCHIVED.
      expect(bookingAssets.isAssetPartiallyCheckedIn).toHaveBeenCalledTimes(2);
      expect(bookingAssets.isAssetPartiallyCheckedIn).toHaveBeenCalledWith(
        mockAssets[0],
        {},
        "ONGOING"
      );
      expect(bookingAssets.isAssetPartiallyCheckedIn).toHaveBeenCalledWith(
        mockAssets[1],
        {},
        "ONGOING"
      );
    });

    it("should not validate assets that already exist in the booking", async () => {
      vi.mocked(httpServer.parseData).mockReturnValue({
        assetIds: ["asset1", "asset2"], // all existing assets
        removedAssetIds: [],
        redirectTo: null,
      });

      vi.mocked(db.asset.findMany).mockResolvedValue([]);

      const { action: actionFunction } = await import(
        "./bookings.$bookingId.overview.manage-assets"
      );

      // Should succeed without validation since no new assets
      await expect(
        actionFunction(
          createActionArgs({
            context: mockContext,
            request: mockRequest,
            params: mockParams,
          })
        )
      ).resolves.not.toThrow();

      // Should not call validation helper since no newly added assets
      expect(bookingAssets.isAssetPartiallyCheckedIn).not.toHaveBeenCalled();
    });
  });

  describe("context-aware validation", () => {
    it("should allow assets that are partially checked in within booking context", async () => {
      const mockAssets = [
        {
          id: "asset3", // new asset
          title: "Asset 3",
          status: AssetStatus.CHECKED_OUT,
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;

      const mockPartialCheckinDetails = {
        asset3: {
          checkinDate: new Date("2023-01-01"),
          checkedInBy: {
            id: "user123",
            firstName: "John",
            lastName: "Doe",
            profilePicture: null,
          },
        },
      };

      vi.mocked(httpServer.parseData).mockReturnValue({
        assetIds: ["asset1", "asset2", "asset3"], // asset3 is new
        removedAssetIds: [],
        redirectTo: null,
      });

      vi.mocked(db.asset.findMany).mockResolvedValue(mockAssets);
      vi.mocked(bookingService.getDetailedPartialCheckinData).mockResolvedValue(
        {
          checkedInAssetIds: ["asset3"],
          partialCheckinDetails: mockPartialCheckinDetails,
        }
      );

      // Mock that asset is partially checked in (available for other bookings)
      vi.mocked(bookingAssets.isAssetPartiallyCheckedIn).mockReturnValue(true);

      const { action: actionFunction } = await import(
        "./bookings.$bookingId.overview.manage-assets"
      );

      // Should succeed because asset is partially checked in within booking context
      await expect(
        actionFunction(
          createActionArgs({
            context: mockContext,
            request: mockRequest,
            params: mockParams,
          })
        )
      ).resolves.not.toThrow();

      expect(bookingAssets.isAssetPartiallyCheckedIn).toHaveBeenCalledWith(
        mockAssets[0],
        mockPartialCheckinDetails,
        "ONGOING"
      );
    });

    it("should block assets that are truly checked out (not partially checked in)", async () => {
      const mockAssets = [
        {
          id: "asset3", // new asset
          title: "Asset 3",
          status: AssetStatus.CHECKED_OUT,
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;

      vi.mocked(httpServer.parseData).mockReturnValue({
        assetIds: ["asset1", "asset2", "asset3"], // asset3 is new
        removedAssetIds: [],
        redirectTo: null,
      });

      vi.mocked(db.asset.findMany).mockResolvedValue(mockAssets);

      // Mock that asset is NOT partially checked in (truly checked out)
      vi.mocked(bookingAssets.isAssetPartiallyCheckedIn).mockReturnValue(false);

      const { action: actionFunction } = await import(
        "./bookings.$bookingId.overview.manage-assets"
      );

      // Should return error response because asset is truly checked out
      const response = await actionFunction(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      assertIsDataWithResponseInit(response);
      expect(response.init?.status).toBe(500);
    });

    it("should allow available assets regardless of partial check-in status", async () => {
      vi.mocked(httpServer.parseData).mockReturnValue({
        assetIds: ["asset1", "asset2", "asset3"], // asset3 is new
        removedAssetIds: [],
        redirectTo: null,
      });

      vi.mocked(db.asset.findMany).mockResolvedValue([]);

      const { action: actionFunction } = await import(
        "./bookings.$bookingId.overview.manage-assets"
      );

      // Should succeed because asset status is AVAILABLE
      await expect(
        actionFunction(
          createActionArgs({
            context: mockContext,
            request: mockRequest,
            params: mockParams,
          })
        )
      ).resolves.not.toThrow();

      // Should not call validation helper since asset is available
      expect(bookingAssets.isAssetPartiallyCheckedIn).not.toHaveBeenCalled();
    });
  });

  describe("booking status validation", () => {
    it("should only validate for ONGOING and OVERDUE bookings", async () => {
      const mockAssets = [
        {
          id: "asset3", // new asset
          title: "Asset 3",
          status: AssetStatus.CHECKED_OUT,
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;

      // Test with DRAFT booking - should not validate
      const draftBooking = { ...mockBooking, status: BookingStatus.DRAFT };

      vi.mocked(httpServer.parseData).mockReturnValue({
        assetIds: ["asset1", "asset2", "asset3"], // asset3 is new
        removedAssetIds: [],
        redirectTo: null,
      });

      vi.mocked(db.booking.findUniqueOrThrow).mockResolvedValue(draftBooking);
      vi.mocked(db.asset.findMany).mockResolvedValue(mockAssets);
      vi.mocked(bookingAssets.isAssetPartiallyCheckedIn).mockReturnValue(false);

      const { action: actionFunction } = await import(
        "./bookings.$bookingId.overview.manage-assets"
      );

      // Should succeed because DRAFT bookings allow checked out assets
      await expect(
        actionFunction(
          createActionArgs({
            context: mockContext,
            request: mockRequest,
            params: mockParams,
          })
        )
      ).resolves.not.toThrow();
    });

    it("should validate for ONGOING bookings", async () => {
      const mockAssets = [
        {
          id: "asset3", // new asset
          title: "Asset 3",
          status: AssetStatus.CHECKED_OUT,
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;

      // Test with ONGOING booking - should validate
      const ongoingBooking = { ...mockBooking, status: BookingStatus.ONGOING };

      vi.mocked(httpServer.parseData).mockReturnValue({
        assetIds: ["asset1", "asset2", "asset3"], // asset3 is new
        removedAssetIds: [],
        redirectTo: null,
      });

      vi.mocked(db.booking.findUniqueOrThrow).mockResolvedValue(ongoingBooking);
      vi.mocked(db.asset.findMany).mockResolvedValue(mockAssets);
      vi.mocked(bookingAssets.isAssetPartiallyCheckedIn).mockReturnValue(false);

      const { action: actionFunction } = await import(
        "./bookings.$bookingId.overview.manage-assets"
      );

      // Should return error response because ONGOING booking validates checked out assets
      const response = await actionFunction(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      assertIsDataWithResponseInit(response);
      expect(response.init?.status).toBe(500);
    });

    it("should validate for OVERDUE bookings", async () => {
      const mockAssets = [
        {
          id: "asset3", // new asset
          title: "Asset 3",
          status: AssetStatus.CHECKED_OUT,
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;

      // Test with OVERDUE booking - should validate
      const overdueBooking = { ...mockBooking, status: BookingStatus.OVERDUE };

      vi.mocked(httpServer.parseData).mockReturnValue({
        assetIds: ["asset1", "asset2", "asset3"], // asset3 is new
        removedAssetIds: [],
        redirectTo: null,
      });

      vi.mocked(db.booking.findUniqueOrThrow).mockResolvedValue(overdueBooking);
      vi.mocked(db.asset.findMany).mockResolvedValue(mockAssets);
      vi.mocked(bookingAssets.isAssetPartiallyCheckedIn).mockReturnValue(false);

      const { action: actionFunction } = await import(
        "./bookings.$bookingId.overview.manage-assets"
      );

      // Should return error response because OVERDUE booking validates checked out assets
      const response = await actionFunction(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      assertIsDataWithResponseInit(response);
      expect(response.init?.status).toBe(500);
    });
  });

  describe("integration with centralized helpers", () => {
    it("should pass correct parameters to isAssetPartiallyCheckedIn helper", async () => {
      const mockAssets = [
        {
          id: "asset3", // new asset
          title: "Asset 3",
          status: AssetStatus.CHECKED_OUT,
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;

      const mockPartialCheckinDetails = {
        asset3: {
          checkinDate: new Date("2023-01-01"),
          checkedInBy: {
            id: "user123",
            firstName: "John",
            lastName: "Doe",
            profilePicture: null,
          },
        },
      };

      vi.mocked(httpServer.parseData).mockReturnValue({
        assetIds: ["asset1", "asset2", "asset3"], // asset3 is new
        removedAssetIds: [],
        redirectTo: null,
      });

      vi.mocked(db.asset.findMany).mockResolvedValue(mockAssets);
      vi.mocked(bookingService.getDetailedPartialCheckinData).mockResolvedValue(
        {
          checkedInAssetIds: ["asset3"],
          partialCheckinDetails: mockPartialCheckinDetails,
        }
      );
      vi.mocked(bookingAssets.isAssetPartiallyCheckedIn).mockReturnValue(true);

      const { action: actionFunction } = await import(
        "./bookings.$bookingId.overview.manage-assets"
      );

      await actionFunction(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      // Verify helper is called with correct parameters
      expect(bookingAssets.isAssetPartiallyCheckedIn).toHaveBeenCalledWith(
        mockAssets[0],
        mockPartialCheckinDetails,
        "ONGOING"
      );
    });
  });

  describe("asset management operations", () => {
    it("should handle asset addition and note creation", async () => {
      vi.mocked(httpServer.parseData).mockReturnValue({
        assetIds: ["asset1", "asset2", "asset3"], // asset3 is new
        removedAssetIds: [],
        redirectTo: null,
      });

      // The route does two findMany calls: one for status validation and
      // one (post-Phase-3c) to load title/type for the activity note.
      // Returning a full asset row covers both.
      const newAsset3 = {
        id: "asset3",
        title: "Asset 3",
        type: "INDIVIDUAL",
        status: AssetStatus.AVAILABLE,
        organizationId: "org123",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;
      vi.mocked(db.asset.findMany).mockResolvedValue([newAsset3]);

      const { action: actionFunction } = await import(
        "./bookings.$bookingId.overview.manage-assets"
      );

      await actionFunction(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      // Verify updateBookingAssets is called with new assets only.
      // Phase 3c added `quantities` (per-asset booked qty) and `userId`
      // (for activity notes inside the service).
      expect(bookingService.updateBookingAssets).toHaveBeenCalledWith({
        id: "booking123",
        organizationId: "org123",
        assetIds: ["asset3"], // only the new asset
        quantities: {},
        userId: "user123",
      });

      // Verify per-asset note creation. The route now uses markdoc link
      // wrappers for both actor and booking so activity rendering stays
      // consistent with the rest of the feed.
      // why: createNotes requires organizationId (cross-org asset guard).
      expect(noteService.createNotes).toHaveBeenCalledWith({
        content:
          '{% link to="/settings/team/users/user123" text="John Doe" /%} added asset to {% link to="/bookings/booking123" text="Test Booking" /%}.',
        type: "UPDATE",
        userId: "user123",
        organizationId: "org123",
        assetIds: ["asset3"], // only the new asset
      });
    });

    it("should handle asset removal", async () => {
      vi.mocked(httpServer.parseData).mockReturnValue({
        assetIds: ["asset1"], // asset2 removed
        removedAssetIds: ["asset2"],
        redirectTo: null,
      });

      vi.mocked(db.asset.findMany).mockResolvedValue([]);

      const { action: actionFunction } = await import(
        "./bookings.$bookingId.overview.manage-assets"
      );

      await actionFunction(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      // Verify removeAssets is called. `assets` is the post-Phase-3c array
      // of full asset rows loaded from the DB for note rendering (empty
      // here because the test mocks `db.asset.findMany` to return []).
      expect(bookingService.removeAssets).toHaveBeenCalledWith({
        booking: { id: "booking123", assetIds: ["asset2"] },
        assets: [], // db.asset.findMany returns [] in this test
        firstName: "John",
        lastName: "Doe",
        userId: "user123",
        organizationId: "org123",
      });
    });

    it("should not update booking when no new assets are added", async () => {
      vi.mocked(httpServer.parseData).mockReturnValue({
        assetIds: ["asset1", "asset2"], // no new assets
        removedAssetIds: [],
        redirectTo: null,
      });

      vi.mocked(db.asset.findMany).mockResolvedValue([]);

      const { action: actionFunction } = await import(
        "./bookings.$bookingId.overview.manage-assets"
      );

      await actionFunction(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      // Should not call updateBookingAssets when no new assets
      expect(bookingService.updateBookingAssets).not.toHaveBeenCalled();
      expect(noteService.createNotes).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should provide descriptive error messages for checked out assets", async () => {
      const mockAssets = [
        {
          id: "asset3",
          title: "Laptop Dell",
          status: AssetStatus.CHECKED_OUT,
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "asset4",
          title: "Monitor Samsung",
          status: AssetStatus.CHECKED_OUT,
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;

      vi.mocked(httpServer.parseData).mockReturnValue({
        assetIds: ["asset1", "asset2", "asset3", "asset4"], // asset3,4 are new
        removedAssetIds: [],
        redirectTo: null,
      });

      vi.mocked(db.asset.findMany).mockResolvedValue(mockAssets);
      vi.mocked(bookingAssets.isAssetPartiallyCheckedIn).mockReturnValue(false);

      const response = await action(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      assertIsDataWithResponseInit(response);
      expect(response.init?.status).toBe(500);
    });
  });

  /**
   * Phase 3c quantity-reduction guardrail.
   *
   * When the user edits a qty-tracked asset's booked quantity in the manage-
   * assets drawer, the action must reject any value lower than the number of
   * units already dispositioned on this booking via ConsumptionLog (RETURN /
   * CONSUME / LOSS / DAMAGE). Otherwise `remaining = booked − Σ(logs)` could
   * go negative and the check-in math would break.
   *
   * The booking fixture here intentionally diverges from the outer
   * `mockBooking` — we need `bookingAssets` shaped to match the action's
   * `select` (assetId, quantity, asset.{id,title,type}) so the guardrail's
   * `existingBookingAssetMap` lookup works.
   */
  describe("manage-assets — qty-tracked lower-bound guardrail", () => {
    /** Booking with one qty-tracked asset already reserving 10 units */
    const qtyBooking = {
      id: "booking123",
      status: BookingStatus.ONGOING,
      name: "Test Booking",
      organizationId: "org123",
      from: new Date(),
      to: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      bookingAssets: [
        {
          assetId: "asset-pens",
          quantity: 10,
          asset: {
            id: "asset-pens",
            title: "Pens",
            type: "QUANTITY_TRACKED",
          },
        },
      ],
    } as any;

    beforeEach(() => {
      // The booking fetched inside the action must carry the qty-tracked
      // bookingAsset fixture, not the default `mockBooking` from the outer
      // describe (which has a different shape).
      vi.mocked(db.booking.findUniqueOrThrow).mockResolvedValue(qtyBooking);
      // No newly-added assets in this flow, so findMany for CHECKED_OUT
      // assets returns empty.
      vi.mocked(db.asset.findMany).mockResolvedValue([]);
    });

    it("rejects reducing BookingAsset.quantity below the already-logged sum", async () => {
      // 6 units already dispositioned; user tries to lower booked qty to 4.
      vi.mocked(db.consumptionLog.groupBy).mockResolvedValue([
        { assetId: "asset-pens", _sum: { quantity: 6 } },
      ] as any);

      vi.mocked(httpServer.parseData).mockReturnValue({
        assetIds: ["asset-pens"], // existing — triggers the adjust-quantity branch
        removedAssetIds: [],
        redirectTo: null,
        quantities: JSON.stringify({ "asset-pens": 4 }),
      } as any);

      const response = await action(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      // The guardrail throws ShelfError(status: 400); the outer try/catch in
      // the action converts it into a data() response with the same status.
      assertIsDataWithResponseInit(response);
      expect(response.init?.status).toBe(400);

      // Error message must communicate the minimum threshold to the user.
      // Match on a stable substring rather than the exact string so wording
      // tweaks don't break the test.
      //
      // The http.server `error` helper is mocked in this file to just pass
      // the ShelfError through (see vi.mock at the top), so `response.data`
      // is the ShelfError instance itself — access `.message` directly.
      const payload = response.data as { message?: string };
      expect(payload?.message).toEqual(expect.stringContaining("below 6"));

      // Crucially, the pivot row must NOT be updated when the guardrail trips.
      expect(bookingService.updateBookingAssets).not.toHaveBeenCalled();
    });

    it("allows reducing to the logged sum or increasing the quantity", async () => {
      vi.mocked(db.consumptionLog.groupBy).mockResolvedValue([
        { assetId: "asset-pens", _sum: { quantity: 6 } },
      ] as any);

      // Case 1: submit exactly the logged sum (6) → allowed.
      vi.mocked(httpServer.parseData).mockReturnValue({
        assetIds: ["asset-pens"],
        removedAssetIds: [],
        redirectTo: null,
        quantities: JSON.stringify({ "asset-pens": 6 }),
      } as any);

      await action(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      expect(bookingService.updateBookingAssets).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "booking123",
          organizationId: "org123",
          assetIds: ["asset-pens"],
          quantities: { "asset-pens": 6 },
        })
      );

      // Reset between sub-cases so the second assertion isn't polluted by
      // the first call's counters.
      vi.mocked(bookingService.updateBookingAssets).mockClear();

      // Case 2: submit a larger quantity (12) → allowed, no guardrail concern.
      vi.mocked(httpServer.parseData).mockReturnValue({
        assetIds: ["asset-pens"],
        removedAssetIds: [],
        redirectTo: null,
        quantities: JSON.stringify({ "asset-pens": 12 }),
      } as any);

      await action(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      expect(bookingService.updateBookingAssets).toHaveBeenCalledWith(
        expect.objectContaining({
          quantities: { "asset-pens": 12 },
        })
      );
    });
  });

  /**
   * The footer `<Form ref={formRef}>` used to render only on the Assets tab,
   * so `UnsavedChangesAlert.onYes` (`submit(formRef.current)`) ran against a
   * null ref while on the Models tab and silently no-opped: no redirect, no
   * assets added. The form is now always mounted; a full Happy-DOM
   * click-through (Models tab → alert → Yes → POST) isn't practical against
   * this route (heavy component, many providers), so this covers the
   * action-level contract the fix depends on: submitting the always-mounted
   * form with a non-null `redirectTo` must redirect there instead of falling
   * through to the default `/bookings/:id`.
   */
  describe("redirectTo handling (confirm-from-unsaved-changes alert)", () => {
    it("redirects to the submitted redirectTo URL instead of the default booking page", async () => {
      const manageKitsUrl =
        "/bookings/booking123/overview/manage-kits?hideUnavailable=true";

      vi.mocked(httpServer.parseData).mockReturnValue({
        assetIds: ["asset1", "asset2"], // both already on the booking — isolates the redirect branch
        removedAssetIds: [],
        redirectTo: manageKitsUrl,
      });

      vi.mocked(db.asset.findMany).mockResolvedValue([]);

      const response = await action(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(302);
      expect((response as Response).headers.get("Location")).toBe(
        manageKitsUrl
      );
    });

    it("redirects to the default booking page when redirectTo is absent", async () => {
      vi.mocked(httpServer.parseData).mockReturnValue({
        assetIds: ["asset1", "asset2"],
        removedAssetIds: [],
        redirectTo: null,
      });

      vi.mocked(db.asset.findMany).mockResolvedValue([]);

      const response = await action(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(302);
      expect((response as Response).headers.get("Location")).toBe(
        "/bookings/booking123"
      );
    });

    it("sanitizes an off-origin redirectTo to the booking page (no open redirect)", async () => {
      // A crafted POST could supply an attacker-controlled absolute URL in the
      // client-side `redirectTo` field. The action must route it through
      // safeRedirect, which rejects off-origin targets and falls back to the
      // booking page instead of redirecting the user off-site.
      vi.mocked(httpServer.parseData).mockReturnValue({
        assetIds: ["asset1", "asset2"],
        removedAssetIds: [],
        redirectTo: "https://evil.example.com/phish",
      });

      vi.mocked(db.asset.findMany).mockResolvedValue([]);

      const response = await action(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(302);
      expect((response as Response).headers.get("Location")).toBe(
        "/bookings/booking123"
      );
    });
  });
});

/**
 * The loader used to inline the "count AssetModels, fetch the first
 * MODEL_PICKER_LIMIT, compute per-model availability, project modelRequests"
 * block directly. It now delegates to the shared `getBookingModelTabData`
 * helper so manage-assets and manage-kits compute Models-tab availability
 * identically. This is a pure refactor — the loader's payload keys and shapes
 * must stay byte-identical, so `getBookingModelTabData` is mocked here to
 * isolate "does the loader wire the helper's output through" from the
 * helper's own DB logic (covered separately by
 * `booking-model-request/service.server.test.ts`).
 */
describe("manage-assets loader — Models tab payload", () => {
  const mockContext = {
    getSession: () => ({ userId: "user123" }),
    appVersion: "1.0.0",
    isAuthenticated: true,
    setSession: vi.fn(),
    destroySession: vi.fn(),
    errorMessage: null,
  } as any;

  const mockParams = { bookingId: "booking123" };

  /** Minimal booking shape the loader needs — DRAFT so no status guard fires. */
  const mockLoaderBooking = {
    id: "booking123",
    name: "Test Booking",
    status: BookingStatus.DRAFT,
    from: new Date("2026-01-01"),
    to: new Date("2026-01-02"),
    bookingAssets: [],
    modelRequests: [],
  } as any;

  /** `getPaginatedAndFilterableAssets` return shape the loader destructures. */
  const mockPaginatedAssets = {
    search: null,
    totalAssets: 0,
    perPage: 20,
    page: 1,
    categories: [],
    tags: [],
    assets: [],
    totalPages: 0,
    totalCategories: 0,
    totalTags: 0,
    locations: [],
    totalLocations: 0,
  };

  /** Known `getBookingModelTabData` output — the five keys F2 is about. */
  const mockModelTabData = {
    showModelsTab: true,
    assetModels: [
      {
        id: "model1",
        name: "Dell XPS",
        total: 5,
        available: 3,
        reservedConcrete: 1,
        reservedViaRequest: 1,
        inCustody: 0,
      },
    ],
    initialAssetModels: [
      {
        id: "model1",
        name: "Dell XPS",
        metadata: {
          total: 5,
          available: 3,
          reservedConcrete: 1,
          reservedViaRequest: 1,
          inCustody: 0,
        },
      },
    ],
    totalAssetModels: 1,
    modelRequests: [
      {
        assetModelId: "model1",
        assetModelName: "Dell XPS",
        quantity: 2,
        fulfilledQuantity: 0,
        fulfilledAt: null,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(rolesServer.requirePermission).mockResolvedValue({
      organizationId: "org123",
      userOrganizations: [],
      isSelfServiceOrBase: false,
      organizations: [],
      currentOrganization: {} as any,
      role: {} as any,
      canSeeAllBookings: false,
      canSeeAllCustody: false,
      canUseBarcodes: false,
      canUseAudits: false,
    });

    vi.mocked(httpServer.getParams).mockReturnValue({
      bookingId: "booking123",
    });

    vi.mocked(assetService.getPaginatedAndFilterableAssets).mockResolvedValue(
      mockPaginatedAssets as any
    );
    vi.mocked(bookingService.getBooking).mockResolvedValue(mockLoaderBooking);
    vi.mocked(bookingService.getKitIdsByAssets).mockReturnValue([]);
    vi.mocked(modelRequestService.getBookingModelTabData).mockResolvedValue(
      mockModelTabData as any
    );
  });

  it("wires the helper's output through to the loader payload, unchanged", async () => {
    const result = await loader(
      createLoaderArgs({ context: mockContext, params: mockParams })
    );

    expect(modelRequestService.getBookingModelTabData).toHaveBeenCalledWith({
      organizationId: "org123",
      booking: mockLoaderBooking,
    });

    // Byte-identical parity check: same five keys, same values, nothing
    // dropped or reshaped on the way from helper → payload.
    expect(result).toMatchObject({
      showModelsTab: mockModelTabData.showModelsTab,
      assetModels: mockModelTabData.assetModels,
      initialAssetModels: mockModelTabData.initialAssetModels,
      totalAssetModels: mockModelTabData.totalAssetModels,
      modelRequests: mockModelTabData.modelRequests,
    });
  });

  it("hides the Models tab when the helper reports no asset models", async () => {
    vi.mocked(modelRequestService.getBookingModelTabData).mockResolvedValue({
      showModelsTab: false,
      assetModels: [],
      initialAssetModels: [],
      totalAssetModels: 0,
      modelRequests: [],
    });

    const result = await loader(
      createLoaderArgs({ context: mockContext, params: mockParams })
    );

    expect(result).toMatchObject({
      showModelsTab: false,
      assetModels: [],
      initialAssetModels: [],
      totalAssetModels: 0,
      modelRequests: [],
    });
  });
});
