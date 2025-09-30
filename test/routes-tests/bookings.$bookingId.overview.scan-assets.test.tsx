import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import type { action as scanAssetsAction } from "~/routes/_layout+/bookings.$bookingId.overview.scan-assets";
import { requirePermission } from "~/utils/roles.server";
import { addScannedAssetsToBooking } from "~/modules/booking/service.server";

vi.mock("fuse.js", () => ({
  __esModule: true,
  default: vi.fn(),
}));

vi.mock("~/components/layout/header", () => ({
  __esModule: true,
  default: vi.fn(() => null),
}));

vi.mock("~/components/scanner/code-scanner", () => ({
  __esModule: true,
  CodeScanner: vi.fn(() => null),
}));

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

vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

vi.mock("~/modules/booking/service.server", () => ({
  addScannedAssetsToBooking: vi.fn(),
  getBooking: vi.fn(),
}));

vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

vi.mock("@remix-run/node", async () => {
  const actual = await vi.importActual("@remix-run/node");
  return {
    ...actual,
    redirect: vi.fn(() => new Response(null, { status: 302 })),
    json: vi.fn(
      (data, init) =>
        new Response(JSON.stringify(data), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    ),
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

    const response = await action(createActionArgs({ request }));

    expect(response.status).toBe(302);
    expect(addScannedAssetsToBookingMock).toHaveBeenCalledWith({
      bookingId: "booking-123",
      assetIds: ["asset-123"],
      organizationId: "org-1",
      userId: "user-123",
    });
    expect(vi.mocked(redirect)).toHaveBeenCalledWith("/bookings/booking-123");
  });
});
