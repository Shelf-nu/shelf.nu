// @vitest-environment node
/**
 * Which web audit loaders ask for expected-asset photos to be signed.
 *
 * `getAuditSessionDetails` re-signs lapsed photo URLs only when its caller asks.
 * The layout, overview and activity loaders read the session alone, so they must
 * ask for no signing and make no storage calls. The scan loader renders the
 * photos, so it asks for them. What the flag does inside the service is tested in
 * `app/modules/audit/service.server.test.ts`.
 *
 * @see {@link file://../../../app/routes/_layout+/audits.$auditId.tsx}
 * @see {@link file://../../../app/routes/_layout+/audits.$auditId.overview.tsx}
 * @see {@link file://../../../app/routes/_layout+/audits.$auditId.activity.tsx}
 * @see {@link file://../../../app/routes/_layout+/audits.$auditId.scan.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuditSessionDetails, requirePermission } = vi.hoisted(() => ({
  getAuditSessionDetails: vi.fn(),
  requirePermission: vi.fn(),
}));

// why: the loaders' authorization call; every test runs as a permitted user.
vi.mock("~/utils/roles.server", () => ({ requirePermission }));

// why: `getAuditSessionDetails` is the call under test. The other exports only
// keep the four route modules importable.
vi.mock("~/modules/audit/service.server", () => ({
  getAuditSessionDetails,
  getAssetsForAuditSession: vi.fn().mockResolvedValue({}),
  getAuditScans: vi.fn().mockResolvedValue([]),
  requireAuditAssignee: vi.fn(),
  requireAuditAssigneeForBaseSelfService: vi.fn(),
  updateAuditSession: vi.fn(),
  cancelAuditSession: vi.fn(),
  archiveAuditSession: vi.fn(),
  deleteAuditSession: vi.fn(),
  removeAssetFromAudit: vi.fn(),
  removeAssetsFromAudit: vi.fn(),
  removeAuditScan: vi.fn(),
}));

// why: overview reads audit images in the same Promise.all as the session;
// its result is not under test.
vi.mock("~/modules/audit/image.service.server", () => ({
  getAuditImages: vi.fn().mockResolvedValue([]),
}));

// why: activity reads notes after the session; its result is not under test.
vi.mock("~/modules/audit/note-service.server", () => ({
  getAuditNotes: vi.fn().mockResolvedValue([]),
}));

// why: keeps every loader off a real database. Reads made after the session
// request fail against this stub, which the runner below tolerates.
vi.mock("~/database/db.server", () => ({
  db: { auditScan: { count: vi.fn().mockResolvedValue(0) } },
}));

import { loader as layoutLoader } from "~/routes/_layout+/audits.$auditId";
import { loader as activityLoader } from "~/routes/_layout+/audits.$auditId.activity";
import { loader as overviewLoader } from "~/routes/_layout+/audits.$auditId.overview";
import { loader as scanLoader } from "~/routes/_layout+/audits.$auditId.scan";

/** A loader under test, reduced to the call this file makes. */
type AuditLoader = (args: never) => Promise<unknown>;

/**
 * Runs a loader until it has requested the session. Everything the loader does
 * afterwards is out of scope and runs against stubs, so a later failure is
 * expected and ignored; only the session request is asserted.
 */
async function run(loader: AuditLoader, path: string) {
  const args = {
    context: { getSession: () => ({ userId: "user-1" }) },
    request: new Request(`http://localhost${path}`),
    params: { auditId: "audit-1" },
  };
  await loader(args as never).catch(() => null);
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({
    organizationId: "org-1",
    userOrganizations: [],
    isSelfServiceOrBase: false,
  });
  getAuditSessionDetails.mockResolvedValue({
    session: { id: "audit-1", name: "Q3 sweep", status: "ACTIVE" },
    expectedAssets: [],
  });
});

describe("web audit loaders — expected-asset photo signing", () => {
  it.each<[string, AuditLoader, string]>([
    ["layout", layoutLoader as AuditLoader, "/audits/audit-1"],
    ["overview", overviewLoader as AuditLoader, "/audits/audit-1/overview"],
    ["activity", activityLoader as AuditLoader, "/audits/audit-1/activity"],
  ])("the %s loader asks for no photo signing", async (_name, loader, path) => {
    await run(loader, path);

    expect(getAuditSessionDetails).toHaveBeenCalledWith(
      expect.objectContaining({ refreshExpectedAssetImages: false })
    );
  });

  it("the scan loader asks for the photos it renders to be re-signed", async () => {
    await run(scanLoader as AuditLoader, "/audits/audit-1/scan");

    expect(getAuditSessionDetails).toHaveBeenCalledWith(
      expect.objectContaining({ refreshExpectedAssetImages: true })
    );
  });
});
