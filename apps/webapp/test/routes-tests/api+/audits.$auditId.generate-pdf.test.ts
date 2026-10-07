// @vitest-environment node
/**
 * The audit receipt's data loader, `api+/audits.$auditId.generate-pdf`.
 *
 * Like the booking checklist's loader, it signs lapsed asset photos for print
 * so the receipt prints every photo, and counts the preview being opened: printing
 * happens in the browser, so this loader is the only place the server sees it.
 *
 * @see {@link file://./../../../app/routes/api+/audits.$auditId.generate-pdf.tsx}
 */
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { captureServerEvent } from "~/integrations/posthog/client.server";
import { signAssetPhotosForPrint } from "~/modules/asset/print-images.server";
import { refreshExpiredAssetImages } from "~/modules/asset/service.server";
import { fetchAllAuditPdfRelatedData } from "~/modules/audit/pdf-helpers";
import { loader } from "~/routes/api+/audits.$auditId.generate-pdf";
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

// why: the receipt's data is a large database read with its own tests
// (`modules/audit/pdf-helpers.test.ts`); this suite is about the loader.
vi.mock("~/modules/audit/pdf-helpers", () => ({
  fetchAllAuditPdfRelatedData: vi.fn(),
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

/** Three rows of the receipt, the first with a lapsed photo. */
const ROWS = [
  { id: "asset-1", mainImage: "https://storage/lapsed.jpg" },
  { id: "asset-2", mainImage: null },
  { id: "asset-3", mainImage: null },
];

function buildArgs(): LoaderFunctionArgs {
  return {
    context: { getSession: () => ({ userId: "user-1" }) },
    request: new Request("https://example.com/api/audits/audit-1/generate-pdf"),
    params: { auditId: "audit-1" },
  } as unknown as LoaderFunctionArgs;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermission).mockResolvedValue({
    organizationId: "org-1",
    role: "ADMIN",
  } as never);
  vi.mocked(fetchAllAuditPdfRelatedData).mockResolvedValue({
    session: { createdAt: null, completedAt: null },
    assets: ROWS,
    conditionNotes: [],
    activityNotes: [],
  } as never);
  vi.mocked(signAssetPhotosForPrint).mockImplementation(
    async (rows) =>
      rows.map((row) =>
        row.mainImage ? { ...row, mainImage: "https://storage/fresh.jpg" } : row
      ) as never
  );
});

describe("audit receipt loader", () => {
  it("signs lapsed photos for print, without the persisting re-sign, before the receipt gets them", async () => {
    const response = (await loader(buildArgs())) as unknown as Response;
    const body = await response.json();

    expect(signAssetPhotosForPrint).toHaveBeenCalledWith(ROWS, {
      organizationId: "org-1",
    });
    expect(refreshExpiredAssetImages).not.toHaveBeenCalled();
    expect(body.pdfMeta.assets[0].mainImage).toBe("https://storage/fresh.jpg");
  });

  it("counts one opened preview, with its printed rows and distinct assets", async () => {
    await loader(buildArgs());

    expect(captureServerEvent).toHaveBeenCalledTimes(1);
    expect(captureServerEvent).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "pdf_preview_opened",
      properties: {
        sheet: "audit_receipt",
        organizationId: "org-1",
        rowCount: 3,
        assetCount: 3,
      },
    });
  });
});
