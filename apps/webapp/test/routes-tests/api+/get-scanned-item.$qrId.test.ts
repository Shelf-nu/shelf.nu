// @vitest-environment node
/**
 * Web scanned-item resolve — the SAM-shaped barcode fallback.
 *
 * Scanner mode (keyboard wedge or typed input, the default on md+ viewports)
 * tests the SAM id pattern before anything else and sends every match to this
 * endpoint. A workspace that prints labels whose value looks like a SAM id but
 * is registered as a barcode therefore never reaches `get-scanned-barcode`,
 * which is where camera scans go.
 *
 * These pin the fallback and the unchanged SAM error either side of it. The
 * error message is byte-matched on purpose: `resolveAssetIdFromSamId` carries
 * the same string as its client-side default.
 *
 * @see {@link file://./../../../app/routes/api+/get-scanned-item.$qrId.ts}
 * @see {@link file://./../scanner-sam-id.test.ts}
 */

const { mockRequirePermission } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
}));
// why: the RBAC gate is not under test — it must PASS so the assertions are
// about what the loader does with the scanned value. It also carries
// `canUseBarcodes`, which is the add-on gate these tests drive.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mockRequirePermission,
}));

const {
  mockAssetFindFirst,
  mockAuditAssetFindFirst,
  mockAuditNoteCount,
  mockAuditImageCount,
} = vi.hoisted(() => ({
  mockAssetFindFirst: vi.fn(),
  mockAuditAssetFindFirst: vi.fn(),
  mockAuditNoteCount: vi.fn(),
  mockAuditImageCount: vi.fn(),
}));
// why: importing the route pulls in `db.server`, whose non-production
// initialization calls `db.$connect()` — without this the test opens a real
// PostgreSQL connection. `asset.findFirst` is the SAM lookup these tests drive;
// the audit counters are only reached with an `auditSessionId`, which none of
// these requests carry.
vi.mock("~/database/db.server", () => ({
  db: {
    $connect: vi.fn(),
    asset: { findFirst: mockAssetFindFirst },
    auditAsset: { findFirst: mockAuditAssetFindFirst },
    auditNote: { count: mockAuditNoteCount },
    auditImage: { count: mockAuditImageCount },
  },
}));

const { mockGetBarcodeByValue } = vi.hoisted(() => ({
  mockGetBarcodeByValue: vi.fn(),
}));
// why: the collaborator the fallback delegates to. Mocking it makes "did we
// even look?" assertable — the add-on-off case must not query.
vi.mock("~/modules/barcode/service.server", () => ({
  getBarcodeByValue: mockGetBarcodeByValue,
}));

const { mockGetQr } = vi.hoisted(() => ({ mockGetQr: vi.fn() }));
// why: the QR branch, which a SAM-shaped value never reaches. Stubbed so the
// module cannot fall through to a database.
vi.mock("~/modules/qr/service.server", () => ({ getQr: mockGetQr }));

// why: recording writes to the database; what these resolves record is pinned
// in get-scanned-item.$qrId.records-scan.test.ts.
vi.mock("~/modules/scan/service.server", () => ({
  recordScanNonFatal: vi.fn(),
}));

import { loader } from "~/routes/api+/get-scanned-item.$qrId";
import { accessFor } from "@helpers/role-access";

const ORG_ID = "org-1";
/** A value that satisfies the SAM id pattern but is stored as a barcode. */
const SAM_SHAPED = "ZZQ-000123";
const SAM_NOT_FOUND =
  "This SAM ID doesn't exist or it doesn't belong to your current organization.";
/**
 * The status the SAM error carries.
 *
 * `ShelfError` defaults to 500 when no status is given, and this throw gives
 * none — so a SAM miss answers 500, not 404. `shouldBeCaptured: false` keeps it
 * out of Sentry, and `resolveAssetIdFromSamId` maps whatever status it gets, so
 * nothing downstream depends on the number. Asserted as it stands: the fallback
 * must not move it either way.
 */
const SAM_NOT_FOUND_STATUS = 500;

/** An asset row as `ASSET_INCLUDE` returns it, trimmed to the image cascade. */
function assetRow(id: string) {
  return {
    id,
    organizationId: ORG_ID,
    title: "An asset",
    mainImage: null,
    thumbnailImage: null,
    assetModel: null,
  };
}

/**
 * Invokes the loader for one scanned value.
 *
 * The loader answers with React Router's `data()` wrapper, which carries the
 * payload and the response init side by side rather than a serialized
 * `Response` — so the status is read off `init` and the body off `data`. A
 * success omits `init` entirely, which is the framework's 200.
 */
async function scan(value: string) {
  const result = await loader({
    request: new Request(
      `http://localhost/api/get-scanned-item/${encodeURIComponent(value)}`
    ),
    params: { qrId: value },
    context: { getSession: () => ({ userId: "user-1", email: "a@b.c" }) },
  } as unknown as Parameters<typeof loader>[0]);

  return {
    status: result.init?.status ?? 200,
    body: result.data as {
      error: { message: string } | null;
      qr?: { type?: string; asset?: { id: string }; kit?: { id: string } };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default posture: the workspace holds the add-on, so each test only has to
  // state what it changes.
  mockRequirePermission.mockResolvedValue({
    organizationId: ORG_ID,
    canUseBarcodes: true,
    access: accessFor(["ADMIN"]),
  });
});

describe("GET /api/get-scanned-item/:qrId — SAM-shaped barcode fallback", () => {
  it("resolves an asset-linked barcode when no asset carries that SAM id", async () => {
    mockAssetFindFirst.mockResolvedValue(null);
    mockGetBarcodeByValue.mockResolvedValue({
      asset: assetRow("asset-1"),
      kit: null,
    });

    const { status, body } = await scan(SAM_SHAPED);

    expect(status).toBe(200);
    expect(body.qr?.type).toBe("asset");
    expect(body.qr?.asset?.id).toBe("asset-1");
    // The raw scanned string is what reaches the barcode table — the helper
    // matches original case first, then uppercase — and it stays org-scoped.
    expect(mockGetBarcodeByValue).toHaveBeenCalledWith(
      expect.objectContaining({ value: SAM_SHAPED, organizationId: ORG_ID })
    );
  });

  it("resolves a kit-linked barcode", async () => {
    mockAssetFindFirst.mockResolvedValue(null);
    mockGetBarcodeByValue.mockResolvedValue({
      asset: null,
      kit: { id: "kit-1", name: "A kit" },
    });

    const { status, body } = await scan(SAM_SHAPED);

    expect(status).toBe(200);
    expect(body.qr?.type).toBe("kit");
    expect(body.qr?.kit?.id).toBe("kit-1");
    expect(body.qr?.asset).toBeUndefined();
  });

  it("keeps the SAM error and never reads the barcode table without the add-on", async () => {
    // why: the barcode table is add-on data. This endpoint must refuse it on
    // the same terms as its camera-scan sibling, which reads the same flag.
    mockRequirePermission.mockResolvedValue({
      organizationId: ORG_ID,
      canUseBarcodes: false,
      access: accessFor(["ADMIN"]),
    });
    mockAssetFindFirst.mockResolvedValue(null);

    const { status, body } = await scan(SAM_SHAPED);

    expect(status).toBe(SAM_NOT_FOUND_STATUS);
    expect(body.error?.message).toBe(SAM_NOT_FOUND);
    expect(mockGetBarcodeByValue).not.toHaveBeenCalled();
  });

  it("keeps the SAM error when the barcode exists but is linked to nothing", async () => {
    // why: an unlinked barcode resolves to no item, and the response must not
    // reveal that a row exists for it.
    mockAssetFindFirst.mockResolvedValue(null);
    mockGetBarcodeByValue.mockResolvedValue({ asset: null, kit: null });

    const { status, body } = await scan(SAM_SHAPED);

    expect(status).toBe(SAM_NOT_FOUND_STATUS);
    expect(body.error?.message).toBe(SAM_NOT_FOUND);
  });

  it("keeps the SAM error when the workspace holds no such barcode", async () => {
    mockAssetFindFirst.mockResolvedValue(null);
    mockGetBarcodeByValue.mockResolvedValue(null);

    const { status, body } = await scan(SAM_SHAPED);

    expect(status).toBe(SAM_NOT_FOUND_STATUS);
    expect(body.error?.message).toBe(SAM_NOT_FOUND);
  });

  it("resolves a real SAM id without touching the barcode table", async () => {
    // why: the SAM id is the core identifier — a value that is both a SAM id
    // and a barcode resolves as the SAM, and costs no extra query.
    mockAssetFindFirst.mockResolvedValue(assetRow("asset-9"));

    const { status, body } = await scan(SAM_SHAPED);

    expect(status).toBe(200);
    expect(body.qr?.type).toBe("asset");
    expect(body.qr?.asset?.id).toBe("asset-9");
    expect(mockGetBarcodeByValue).not.toHaveBeenCalled();
  });

  it("leaves a non-SAM-shaped value on the QR path", async () => {
    // why: the fallback lives inside the SAM branch only. A plain QR id must
    // still resolve through `getQr`, untouched.
    mockGetQr.mockResolvedValue({
      id: "abcdefghij",
      organizationId: ORG_ID,
      assetId: "asset-2",
      kitId: null,
      asset: assetRow("asset-2"),
      kit: null,
    });

    const { status, body } = await scan("abcdefghij");

    expect(status).toBe(200);
    expect(body.qr?.type).toBe("asset");
    expect(body.qr?.asset?.id).toBe("asset-2");
    expect(mockGetBarcodeByValue).not.toHaveBeenCalled();
  });
});

describe("GET /api/get-scanned-item/:qrId: workspace of the linked item", () => {
  it("refuses a code whose linked asset is in another workspace", async () => {
    mockGetQr.mockResolvedValue({
      id: "abcdefghij",
      organizationId: ORG_ID,
      assetId: "asset-3",
      kitId: null,
      asset: { ...assetRow("asset-3"), organizationId: "org-2" },
      kit: null,
    });

    const { status, body } = await scan("abcdefghij");

    expect(status).not.toBe(200);
    expect(body.qr).toBeUndefined();
  });

  it("refuses a code whose linked kit is in another workspace", async () => {
    mockGetQr.mockResolvedValue({
      id: "abcdefghij",
      organizationId: ORG_ID,
      assetId: null,
      kitId: "kit-3",
      asset: null,
      kit: { id: "kit-3", name: "A kit", organizationId: "org-2" },
    });

    const { status, body } = await scan("abcdefghij");

    expect(status).not.toBe(200);
    expect(body.qr).toBeUndefined();
  });

  it("resolves a code whose linked kit is in the caller's workspace", async () => {
    mockGetQr.mockResolvedValue({
      id: "abcdefghij",
      organizationId: ORG_ID,
      assetId: null,
      kitId: "kit-4",
      asset: null,
      kit: { id: "kit-4", name: "A kit", organizationId: ORG_ID },
    });

    const { status, body } = await scan("abcdefghij");

    expect(status).toBe(200);
    expect(body.qr?.type).toBe("kit");
  });
});

describe("GET /api/get-scanned-item/:qrId: custodian visibility", () => {
  /** A custodian row as `CUSTODIAN_SELECT` returns it. */
  function custodian(userId: string | null, name: string) {
    return { userId, name, user: null };
  }

  /** Resolves `value` as a member without custody visibility. */
  async function scanRestricted(value: string) {
    mockRequirePermission.mockResolvedValue({
      organizationId: ORG_ID,
      canUseBarcodes: true,
      access: accessFor(["SELF_SERVICE"]),
    });
    const result = await loader({
      request: new Request(`http://localhost/api/get-scanned-item/${value}`),
      params: { qrId: value },
      context: { getSession: () => ({ userId: "user-1", email: "a@b.c" }) },
    } as unknown as Parameters<typeof loader>[0]);

    return result.data as {
      qr: {
        asset?: { custody: { custodian: ReturnType<typeof custodian> }[] };
        kit?: {
          custody: { custodian: ReturnType<typeof custodian> } | null;
          assetKits: {
            asset: {
              custody: { custodian?: ReturnType<typeof custodian> }[];
            };
          }[];
        };
      };
    };
  }

  const REDACTED = { userId: null, name: "", user: null };

  it("redacts another holder on a QR-scanned asset and keeps the viewer's own", async () => {
    mockGetQr.mockResolvedValue({
      id: "abcdefghij",
      organizationId: ORG_ID,
      assetId: "asset-5",
      kitId: null,
      asset: {
        ...assetRow("asset-5"),
        custody: [
          { quantity: 2, custodian: custodian("someone", "Sam") },
          { quantity: 1, custodian: custodian("user-1", "Me") },
        ],
      },
      kit: null,
    });

    const body = await scanRestricted("abcdefghij");

    expect(body.qr.asset?.custody[0].custodian).toEqual(REDACTED);
    expect(body.qr.asset?.custody[1].custodian.name).toBe("Me");
  });

  it("redacts another holder on a SAM-scanned asset", async () => {
    mockAssetFindFirst.mockResolvedValue({
      ...assetRow("asset-6"),
      custody: [{ quantity: 1, custodian: custodian(null, "Nora NRM") }],
    });

    const body = await scanRestricted(SAM_SHAPED);

    expect(body.qr.asset?.custody[0].custodian).toEqual(REDACTED);
  });

  it("redacts a kit's custodian and its members' custodians", async () => {
    mockGetQr.mockResolvedValue({
      id: "abcdefghij",
      organizationId: ORG_ID,
      assetId: null,
      kitId: "kit-5",
      asset: null,
      kit: {
        id: "kit-5",
        name: "A kit",
        organizationId: ORG_ID,
        custody: { custodian: custodian("someone", "Sam") },
        assetKits: [
          {
            id: "ak-1",
            asset: {
              id: "asset-7",
              custody: [{ custodian: custodian("someone", "Sam") }],
            },
          },
        ],
      },
    });

    const body = await scanRestricted("abcdefghij");

    expect(body.qr.kit?.custody?.custodian).toEqual(REDACTED);
    expect(body.qr.kit?.assetKits[0].asset.custody[0].custodian).toEqual(
      REDACTED
    );
  });
});
