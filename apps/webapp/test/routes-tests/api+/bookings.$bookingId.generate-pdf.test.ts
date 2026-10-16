// @vitest-environment node
/**
 * The booking checklist's data loader, `api+/bookings.$bookingId.generate-pdf`.
 *
 * Two things happen here and nowhere else. Lapsed asset photos are signed for
 * print, so the sheet prints every photo instead of a placeholder. And the preview is
 * counted: printing happens in the browser, so the loader, which runs when the
 * preview opens, is the only place the server sees the sheet being used.
 *
 * @see {@link file://./../../../app/routes/api+/bookings.$bookingId.generate-pdf.tsx}
 */
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionContext } from "@helpers/role-access";

import { captureServerEvent } from "~/integrations/posthog/client.server";
import { signAssetPhotosForPrint } from "~/modules/asset/print-images.server";
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

// why: signing talks to storage. The stub stands in for storage handing back
// a fresh URL, so the test can see the fresh rows reach the response.
vi.mock("~/modules/asset/print-images.server", () => ({
  signAssetPhotosForPrint: vi.fn(),
}));

// why: stands in for the persisting re-sign, so the test can prove the
// loader never uses it (it writes back and bumps `Asset.updatedAt`).
vi.mock("~/modules/asset/service.server", () => ({
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

/**
 * Three rows of the sheet, the first with a lapsed photo. Rows are booking
 * slices, so `asset-1` prints twice: three rows, two assets.
 */
const ROWS = [
  {
    id: "asset-1",
    bookingAssetId: "ba-1",
    mainImage: "https://storage/lapsed.jpg",
  },
  { id: "asset-2", bookingAssetId: "ba-2", mainImage: null },
  { id: "asset-1", bookingAssetId: "ba-3", mainImage: null },
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
  vi.mocked(requirePermission).mockResolvedValue(permissionContext() as never);
  vi.mocked(fetchAllPdfRelatedData).mockResolvedValue({
    booking: { from: null, to: null, originalFrom: null, originalTo: null },
    assets: ROWS,
  } as never);
  vi.mocked(signAssetPhotosForPrint).mockImplementation(
    async (rows) =>
      rows.map((row) =>
        row.mainImage ? { ...row, mainImage: "https://storage/fresh.jpg" } : row
      ) as never
  );
});

describe("booking checklist loader", () => {
  it("hands the caller's access to the data read, which runs the ownership check", async () => {
    const context = permissionContext({ roles: ["BASE"] });
    vi.mocked(requirePermission).mockResolvedValue(context as never);

    await loader(buildArgs());

    expect(vi.mocked(fetchAllPdfRelatedData).mock.calls[0][3]).toBe(
      context.access
    );
  });

  it("signs lapsed photos for print, without the persisting re-sign, before the sheet gets them", async () => {
    const response = (await loader(buildArgs())) as unknown as Response;
    const body = await response.json();

    expect(signAssetPhotosForPrint).toHaveBeenCalledWith(ROWS, {
      organizationId: "org-1",
    });
    expect(refreshExpiredAssetImages).not.toHaveBeenCalled();
    // why: signing is only useful if the fresh URL is what gets printed.
    expect(body.pdfMeta.assets[0].mainImage).toBe("https://storage/fresh.jpg");
  });

  it("counts one opened preview, with its printed rows and distinct assets", async () => {
    await loader(buildArgs());

    expect(captureServerEvent).toHaveBeenCalledTimes(1);
    expect(captureServerEvent).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "pdf_preview_opened",
      properties: {
        sheet: "booking_checklist",
        organizationId: "org-1",
        rowCount: 3,
        assetCount: 2,
      },
    });
  });

  it("counts nothing when the sheet could not be built", async () => {
    vi.mocked(fetchAllPdfRelatedData).mockRejectedValue(new Error("boom"));

    await expect(loader(buildArgs())).rejects.toBeDefined();

    expect(captureServerEvent).not.toHaveBeenCalled();
  });
});
