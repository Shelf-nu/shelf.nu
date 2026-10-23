// @vitest-environment node
/**
 * Web scanned-barcode resolve: the scan each resolve records.
 *
 * Every web scanner drawer resolves each camera-scanned barcode here. A drawer
 * resolve records a `WEB_DRAWER` barcode scan with no note; a resolve for an
 * audit (`auditSessionId`) records nothing, because the audit's writer does.
 *
 * @see {@link file://./../../../app/routes/api+/get-scanned-barcode.$value.ts}
 */

const { mockRequirePermission } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
}));
// why: the RBAC gate is not under test; it passes and holds the add-on.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mockRequirePermission,
}));

const { mockGetBarcodeByValue } = vi.hoisted(() => ({
  mockGetBarcodeByValue: vi.fn(),
}));
// why: the barcode lookup reads the database.
vi.mock("~/modules/barcode/service.server", () => ({
  getBarcodeByValue: mockGetBarcodeByValue,
}));

// why: the audit counters read the database; importing the route would
// otherwise open a real connection.
vi.mock("~/database/db.server", () => ({
  db: {
    $connect: vi.fn(),
    auditAsset: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

const { mockRecordScanNonFatal } = vi.hoisted(() => ({
  mockRecordScanNonFatal: vi.fn(),
}));
// why: the recording helper writes to the database; its own behaviour is
// covered in record-scan.test.ts. Here we assert what the route asks it for.
vi.mock("~/modules/scan/service.server", () => ({
  recordScanNonFatal: mockRecordScanNonFatal,
}));

import { loader } from "~/routes/api+/get-scanned-barcode.$value";

/** Resolves one barcode value, optionally for an audit. */
async function resolve(value: string, search = "") {
  const result = await loader({
    request: new Request(
      `http://localhost/api/get-scanned-barcode/${encodeURIComponent(
        value
      )}${search}`,
      { headers: { "user-agent": "Mozilla/5.0" } }
    ),
    params: { value },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof loader>[0]);
  return result.init?.status ?? 200;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePermission.mockResolvedValue({
    organizationId: "org-1",
    canUseBarcodes: true,
  });
  mockGetBarcodeByValue.mockResolvedValue({
    id: "barcode-1",
    value: "BC-0042",
    assetId: "asset-1",
    kitId: null,
    asset: {
      id: "asset-1",
      title: "Tripod",
      mainImage: null,
      thumbnailImage: null,
      assetModel: null,
    },
    kit: null,
  });
});

describe("GET /api/get-scanned-barcode/:value records the scan", () => {
  it("records a drawer barcode scan without a note", async () => {
    expect(await resolve("BC-0042")).toBe(200);

    expect(mockRecordScanNonFatal).toHaveBeenCalledWith({
      codeType: "BARCODE",
      code: "BC-0042",
      source: "WEB_DRAWER",
      userAgent: "Mozilla/5.0",
      userId: "user-1",
      barcodeId: "barcode-1",
      assetId: "asset-1",
      kitId: null,
      organizationId: "org-1",
      writeNote: false,
    });
  });

  it("records nothing for an audit: the audit's writer records it", async () => {
    expect(await resolve("BC-0042", "?auditSessionId=audit-1")).toBe(200);

    expect(mockRecordScanNonFatal).not.toHaveBeenCalled();
  });

  it("records nothing for an unknown barcode", async () => {
    mockGetBarcodeByValue.mockResolvedValue(null);

    expect(await resolve("NOPE")).not.toBe(200);

    expect(mockRecordScanNonFatal).not.toHaveBeenCalled();
  });
});
