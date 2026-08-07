import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { resolveMobileScannedCode } from "~/modules/api/mobile-code-resolve.server";

// why: importing the module transitively loads `~/database/db.server`, which
// instantiates a real Prisma client and tries to connect at module load —
// under `pnpm test:run` (no DB available) that fails the suite. The resolver
// only touches `qr.findUnique`, `userOrganization.findUnique`,
// `asset.findFirst` and `kit.findFirst`, so we stub exactly those.
vi.mock("~/database/db.server", () => ({
  db: {
    qr: { findUnique: vi.fn() },
    userOrganization: { findUnique: vi.fn() },
    asset: { findFirst: vi.fn() },
    kit: { findFirst: vi.fn() },
  },
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
