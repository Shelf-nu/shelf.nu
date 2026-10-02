// @vitest-environment node
/**
 * The check-in receipt's data loader,
 * `api+/bookings.$bookingId.generate-checkin-receipt`.
 *
 * The receipt prints no photos, so unlike the checklist's loader it re-signs
 * none: that is a storage call per lapsed photo for nothing. It does count the
 * preview being opened, like every printable sheet.
 *
 * @see {@link file://./../../../app/routes/api+/bookings.$bookingId.generate-checkin-receipt.tsx}
 */
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { captureServerEvent } from "~/integrations/posthog/client.server";
import { refreshExpiredAssetImages } from "~/modules/asset/service.server";
import { fetchCheckinReceiptData } from "~/modules/booking/checkin-receipt.server";
import { loader } from "~/routes/api+/bookings.$bookingId.generate-checkin-receipt";
import { requirePermission } from "~/utils/roles.server";

// why: data() returns a fetch Response so the loader can be invoked directly,
// with no router runtime to stand up.
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    )
);
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: each test supplies the workspace the permission check resolves to,
// rather than running the real permission machinery.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the receipt's data is a large database read with its own tests; this
// suite is about the loader.
vi.mock("~/modules/booking/checkin-receipt.server", () => ({
  fetchCheckinReceiptData: vi.fn(),
}));

// why: stands in for storage, so the test can prove the receipt never asks it
// to re-sign anything.
vi.mock("~/modules/asset/service.server", () => ({
  ASSET_IMAGE_RESIGN_LIMITS: { maxRefreshes: 100, timeBudgetMs: 2_500 },
  refreshExpiredAssetImages: vi.fn(),
}));

// why: reads the acting user's saved format preferences from the database.
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn().mockResolvedValue({
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "UTC",
  }),
}));

// why: PostHog is an external service; record what would be sent.
vi.mock("~/integrations/posthog/client.server", () => ({
  captureServerEvent: vi.fn(),
}));

/** One receipt row, as the data helper returns it. */
function receiptRow(bookingAssetId: string) {
  return {
    bookingAssetId,
    title: "Tripod",
    checkedInAt: null,
    checkedInByIds: [],
  };
}

function buildArgs(): LoaderFunctionArgs {
  return {
    context: { getSession: () => ({ userId: "user-1" }) },
    request: new Request(
      "https://example.com/api/bookings/booking-1/generate-checkin-receipt"
    ),
    params: { bookingId: "booking-1" },
  } as unknown as LoaderFunctionArgs;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermission).mockResolvedValue({
    organizationId: "org-1",
    role: "ADMIN",
  } as never);
  vi.mocked(fetchCheckinReceiptData).mockResolvedValue({
    booking: {
      id: "booking-1",
      name: "Shoot",
      description: null,
      custodianUser: null,
      custodianTeamMember: null,
      tags: [],
    },
    organization: {
      name: "Org",
      imageId: null,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    rows: [receiptRow("ba-1"), receiptRow("ba-2")],
    totals: {},
    stamp: "COMPLETE",
    plannedFrom: null,
    plannedTo: null,
    checkedOutAt: null,
    checkedOutByName: null,
    returnedAt: null,
    latenessNote: null,
    checkedInByNames: [],
  } as never);
});

describe("check-in receipt loader", () => {
  it("counts one opened preview, with the sheet and its row count", async () => {
    await loader(buildArgs());

    expect(captureServerEvent).toHaveBeenCalledTimes(1);
    expect(captureServerEvent).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "pdf_preview_opened",
      properties: {
        sheet: "checkin_receipt",
        organizationId: "org-1",
        rowCount: 2,
      },
    });
  });

  it("re-signs no photos, because the receipt prints none", async () => {
    await loader(buildArgs());

    expect(refreshExpiredAssetImages).not.toHaveBeenCalled();
  });
});
