import { BookingStatus, KitStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import * as bookingService from "~/modules/booking/service.server";
import * as noteService from "~/modules/note/service.server";
import * as userService from "~/modules/user/service.server";
import * as bookingAssets from "~/utils/booking-assets";
import * as httpServer from "~/utils/http.server";
import * as rolesServer from "~/utils/roles.server";

// Import the action function
import { action } from "./bookings.$bookingId.manage-kits";

// @vitest-environment node

// Mock external dependencies
vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findUniqueOrThrow: vi.fn(),
    },
    kit: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("~/modules/booking/service.server", () => ({
  getDetailedPartialCheckinData: vi.fn(),
  updateBookingAssets: vi.fn(),
}));

vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn(),
}));

vi.mock("~/modules/note/service.server", () => ({
  createNotes: vi.fn(),
}));

vi.mock("~/utils/booking-assets", () => ({
  isKitPartiallyCheckedIn: vi.fn(),
}));

vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

vi.mock("~/utils/http.server", () => ({
  getParams: vi.fn(),
  parseData: vi.fn(),
  json: vi.fn((data) => data),
  error: vi.fn((reason) => reason),
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

describe("manage-kits route validation", () => {
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
  });

  describe("validation scope - only newly added kits", () => {
    it("should only validate kits that add NEW assets to the booking", async () => {
      const mockKits = [
        {
          id: "kit1",
          name: "Kit 1",
          status: KitStatus.CHECKED_OUT,
          assets: [{ id: "asset1" }, { id: "asset3" }], // asset1 exists, asset3 is new
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "kit2",
          name: "Kit 2",
          status: KitStatus.CHECKED_OUT,
          assets: [{ id: "asset1" }, { id: "asset2" }], // all existing assets
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;

      vi.mocked(httpServer.parseData).mockReturnValue({
        kitIds: ["kit1", "kit2"],
        removedKitIds: [],
        redirectTo: null,
      });

      vi.mocked(db.kit.findMany).mockResolvedValue(mockKits);
      vi.mocked(bookingAssets.isKitPartiallyCheckedIn).mockReturnValue(false);

      const response = await action({
        context: mockContext,
        request: mockRequest,
        params: mockParams,
      });

      // Should return error response for checked out kits
      expect(response.status).toBe(500);

      // Should only validate kit1 (adds new asset3), not kit2 (only existing assets)
      expect(bookingAssets.isKitPartiallyCheckedIn).toHaveBeenCalledTimes(1);
      expect(bookingAssets.isKitPartiallyCheckedIn).toHaveBeenCalledWith(
        mockKits[0],
        {},
        new Set(["asset1", "asset2"])
      );
    });

    it("should not validate kits that only contain existing booking assets", async () => {
      const mockKits = [
        {
          id: "kit1",
          name: "Kit 1",
          status: KitStatus.CHECKED_OUT,
          assets: [{ id: "asset1" }, { id: "asset2" }], // all existing
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;

      vi.mocked(httpServer.parseData).mockReturnValue({
        kitIds: ["kit1"],
        removedKitIds: [],
        redirectTo: null,
      });

      vi.mocked(db.kit.findMany).mockResolvedValue(mockKits);

      const { action: actionFunction } = await import(
        "./bookings.$bookingId.manage-kits"
      );

      // Should succeed without validation since no new assets
      await expect(
        actionFunction({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      ).resolves.not.toThrow();

      // Should not call validation helper since no newly added kits
      expect(bookingAssets.isKitPartiallyCheckedIn).not.toHaveBeenCalled();
    });
  });

  describe("context-aware validation", () => {
    it("should allow kits that are partially checked in within booking context", async () => {
      const mockKits = [
        {
          id: "kit1",
          name: "Kit 1",
          status: KitStatus.CHECKED_OUT,
          assets: [{ id: "asset3" }], // new asset
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
        kitIds: ["kit1"],
        removedKitIds: [],
        redirectTo: null,
      });

      vi.mocked(db.kit.findMany).mockResolvedValue(mockKits);
      vi.mocked(bookingService.getDetailedPartialCheckinData).mockResolvedValue(
        {
          checkedInAssetIds: ["asset3"],
          partialCheckinDetails: mockPartialCheckinDetails,
        }
      );

      // Mock that kit is partially checked in (available for other bookings)
      vi.mocked(bookingAssets.isKitPartiallyCheckedIn).mockReturnValue(true);

      const { action: actionFunction } = await import(
        "./bookings.$bookingId.manage-kits"
      );

      // Should succeed because kit is partially checked in within booking context
      await expect(
        actionFunction({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      ).resolves.not.toThrow();

      expect(bookingAssets.isKitPartiallyCheckedIn).toHaveBeenCalledWith(
        mockKits[0],
        mockPartialCheckinDetails,
        new Set(["asset1", "asset2"])
      );
    });

    it("should block kits that are truly checked out (not partially checked in)", async () => {
      const mockKits = [
        {
          id: "kit1",
          name: "Kit 1",
          status: KitStatus.CHECKED_OUT,
          assets: [{ id: "asset3" }], // new asset
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;

      vi.mocked(httpServer.parseData).mockReturnValue({
        kitIds: ["kit1"],
        removedKitIds: [],
        redirectTo: null,
      });

      vi.mocked(db.kit.findMany).mockResolvedValue(mockKits);

      // Mock that kit is NOT partially checked in (truly checked out)
      vi.mocked(bookingAssets.isKitPartiallyCheckedIn).mockReturnValue(false);

      const { action: actionFunction } = await import(
        "./bookings.$bookingId.manage-kits"
      );

      // Should return error response because kit is truly checked out
      const response = await actionFunction({
        context: mockContext,
        request: mockRequest,
        params: mockParams,
      });

      expect(response.status).toBe(500);
    });

    it("should allow available kits regardless of partial check-in status", async () => {
      const mockKits = [
        {
          id: "kit1",
          name: "Kit 1",
          status: KitStatus.AVAILABLE,
          assets: [{ id: "asset3" }], // new asset
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;

      vi.mocked(httpServer.parseData).mockReturnValue({
        kitIds: ["kit1"],
        removedKitIds: [],
        redirectTo: null,
      });

      vi.mocked(db.kit.findMany).mockResolvedValue(mockKits);

      const { action: actionFunction } = await import(
        "./bookings.$bookingId.manage-kits"
      );

      // Should succeed because kit status is AVAILABLE
      await expect(
        actionFunction({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      ).resolves.not.toThrow();

      // Should not call validation helper since kit is available
      expect(bookingAssets.isKitPartiallyCheckedIn).not.toHaveBeenCalled();
    });
  });

  describe("booking status validation", () => {
    it("should only validate for ONGOING and OVERDUE bookings", async () => {
      const mockKits = [
        {
          id: "kit1",
          name: "Kit 1",
          status: KitStatus.CHECKED_OUT,
          assets: [{ id: "asset3" }], // new asset
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;

      // Test with DRAFT booking - should not validate
      const draftBooking = { ...mockBooking, status: BookingStatus.DRAFT };

      vi.mocked(httpServer.parseData).mockReturnValue({
        kitIds: ["kit1"],
        removedKitIds: [],
        redirectTo: null,
      });

      vi.mocked(db.booking.findUniqueOrThrow).mockResolvedValue(draftBooking);
      vi.mocked(db.kit.findMany).mockResolvedValue(mockKits);
      vi.mocked(bookingAssets.isKitPartiallyCheckedIn).mockReturnValue(false);

      // Should succeed because DRAFT bookings allow checked out kits
      await expect(
        action({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      ).resolves.not.toThrow();
    });
  });

  describe("integration with centralized helpers", () => {
    it("should pass correct parameters to isKitPartiallyCheckedIn helper", async () => {
      const mockKits = [
        {
          id: "kit1",
          name: "Kit 1",
          status: KitStatus.CHECKED_OUT,
          assets: [{ id: "asset3" }], // new asset
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
        kitIds: ["kit1"],
        removedKitIds: [],
        redirectTo: null,
      });

      vi.mocked(db.kit.findMany).mockResolvedValue(mockKits);
      vi.mocked(bookingService.getDetailedPartialCheckinData).mockResolvedValue(
        {
          checkedInAssetIds: ["asset3"],
          partialCheckinDetails: mockPartialCheckinDetails,
        }
      );
      vi.mocked(bookingAssets.isKitPartiallyCheckedIn).mockReturnValue(true);

      await action({
        context: mockContext,
        request: mockRequest,
        params: mockParams,
      });

      // Verify helper is called with correct parameters
      expect(bookingAssets.isKitPartiallyCheckedIn).toHaveBeenCalledWith(
        mockKits[0],
        mockPartialCheckinDetails,
        new Set(["asset1", "asset2"]) // existing booking asset IDs
      );
    });
  });
});
