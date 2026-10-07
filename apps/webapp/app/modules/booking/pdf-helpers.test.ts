/**
 * What the booking checklist PDF prints in its Code column.
 *
 * The checklist is carried around a warehouse and matched against physical
 * labels. A workspace that labels its shelves with SAM IDs and then gets a
 * sheet of QR ids has to translate every row by hand, which is the whole
 * reason the code is printed at all.
 *
 * The resolution rules themselves live in `~/modules/barcode/display` and are
 * covered by `display.test.ts`. What is tested here is the wiring: that the
 * query asks for the columns the resolver reads, and that every rendered row —
 * including the several a QUANTITY_TRACKED asset produces — can find its code.
 *
 * @see {@link file://./pdf-helpers.ts}
 * @see {@link file://./../../components/booking/booking-overview-pdf.tsx}
 */
// @vitest-environment node

// why: external database — don't hit the real DB
vi.mock("~/database/db.server", () => ({
  db: {
    asset: { findMany: vi.fn() },
    organization: { findUnique: vi.fn() },
    kit: { findMany: vi.fn() },
  },
}));

// why: rendering a QR per asset is external image work (qrcode-generator +
// sharp). The stub hands back one recognisable picture per asset it is given,
// so a test can tell which assets were sent for a QR. Barcode pictures are NOT
// stubbed: they are drawn by the real bwip-js, because their geometry is what
// makes them scan.
vi.mock("~/modules/qr/service.server", () => ({
  getQrCodeMaps: vi.fn(({ assets }: { assets: { id: string }[] }) =>
    Promise.resolve(
      Object.fromEntries(
        assets.map((asset) => [asset.id, `qr-image:${asset.id}`])
      )
    )
  ),
}));

// why: the booking read is a large org-scoped query with its own tests; this
// suite only cares which slices reach the render list.
vi.mock("./service.server", () => ({
  getBooking: vi.fn(),
}));

import type { QrIdDisplayPreference } from "@prisma/client";

import { db } from "~/database/db.server";
import { QR_CODES_ORDER_BY } from "~/modules/barcode/display";
import { fetchAllPdfRelatedData } from "~/modules/booking/pdf-helpers";
import { getQrCodeMaps } from "~/modules/qr/service.server";

import { getBooking } from "./service.server";

const mockOf = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

/** A QUANTITY_TRACKED asset that is a member of one kit. */
const ASSET = {
  id: "asset-1",
  title: "Tripod",
  description: null,
  status: "AVAILABLE",
  valuation: 100,
  mainImage: null,
  thumbnailImage: null,
  mainImageExpiration: null,
  // Nullable: an asset without one is what sends SAM_ID to its fallback.
  sequentialId: "SAM-0001" as string | null,
  // Nullable: set, it names the barcode that overrides the workspace choice.
  preferredBarcodeId: null as string | null,
  qrCodes: [{ id: "qr-visible-id", version: 0, errorCorrection: "L" }],
  barcodes: [{ id: "bc-1", type: "Code128", value: "128-VALUE" }],
  category: { name: "Support" },
  assetLocations: [{ location: { name: "Studio" } }],
  assetKits: [
    { id: "ak-1", kit: { id: "kit-1", name: "Camera kit", location: null } },
  ],
  assetModel: null,
};

const KIT = { id: "kit-1", name: "Camera kit", location: null };

/**
 * The same asset booked twice: once standalone, once through its kit. Two
 * `BookingAsset` rows, so two printed rows, one deduped asset fetch.
 */
const BOOKING_ASSETS = [
  {
    id: "ba-standalone",
    quantity: 2,
    assetKitId: null,
    sourceKitId: null,
    asset: ASSET,
  },
  {
    id: "ba-via-kit",
    quantity: 3,
    assetKitId: "ak-1",
    sourceKitId: "kit-1",
    asset: ASSET,
  },
];

type OrgPrefs = {
  qrIdDisplayPreference: QrIdDisplayPreference;
  barcodesEnabled: boolean;
  /** Defaults to the column default (`true`) when a case doesn't set it. */
  showQrCodesOnPdfs?: boolean;
};

async function run(prefs: OrgPrefs, overrides: Partial<typeof ASSET> = {}) {
  vi.clearAllMocks();

  const asset = { ...ASSET, ...overrides };

  // why: supplies the `BookingAsset` slices, which decide how many rows the
  // render list has — two here, for one asset booked twice.
  mockOf(getBooking).mockResolvedValue({
    id: "booking-1",
    name: "Shoot",
    description: null,
    custodianUser: null,
    custodianTeamMember: { name: "Ada" },
    tags: [],
    modelRequests: [],
    bookingAssets: BOOKING_ASSETS.map((ba) => ({ ...ba, asset })),
  });
  // why: the deduped asset read the resolver runs over. One row, because the
  // helper fetches each asset once however many slices reference it.
  mockOf(db.asset.findMany).mockResolvedValue([asset]);
  // why: the helper looks up the kits named by `sourceKitId` and maps over the
  // result, which throws on an unstubbed `vi.fn()`. It does NOT decide this
  // slice's kit — `assetKitId` matches a live membership on the asset, so
  // `buildPdfAssetRows` resolves the kit from that and never reads the snapshot
  // map. The snapshot path is the detached-residue case, not covered here.
  mockOf(db.kit.findMany).mockResolvedValue([KIT]);
  // why: carries the preference under test. `currency` is read by the total,
  // and the helper throws before building anything if this returns nothing.
  mockOf(db.organization.findUnique).mockResolvedValue({
    id: "org-1",
    name: "Org",
    imageId: null,
    currency: "USD",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    // Matches the column default, so a case that says nothing about the switch
    // exercises the path that prints the image.
    showQrCodesOnPdfs: true,
    ...prefs,
  });

  return fetchAllPdfRelatedData(
    "booking-1",
    "org-1",
    "user-1",
    // No role: the ownership check is exercised by its own tests.
    undefined,
    new Request("http://localhost/x")
  );
}

const QR_ORG: OrgPrefs = {
  qrIdDisplayPreference: "QR_ID",
  barcodesEnabled: false,
};

describe("booking checklist PDF — the printed asset code", () => {
  it("asks the database for the columns the resolver reads", async () => {
    await run(QR_ORG);

    const include = mockOf(db.asset.findMany).mock.calls[0][0].include;

    expect(include.barcodes).toEqual({
      select: { id: true, type: true, value: true },
    });
    // why: NOT the tight `{ take: 1, select: { id } }` the code-bearing-entity
    // rule asks for. The same payload is handed to `getQrCodeMaps`, which
    // renders the image from `version` / `errorCorrection`. Narrowing this
    // select breaks the QR images, silently, in print only. Ordered so the QR
    // picture and the QR id under it are the same first code on every print.
    expect(include.qrCodes).toEqual({ orderBy: QR_CODES_ORDER_BY });
  });

  it("asks the database which code the workspace wants printed", async () => {
    await run(QR_ORG);

    expect(
      mockOf(db.organization.findUnique).mock.calls[0][0].select
    ).toMatchObject({
      qrIdDisplayPreference: true,
      barcodesEnabled: true,
      // why: the sheet cannot decide whether to print the QR image without it.
      showQrCodesOnPdfs: true,
    });
  });

  it("prints the SAM ID for a workspace that asked for SAM IDs", async () => {
    const result = await run({
      qrIdDisplayPreference: "SAM_ID",
      barcodesEnabled: false,
    });

    expect(result.assetIdToDisplayCodeMap["asset-1"]).toMatchObject({
      value: "SAM-0001",
      type: "SAM_ID",
      isFallback: false,
    });
  });

  it("prints the QR id for a default workspace", async () => {
    const result = await run(QR_ORG);

    expect(result.assetIdToDisplayCodeMap["asset-1"]).toMatchObject({
      value: "qr-visible-id",
      type: "QR_ID",
      isFallback: false,
    });
  });

  it("prints the barcode value for a barcode-preference workspace", async () => {
    const result = await run({
      qrIdDisplayPreference: "Code128",
      barcodesEnabled: true,
    });

    expect(result.assetIdToDisplayCodeMap["asset-1"]).toMatchObject({
      value: "128-VALUE",
      type: "Code128",
      isFallback: false,
    });
  });

  it("flags the fallback when the preferred code is missing from the asset", async () => {
    // why: on screen the badge explains this in a tooltip. On paper the only
    // way to say it is the caption the renderer prints under the value, and
    // that caption is driven by this flag.
    const result = await run(
      { qrIdDisplayPreference: "SAM_ID", barcodesEnabled: false },
      { sequentialId: null }
    );

    expect(result.assetIdToDisplayCodeMap["asset-1"]).toMatchObject({
      value: "qr-visible-id",
      type: "QR_ID",
      isFallback: true,
      workspacePreference: "SAM_ID",
    });
  });

  it("gives every per-slice row a code, from one entry", async () => {
    // why: the render list is one row per BookingAsset, so a QT asset booked
    // standalone AND through a kit prints twice. Keying the map by asset id
    // is what lets both rows read the same resolved code — a map keyed by
    // `bookingAssetId` would need the resolver run per row for no gain, and a
    // map built from the per-slice list would resolve the same asset twice.
    const result = await run({
      qrIdDisplayPreference: "SAM_ID",
      barcodesEnabled: false,
    });

    expect(result.assets.map((row) => row.bookingAssetId)).toHaveLength(2);
    expect(Object.keys(result.assetIdToDisplayCodeMap)).toEqual(["asset-1"]);

    for (const row of result.assets) {
      expect(result.assetIdToDisplayCodeMap[row.id]?.value).toBe("SAM-0001");
    }
  });
  it("keeps the code-resolution relations out of the rows it returns", async () => {
    // why: the rows are serialised to the browser, and the render list is one
    // row per slice — so a relation left on a row ships once per slice, for a
    // map the client already has. Both maps are built before this point.
    const result = await run({
      qrIdDisplayPreference: "SAM_ID",
      barcodesEnabled: false,
    });

    for (const row of result.assets) {
      expect(row).not.toHaveProperty("barcodes");
      expect(row).not.toHaveProperty("qrCodes");
      expect(row).not.toHaveProperty("assetKits");
      expect(row).not.toHaveProperty("assetLocations");
    }

    // why: `getBooking` carries a second, select-shaped copy of every asset —
    // the code relations among them — on `bookingAssets`, once per slice, and
    // `modelRequests` with full `AssetModel` rows that the sheet reads from
    // the projected `modelRequests` instead. Stripping the render rows alone
    // leaves both in the response.
    expect(result.booking).not.toHaveProperty("bookingAssets");
    expect(result.booking).not.toHaveProperty("modelRequests");

    // The projection the sheet actually reads is untouched.
    expect(result.modelRequests).toEqual([]);

    expect(result.assetIdToDisplayCodeMap["asset-1"].value).toBe("SAM-0001");
  });

  it("encodes a QR per asset when the workspace prints them", async () => {
    await run(QR_ORG);

    expect(mockOf(getQrCodeMaps)).toHaveBeenCalledTimes(1);
  });

  it("encodes nothing when the workspace prints no code pictures", async () => {
    // The sheet renders no picture in this case, so encoding one would cost an
    // encode per asset and carry a data URL per asset to a browser that drops
    // it. The printed code is resolved independently, so the row stays
    // matchable.
    const result = await run({ ...QR_ORG, showQrCodesOnPdfs: false });

    expect(mockOf(getQrCodeMaps)).not.toHaveBeenCalled();
    expect(result.assetIdToCodeImageMap).toEqual({});
    expect(result.assetIdToDisplayCodeMap["asset-1"].value).toBe(
      "qr-visible-id"
    );
  });
});

/** Decodes a code picture's data URL back to its SVG source. */
function svgOf(dataUrl: string | undefined): string {
  expect(dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  return Buffer.from(dataUrl!.split(",")[1], "base64").toString("utf8");
}

/**
 * Builds a checklist over several standalone assets, one row each, so a case
 * can mix assets that carry the preferred barcode with assets that do not.
 */
async function runWithAssets(
  prefs: OrgPrefs,
  assets: Array<Partial<typeof ASSET> & { id: string }>,
  options?: Parameters<typeof fetchAllPdfRelatedData>[6]
) {
  vi.clearAllMocks();

  const rows = assets.map((overrides) => ({
    ...ASSET,
    assetKits: [],
    barcodes: [],
    qrCodes: [{ id: `qr-${overrides.id}`, version: 0, errorCorrection: "L" }],
    ...overrides,
  }));

  // why: supplies one standalone `BookingAsset` slice per asset.
  mockOf(getBooking).mockResolvedValue({
    id: "booking-1",
    name: "Shoot",
    description: null,
    custodianUser: null,
    custodianTeamMember: { name: "Ada" },
    tags: [],
    modelRequests: [],
    bookingAssets: rows.map((asset) => ({
      id: `ba-${asset.id}`,
      quantity: 1,
      assetKitId: null,
      sourceKitId: null,
      asset,
    })),
  });
  // why: the deduped asset read the pictures are drawn from.
  mockOf(db.asset.findMany).mockResolvedValue(rows);
  // why: no slice names a kit, so the snapshot kit lookup finds nothing.
  mockOf(db.kit.findMany).mockResolvedValue([]);
  // why: carries the preference and the switch under test.
  mockOf(db.organization.findUnique).mockResolvedValue({
    id: "org-1",
    name: "Org",
    imageId: null,
    currency: "USD",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    showQrCodesOnPdfs: true,
    ...prefs,
  });

  return fetchAllPdfRelatedData(
    "booking-1",
    "org-1",
    "user-1",
    undefined,
    new Request("http://localhost/x"),
    undefined,
    options
  );
}

const CODE128_ORG: OrgPrefs = {
  qrIdDisplayPreference: "Code128",
  barcodesEnabled: true,
};

describe("booking checklist PDF: the picture in the Code cell", () => {
  it("draws the barcode for an asset that carries the workspace's barcode", async () => {
    const result = await runWithAssets(CODE128_ORG, [
      {
        id: "with-barcode",
        barcodes: [{ id: "bc-1", type: "Code128", value: "AB-12345678" }],
      },
    ]);

    // why: the picture must be the SAME code as the text under it, so a
    // scanner reads what the picker reads.
    expect(result.assetIdToDisplayCodeMap["with-barcode"].value).toBe(
      "AB-12345678"
    );
    const image = result.assetIdToCodeImageMap["with-barcode"];
    expect(image).toMatchObject({ shape: "linear", placement: "cell" });
    const svg = svgOf(image?.src);
    expect(svg).toContain('preserveAspectRatio="none"');
    expect(svg).toMatch(/<svg[^>]* width="[\d.]+mm"/);
  });

  it("prints the Shelf QR for an asset without the workspace's barcode", async () => {
    // why: its text falls back to the QR id, so its picture must be the QR.
    const result = await runWithAssets(CODE128_ORG, [
      { id: "without-barcode" },
    ]);

    expect(result.assetIdToDisplayCodeMap["without-barcode"]).toMatchObject({
      type: "QR_ID",
      isFallback: true,
    });
    expect(result.assetIdToCodeImageMap["without-barcode"]).toEqual({
      src: "qr-image:without-barcode",
      shape: "square",
      placement: "cell",
    });
  });

  it("prints the Shelf QR in a SAM ID workspace", async () => {
    // why: a SAM ID has no picture of its own. The QR is what the label on the
    // asset carries alongside it, so the sheet keeps printing it.
    const result = await runWithAssets(
      { qrIdDisplayPreference: "SAM_ID", barcodesEnabled: false },
      [{ id: "sam-asset" }]
    );

    expect(result.assetIdToDisplayCodeMap["sam-asset"].type).toBe("SAM_ID");
    expect(result.assetIdToCodeImageMap["sam-asset"]).toEqual({
      src: "qr-image:sam-asset",
      shape: "square",
      placement: "cell",
    });
  });

  it("sends only the assets whose picture is a QR to the QR renderer", async () => {
    await runWithAssets(CODE128_ORG, [
      {
        id: "with-barcode",
        barcodes: [{ id: "bc-1", type: "Code128", value: "AB-12345678" }],
      },
      { id: "without-barcode" },
    ]);

    const sent = mockOf(getQrCodeMaps).mock.calls[0][0].assets.map(
      (asset: { id: string }) => asset.id
    );
    expect(sent).toEqual(["without-barcode"]);
  });

  it("does not call the QR renderer when every picture is a barcode", async () => {
    await runWithAssets(CODE128_ORG, [
      {
        id: "with-barcode",
        barcodes: [{ id: "bc-1", type: "Code128", value: "AB-12345678" }],
      },
    ]);

    expect(mockOf(getQrCodeMaps)).not.toHaveBeenCalled();
  });

  it("moves a barcode too wide for the Code column onto the line under its row", async () => {
    // 20 letters of Code 128: well over 250 modules, so even at the 0.19 mm
    // floor it needs more than the cell's ~44.7 mm.
    const result = await runWithAssets(CODE128_ORG, [
      {
        id: "long-barcode",
        barcodes: [
          { id: "bc-1", type: "Code128", value: "ABCDEFGHIJKLMNOPQRST" },
        ],
      },
    ]);

    // why: shrinking it into the cell would make the bars too thin to scan,
    // and printing a QR instead would put a picture of a DIFFERENT code beside
    // the text. The full-width line fits it at the preferred module width.
    expect(result.assetIdToDisplayCodeMap["long-barcode"].value).toBe(
      "ABCDEFGHIJKLMNOPQRST"
    );
    const image = result.assetIdToCodeImageMap["long-barcode"];
    expect(image).toMatchObject({ shape: "linear", placement: "line" });
    expect(svgOf(image?.src)).toMatch(/<svg[^>]* width="[\d.]+mm"/);
    expect(mockOf(getQrCodeMaps)).not.toHaveBeenCalled();
  });

  it("prints text only for an EAN-13 the encoder refuses", async () => {
    const result = await runWithAssets(
      { qrIdDisplayPreference: "EAN13", barcodesEnabled: true },
      [
        {
          id: "bad-ean",
          barcodes: [{ id: "bc-1", type: "EAN13", value: "12345" }],
        },
      ]
    );

    expect(result.assetIdToCodeImageMap).not.toHaveProperty("bad-ean");
  });

  it("draws a per-asset preferred barcode even in a SAM ID workspace", async () => {
    // why: the per-asset override wins over the workspace preference, for the
    // text and so for the picture.
    const result = await runWithAssets(
      { qrIdDisplayPreference: "SAM_ID", barcodesEnabled: true },
      [
        {
          id: "override",
          preferredBarcodeId: "bc-1",
          barcodes: [{ id: "bc-1", type: "DataMatrix", value: "DM-0001" }],
        },
      ]
    );

    expect(result.assetIdToDisplayCodeMap["override"].type).toBe("DataMatrix");
    expect(svgOf(result.assetIdToCodeImageMap["override"]?.src)).toContain(
      "<svg"
    );
  });

  it("draws no pictures for a sheet that prints none", async () => {
    // why: the check-in receipt prints the code as text only.
    const result = await runWithAssets(
      CODE128_ORG,
      [
        {
          id: "with-barcode",
          barcodes: [{ id: "bc-1", type: "Code128", value: "AB-12345678" }],
        },
        { id: "without-barcode" },
      ],
      { includeCodeImages: false }
    );

    expect(result.assetIdToCodeImageMap).toEqual({});
    expect(mockOf(getQrCodeMaps)).not.toHaveBeenCalled();
  });
});
