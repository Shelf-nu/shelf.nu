import { BookingStatus, KitStatus } from "@shelf/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { queryRaw } from "~/database/sql.server";
import * as bookingService from "~/modules/booking/service.server";
import * as noteService from "~/modules/note/service.server";
import * as userService from "~/modules/user/service.server";
import * as bookingAssets from "~/utils/booking-assets";
import * as httpServer from "~/utils/http.server";
import * as rolesServer from "~/utils/roles.server";

// Import the action function
import { action } from "./bookings.$bookingId.overview.manage-kits";
import { assertIsDataWithResponseInit } from "../../../test/helpers/assertions";

// @vitest-environment node

// why: stub — the real db is not used directly; sql helpers are mocked below
vi.mock("~/database/db.server", () => ({
  db: {},
}));

// why: isolating SQL queries executed by the action
vi.mock("~/database/sql.server", () => ({
  queryRaw: vi.fn().mockResolvedValue([]),
  sql: vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) =>
    strings.join("")
  ),
  join: vi.fn((fragments: string[], separator: string) =>
    fragments.join(separator)
  ),
}));

// why: not used in the action but imported transitively; findUnique needed by email-helpers
vi.mock("~/database/query-helpers.server", () => ({
  findMany: vi.fn().mockResolvedValue([]),
  findUnique: vi.fn().mockResolvedValue(null),
}));

vi.mock("~/modules/booking/service.server", () => ({
  getDetailedPartialCheckinData: vi.fn(),
  updateBookingAssets: vi.fn(),
  getKitIdsByAssets: vi.fn(),
  getBooking: vi.fn(),
  removeAssets: vi.fn(),
  createKitBookingNote: vi.fn(),
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

// why: sendBookingUpdatedEmail is fire-and-forget; mock to prevent transitive db calls
vi.mock("~/modules/booking/email-helpers", () => ({
  sendBookingUpdatedEmail: vi.fn().mockResolvedValue(undefined),
}));

// why: imported by route but not exercised in tests
vi.mock("~/utils/client-hints", () => ({
  getClientHint: vi.fn().mockReturnValue({}),
}));

const mockedQueryRaw = vi.mocked(queryRaw);

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

  const mockBookingRow = {
    id: "booking123",
    status: BookingStatus.ONGOING,
  };

  const mockBookingAssetRows = [{ id: "asset1" }, { id: "asset2" }];

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset queryRaw to clear any leftover mockResolvedValueOnce queue
    mockedQueryRaw.mockReset();

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
      const mockKitRows = [
        { id: "kit1", name: "Kit 1", status: KitStatus.CHECKED_OUT },
        { id: "kit2", name: "Kit 2", status: KitStatus.CHECKED_OUT },
      ];

      const mockKitAssetRows = [
        { kitId: "kit1", id: "asset1", status: "AVAILABLE" },
        { kitId: "kit1", id: "asset3", status: "AVAILABLE" },
        { kitId: "kit2", id: "asset1", status: "AVAILABLE" },
        { kitId: "kit2", id: "asset2", status: "AVAILABLE" },
      ];

      vi.mocked(httpServer.parseData).mockReturnValue({
        kitIds: ["kit1", "kit2"],
        removedKitIds: [],
        redirectTo: null,
      });

      mockedQueryRaw
        .mockResolvedValueOnce([mockBookingRow]) // booking lookup
        .mockResolvedValueOnce(mockBookingAssetRows) // booking assets
        .mockResolvedValueOnce(mockKitRows) // kit rows
        .mockResolvedValueOnce(mockKitAssetRows); // kit asset rows

      vi.mocked(bookingAssets.isKitPartiallyCheckedIn).mockReturnValue(false);

      const response = await action(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      // Should return error response for checked out kits
      assertIsDataWithResponseInit(response);
      expect(response.init?.status).toBe(500);

      // Should only validate kit1 (adds new asset3), not kit2 (only existing assets)
      expect(bookingAssets.isKitPartiallyCheckedIn).toHaveBeenCalledTimes(1);
      expect(bookingAssets.isKitPartiallyCheckedIn).toHaveBeenCalledWith(
        expect.objectContaining({ id: "kit1" }),
        {},
        new Set(["asset1", "asset2"]),
        BookingStatus.ONGOING
      );
    });

    it("should not validate kits that only contain existing booking assets", async () => {
      const mockKitRows = [
        { id: "kit1", name: "Kit 1", status: KitStatus.CHECKED_OUT },
      ];

      const mockKitAssetRows = [
        { kitId: "kit1", id: "asset1", status: "AVAILABLE" },
        { kitId: "kit1", id: "asset2", status: "AVAILABLE" },
      ];

      vi.mocked(httpServer.parseData).mockReturnValue({
        kitIds: ["kit1"],
        removedKitIds: [],
        redirectTo: null,
      });

      mockedQueryRaw
        .mockResolvedValueOnce([mockBookingRow])
        .mockResolvedValueOnce(mockBookingAssetRows)
        .mockResolvedValueOnce(mockKitRows)
        .mockResolvedValueOnce(mockKitAssetRows);

      const { action: actionFunction } = await import(
        "./bookings.$bookingId.overview.manage-kits"
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

      // Should not call validation helper since no newly added kits
      expect(bookingAssets.isKitPartiallyCheckedIn).not.toHaveBeenCalled();
    });
  });

  describe("context-aware validation", () => {
    it("should allow kits that are partially checked in within booking context", async () => {
      const mockKitRows = [
        { id: "kit1", name: "Kit 1", status: KitStatus.CHECKED_OUT },
      ];

      const mockKitAssetRows = [
        { kitId: "kit1", id: "asset3", status: "AVAILABLE" },
      ];

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

      mockedQueryRaw
        .mockResolvedValueOnce([mockBookingRow])
        .mockResolvedValueOnce(mockBookingAssetRows)
        .mockResolvedValueOnce(mockKitRows)
        .mockResolvedValueOnce(mockKitAssetRows);

      vi.mocked(bookingService.getDetailedPartialCheckinData).mockResolvedValue(
        {
          checkedInAssetIds: ["asset3"],
          partialCheckinDetails: mockPartialCheckinDetails,
        }
      );

      // Mock that kit is partially checked in (available for other bookings)
      vi.mocked(bookingAssets.isKitPartiallyCheckedIn).mockReturnValue(true);

      const { action: actionFunction } = await import(
        "./bookings.$bookingId.overview.manage-kits"
      );

      // Should succeed because kit is partially checked in within booking context
      await expect(
        actionFunction(
          createActionArgs({
            context: mockContext,
            request: mockRequest,
            params: mockParams,
          })
        )
      ).resolves.not.toThrow();

      expect(bookingAssets.isKitPartiallyCheckedIn).toHaveBeenCalledWith(
        expect.objectContaining({ id: "kit1" }),
        mockPartialCheckinDetails,
        new Set(["asset1", "asset2"]),
        BookingStatus.ONGOING
      );
    });

    it("should block kits that are truly checked out (not partially checked in)", async () => {
      const mockKitRows = [
        { id: "kit1", name: "Kit 1", status: KitStatus.CHECKED_OUT },
      ];

      const mockKitAssetRows = [
        { kitId: "kit1", id: "asset3", status: "AVAILABLE" },
      ];

      vi.mocked(httpServer.parseData).mockReturnValue({
        kitIds: ["kit1"],
        removedKitIds: [],
        redirectTo: null,
      });

      mockedQueryRaw
        .mockResolvedValueOnce([mockBookingRow])
        .mockResolvedValueOnce(mockBookingAssetRows)
        .mockResolvedValueOnce(mockKitRows)
        .mockResolvedValueOnce(mockKitAssetRows);

      // Mock that kit is NOT partially checked in (truly checked out)
      vi.mocked(bookingAssets.isKitPartiallyCheckedIn).mockReturnValue(false);

      const { action: actionFunction } = await import(
        "./bookings.$bookingId.overview.manage-kits"
      );

      // Should return error response because kit is truly checked out
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

    it("should allow available kits regardless of partial check-in status", async () => {
      const mockKitRows = [
        { id: "kit1", name: "Kit 1", status: KitStatus.AVAILABLE },
      ];

      const mockKitAssetRows = [
        { kitId: "kit1", id: "asset3", status: "AVAILABLE" },
      ];

      vi.mocked(httpServer.parseData).mockReturnValue({
        kitIds: ["kit1"],
        removedKitIds: [],
        redirectTo: null,
      });

      mockedQueryRaw
        .mockResolvedValueOnce([mockBookingRow])
        .mockResolvedValueOnce(mockBookingAssetRows)
        .mockResolvedValueOnce(mockKitRows)
        .mockResolvedValueOnce(mockKitAssetRows);

      const { action: actionFunction } = await import(
        "./bookings.$bookingId.overview.manage-kits"
      );

      // Should succeed because kit status is AVAILABLE
      await expect(
        actionFunction(
          createActionArgs({
            context: mockContext,
            request: mockRequest,
            params: mockParams,
          })
        )
      ).resolves.not.toThrow();

      // Should not call validation helper since kit is available
      expect(bookingAssets.isKitPartiallyCheckedIn).not.toHaveBeenCalled();
    });
  });

  describe("booking status validation", () => {
    it("should only validate for ONGOING and OVERDUE bookings", async () => {
      const mockKitRows = [
        { id: "kit1", name: "Kit 1", status: KitStatus.CHECKED_OUT },
      ];

      const mockKitAssetRows = [
        { kitId: "kit1", id: "asset3", status: "AVAILABLE" },
      ];

      // Test with DRAFT booking - should not validate
      const draftBookingRow = { id: "booking123", status: BookingStatus.DRAFT };

      vi.mocked(httpServer.parseData).mockReturnValue({
        kitIds: ["kit1"],
        removedKitIds: [],
        redirectTo: null,
      });

      mockedQueryRaw
        .mockResolvedValueOnce([draftBookingRow])
        .mockResolvedValueOnce(mockBookingAssetRows)
        .mockResolvedValueOnce(mockKitRows)
        .mockResolvedValueOnce(mockKitAssetRows);

      vi.mocked(bookingAssets.isKitPartiallyCheckedIn).mockReturnValue(false);

      // Should succeed because DRAFT bookings allow checked out kits
      await expect(
        action(
          createActionArgs({
            context: mockContext,
            request: mockRequest,
            params: mockParams,
          })
        )
      ).resolves.not.toThrow();
    });
  });

  describe("integration with centralized helpers", () => {
    it("should pass correct parameters to isKitPartiallyCheckedIn helper", async () => {
      const mockKitRows = [
        { id: "kit1", name: "Kit 1", status: KitStatus.CHECKED_OUT },
      ];

      const mockKitAssetRows = [
        { kitId: "kit1", id: "asset3", status: "AVAILABLE" },
      ];

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

      mockedQueryRaw
        .mockResolvedValueOnce([mockBookingRow])
        .mockResolvedValueOnce(mockBookingAssetRows)
        .mockResolvedValueOnce(mockKitRows)
        .mockResolvedValueOnce(mockKitAssetRows);

      vi.mocked(bookingService.getDetailedPartialCheckinData).mockResolvedValue(
        {
          checkedInAssetIds: ["asset3"],
          partialCheckinDetails: mockPartialCheckinDetails,
        }
      );
      vi.mocked(bookingAssets.isKitPartiallyCheckedIn).mockReturnValue(true);

      await action(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      // Verify helper is called with correct parameters
      expect(bookingAssets.isKitPartiallyCheckedIn).toHaveBeenCalledWith(
        expect.objectContaining({ id: "kit1" }),
        mockPartialCheckinDetails,
        new Set(["asset1", "asset2"]), // existing booking asset IDs
        BookingStatus.ONGOING
      );
    });
  });
});
