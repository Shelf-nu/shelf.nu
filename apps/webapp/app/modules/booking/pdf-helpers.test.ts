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

// why: rendering a QR per asset is real work (qrcode-generator + sharp) and
// irrelevant here — the printed code is resolved independently of whether an
// image came back.
vi.mock("~/modules/qr/service.server", () => ({
  getQrCodeMaps: vi.fn().mockResolvedValue({}),
}));

// why: the booking read is a large org-scoped query with its own tests; this
// suite only cares which slices reach the render list.
vi.mock("./service.server", () => ({
  getBooking: vi.fn(),
}));

import type { QrIdDisplayPreference } from "@prisma/client";

import { db } from "~/database/db.server";
import { fetchAllPdfRelatedData } from "~/modules/booking/pdf-helpers";

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
  preferredBarcodeId: null,
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
    // select breaks the QR images, silently, in print only.
    expect(include.qrCodes).toBe(true);
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
});
