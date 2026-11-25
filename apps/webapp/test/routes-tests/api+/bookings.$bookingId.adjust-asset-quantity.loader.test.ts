/**
 * Route tests for the loader of
 * `api+/bookings.$bookingId.adjust-asset-quantity.ts`: the From section of
 * the adjust dialog, behind the same ownership guard as the action and the
 * manage-items status rule.
 */

import { AssetType, OrganizationRoles } from "@prisma/client";
import { permissionContext } from "@helpers/role-access";
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSourceEditorData } from "~/modules/booking/sources/source-editor.server";
import { loader } from "~/routes/api+/bookings.$bookingId.adjust-asset-quantity";
import { requirePermission } from "~/utils/roles.server";

// why: data() returns a fetch Response so the loader can be invoked directly
// without a Remix runtime.
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    });
});

const dbMocks = vi.hoisted(() => ({ bookingAssetFindFirst: vi.fn() }));

// why: the loader's one read of the slice is the input each case varies.
vi.mock("~/database/db.server", () => ({
  db: { bookingAsset: { findFirst: dbMocks.bookingAssetFindFirst } },
}));

// why: the permission context (roles, org) is the input under test.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the editor reader has its own suite (source-editor.server.test.ts);
// here only whether and how the loader calls it matters.
vi.mock("~/modules/booking/sources/source-editor.server", () => ({
  getSourceEditorData: vi.fn(),
}));

// why: the action's service imports reach the facade's heavy module graph;
// the loader never calls them.
vi.mock("~/modules/booking/booked-quantity.server", () => ({
  noteBookedQuantityChanges: vi.fn(),
  setStandaloneBookedQuantity: vi.fn(),
}));

// why: the action's notification helper is never reached by the loader.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

const requirePermissionMock = vi.mocked(requirePermission);
const editorMock = vi.mocked(getSourceEditorData);

const FROM = new Date("2026-12-01T09:00:00.000Z");
const TO = new Date("2026-12-03T17:00:00.000Z");

function sliceRow(status = "RESERVED", creatorId = "user-current") {
  return {
    id: "ba-1",
    assetId: "asset-1",
    sourceKitId: null,
    sourceAllocation: "MANUAL",
    asset: { type: AssetType.QUANTITY_TRACKED },
    booking: { status, from: FROM, to: TO, creatorId, custodianUserId: null },
  };
}

function args(url: string): LoaderFunctionArgs {
  return {
    context: { getSession: () => ({ userId: "user-current" }) },
    request: new Request(url),
    params: { bookingId: "booking-1" },
  } as unknown as LoaderFunctionArgs;
}

const URL_WITH_ASSET =
  "https://example.com/api/bookings/booking-1/adjust-asset-quantity?assetId=asset-1";

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue(permissionContext() as never);
  dbMocks.bookingAssetFindFirst.mockResolvedValue(sliceRow());
  editorMock.mockResolvedValue({
    sliceId: "ba-1",
    mode: "MANUAL",
    rows: [],
    unassignedPending: 0,
    unknownOut: 0,
  });
});

describe("api/bookings/:bookingId/adjust-asset-quantity loader", () => {
  it("returns the From section of the standalone slice, scoped to the workspace", async () => {
    const response = (await loader(
      args(URL_WITH_ASSET)
    )) as unknown as Response;

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sourceEditor: { sliceId: string } | null;
    };
    expect(body.sourceEditor?.sliceId).toBe("ba-1");
    expect(dbMocks.bookingAssetFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          bookingId: "booking-1",
          assetId: "asset-1",
          assetKitId: null,
          booking: { organizationId: "org-1" },
        },
      })
    );
    expect(editorMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      bookingId: "booking-1",
      slice: {
        id: "ba-1",
        assetId: "asset-1",
        sourceKitId: null,
        sourceAllocation: "MANUAL",
        isPool: true,
        booking: { status: "RESERVED", from: FROM, to: TO },
      },
    });
  });

  it("refuses another member's booking for SELF_SERVICE with 403", async () => {
    requirePermissionMock.mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.SELF_SERVICE] }) as never
    );
    dbMocks.bookingAssetFindFirst.mockResolvedValue(
      sliceRow("DRAFT", "someone-else")
    );

    const response = (await loader(
      args(URL_WITH_ASSET)
    )) as unknown as Response;

    expect(response.status).toBe(403);
    expect(editorMock).not.toHaveBeenCalled();
  });

  it("offers nothing to edit where the manage-items rule refuses the caller", async () => {
    requirePermissionMock.mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.SELF_SERVICE] }) as never
    );
    dbMocks.bookingAssetFindFirst.mockResolvedValue(sliceRow("RESERVED"));

    const response = (await loader(
      args(URL_WITH_ASSET)
    )) as unknown as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sourceEditor: null });
    expect(editorMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the asset has no standalone slice on the booking", async () => {
    dbMocks.bookingAssetFindFirst.mockResolvedValue(null);

    const response = (await loader(
      args(URL_WITH_ASSET)
    )) as unknown as Response;

    expect(response.status).toBe(404);
  });

  it("returns 400 without an assetId", async () => {
    const response = (await loader(
      args("https://example.com/api/bookings/booking-1/adjust-asset-quantity")
    )) as unknown as Response;

    expect(response.status).toBe(400);
    expect(dbMocks.bookingAssetFindFirst).not.toHaveBeenCalled();
  });
});
