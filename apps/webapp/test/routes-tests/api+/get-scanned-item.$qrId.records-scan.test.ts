// @vitest-environment node
/**
 * Web scanned-item resolve: the scan each resolve records.
 *
 * Every web scanner drawer resolves each scanned code here, and the web
 * scanner's SAM "View asset" does too, marked `?source=scanner`. A drawer
 * resolve records a `WEB_DRAWER` scan with no note; the scanner's view records
 * `WEB_SCANNER` with a note on the asset, because it opens that asset. A
 * resolve for an audit (`auditSessionId`) records nothing: the audit's writer
 * records it.
 *
 * @see {@link file://./../../../app/routes/api+/get-scanned-item.$qrId.ts}
 */

const { mockRequirePermission } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
}));
// why: the RBAC gate is not under test; it passes and names the workspace.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mockRequirePermission,
}));

const { mockAssetFindFirst, mockAuditAssetFindFirst } = vi.hoisted(() => ({
  mockAssetFindFirst: vi.fn(),
  mockAuditAssetFindFirst: vi.fn(),
}));
// why: the SAM lookup and the audit counters read the database; importing the
// route would otherwise open a real connection.
vi.mock("~/database/db.server", () => ({
  db: {
    $connect: vi.fn(),
    asset: { findFirst: mockAssetFindFirst },
    auditAsset: { findFirst: mockAuditAssetFindFirst },
    auditNote: { count: vi.fn() },
    auditImage: { count: vi.fn() },
  },
}));

const { mockGetBarcodeByValue } = vi.hoisted(() => ({
  mockGetBarcodeByValue: vi.fn(),
}));
// why: the SAM-shaped barcode fallback reads the barcode table.
vi.mock("~/modules/barcode/service.server", () => ({
  getBarcodeByValue: mockGetBarcodeByValue,
}));

const { mockGetQr } = vi.hoisted(() => ({ mockGetQr: vi.fn() }));
// why: the QR lookup reads the database.
vi.mock("~/modules/qr/service.server", () => ({ getQr: mockGetQr }));

const { mockRecordScanNonFatal } = vi.hoisted(() => ({
  mockRecordScanNonFatal: vi.fn(),
}));
// why: the recording helper writes to the database; its own behaviour is
// covered in record-scan.test.ts. Here we assert what the route asks it for.
vi.mock("~/modules/scan/service.server", () => ({
  recordScanNonFatal: mockRecordScanNonFatal,
}));

import { loader } from "~/routes/api+/get-scanned-item.$qrId";

const ORG_ID = "org-1";

/** An asset row trimmed to what the serializer reads. */
function assetRow(id: string) {
  return {
    id,
    title: "An asset",
    mainImage: null,
    thumbnailImage: null,
    assetModel: null,
  };
}

/**
 * Resolves one scanned value.
 *
 * @param value - the scanned code
 * @param search - the query string, e.g. `?source=scanner`
 * @returns the response status
 */
async function resolve(value: string, search = "") {
  const result = await loader({
    request: new Request(
      `http://localhost/api/get-scanned-item/${encodeURIComponent(
        value
      )}${search}`,
      { headers: { "user-agent": "Mozilla/5.0" } }
    ),
    params: { qrId: value },
    context: { getSession: () => ({ userId: "user-1", email: "a@b.c" }) },
  } as unknown as Parameters<typeof loader>[0]);
  return result.init?.status ?? 200;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePermission.mockResolvedValue({
    organizationId: ORG_ID,
    canUseBarcodes: true,
  });
  mockGetQr.mockResolvedValue({
    id: "qr-1",
    organizationId: ORG_ID,
    assetId: "asset-1",
    kitId: null,
    asset: assetRow("asset-1"),
    kit: null,
  });
});

describe("GET /api/get-scanned-item/:qrId records the scan", () => {
  it("records a drawer QR scan without a note", async () => {
    expect(await resolve("qr-1")).toBe(200);

    expect(mockRecordScanNonFatal).toHaveBeenCalledWith({
      codeType: "QR",
      code: "qr-1",
      qrId: "qr-1",
      assetId: "asset-1",
      kitId: null,
      source: "WEB_DRAWER",
      userAgent: "Mozilla/5.0",
      userId: "user-1",
      organizationId: ORG_ID,
      writeNote: false,
    });
  });

  it("records the scanner's SAM view with a note on the asset", async () => {
    mockAssetFindFirst.mockResolvedValue(assetRow("asset-7"));

    expect(await resolve("SAM-0007", "?source=scanner")).toBe(200);

    expect(mockRecordScanNonFatal).toHaveBeenCalledWith(
      expect.objectContaining({
        codeType: "SAM_ID",
        code: "SAM-0007",
        assetId: "asset-7",
        source: "WEB_SCANNER",
        writeNote: true,
      })
    );
  });

  it("treats any other source value as a drawer", async () => {
    mockAssetFindFirst.mockResolvedValue(assetRow("asset-7"));

    await resolve("SAM-0007", "?source=anything");

    expect(mockRecordScanNonFatal).toHaveBeenCalledWith(
      expect.objectContaining({ source: "WEB_DRAWER", writeNote: false })
    );
  });

  it("records a SAM-shaped barcode as the barcode it is", async () => {
    mockAssetFindFirst.mockResolvedValue(null);
    mockGetBarcodeByValue.mockResolvedValue({
      id: "barcode-1",
      asset: null,
      kit: { id: "kit-1", name: "Kit" },
    });

    await resolve("ZZQ-000123");

    expect(mockRecordScanNonFatal).toHaveBeenCalledWith(
      expect.objectContaining({
        codeType: "BARCODE",
        code: "ZZQ-000123",
        barcodeId: "barcode-1",
        assetId: null,
        kitId: "kit-1",
      })
    );
  });

  it("records nothing for an audit: the audit's writer records it", async () => {
    mockAuditAssetFindFirst.mockResolvedValue(null);

    expect(await resolve("qr-1", "?auditSessionId=audit-1")).toBe(200);

    expect(mockRecordScanNonFatal).not.toHaveBeenCalled();
  });

  it("records nothing for a QR from another workspace", async () => {
    mockGetQr.mockResolvedValue({
      id: "qr-1",
      organizationId: "org-2",
      assetId: "asset-1",
      kitId: null,
    });

    expect(await resolve("qr-1")).not.toBe(200);

    expect(mockRecordScanNonFatal).not.toHaveBeenCalled();
  });
});
