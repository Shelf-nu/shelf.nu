/**
 * What the audit receipt is allowed to leave out.
 *
 * The receipt is the audit's OUTPUT: the artifact somebody keeps, attaches to
 * a claim, or hands to a client.
 *
 * `AuditNote` mixes two unrelated things — the condition notes people typed,
 * and the system trail, which grows with every scan. They must be read with
 * separate queries, because only one of them may be truncated. Cutting the
 * trail short is fine; it is a convenience summary. Cutting off what somebody
 * wrote about a damaged asset is data loss, and it is silent, which is why the
 * bound belongs in a test rather than a comment.
 *
 * @see {@link file://./pdf-helpers.ts}
 * @see {@link file://./../../components/audit/audit-receipt-pdf.tsx}
 */
// @vitest-environment node

// why: external database — don't hit the real DB
vi.mock("~/database/db.server", () => ({
  db: {
    auditSession: { findUnique: vi.fn() },
    auditAsset: { findMany: vi.fn() },
    auditImage: { findMany: vi.fn() },
    auditNote: { findMany: vi.fn() },
    asset: { findMany: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}));

// why: signing QR images reaches Supabase storage; irrelevant to note queries
vi.mock("~/modules/qr/service.server", () => ({
  getQrCodeMaps: vi.fn().mockResolvedValue({}),
}));

import { db } from "~/database/db.server";
import { fetchAllAuditPdfRelatedData } from "~/modules/audit/pdf-helpers";

const SESSION = {
  id: "audit-1",
  name: "Quarterly check",
  status: "COMPLETED",
  organizationId: "org-1",
  createdBy: { firstName: "Ada", lastName: "L", email: "ada@example.com" },
  assignments: [],
};

/** The note query for a given `type`, as it was actually issued. */
function noteQueryFor(type: "COMMENT" | "UPDATE") {
  const calls = (db.auditNote.findMany as ReturnType<typeof vi.fn>).mock.calls;
  return calls.map((c) => c[0]).find((arg) => arg?.where?.type === type);
}

describe("audit receipt — what it may truncate", () => {
  /**
   * why this helper: the same `ReturnType<typeof vi.fn>` shape `noteQueryFor`
   * already uses one function up. Casting each mock to `any` at the call site
   * threw away the mock's own typing six times over for no benefit.
   */
  const mockOf = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockOf(db.auditSession.findUnique).mockResolvedValue(SESSION);
    mockOf(db.auditAsset.findMany).mockResolvedValue([]);
    mockOf(db.auditImage.findMany).mockResolvedValue([]);
    mockOf(db.auditNote.findMany).mockResolvedValue([]);
    mockOf(db.asset.findMany).mockResolvedValue([]);
    mockOf(db.organization.findUnique).mockResolvedValue({
      id: "org-1",
      name: "Org",
    });

    await fetchAllAuditPdfRelatedData(
      "audit-1",
      "org-1",
      "user-1",
      undefined,
      new Request("http://localhost/x")
    );
  });

  it("asks for condition notes and system activity separately", () => {
    // why: one query for both is what made the loss possible. Two queries is
    // the structural fix; everything below only holds because of it.
    expect(db.auditNote.findMany).toHaveBeenCalledTimes(2);
    expect(noteQueryFor("COMMENT")).toBeTruthy();
    expect(noteQueryFor("UPDATE")).toBeTruthy();
  });

  it("never caps the condition notes", () => {
    // why: this is the whole point. A receipt that quietly drops the
    // twenty-first observation is worse than one that shows none, because it
    // looks complete. If a cap is ever added here it must be a deliberate
    // decision that changes this line, not a default that nobody noticed.
    const q = noteQueryFor("COMMENT");

    expect(q).not.toHaveProperty("take");
    expect(q?.where).toMatchObject({
      auditSessionId: "audit-1",
      type: "COMMENT",
    });
  });

  it("reads condition notes oldest first, so the receipt tells a story", () => {
    // why: the feed on screen is newest-first because it is a feed. A printed
    // record is read top to bottom in the order the audit happened.
    expect(noteQueryFor("COMMENT")?.orderBy).toEqual({ createdAt: "asc" });
  });

  it("carries each note's asset, so a note prints beside its photos", () => {
    // why: a note about an asset and a photo of that asset are one
    // observation. Without the asset on the note the receipt cannot group
    // them and the reader rejoins them by name across sections.
    expect(noteQueryFor("COMMENT")?.include).toHaveProperty("auditAsset");
  });

  it("still caps the system activity, which is a summary and may truncate", () => {
    // why: the trail grows without bound and nobody needs all of it in a
    // receipt. Keeping the cap HERE is what lets the notes go uncapped.
    const q = noteQueryFor("UPDATE");

    expect(q?.take).toBe(15);
    expect(q?.orderBy).toEqual({ createdAt: "desc" });
  });
});

/**
 * The receipt's Code column.
 *
 * Same wiring as the booking checklist, same reason: the sheet is read next to
 * physical labels. The resolution rules are covered by `display.test.ts`; what
 * is tested here is that the query asks for the columns the resolver reads and
 * that the org's preference is one of them.
 *
 * Each case sets the two preference fields EXPLICITLY. Left off, the resolver's
 * `undefined` preference falls through its `default` branch to the QR id, so a
 * QR-id assertion passes on an org row that never carried a preference at all.
 * The preference is the thing under test; it has to be set.
 */
describe("audit receipt — the printed asset code", () => {
  const mockOf = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

  const ASSET = {
    id: "asset-1",
    title: "Camera",
    thumbnailImage: null,
    // Nullable: an asset without one is what sends SAM_ID to its fallback.
    sequentialId: "SAM-0001" as string | null,
    preferredBarcodeId: null,
    qrCodes: [{ id: "qr-visible-id", version: 0, errorCorrection: "L" }],
    barcodes: [{ id: "bc-1", type: "Code128", value: "128-VALUE" }],
    category: null,
    // A location so the strip can be shown NOT to take the derived
    // `location` field with it.
    assetLocations: [{ location: { name: "Store room" } }],
  };

  async function run(
    prefs: { qrIdDisplayPreference: string; barcodesEnabled: boolean },
    overrides: Partial<typeof ASSET> = {}
  ) {
    vi.clearAllMocks();
    // why: the audit under test. The helper throws immediately without it.
    mockOf(db.auditSession.findUnique).mockResolvedValue(SESSION);
    // why: names which assets are on the audit; the helper skips the asset
    // read entirely when this is empty, and there would be no row to check.
    mockOf(db.auditAsset.findMany).mockResolvedValue([
      { assetId: "asset-1", expected: true, status: null },
    ]);
    // why: the receipt's photo and note sections. Empty keeps these cases
    // about the Code column.
    mockOf(db.auditImage.findMany).mockResolvedValue([]);
    mockOf(db.auditNote.findMany).mockResolvedValue([]);
    // why: the row the resolver runs over — its QR, barcodes and SAM id are
    // what each case varies.
    mockOf(db.asset.findMany).mockResolvedValue([{ ...ASSET, ...overrides }]);
    // why: carries the preference under test.
    mockOf(db.organization.findUnique).mockResolvedValue({
      id: "org-1",
      name: "Org",
      imageId: null,
      currency: "USD",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...prefs,
    });

    return fetchAllAuditPdfRelatedData(
      "audit-1",
      "org-1",
      "user-1",
      undefined,
      new Request("http://localhost/x")
    );
  }

  it("asks the database for the columns the resolver reads", async () => {
    await run({ qrIdDisplayPreference: "QR_ID", barcodesEnabled: false });

    const include = mockOf(db.asset.findMany).mock.calls[0][0].include;

    expect(include.barcodes).toEqual({
      select: { id: true, type: true, value: true },
    });
    // why: NOT the tight `{ take: 1, select: { id } }` the code-bearing-entity
    // rule asks for — `getQrCodeMaps` renders the image from `version` /
    // `errorCorrection`, so narrowing this breaks the QR images in print only.
    expect(include.qrCodes).toBe(true);
  });

  it("asks the database which code the workspace wants printed", async () => {
    await run({ qrIdDisplayPreference: "QR_ID", barcodesEnabled: false });

    expect(
      mockOf(db.organization.findUnique).mock.calls[0][0].select
    ).toMatchObject({
      qrIdDisplayPreference: true,
      barcodesEnabled: true,
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
    const result = await run({
      qrIdDisplayPreference: "QR_ID",
      barcodesEnabled: false,
    });

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

  it("resolves a code even when no QR image could be generated", async () => {
    // why: `getQrCodeMaps` is stubbed to return {} here, which is also what a
    // real signing failure produces. The row still has to print something a
    // reader can match against the shelf.
    const result = await run({
      qrIdDisplayPreference: "SAM_ID",
      barcodesEnabled: false,
    });

    expect(result.assetIdToQrCodeMap["asset-1"]).toBeUndefined();
    expect(result.assetIdToDisplayCodeMap["asset-1"].value).toBe("SAM-0001");
  });
  it("keeps the code-resolution relations out of the rows it returns", async () => {
    // why: the rows are serialised to the browser, and the relations exist only
    // to build the two maps the helper returns alongside them.
    const result = await run({
      qrIdDisplayPreference: "SAM_ID",
      barcodesEnabled: false,
    });

    for (const row of result.assets) {
      expect(row).not.toHaveProperty("barcodes");
      expect(row).not.toHaveProperty("qrCodes");
      expect(row).not.toHaveProperty("assetLocations");
    }

    // why: `location` is derived from `assetLocations`, so dropping the
    // relation must not take the derived field with it.
    expect(result.assets[0].location).toEqual({ name: "Store room" });

    expect(result.assetIdToDisplayCodeMap["asset-1"].value).toBe("SAM-0001");
  });
});
