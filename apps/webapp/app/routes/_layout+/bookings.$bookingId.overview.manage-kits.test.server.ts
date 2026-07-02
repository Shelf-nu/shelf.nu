import { BookingStatus, KitStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs, createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import * as bookingService from "~/modules/booking/service.server";
import * as modelRequestService from "~/modules/booking-model-request/service.server";
import * as kitService from "~/modules/kit/service.server";
import * as noteService from "~/modules/note/service.server";
import * as userService from "~/modules/user/service.server";
import * as bookingAssets from "~/utils/booking-assets";
import * as httpServer from "~/utils/http.server";
import * as rolesServer from "~/utils/roles.server";

// Import the action + loader functions
import { action, loader } from "./bookings.$bookingId.overview.manage-kits";
import { assertIsDataWithResponseInit } from "../../../test/helpers/assertions";

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
  createKitBookingNote: vi.fn(),
  // Loader-only — used by the Models-tab loader tests below.
  getBooking: vi.fn(),
  getKitIdsByAssets: vi.fn(),
}));

// Loader-only — `getPaginatedAndFilterableKits` backs the Kits tab list.
vi.mock("~/modules/kit/service.server", () => ({
  getPaginatedAndFilterableKits: vi.fn(),
}));

// why: mock the shared Models-tab payload helper as a unit so the loader
// test isolates "does the loader wire the helper's output into the payload"
// from the helper's own DB logic, which has its own unit test in
// `booking-model-request/service.server.test.ts` (including org-scoping).
vi.mock("~/modules/booking-model-request/service.server", () => ({
  getBookingModelTabData: vi.fn(),
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

vi.mock("~/utils/http.server", async (importOriginal) => {
  const actual = await importOriginal<typeof httpServer>();
  return {
    getParams: vi.fn(),
    parseData: vi.fn(),
    json: vi.fn((data) => data),
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

  // The action reads `booking.bookingAssets` with each row's
  // `assetKitId` discriminator — the manage-kits add filter now scopes
  // "already in booking" per kit-driven AssetKit row, not per asset id,
  // so a qty-tracked asset can be standalone (assetKitId=null) AND have
  // separate kit-driven slices for different kits in the same booking.
  // The default mock booking holds two standalone slices.
  const mockBooking = {
    id: "booking123",
    status: BookingStatus.ONGOING,
    bookingAssets: [
      {
        asset: { id: "asset1" },
        assetId: "asset1",
        quantity: 1,
        id: "ba1",
        assetKitId: null,
      },
      {
        asset: { id: "asset2" },
        assetId: "asset2",
        quantity: 1,
        id: "ba2",
        assetKitId: null,
      },
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
    vi.mocked(bookingService.createKitBookingNote).mockResolvedValue(
      undefined as any
    );
    vi.mocked(noteService.createNotes).mockResolvedValue({ count: 0 });
  });

  describe("validation scope - only newly added kits", () => {
    it("should only validate kits whose AssetKits aren't already in the booking", async () => {
      // Default mockBooking has TWO standalone slices (assetKitId=null)
      // for asset1+asset2. Kit1's AssetKits are brand new → adds slices
      // → must be validated. Kit2's AssetKits map to asset1+asset2 but
      // those are STANDALONE slices in the booking, NOT kit-driven
      // ones — adding kit2 still creates new kit-driven rows, so it
      // also needs validation (the prior "filter by asset id" semantics
      // are wrong now that the same asset can have both kinds of
      // slices simultaneously).
      const mockKits = [
        {
          id: "kit1",
          name: "Kit 1",
          status: KitStatus.CHECKED_OUT,
          assetKits: [
            { id: "ak-kit1-asset1", quantity: 1, asset: { id: "asset1" } },
            { id: "ak-kit1-asset3", quantity: 1, asset: { id: "asset3" } },
          ],
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "kit2",
          name: "Kit 2",
          status: KitStatus.CHECKED_OUT,
          assetKits: [
            { id: "ak-kit2-asset1", quantity: 1, asset: { id: "asset1" } },
            { id: "ak-kit2-asset2", quantity: 1, asset: { id: "asset2" } },
          ],
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

      // Both kits adopt NEW kit-driven AssetKit slices: kit1 adds
      // ak-kit1-asset1 + ak-kit1-asset3, kit2 adds ak-kit2-asset1 +
      // ak-kit2-asset2. The booking's existing rows for asset1/asset2 are
      // standalone (assetKitId = null), so none of these AssetKit IDs are
      // already represented — both kits stay in newlyAddedKits and BOTH
      // reach the validation helper (see route: filter is keyed on the
      // AssetKit pivot id, not the asset id — a standalone slice does
      // NOT block a kit-driven slice of the same asset).
      expect(bookingAssets.isKitPartiallyCheckedIn).toHaveBeenCalledTimes(2);
      expect(bookingAssets.isKitPartiallyCheckedIn).toHaveBeenCalledWith(
        mockKits[0],
        {},
        new Set(["asset1", "asset2"]),
        "ONGOING"
      );
      expect(bookingAssets.isKitPartiallyCheckedIn).toHaveBeenCalledWith(
        mockKits[1],
        {},
        new Set(["asset1", "asset2"]),
        "ONGOING"
      );
    });

    it("passes two kit slices for a shared asset belonging to two kits", async () => {
      // Data-integrity fix: when the SAME asset belongs to TWO selected
      // kits, the action must hand `updateBookingAssets` TWO kit slices
      // (one per AssetKit, distinct assetKitId) so both kit-driven rows
      // get created. The old 1:1 map dropped the second.
      vi.mocked(db.booking.findUniqueOrThrow).mockResolvedValue({
        ...mockBooking,
        status: BookingStatus.DRAFT, // avoid checked-out kit guard
        bookingAssets: [],
      } as any);

      const mockKits = [
        {
          id: "kit1",
          name: "Kit 1",
          status: KitStatus.AVAILABLE,
          assetKits: [
            {
              id: "ak-kit1-shared",
              quantity: 10,
              asset: { id: "asset-shared" },
            },
          ],
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "kit2",
          name: "Kit 2",
          status: KitStatus.AVAILABLE,
          assetKits: [
            {
              id: "ak-kit2-shared",
              quantity: 5,
              asset: { id: "asset-shared" },
            },
          ],
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

      await action(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      // A pure kit-add passes `assetIds: []` — the kit members travel ONLY
      // through `kitSlices`. Forwarding them as `assetIds` too would create
      // duplicate standalone rows (the "kit assets show twice" bug). The
      // service derives the asset-status flip + events from the kit slices.
      expect(bookingService.updateBookingAssets).toHaveBeenCalledWith(
        expect.objectContaining({
          assetIds: [],
          kitSlices: [
            {
              assetId: "asset-shared",
              assetKitId: "ak-kit1-shared",
              quantity: 10,
            },
            {
              assetId: "asset-shared",
              assetKitId: "ak-kit2-shared",
              quantity: 5,
            },
          ],
        })
      );
    });

    it("should not validate kits whose AssetKit ids are already kit-driven in the booking", async () => {
      // Override the default mockBooking with one that already holds
      // kit1's kit-driven slices.
      vi.mocked(db.booking.findUniqueOrThrow).mockResolvedValue({
        ...mockBooking,
        bookingAssets: [
          {
            asset: { id: "asset1" },
            assetId: "asset1",
            quantity: 1,
            id: "ba1",
            assetKitId: "ak-kit1-asset1",
          },
          {
            asset: { id: "asset2" },
            assetId: "asset2",
            quantity: 1,
            id: "ba2",
            assetKitId: "ak-kit1-asset2",
          },
        ],
      } as any);

      const mockKits = [
        {
          id: "kit1",
          name: "Kit 1",
          status: KitStatus.CHECKED_OUT,
          assetKits: [
            { id: "ak-kit1-asset1", quantity: 1, asset: { id: "asset1" } },
            { id: "ak-kit1-asset2", quantity: 1, asset: { id: "asset2" } },
          ],
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
        "./bookings.$bookingId.overview.manage-kits"
      );

      // Should succeed without validation since no new AssetKits
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
      const mockKits = [
        {
          id: "kit1",
          name: "Kit 1",
          status: KitStatus.CHECKED_OUT,
          assetKits: [{ asset: { id: "asset3" } }], // new asset
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
        mockKits[0],
        mockPartialCheckinDetails,
        new Set(["asset1", "asset2"]),
        "ONGOING"
      );
    });

    it("should block kits that are truly checked out (not partially checked in)", async () => {
      const mockKits = [
        {
          id: "kit1",
          name: "Kit 1",
          status: KitStatus.CHECKED_OUT,
          assetKits: [{ asset: { id: "asset3" } }], // new asset
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
      const mockKits = [
        {
          id: "kit1",
          name: "Kit 1",
          status: KitStatus.AVAILABLE,
          assetKits: [{ asset: { id: "asset3" } }], // new asset
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
      const mockKits = [
        {
          id: "kit1",
          name: "Kit 1",
          status: KitStatus.CHECKED_OUT,
          assetKits: [{ asset: { id: "asset3" } }], // new asset
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
      const mockKits = [
        {
          id: "kit1",
          name: "Kit 1",
          status: KitStatus.CHECKED_OUT,
          assetKits: [{ asset: { id: "asset3" } }], // new asset
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

      await action(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      // Verify helper is called with correct parameters
      expect(bookingAssets.isKitPartiallyCheckedIn).toHaveBeenCalledWith(
        mockKits[0],
        mockPartialCheckinDetails,
        new Set(["asset1", "asset2"]), // existing booking asset IDs
        "ONGOING"
      );
    });
  });

  describe("updateBookingAssets call scope", () => {
    it("should forward only the newly-added kit id, not the full submitted selection", async () => {
      // Booking already contains asset1 + asset2 as kit-driven slices for
      // kit2 (the pre-existing kit). kit1 is newly added: it brings asset3
      // which is not yet in the booking. Submitting kitIds: ["kit2", "kit1"]
      // should only pass kit1's id to updateBookingAssets — otherwise
      // re-submitting an already-added kit would re-flip its status.
      // Note: the action filters by `assetKitId` (per-row discriminator),
      // so the booking holds kit2's `assetKitId` values to mark them as
      // already-present.
      vi.mocked(db.booking.findUniqueOrThrow).mockResolvedValue({
        ...mockBooking,
        bookingAssets: [
          {
            asset: { id: "asset1" },
            assetId: "asset1",
            quantity: 1,
            id: "ba1",
            assetKitId: "ak-kit2-asset1",
          },
          {
            asset: { id: "asset2" },
            assetId: "asset2",
            quantity: 1,
            id: "ba2",
            assetKitId: "ak-kit2-asset2",
          },
        ],
      } as any);

      const mockKits = [
        {
          id: "kit2",
          name: "Kit 2",
          status: KitStatus.AVAILABLE, // AVAILABLE so the checked-out guard is not tripped
          assetKits: [
            { id: "ak-kit2-asset1", quantity: 1, asset: { id: "asset1" } },
            { id: "ak-kit2-asset2", quantity: 1, asset: { id: "asset2" } },
          ],
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "kit1",
          name: "Kit 1",
          status: KitStatus.AVAILABLE, // AVAILABLE so the checked-out guard is not tripped
          assetKits: [
            { id: "ak-kit1-asset3", quantity: 1, asset: { id: "asset3" } },
          ],
          organizationId: "org123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;

      vi.mocked(httpServer.parseData).mockReturnValue({
        kitIds: ["kit2", "kit1"],
        removedKitIds: [],
        redirectTo: null,
      });

      vi.mocked(db.kit.findMany).mockResolvedValue(mockKits);
      vi.mocked(bookingAssets.isKitPartiallyCheckedIn).mockReturnValue(false);

      await action(
        createActionArgs({
          context: mockContext,
          request: mockRequest,
          params: mockParams,
        })
      );

      // updateBookingAssets must be called exactly once with ONLY kit1
      // (not kit2). A pure kit-add passes `assetIds: []`; the member id
      // (asset3) travels via `kitSlices`, and the service derives the
      // status flip + events from those slices. Passing it as `assetIds`
      // too would create a duplicate standalone row.
      expect(bookingService.updateBookingAssets).toHaveBeenCalledTimes(1);
      expect(bookingService.updateBookingAssets).toHaveBeenCalledWith(
        expect.objectContaining({
          assetIds: [],
          kitIds: ["kit1"], // ONLY the newly-added kit, not the pre-existing available kit2
          kitSlices: [
            {
              assetId: "asset3",
              assetKitId: "ak-kit1-asset3",
              quantity: 1,
            },
          ],
        })
      );
    });
  });

  describe("redirectTo handling (confirm-from-unsaved-changes alert)", () => {
    // A successful kit-add: kit1 (AVAILABLE) brings asset3, which is not yet on
    // the booking, so the action reaches updateBookingAssets and then the
    // redirect branch. beforeEach already resolves updateBookingAssets +
    // createKitBookingNote, so only the kit inputs need setting per test.
    const availableKit = [
      {
        id: "kit1",
        name: "Kit 1",
        status: KitStatus.AVAILABLE,
        assetKits: [
          { id: "ak-kit1-asset3", quantity: 1, asset: { id: "asset3" } },
        ],
        organizationId: "org123",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as any;

    it("redirects to a same-origin redirectTo submitted through the alert", async () => {
      const manageAssetsUrl =
        "/bookings/booking123/overview/manage-assets?hideUnavailable=true";

      vi.mocked(httpServer.parseData).mockReturnValue({
        kitIds: ["kit1"],
        removedKitIds: [],
        redirectTo: manageAssetsUrl,
      });
      vi.mocked(db.kit.findMany).mockResolvedValue(availableKit);
      vi.mocked(bookingAssets.isKitPartiallyCheckedIn).mockReturnValue(false);

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
        manageAssetsUrl
      );
    });

    it("sanitizes an off-origin redirectTo to the booking page (no open redirect)", async () => {
      // A crafted POST could supply an attacker-controlled absolute URL in the
      // client-side `redirectTo` field. The action must route it through
      // safeRedirect, which rejects off-origin targets and falls back to the
      // booking page instead of redirecting the user off-site.
      vi.mocked(httpServer.parseData).mockReturnValue({
        kitIds: ["kit1"],
        removedKitIds: [],
        redirectTo: "https://evil.example.com/phish",
      });
      vi.mocked(db.kit.findMany).mockResolvedValue(availableKit);
      vi.mocked(bookingAssets.isKitPartiallyCheckedIn).mockReturnValue(false);

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
 * The manage-kits loader used to only ship the Kits-tab payload, so
 * manage-kits never rendered a Models tab even when the org had
 * `AssetModel`s. It now delegates to the shared `getBookingModelTabData`
 * helper — the SAME helper the manage-assets loader uses — so both surfaces
 * compute Models-tab availability identically. This is additive: the
 * loader's existing Kits-tab payload keys are untouched.
 *
 * `getBookingModelTabData` is mocked here (as in the manage-assets loader
 * test) so these tests isolate "does the loader wire the helper's output
 * into the payload" from the helper's own DB logic — including org-scoping
 * — which has its own unit test in
 * `booking-model-request/service.server.test.ts`.
 */
describe("manage-kits loader — Models tab payload", () => {
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

  /** `getPaginatedAndFilterableKits` return shape the loader destructures. */
  const mockPaginatedKits = {
    page: 1,
    perPage: 20,
    kits: [],
    search: null,
    totalKits: 0,
    totalPages: 0,
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

    vi.mocked(bookingService.getBooking).mockResolvedValue(mockLoaderBooking);
    vi.mocked(bookingService.getKitIdsByAssets).mockReturnValue([]);
    vi.mocked(kitService.getPaginatedAndFilterableKits).mockResolvedValue(
      mockPaginatedKits as any
    );
  });

  it("hides the Models tab when the org has no asset models", async () => {
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

  it("wires the helper's Models tab payload through, shipping both crash-guard keys", async () => {
    // Omitting either `initialAssetModels` or `totalAssetModels` crashes the
    // Models tab the moment it mounts: `useModelFilters` maps over
    // `initialData["initialAssetModels"]` / `["totalAssetModels"]`
    // (`use-model-filters.ts:96-103`), so this test asserts BOTH keys are
    // present, not just that the tab is shown.
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
    vi.mocked(modelRequestService.getBookingModelTabData).mockResolvedValue(
      mockModelTabData as any
    );

    const result = await loader(
      createLoaderArgs({ context: mockContext, params: mockParams })
    );

    expect(result).toHaveProperty("initialAssetModels");
    expect(result).toHaveProperty("totalAssetModels");
    expect((result as any).totalAssetModels).toBe(1);
    expect(result).toMatchObject({
      showModelsTab: true,
      assetModels: mockModelTabData.assetModels,
      initialAssetModels: mockModelTabData.initialAssetModels,
      totalAssetModels: mockModelTabData.totalAssetModels,
      modelRequests: mockModelTabData.modelRequests,
    });
  });

  it("scopes the Models tab lookup to the caller's organizationId", async () => {
    // Deep org-scoping (e.g. "a foreign-org model is never counted/listed")
    // is covered by `getBookingModelTabData`'s own unit tests. At the
    // loader level we only need to prove the loader forwards the caller's
    // `organizationId` (from `requirePermission`) — never a value derived
    // from user input — into the helper.
    vi.mocked(modelRequestService.getBookingModelTabData).mockResolvedValue({
      showModelsTab: true,
      assetModels: [],
      initialAssetModels: [],
      totalAssetModels: 1,
      modelRequests: [],
    });

    await loader(
      createLoaderArgs({ context: mockContext, params: mockParams })
    );

    expect(modelRequestService.getBookingModelTabData).toHaveBeenCalledWith({
      organizationId: "org123",
      booking: mockLoaderBooking,
    });
  });
});
