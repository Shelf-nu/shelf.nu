// @vitest-environment node
/**
 * Asset overview loader: the "Last audit" card's history.
 *
 * The loader reads an asset's audit history only for callers who may see the
 * "Last audit date" column (every audit visible, audits add-on on). Anyone
 * else gets no read at all, so no audit dates reach the page payload.
 *
 * This asserts the WIRING only. The loader goes on to read a dozen other
 * things, so the next read (`generateQrObj`) rejects on purpose and the loader
 * stops there, after the call under test.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.$assetId.overview.tsx}
 */
import { OrganizationRoles } from "@prisma/client";
import { permissionContext } from "@helpers/role-access";

// why: importing the route pulls in `db.server`, whose initialization would
// otherwise open a real PostgreSQL connection.
vi.mock("~/database/db.server", () => ({ db: { $connect: vi.fn() } }));

const { mockRequirePermission } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
}));
// why: the RBAC gate is not under test; it hands back the viewer's access.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mockRequirePermission,
}));

// why: the add-on rule also reads premium env flags; it is reduced to the
// workspace's own flag.
vi.mock("~/utils/subscription.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  canUseAudits: (org: { auditsEnabled: boolean }) => org.auditsEnabled,
}));

const { mockGetAsset } = vi.hoisted(() => ({ mockGetAsset: vi.fn() }));
// why: the asset read hits the database; only its id matters here.
vi.mock("~/modules/asset/service.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAsset: mockGetAsset,
}));

// why: the last scan read hits the database and is pinned in its own test.
vi.mock("~/modules/scan/service.server", () => ({
  getLastScanForViewer: vi.fn().mockResolvedValue(null),
}));

const { mockGetAssetAuditHistory } = vi.hoisted(() => ({
  mockGetAssetAuditHistory: vi.fn(),
}));
// why: the history read is the collaborator under test; its queries are
// pinned in the service's own test.
vi.mock("~/modules/audit/asset-audit-history.server", () => ({
  getAssetAuditHistory: mockGetAssetAuditHistory,
}));

const { mockGenerateQrObj } = vi.hoisted(() => ({
  mockGenerateQrObj: vi.fn(),
}));
// why: the loader's next read after the history. It rejects on purpose so the
// loader stops right after the call under test.
vi.mock("~/modules/qr/utils.server", () => ({
  generateQrObj: mockGenerateQrObj,
}));

import { loader } from "~/routes/_layout+/assets.$assetId.overview";

/** Grants `roles` in a workspace whose audits add-on is on or off. */
function grant(roles: OrganizationRoles[], auditsEnabled: boolean) {
  const ctx = permissionContext({ roles });
  mockRequirePermission.mockResolvedValue({
    ...ctx,
    currentOrganization: { ...ctx.currentOrganization, auditsEnabled },
    canUseBarcodes: true,
  });
}

/** Runs the loader until the stop read, after the history call. */
async function load() {
  await expect(
    loader({
      request: new Request("http://localhost/assets/asset-1/overview"),
      params: { assetId: "asset-1" },
      context: { getSession: () => ({ userId: "user-1" }) },
    } as unknown as Parameters<typeof loader>[0])
  ).rejects.toBeDefined();
  // The loader reached the read after the history, so the gate ran.
  expect(mockGenerateQrObj).toHaveBeenCalledTimes(1);
}

describe("asset overview loader: last audit history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAsset.mockResolvedValue({ id: "asset-1" });
    mockGetAssetAuditHistory.mockResolvedValue({ recent: [], upcoming: [] });
    mockGenerateQrObj.mockRejectedValue(new Error("stop after the history"));
  });

  it("reads the history for a caller who sees every audit, with the add-on", async () => {
    grant([OrganizationRoles.ADMIN], true);

    await load();

    expect(mockGetAssetAuditHistory).toHaveBeenCalledWith({
      assetId: "asset-1",
      organizationId: "org-1",
    });
  });

  it("skips the history when the workspace has no audits add-on", async () => {
    grant([OrganizationRoles.ADMIN], false);

    await load();

    expect(mockGetAssetAuditHistory).not.toHaveBeenCalled();
  });

  it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
    "skips the history for a %s caller",
    async (role) => {
      grant([role], true);

      await load();

      expect(mockGetAssetAuditHistory).not.toHaveBeenCalled();
    }
  );
});
