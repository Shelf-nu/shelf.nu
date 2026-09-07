import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { requireOrganizationAccess } from "~/modules/api/mobile-auth.server";
import { resolveMobileScannedCode } from "~/modules/api/mobile-code-resolve.server";
import { getBarcodeByValue } from "~/modules/barcode/service.server";
import { canUseBarcodes } from "~/utils/subscription.server";

// why: importing the module transitively loads `~/database/db.server`, which
// instantiates a real Prisma client and tries to connect at module load —
// under `pnpm test:run` (no DB available) that fails the suite. The resolver
// only touches `qr.findUnique`, `userOrganization.findUnique`,
// `asset.findFirst`, `kit.findFirst` and `organization.findUnique` (the
// Barcodes add-on gate on the SAM fallback), so we stub exactly those.
vi.mock("~/database/db.server", () => ({
  db: {
    qr: { findUnique: vi.fn() },
    userOrganization: { findUnique: vi.fn() },
    asset: { findFirst: vi.fn() },
    kit: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}));

// why: the SAM fallback reads the workspace's barcode table through this
// service. Stubbing it keeps the branch under test free of a database and
// makes "did we even look?" assertable — the add-on-off case must not query.
vi.mock("~/modules/barcode/service.server", () => ({
  getBarcodeByValue: vi.fn(),
}));

// why: `subscription.server` pulls in the Stripe client and the whole billing
// config at module load. Stubbing the one capability helper also puts the
// add-on gate under explicit control, so these tests do not depend on the
// ambient `ENABLE_PREMIUM_FEATURES` value.
vi.mock("~/utils/subscription.server", () => ({
  canUseBarcodes: vi.fn(),
}));

// why: `mobile-auth.server` transitively loads the Supabase admin client
// (needs env + network wiring we don't have in unit tests). The resolver only
// needs the select constants and the shape helpers from it; pass-through
// stubs keep the branching under test observable without the heavy imports.
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireOrganizationAccess: vi.fn(),
  MOBILE_ASSET_SELECT: {},
  MOBILE_KIT_SELECT: {},
  shapeMobileAssetResponse: (asset: unknown) => asset,
  shapeMobileKitResponse: (kit: unknown) => kit,
}));

/**
 * Tests for `resolveMobileScannedCode`'s failure discrimination — most
 * importantly the additive `reason: "unclaimed"` discriminator that lets the
 * companion take over the native claim flow. The pre-existing contract
 * (status codes + messages) must stay byte-identical so the audit scanner
 * and older app builds keep behaving unchanged.
 *
 * @see {@link file://./mobile-code-resolve.server.ts}
 */

/** Builds loader-shaped args for the resolver with a plain QR id param. */
function resolveArgs(qrId = "abcdefghij") {
  return {
    request: new Request(`http://localhost/api/mobile/qr/${qrId}`),
    params: { qrId },
    user: { id: "user-1" },
  };
}

const qrFindUnique = vi.mocked(db.qr.findUnique);
const membershipFindUnique = vi.mocked(db.userOrganization.findUnique);
const requireOrgAccess = vi.mocked(requireOrganizationAccess);
const barcodeByValue = vi.mocked(getBarcodeByValue);
const barcodesCapability = vi.mocked(canUseBarcodes);

/**
 * The two handles the SAM tests drive, narrowed to the shape the resolver
 * actually reads.
 *
 * Both queries use `select`, so Prisma hands the resolver a few columns and
 * never a whole row — but the mocked client's signature still asks for one.
 * Widening happens once, here, instead of at every fixture: building full
 * Prisma rows would describe data the resolver never sees, and a per-fixture
 * cast would switch off checking on the values under test. With the handle
 * typed, a mistyped column (`barcodeEnabled`) fails the build rather than
 * silently flipping a gate at runtime.
 */
const assetFindFirst = db.asset.findFirst as unknown as Mock<
  () => Promise<{ id: string; title: string } | null>
>;
const organizationFindUnique = db.organization.findUnique as unknown as Mock<
  () => Promise<{ barcodesEnabled: boolean } | null>
>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveMobileScannedCode failure discrimination", () => {
  it("returns a plain 404 (no reason) when the QR does not exist", async () => {
    // why: unknown code → nothing actionable; the companion must NOT offer
    // the claim flow for codes that aren't Shelf codes at all.
    qrFindUnique.mockResolvedValue(null);

    const result = await resolveMobileScannedCode(resolveArgs());

    expect(result).toEqual({
      ok: false,
      status: 404,
      message: "QR code not found",
    });
  });

  it("returns 404 with reason 'unclaimed' + the qr id for an unclaimed code", async () => {
    // why: this is THE branch the native takeover keys off — QR row exists
    // but organizationId is null (printed, never claimed).
    // why: cast — the resolver selects a narrow shape, not the full Qr row
    // (same pattern as the note service tests' Prisma mocks).
    qrFindUnique.mockResolvedValue({
      id: "qr-unclaimed",
      assetId: null,
      kitId: null,
      organizationId: null,
    } as any);

    const result = await resolveMobileScannedCode(resolveArgs("qr-unclaimed"));

    expect(result).toEqual({
      ok: false,
      status: 404,
      // Message must stay byte-identical: older companion builds string-match
      // it and the audit scanner surfaces it verbatim.
      message: "This QR code is not linked to any organization",
      reason: "unclaimed",
      qrId: "qr-unclaimed",
    });
  });

  it("returns a plain 404 (no reason) for an orgless code that is linked to an asset", async () => {
    // why: orgless-but-linked is the corrupted state createAsset's loose
    // QR-connect branch can produce. The web claim loader refuses these
    // (`assetId: null, kitId: null` guard), so the resolver must NOT
    // advertise the claim flow — same status/message, just no reason.
    // why: cast — narrow selected shape, not the full Qr row.
    qrFindUnique.mockResolvedValue({
      id: "qr-orgless-linked",
      assetId: "asset-1",
      kitId: null,
      organizationId: null,
    } as any);

    const result = await resolveMobileScannedCode(
      resolveArgs("qr-orgless-linked")
    );

    expect(result).toEqual({
      ok: false,
      status: 404,
      message: "This QR code is not linked to any organization",
    });
    // No claim offer for a code the web claim flow would refuse.
    expect(result.ok === false && result.reason).toBeFalsy();
  });

  it("returns a plain 403 (no reason) when the code belongs to another org", async () => {
    // why: cast — narrow selected shape, not the full Qr row.
    qrFindUnique.mockResolvedValue({
      id: "qr-foreign",
      assetId: null,
      kitId: null,
      organizationId: "org-other",
    } as any);
    // Caller is not a member of org-other.
    membershipFindUnique.mockResolvedValue(null);

    const result = await resolveMobileScannedCode(resolveArgs("qr-foreign"));

    expect(result).toEqual({
      ok: false,
      status: 403,
      message: "This QR code belongs to a different organization",
    });
    // No claim offer for someone else's code.
    expect(result.ok === false && result.reason).toBeFalsy();
  });

  it("resolves ok with null asset/kit for a claimed-but-unlinked code in the caller's org", async () => {
    // why: this drives the companion's "claimed but unlinked → offer
    // create/link (skipping the claim call)" branch.
    // why: casts — narrow selected shapes, not full Prisma rows.
    qrFindUnique.mockResolvedValue({
      id: "qr-claimed",
      assetId: null,
      kitId: null,
      organizationId: "org-1",
    } as any);
    membershipFindUnique.mockResolvedValue({ id: "membership-1" } as any);

    const result = await resolveMobileScannedCode(resolveArgs("qr-claimed"));

    expect(result).toEqual({
      ok: true,
      recordableQrId: "qr-claimed",
      qr: {
        id: "qr-claimed",
        assetId: null,
        kitId: null,
        organizationId: "org-1",
        asset: null,
        kit: null,
      },
    });
  });
});

/**
 * The SAM branch's barcode fallback.
 *
 * A workspace can print labels whose value looks like a SAM id but is
 * registered as a barcode. The companion routes every SAM-shaped scan to the
 * SAM resolver, so without this fallback those labels never resolve.
 *
 * @see {@link file://./mobile-code-resolve.server.ts} `resolveSamShapedBarcode`
 */
describe("resolveMobileScannedCode SAM-shaped barcode fallback", () => {
  const ORG_ID = "org-1";
  /** A value that satisfies the SAM id pattern but is stored as a barcode. */
  const SAM_SHAPED = "SAM-0001";

  /** The SAM 404 the resolver returns when nothing matches the scanned value. */
  const SAM_NOT_FOUND = {
    ok: false,
    status: 404,
    message:
      "This SAM ID doesn't exist or it doesn't belong to your current organization.",
  };

  beforeEach(() => {
    requireOrgAccess.mockResolvedValue(ORG_ID);
    // Default posture: the workspace holds the add-on, so each test only has
    // to state what it changes.
    organizationFindUnique.mockResolvedValue({ barcodesEnabled: true });
    barcodesCapability.mockReturnValue(true);
  });

  it("resolves an asset-linked barcode when no asset carries that SAM id", async () => {
    assetFindFirst.mockResolvedValue(null);
    barcodeByValue.mockResolvedValue({
      value: SAM_SHAPED,
      assetId: "asset-1",
      kitId: null,
      asset: { id: "asset-1", title: "Asset one" },
      kit: null,
    });

    const result = await resolveMobileScannedCode(resolveArgs(SAM_SHAPED));

    expect(result).toEqual({
      ok: true,
      // A barcode has no QR row, so there is nothing to attribute a scan to.
      recordableQrId: null,
      qr: {
        id: SAM_SHAPED,
        assetId: "asset-1",
        kitId: null,
        organizationId: ORG_ID,
        asset: { id: "asset-1", title: "Asset one" },
        kit: null,
      },
    });
    // The raw scanned string is what reaches the barcode table — the helper
    // matches original case first, then uppercase.
    expect(barcodeByValue).toHaveBeenCalledWith(
      expect.objectContaining({ value: SAM_SHAPED, organizationId: ORG_ID })
    );
  });

  it("resolves a kit-linked barcode with the kit shaped as the QR path shapes it", async () => {
    assetFindFirst.mockResolvedValue(null);
    barcodeByValue.mockResolvedValue({
      value: SAM_SHAPED,
      assetId: null,
      kitId: "kit-1",
      asset: null,
      kit: { id: "kit-1", name: "Kit one" },
    });

    const result = await resolveMobileScannedCode(resolveArgs(SAM_SHAPED));

    expect(result).toEqual({
      ok: true,
      recordableQrId: null,
      qr: {
        id: SAM_SHAPED,
        assetId: null,
        kitId: "kit-1",
        organizationId: ORG_ID,
        asset: null,
        kit: { id: "kit-1", name: "Kit one" },
      },
    });
  });

  it("keeps the SAM 404 and never reads the barcode table without the add-on", async () => {
    // why: the barcode table is add-on data — a workspace without the add-on
    // must not resolve through it, and must not be told the row exists.
    assetFindFirst.mockResolvedValue(null);
    organizationFindUnique.mockResolvedValue({ barcodesEnabled: false });
    barcodesCapability.mockReturnValue(false);

    const result = await resolveMobileScannedCode(resolveArgs(SAM_SHAPED));

    expect(result).toEqual(SAM_NOT_FOUND);
    expect(barcodeByValue).not.toHaveBeenCalled();
  });

  it("keeps the SAM 404 when the barcode exists but is linked to nothing", async () => {
    // why: an unlinked barcode resolves to no item, and the response must not
    // reveal that a row exists for it.
    assetFindFirst.mockResolvedValue(null);
    barcodeByValue.mockResolvedValue({
      value: SAM_SHAPED,
      assetId: null,
      kitId: null,
      asset: null,
      kit: null,
    });

    const result = await resolveMobileScannedCode(resolveArgs(SAM_SHAPED));

    expect(result).toEqual(SAM_NOT_FOUND);
  });

  it("keeps the SAM 404 when the workspace holds no such barcode", async () => {
    assetFindFirst.mockResolvedValue(null);
    barcodeByValue.mockResolvedValue(null);

    const result = await resolveMobileScannedCode(resolveArgs(SAM_SHAPED));

    expect(result).toEqual(SAM_NOT_FOUND);
  });

  it("resolves a real SAM id without touching the barcode table", async () => {
    // why: the SAM id is the core identifier — a value that is both a SAM id
    // and a barcode resolves as the SAM, and costs no extra query.
    assetFindFirst.mockResolvedValue({ id: "asset-9", title: "Asset nine" });

    const result = await resolveMobileScannedCode(resolveArgs(SAM_SHAPED));

    expect(result).toEqual({
      ok: true,
      recordableQrId: null,
      qr: {
        id: SAM_SHAPED,
        assetId: "asset-9",
        kitId: null,
        organizationId: ORG_ID,
        asset: { id: "asset-9", title: "Asset nine" },
        kit: null,
      },
    });
    expect(barcodeByValue).not.toHaveBeenCalled();
    expect(organizationFindUnique).not.toHaveBeenCalled();
  });
});
