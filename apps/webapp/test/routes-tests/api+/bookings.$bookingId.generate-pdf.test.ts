// @vitest-environment node
/**
 * The booking checklist's data loader, `api+/bookings.$bookingId.generate-pdf`.
 *
 * Two things happen here and nowhere else. Lapsed asset photos are re-signed,
 * so the sheet prints every photo instead of a placeholder. And the preview is
 * counted: printing happens in the browser, so the loader, which runs when the
 * preview opens, is the only place the server sees the sheet being used.
 *
 * @see {@link file://./../../../app/routes/api+/bookings.$bookingId.generate-pdf.tsx}
 */
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { captureServerEvent } from "~/integrations/posthog/client.server";
import { refreshExpiredAssetImages } from "~/modules/asset/service.server";
import { fetchAllPdfRelatedData } from "~/modules/booking/pdf-helpers";
import { loader } from "~/routes/api+/bookings.$bookingId.generate-pdf";
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

// why: the sheet's data is a large database read with its own tests
// (`modules/booking/pdf-helpers.test.ts`); this suite is about the loader.
vi.mock("~/modules/booking/pdf-helpers", () => ({
  fetchAllPdfRelatedData: vi.fn(),
}));

// why: re-signing talks to storage. The stub stands in for storage handing
// back a fresh URL, so the test can see the fresh rows reach the response.
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

/** Two rows of the sheet, the first with a lapsed photo. */
const ROWS = [
  {
    id: "asset-1",
    bookingAssetId: "ba-1",
    mainImage: "https://storage/lapsed.jpg",
  },
  { id: "asset-2", bookingAssetId: "ba-2", mainImage: null },
];

function buildArgs(): LoaderFunctionArgs {
  return {
    context: { getSession: () => ({ userId: "user-1" }) },
    request: new Request(
      "https://example.com/api/bookings/booking-1/generate-pdf"
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
  vi.mocked(fetchAllPdfRelatedData).mockResolvedValue({
    booking: { from: null, to: null, originalFrom: null, originalTo: null },
    assets: ROWS,
  } as never);
  vi.mocked(refreshExpiredAssetImages).mockImplementation(
    async (rows) =>
      rows.map((row) =>
        row.mainImage ? { ...row, mainImage: "https://storage/fresh.jpg" } : row
      ) as never
  );
});

describe("booking checklist loader", () => {
  it("re-signs lapsed photos, scoped to the workspace, before the sheet gets them", async () => {
    const response = (await loader(buildArgs())) as unknown as Response;
    const body = await response.json();

    expect(refreshExpiredAssetImages).toHaveBeenCalledWith(ROWS, {
      organizationId: "org-1",
      maxRefreshes: 100,
      timeBudgetMs: 2_500,
    });
    // why: re-signing is only useful if the fresh URL is what gets printed.
    expect(body.pdfMeta.assets[0].mainImage).toBe("https://storage/fresh.jpg");
  });

  it("counts one opened preview, with the sheet and its row count", async () => {
    await loader(buildArgs());

    expect(captureServerEvent).toHaveBeenCalledTimes(1);
    expect(captureServerEvent).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "pdf_preview_opened",
      properties: {
        sheet: "booking_checklist",
        organizationId: "org-1",
        rowCount: 2,
      },
    });
  });

  it("counts nothing when the sheet could not be built", async () => {
    vi.mocked(fetchAllPdfRelatedData).mockRejectedValue(new Error("boom"));

    await expect(loader(buildArgs())).rejects.toBeDefined();

    expect(captureServerEvent).not.toHaveBeenCalled();
  });
});
