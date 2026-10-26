// @vitest-environment node
/**
 * Asset overview loader: the last scan it reads.
 *
 * The card shows the asset's latest scan whichever code was scanned (QR,
 * barcode or SAM ID), so the loader reads by the asset, through the gated
 * `getLastScanForViewer`, with the viewer's roles.
 *
 * This asserts the WIRING only: the arguments of that one call. The loader
 * goes on to read a dozen other things, so the next read (`generateQrObj`)
 * rejects on purpose and the loader stops there, after the call under test. The helper's gate is pinned against the
 * live permission matrix in `app/modules/scan/last-scan-for-viewer.test.ts`.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.$assetId.overview.tsx}
 */
import { OrganizationRoles } from "@prisma/client";

// why: importing the route pulls in `db.server`, whose initialization would
// otherwise open a real PostgreSQL connection.
vi.mock("~/database/db.server", () => ({ db: { $connect: vi.fn() } }));

const { mockRequirePermission } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
}));
// why: the RBAC gate is not under test; it passes and hands back the viewer.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mockRequirePermission,
}));

const { mockGetAsset } = vi.hoisted(() => ({ mockGetAsset: vi.fn() }));
// why: the asset read hits the database; only its id matters here.
vi.mock("~/modules/asset/service.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/modules/asset/service.server")>()),
  getAsset: mockGetAsset,
}));

const { mockGetLastScanForViewer } = vi.hoisted(() => ({
  mockGetLastScanForViewer: vi.fn().mockResolvedValue(null),
}));
// why: the gated helper is the collaborator under test.
vi.mock("~/modules/scan/service.server", () => ({
  getLastScanForViewer: mockGetLastScanForViewer,
}));

const { mockGenerateQrObj } = vi.hoisted(() => ({
  mockGenerateQrObj: vi.fn(),
}));
// why: the loader's next read after the scan. It rejects on purpose so the
// loader stops right after the call under test, and the test can tell that it
// got that far rather than failing earlier.
vi.mock("~/modules/qr/utils.server", () => ({
  generateQrObj: mockGenerateQrObj,
}));

import { loader } from "~/routes/_layout+/assets.$assetId.overview";

describe("asset overview loader: last scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue({
      organizationId: "org-1",
      userOrganizations: [
        {
          organization: { id: "org-1" },
          roles: [OrganizationRoles.ADMIN],
        },
      ],
      currentOrganization: { id: "org-1", auditsEnabled: false },
      canUseBarcodes: true,
      // Audits off: the last audit card stays out of this test's way.
      access: { audits: { seeAll: false } },
    });
    mockGetAsset.mockResolvedValue({ id: "asset-1" });
    mockGenerateQrObj.mockRejectedValue(new Error("stop after the scan read"));
  });

  it("reads the asset's last scan by the asset, with the viewer's roles", async () => {
    await expect(
      loader({
        request: new Request("http://localhost/assets/asset-1/overview"),
        params: { assetId: "asset-1" },
        context: { getSession: () => ({ userId: "user-1" }) },
      } as unknown as Parameters<typeof loader>[0])
    ).rejects.toBeDefined();

    // The loader reached the read after the scan, so the scan call ran.
    expect(mockGenerateQrObj).toHaveBeenCalledTimes(1);

    expect(mockGetLastScanForViewer).toHaveBeenCalledWith({
      target: { assetId: "asset-1" },
      userId: "user-1",
      organizationId: "org-1",
      roles: [OrganizationRoles.ADMIN],
    });
  });
});
