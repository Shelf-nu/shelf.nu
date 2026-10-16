// @vitest-environment node
/**
 * "Update GPS coordinates" (`POST /api/asset/scan`): the scan it records.
 *
 * The asset page posts the coordinates a user entered by hand. The route
 * records them as a `GPS_UPDATE` scan of the asset's QR, in the caller's
 * workspace, with a note. The coordinates also go into that note, so the
 * route refuses anything that is not a real coordinate pair.
 *
 * @see {@link file://./../../../app/routes/api+/asset.scan.ts}
 */

const { mockRequirePermission } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
}));
// why: the RBAC gate is not under test; it passes and hands back the org.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mockRequirePermission,
}));

const { mockGetAsset } = vi.hoisted(() => ({ mockGetAsset: vi.fn() }));
// why: the asset read hits the database; the route only needs its QR.
vi.mock("~/modules/asset/service.server", () => ({ getAsset: mockGetAsset }));

const { mockAssertNotArchived } = vi.hoisted(() => ({
  mockAssertNotArchived: vi.fn(),
}));
// why: the archive guard reads the database and has its own tests.
vi.mock("~/utils/org-validation.server", () => ({
  assertAssetsAreNotArchived: mockAssertNotArchived,
}));

const { mockRecordScan } = vi.hoisted(() => ({ mockRecordScan: vi.fn() }));
// why: recording writes to the database; its own behaviour is covered in
// record-scan.test.ts. Here we assert what the route asks it for.
vi.mock("~/modules/scan/service.server", () => ({
  recordScan: mockRecordScan,
}));

// why: importing the route pulls in `db.server`, whose initialization would
// otherwise open a real PostgreSQL connection.
vi.mock("~/database/db.server", () => ({ db: { $connect: vi.fn() } }));

import { action } from "~/routes/api+/asset.scan";

/** Posts the "Update GPS coordinates" form with the given fields. */
async function post(fields: Record<string, string>) {
  const result = (await action({
    request: new Request("http://localhost/api/asset/scan", {
      method: "POST",
      headers: { "user-agent": "Mozilla/5.0" },
      body: new URLSearchParams(fields),
    }),
    params: {},
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof action>[0])) as {
    data: unknown;
    init: ResponseInit | null;
  };
  return { status: result.init?.status ?? 200, body: result.data };
}

const validForm = {
  assetId: "asset-1",
  latitude: "52.3676",
  longitude: "4.9041",
  manuallyGenerated: "yes",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePermission.mockResolvedValue({ organizationId: "org-1" });
  mockAssertNotArchived.mockResolvedValue(undefined);
  mockGetAsset.mockResolvedValue({ id: "asset-1", qrCodes: [{ id: "qr-1" }] });
  mockRecordScan.mockResolvedValue({ id: "scan-1" });
});

describe("POST /api/asset/scan", () => {
  it("records a manual GPS update of the asset's QR, in the caller's workspace, with a note", async () => {
    const { status } = await post(validForm);

    expect(status).toBe(200);
    expect(mockGetAsset).toHaveBeenCalledWith(
      expect.objectContaining({ id: "asset-1", organizationId: "org-1" })
    );
    expect(mockRecordScan).toHaveBeenCalledWith({
      codeType: "QR",
      code: "qr-1",
      source: "GPS_UPDATE",
      userAgent: "Mozilla/5.0",
      userId: "user-1",
      qrId: "qr-1",
      assetId: "asset-1",
      organizationId: "org-1",
      latitude: "52.3676",
      longitude: "4.9041",
      manuallyGenerated: true,
      writeNote: true,
    });
  });

  it("refuses an archived asset before recording anything", async () => {
    mockAssertNotArchived.mockRejectedValue(
      Object.assign(new Error("Archived"), { status: 400 })
    );

    const { status } = await post(validForm);

    expect(status).not.toBe(200);
    expect(mockRecordScan).not.toHaveBeenCalled();
  });

  it.each([
    ["Markdoc in the latitude", { latitude: "{% booking_status /%}" }],
    ["text in the longitude", { longitude: "north" }],
    ["a latitude out of range", { latitude: "91" }],
    ["a blank longitude", { longitude: "" }],
  ])("refuses %s, and records nothing", async (_case, override) => {
    const { status } = await post({ ...validForm, ...override });

    expect(status).toBe(400);
    expect(mockRecordScan).not.toHaveBeenCalled();
  });
});
