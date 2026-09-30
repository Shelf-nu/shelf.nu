import { OrganizationRoles } from "@prisma/client";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { locationDescendantsMock } from "@mocks/location-descendants";
import { permissionContext } from "@helpers/role-access";

// why: mocking location descendants to avoid database queries during tests
vi.mock("~/modules/location/descendants.server", () => locationDescendantsMock);

import type { action as scanAssetsAction } from "~/routes/_layout+/bookings.$bookingId.overview.scan-assets";
import { requirePermission } from "~/utils/roles.server";
import { addScannedAssetsToBooking } from "~/modules/booking/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";

// why: preventing fuzzy search library initialization during route import
vi.mock("fuse.js", () => ({
  __esModule: true,
  default: vi.fn(),
}));

// why: route file imports header component, mock needed to avoid component rendering during route import
vi.mock("~/components/layout/header", () => ({
  __esModule: true,
  default: vi.fn(() => null),
}));

// why: route file imports scanner component, mock needed to avoid component rendering during route import
vi.mock("~/components/scanner/code-scanner", () => ({
  __esModule: true,
  CodeScanner: vi.fn(() => null),
}));

// why: route file imports drawer component, mock needed to avoid component rendering during route import
vi.mock(
  "~/components/scanner/drawer/uses/add-assets-to-booking-drawer",
  async () => {
    const actual = await vi.importActual<
      typeof import("~/components/scanner/drawer/uses/add-assets-to-booking-drawer")
    >("~/components/scanner/drawer/uses/add-assets-to-booking-drawer");
    return {
      ...actual,
      __esModule: true,
      default: vi.fn(() => null),
    };
  }
);

// why: testing authorization logic without executing actual permission checks
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: testing route action logic without executing actual booking service operations
vi.mock("~/modules/booking/service.server", () => ({
  addScannedAssetsToBooking: vi.fn(),
  getBooking: vi.fn(),
}));

// why: the action reads the target booking's status and owners before it
// writes; an open DRAFT keeps these cases about the write itself (the caller
// is an ADMIN, whose access writes every booking).
vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findFirst: vi.fn().mockResolvedValue({
        status: "DRAFT",
        creatorId: "someone-else",
        custodianUserId: null,
      }),
    },
  },
}));

// why: preventing actual notification sending during route tests
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: mocking redirect and response helpers for testing route handler status codes
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  const mockResponse = (data: any, init?: { status?: number }) =>
    new Response(JSON.stringify(data), {
      status: init?.status || 200,
      headers: { "Content-Type": "application/json" },
    });
  return {
    ...actual,
    redirect: vi.fn(() => new Response(null, { status: 302 })),
    json: vi.fn(mockResponse),
    data: vi.fn(mockResponse),
  };
});

const requirePermissionMock = vi.mocked(requirePermission);
const addScannedAssetsToBookingMock = vi.mocked(addScannedAssetsToBooking);
const sendNotificationMock = vi.mocked(sendNotification);
let action: typeof scanAssetsAction;

beforeAll(async () => {
  ({ action } = await import(
    "~/routes/_layout+/bookings.$bookingId.overview.scan-assets"
  ));
});

function createActionArgs(
  overrides: Partial<ActionFunctionArgs> = {}
): ActionFunctionArgs {
  return {
    context: {
      getSession: () => ({ userId: "user-123" }),
    },
    request: new Request(
      "https://example.com/bookings/booking-123/overview/scan-assets",
      {
        method: "POST",
      }
    ),
    params: { bookingId: "booking-123" },
    ...overrides,
  } as ActionFunctionArgs;
}

describe("bookings/$bookingId/overview/scan-assets action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermissionMock.mockReset();
    addScannedAssetsToBookingMock.mockReset();
    requirePermissionMock.mockResolvedValue(
      permissionContext({
        organizationId: "org-1",
        roles: [OrganizationRoles.ADMIN],
      }) as unknown as Awaited<ReturnType<typeof requirePermission>>
    );
    // why: the action destructures `addedAssetIds`/`claimedAssetIds` off the
    // service's return value to choose its notification; this test only
    // cares about the call args and the redirect, so one added asset is a
    // sane default that keeps the destructure from throwing.
    addScannedAssetsToBookingMock.mockResolvedValue({
      booking: { id: "booking-123", name: "Booking One", status: "DRAFT" },
      addedAssetIds: ["asset-123"],
      claimedAssetIds: [],
    } as any);
  });

  it("allows submitting only asset IDs without kit IDs", async () => {
    const formData = new FormData();
    formData.append("assetIds[0]", "asset-123");

    const request = new Request(
      "https://example.com/bookings/booking-123/overview/scan-assets",
      {
        method: "POST",
        body: formData,
      }
    );

    const response = (await action(
      createActionArgs({ request })
    )) as unknown as Response;

    expect(response.status).toBe(302);
    expect(addScannedAssetsToBookingMock).toHaveBeenCalledWith({
      bookingId: "booking-123",
      assetIds: ["asset-123"],
      kitIds: [],
      organizationId: "org-1",
      userId: "user-123",
      // Scanner drawer sends an `assetQuantities` JSON blob for
      // QTY_TRACKED rows; this test posts no quantities, so the
      // service receives an empty map.
      quantities: {},
      // Scanner drawer sends a `kitSlices` JSON array recording each
      // (asset, AssetKit) membership scanned (so each gets its own
      // kit-driven BookingAsset row). Empty when only direct asset
      // scans were submitted.
      kitSlices: [],
    });
    expect(vi.mocked(redirect)).toHaveBeenCalledWith("/bookings/booking-123");
  });

  /**
   * A scan can add rows, claim existing ones toward a reservation, or do
   * neither. Reporting "Assets added" for all three tells an operator the
   * hand-over happened when nothing moved, which is the failure the branch
   * exists to prevent. Each outcome is pinned here because nothing else
   * distinguishes them: all three redirect the same way.
   */
  describe("notification", () => {
    async function runWith(result: {
      addedAssetIds: string[];
      claimedAssetIds: string[];
    }) {
      addScannedAssetsToBookingMock.mockResolvedValue({
        booking: { id: "booking-123", name: "Booking One", status: "DRAFT" },
        ...result,
      } as any);

      const formData = new FormData();
      formData.append("assetIds[0]", "asset-123");

      await action(
        createActionArgs({
          request: new Request(
            "https://example.com/bookings/booking-123/overview/scan-assets",
            { method: "POST", body: formData }
          ),
        })
      );

      return sendNotificationMock.mock.calls.at(-1)?.[0];
    }

    it("reports what was added when a scan creates rows", async () => {
      const notification = await runWith({
        addedAssetIds: ["asset-123"],
        claimedAssetIds: [],
      });

      expect(notification).toMatchObject({ title: "Assets added" });
    });

    // The headline case: nothing new joins the booking, but an asset already
    // on it now answers a reserved unit. "Assets added" would be false here.
    it("reports a reservation claim when no row was created", async () => {
      const notification = await runWith({
        addedAssetIds: [],
        claimedAssetIds: ["asset-123"],
      });

      expect(notification).toMatchObject({ title: "Reservation updated" });
    });

    // Added wins when a scan does both, because the new rows are the larger
    // change and the claim is visible on the booking either way.
    it("reports the addition when a scan both adds and claims", async () => {
      const notification = await runWith({
        addedAssetIds: ["asset-123"],
        claimedAssetIds: ["asset-456"],
      });

      expect(notification).toMatchObject({ title: "Assets added" });
    });

    it("says nothing changed when a scan neither adds nor claims", async () => {
      const notification = await runWith({
        addedAssetIds: [],
        claimedAssetIds: [],
      });

      expect(notification).toMatchObject({
        title: "Nothing to add",
        icon: { name: "scan", variant: "gray" },
      });
    });
  });
});
