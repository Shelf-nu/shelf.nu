// @vitest-environment node
/**
 * Camera scans of a non-Shelf QR code reach this endpoint with the raw text
 * the code encodes. A workspace that imported its codes as `example.it/ABC123`
 * prints stickers that encode `https://example.it/ABC123`, so the lookup must
 * treat the two spellings as one code.
 *
 * The barcode table is an in-memory stand-in so the real `getBarcodeByValue`
 * runs end to end.
 *
 * @see {@link file://./../../../app/routes/api+/get-scanned-barcode.$value.ts}
 */
import {
  inMemoryBarcodeTable,
  type FakeBarcodeRow,
} from "@helpers/in-memory-barcode-table";

const { mockRequirePermission } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
}));
// why: the RBAC gate is not under test; it passes and grants the add-on.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mockRequirePermission,
}));

const { barcodeTable } = vi.hoisted(() => ({
  barcodeTable: { findMany: vi.fn() },
}));
// why: the barcode table is the boundary; each test seeds the rows it needs.
vi.mock("~/database/db.server", () => ({
  db: { $connect: vi.fn(), barcode: barcodeTable },
}));

import { loader } from "~/routes/api+/get-scanned-barcode.$value";

const ORG_ID = "org-1";

function seed(rows: FakeBarcodeRow[]) {
  const assetFor = (id: string | null) =>
    id
      ? {
          id,
          title: "An asset",
          mainImage: null,
          thumbnailImage: null,
          assetModel: null,
        }
      : null;
  const withRelations = (row: FakeBarcodeRow) => ({
    ...row,
    asset: assetFor(row.assetId),
    kit: null,
  });
  const table = inMemoryBarcodeTable(rows);
  barcodeTable.findMany.mockImplementation(async (args) =>
    (await table.findMany(args)).map(withRelations)
  );
}

/** Requests the endpoint exactly as the scanner drawer does. */
async function scan(value: string) {
  const encoded = encodeURIComponent(value);
  const result = await loader({
    request: new Request(`http://localhost/api/get-scanned-barcode/${encoded}`),
    params: { value },
    context: { getSession: () => ({ userId: "user-1", email: "a@b.c" }) },
  } as unknown as Parameters<typeof loader>[0]);

  return {
    status: result.init?.status ?? 200,
    body: result.data as {
      error: { message: string } | null;
      barcode?: { id: string; type?: string; asset?: { id: string } };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePermission.mockResolvedValue({
    organizationId: ORG_ID,
    canUseBarcodes: true,
  });
  seed([
    {
      id: "bc-1",
      value: "example.it/ZZTEST1",
      type: "ExternalQR",
      organizationId: ORG_ID,
      assetId: "asset-1",
      kitId: null,
    },
  ]);
});

describe("GET /api/get-scanned-barcode/:value for an External QR stored without a scheme", () => {
  it.each([
    "example.it/ZZTEST1",
    "https://example.it/ZZTEST1",
    "http://www.example.it/ZZTEST1/",
  ])("resolves %s to the stored asset", async (scanned) => {
    const { status, body } = await scan(scanned);

    expect(status).toBe(200);
    expect(body.barcode?.id).toBe("bc-1");
    expect(body.barcode?.type).toBe("asset");
    expect(body.barcode?.asset?.id).toBe("asset-1");
  });

  it("still answers not-found for a different code on the same host", async () => {
    const { body } = await scan("https://example.it/ZZTEST2");

    expect(body.error?.message).toBe(
      "This barcode doesn't exist or it doesn't belong to your current organization."
    );
  });
});
