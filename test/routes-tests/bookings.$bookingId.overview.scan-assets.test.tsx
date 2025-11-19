import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { mockLocationDescendants } from "@mocks/location-descendants";

mockLocationDescendants();

import type { action as scanAssetsAction } from "~/routes/_layout+/bookings.$bookingId.overview.scan-assets";
import { requirePermission } from "~/utils/roles.server";
import { addScannedAssetsToBooking } from "~/modules/booking/service.server";

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

// why: preventing actual notification sending during route tests
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: mocking redirect and response helpers for testing route handler status codes
vi.mock("@remix-run/node", async () => {
  const actual = await vi.importActual("@remix-run/node");
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
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
    } as any);
    addScannedAssetsToBookingMock.mockResolvedValue(undefined as any);
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
    });
    expect(vi.mocked(redirect)).toHaveBeenCalledWith("/bookings/booking-123");
  });
});
