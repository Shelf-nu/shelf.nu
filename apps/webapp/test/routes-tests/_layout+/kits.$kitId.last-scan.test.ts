// @vitest-environment node
/**
 * Kit detail loader — last-scan PII is gated SERVER-SIDE.
 *
 * `parseScanData` returns the scanner's display name and EMAIL, the scan's GPS
 * COORDINATES and the device user-agent. BASE and SELF_SERVICE hold `scan: []`,
 * and the page hides `<ScanDetails>` behind a client-side check — which hides
 * the data without withholding it. It was still in the page payload, readable
 * from the network response.
 *
 * The asset overview loader was moved onto the gated `getLastScanForViewer` in
 * `109d02857`; the kit loader kept calling `parseScanData` directly and was the
 * last route doing so.
 *
 * This asserts the WIRING — that the loader delegates to the gated helper and
 * forwards the viewer's full role list. The helper's own gate is pinned
 * separately, against the live permission matrix, in
 * `app/modules/scan/last-scan-for-viewer.test.ts`.
 *
 * detail.dev finding D060.
 *
 * @see {@link file://./../../../app/routes/_layout+/kits.$kitId.tsx}
 */

import { OrganizationRoles } from "@prisma/client";

const { mockRequirePermission } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
}));
// why: the RBAC gate is not under test — it must PASS, so what the loader does
// with the scan is what the assertions are about.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mockRequirePermission,
}));

const { mockGetLastScanForViewer } = vi.hoisted(() => ({
  mockGetLastScanForViewer: vi.fn().mockResolvedValue(null),
}));
// why: the gated helper is the collaborator under test. Mocking it lets this
// assert the loader delegates and forwards the right roles, without re-testing
// the gate itself.
vi.mock("~/modules/scan/service.server", () => ({
  getLastScanForViewer: mockGetLastScanForViewer,
  getScanByQrId: vi.fn(),
}));

// why: the loader's data fetch; irrelevant to scan gating and would need a DB.
vi.mock("~/modules/kit/service.server", () => ({
  getKit: vi.fn().mockResolvedValue({
    id: "kit-1",
    name: "Camera kit",
    qrCodes: [{ id: "qr-1" }],
    assetKits: [],
    custody: null,
    barcodes: [],
  }),
  deleteKit: vi.fn(),
  deleteKitImage: vi.fn(),
}));
// why: `generateQrObj` lives in qr/utils.server (not service.server) and runs
// inside the same Promise.all as the kit fetch, so it reaches the DB and
// rejects before the loader ever gets to the scan.
vi.mock("~/modules/qr/utils.server", () => ({
  generateQrObj: vi.fn().mockResolvedValue({ qr: null }),
}));

import { loader } from "~/routes/_layout+/kits.$kitId";

const ORG = "org-1";

function loaderArgs() {
  return {
    request: new Request("https://app.shelf.nu/kits/kit-1"),
    params: { kitId: "kit-1" },
    context: { getSession: () => ({ userId: "user-1", email: "a@b.c" }) },
  } as unknown as Parameters<typeof loader>[0];
}

/** Makes `requirePermission` report a caller holding `roles`. */
function callerHolds(roles: OrganizationRoles[]) {
  mockRequirePermission.mockResolvedValue({
    organizationId: ORG,
    currentOrganization: { id: ORG },
    canUseBarcodes: false,
    canSeeAllCustody: true,
    userOrganizations: [{ organization: { id: ORG }, roles }],
  });
}

describe("kit detail loader — last scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLastScanForViewer.mockResolvedValue(null);
  });

  it("resolves the last scan through the gated helper", async () => {
    callerHolds([OrganizationRoles.BASE]);

    await loader(loaderArgs()).catch(() => undefined);

    // The defect was that this route called `parseScanData` directly, skipping
    // the `scan:read` gate the helper applies.
    expect(mockGetLastScanForViewer).toHaveBeenCalledTimes(1);
  });

  it("forwards the viewer's FULL role list, not a single resolved role", async () => {
    // `[SELF_SERVICE, ADMIN]` is the shape that has repeatedly gone wrong in
    // this codebase: passing only `roles[0]`, or only the single resolved
    // `role`, hands `hasPermission` a narrower membership than the caller has.
    callerHolds([OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN]);

    await loader(loaderArgs()).catch(() => undefined);

    expect(mockGetLastScanForViewer).toHaveBeenCalledWith(
      expect.objectContaining({
        qrId: "qr-1",
        userId: "user-1",
        organizationId: ORG,
        roles: [OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN],
      })
    );
  });
});
