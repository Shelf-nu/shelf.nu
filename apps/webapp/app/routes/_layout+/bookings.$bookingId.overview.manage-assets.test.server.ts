import { AssetStatus, BookingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import * as bookingService from "~/modules/booking/service.server";
import * as noteService from "~/modules/note/service.server";
import * as userService from "~/modules/user/service.server";
import * as bookingAssets from "~/utils/booking-assets";
import * as httpServer from "~/utils/http.server";
import * as rolesServer from "~/utils/roles.server";

// Import the action function
import { action } from "./bookings.$bookingId.overview.manage-assets";
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
  },
}));

vi.mock("~/modules/booking/service.server", () => ({
  getDetailedPartialCheckinData: vi.fn(),
  updateBookingAssets: vi.fn(),
  removeAssets: vi.fn(),
}));

vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn(),
}));

vi.mock("~/modules/note/service.server", () => ({
  createNotes: vi.fn(),
}));

vi.mock("~/utils/booking-assets", () => ({
  isAssetPartiallyCheckedIn: vi.fn(),
}));

vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

vi.mock("~/utils/http.server", () => ({
  getParams: vi.fn(),
  parseData: vi.fn(),
  json: vi.fn((data) => data),
  getCurrentSearchParams: vi.fn(),
  error: vi.fn((reason) => reason),
}));

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

  const mockBooking = {
    id: "booking123",
    status: BookingStatus.ONGOING,
    assets: [{ id: "asset1" }, { id: "asset2" }],
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

      // Should only validate newly added assets (asset3, asset4)
      expect(bookingAssets.isAssetPartiallyCheckedIn).toHaveBeenCalledTimes(2);
      expect(bookingAssets.isAssetPartiallyCheckedIn).toHaveBeenCalledWith(
        mockAssets[0],
        {}
      );
      expect(bookingAssets.isAssetPartiallyCheckedIn).toHaveBeenCalledWith(
        mockAssets[1],
        {}
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
        mockPartialCheckinDetails
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
        mockPartialCheckinDetails
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

      // Verify updateBookingAssets is called with new assets only
      expect(bookingService.updateBookingAssets).toHaveBeenCalledWith({
        id: "booking123",
        organizationId: "org123",
        assetIds: ["asset3"], // only the new asset
      });

      // Verify note creation for new assets
      expect(noteService.createNotes).toHaveBeenCalledWith({
        content:
          "**John Doe** added asset to booking **[Test Booking](/bookings/booking123)**.",
        type: "UPDATE",
        userId: "user123",
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

      // Verify removeAssets is called
      expect(bookingService.removeAssets).toHaveBeenCalledWith({
        booking: { id: "booking123", assetIds: ["asset2"] },
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
});
