// @vitest-environment node
/**
 * Web barcode view (`/barcode/:value`): the scan it records.
 *
 * The web scanner's "View asset" for a barcode navigates here. It is a real
 * scan that opens the item, so it records a `WEB_SCANNER` barcode scan with a
 * note on the asset, in the barcode's workspace, before redirecting.
 *
 * @see {@link file://./../../../app/routes/barcode+/$value.tsx}
 */

const { mockRequirePermission } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
}));
// why: the RBAC gate is not under test; it passes and carries the add-on flag
// and the caller's workspaces.
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

// why: the workspace cookie is signed with the session secret, which unit
// tests do not carry; its value is not under test.
vi.mock("~/modules/organization/context.server", () => ({
  setSelectedOrganizationIdCookie: vi.fn().mockResolvedValue("org=org-1"),
}));

// why: importing the route pulls in `db.server`, whose initialization would
// otherwise open a real PostgreSQL connection.
vi.mock("~/database/db.server", () => ({ db: { $connect: vi.fn() } }));

const { mockRecordScanNonFatal } = vi.hoisted(() => ({
  mockRecordScanNonFatal: vi.fn(),
}));
// why: the recording helper writes to the database; its own behaviour is
// covered in record-scan.test.ts. Here we assert what the route asks it for.
vi.mock("~/modules/scan/service.server", () => ({
  recordScanNonFatal: mockRecordScanNonFatal,
}));

import { loader } from "~/routes/barcode+/$value";

/**
 * Runs the loader for one scanned barcode value.
 *
 * @returns the redirect `Response`, or the thrown error response
 */
async function view(value: string) {
  try {
    return (await loader({
      request: new Request(
        `http://localhost/barcode/${encodeURIComponent(value)}`,
        { headers: { "user-agent": "Mozilla/5.0" } }
      ),
      params: { value },
      context: { getSession: () => ({ userId: "user-1" }) },
    } as unknown as Parameters<typeof loader>[0])) as Response;
  } catch (thrown) {
    return thrown;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePermission.mockResolvedValue({
    organizationId: "org-1",
    canUseBarcodes: true,
    userOrganizations: [
      { organization: { id: "org-1", type: "TEAM" } },
      { organization: { id: "org-p", type: "PERSONAL" } },
    ],
  });
});

describe("GET /barcode/:value records the scan", () => {
  it("records a web scanner barcode scan with a note, then opens the asset", async () => {
    mockGetBarcodeByValue.mockResolvedValue({
      id: "barcode-1",
      value: "BC-0042",
      assetId: "asset-1",
      kitId: null,
      organizationId: "org-1",
    });

    const response = (await view("BC-0042")) as Response;

    expect(mockRecordScanNonFatal).toHaveBeenCalledWith({
      codeType: "BARCODE",
      code: "BC-0042",
      source: "WEB_SCANNER",
      userAgent: "Mozilla/5.0",
      userId: "user-1",
      barcodeId: "barcode-1",
      assetId: "asset-1",
      kitId: null,
      organizationId: "org-1",
      writeNote: true,
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain(
      "/assets/asset-1/overview"
    );
  });

  it("records a kit barcode against the kit", async () => {
    mockGetBarcodeByValue.mockResolvedValue({
      id: "barcode-2",
      value: "KIT-01",
      assetId: null,
      kitId: "kit-1",
      organizationId: "org-1",
    });

    await view("KIT-01");

    expect(mockRecordScanNonFatal).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: null, kitId: "kit-1" })
    );
  });

  it("records nothing for a barcode linked to nothing", async () => {
    mockGetBarcodeByValue.mockResolvedValue({
      id: "barcode-3",
      value: "LOOSE",
      assetId: null,
      kitId: null,
      organizationId: "org-1",
    });

    await view("LOOSE");

    expect(mockRecordScanNonFatal).not.toHaveBeenCalled();
  });

  it("records nothing for an unknown barcode", async () => {
    mockGetBarcodeByValue.mockResolvedValue(null);

    await view("NOPE");

    expect(mockRecordScanNonFatal).not.toHaveBeenCalled();
  });
});
