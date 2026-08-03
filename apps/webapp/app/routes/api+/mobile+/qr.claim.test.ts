import { beforeEach, describe, expect, it, vi } from "vitest";

// why: the route pre-reads the QR state via `db.qr.findUnique` (the web claim
// loader's `assetId: null, kitId: null` availability guard); stubbing just
// that avoids the real Prisma client (no DB in unit tests).
vi.mock("~/database/db.server", () => ({
  db: {
    qr: { findUnique: vi.fn() },
  },
}));

// why: `mobile-auth.server` transitively loads the Supabase admin client and
// the real Prisma client (no DB / env in unit tests). The route only calls
// these three gate functions, so we stub exactly those and drive the
// permission/org branching through them.
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
}));

// why: `claimQrCode` is the web-parity service (its own semantics are the
// web claim route's semantics). The route's observable job is gating +
// envelope shaping, so the service is stubbed and its failure modes are
// simulated as the ShelfErrors it really throws.
vi.mock("~/modules/qr/service.server", () => ({
  claimQrCode: vi.fn(),
}));

import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { claimQrCode } from "~/modules/qr/service.server";
import { ShelfError } from "~/utils/error";
import { action } from "./qr.claim";

/**
 * Tests for POST /api/mobile/qr/claim — the native takeover of the web claim
 * flow. Asserts observable behavior: status codes, error envelopes,
 * permission denials, and that the claim is always bound to the caller's
 * current org (never a body-supplied one).
 *
 * @see {@link file://./qr.claim.ts}
 */

/** Shape of the `data()` result the route action returns. */
type DataResult<T> = { data: T; init: ResponseInit | null };

/** Runs the action with a JSON body and unwraps the data() envelope. */
async function callAction(body: unknown) {
  const request = new Request(
    "http://localhost/api/mobile/qr/claim?orgId=org-1",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const result = await action({ request, params: {}, context: {} } as never);
  const { data, init } = result as unknown as DataResult<{
    qr?: { id: string; organizationId: string | null };
    error?: { message: string };
  }>;
  return { body: data, status: init?.status ?? 200 };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: { id: "user-1" },
  } as any);
  vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
  vi.mocked(requireMobilePermission).mockResolvedValue(undefined);
  // why: cast — the route selects a narrow shape, not the full Qr row.
  // Default: an unlinked code, so the availability guard passes and each
  // denial test overrides only the branch it exercises.
  vi.mocked(db.qr.findUnique).mockResolvedValue({
    id: "qr-1",
    assetId: null,
    kitId: null,
  } as any);
});

describe("POST /api/mobile/qr/claim", () => {
  it("claims the code into the caller's current org and returns the qr summary", async () => {
    vi.mocked(claimQrCode).mockResolvedValue({
      id: "qr-1",
      organizationId: "org-1",
      assetId: null,
      kitId: null,
    } as any);

    const { body, status } = await callAction({ qrId: "qr-1" });

    expect(status).toBe(200);
    expect(body).toEqual({
      qr: { id: "qr-1", organizationId: "org-1", assetId: null, kitId: null },
    });
    // The claim is bound to the resolved caller org + caller user — the body
    // can never smuggle a different org (org-scope contract).
    expect(claimQrCode).toHaveBeenCalledWith({
      id: "qr-1",
      organizationId: "org-1",
      userId: "user-1",
    });
  });

  it("returns 403 and never claims when the caller lacks qr:update (non-admin/owner)", async () => {
    vi.mocked(requireMobilePermission).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "You have no permission to perform this action",
        label: "Permission",
        status: 403,
      })
    );

    const { body, status } = await callAction({ qrId: "qr-1" });

    expect(status).toBe(403);
    expect(body.error?.message).toBe(
      "You have no permission to perform this action"
    );
    expect(claimQrCode).not.toHaveBeenCalled();
  });

  it("returns 403 when the code is already claimed by an organization", async () => {
    // why: simulate exactly what claimQrCode throws for an already-claimed
    // code — a 403 ShelfError whose status survives the service's re-wrap.
    vi.mocked(claimQrCode).mockRejectedValue(
      new ShelfError({
        cause: null,
        message:
          "This QR code already belongs to an organization so you cannot claim it.",
        label: "QR",
        status: 403,
      })
    );

    const { body, status } = await callAction({ qrId: "qr-1" });

    expect(status).toBe(403);
    expect(body.error?.message).toBe(
      "This QR code already belongs to an organization so you cannot claim it."
    );
  });

  it("returns 400 for a body without a qrId", async () => {
    const { body, status } = await callAction({});

    expect(status).toBe(400);
    expect(body.error?.message).toBe("Invalid request body");
    expect(claimQrCode).not.toHaveBeenCalled();
  });

  it("returns 400 (not 500) for a non-JSON body", async () => {
    // why: raw Request — `request.json()` must throw a SyntaxError here, and
    // the route has to funnel it into the same 400 as a Zod failure instead
    // of leaking a 500 through makeShelfError's unknown-error branch.
    const request = new Request(
      "http://localhost/api/mobile/qr/claim?orgId=org-1",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }
    );
    const result = await action({ request, params: {}, context: {} } as never);
    const { data, init } = result as unknown as DataResult<{
      error?: { message: string };
    }>;

    expect(init?.status).toBe(400);
    expect(data.error?.message).toBe("Invalid request body");
    expect(claimQrCode).not.toHaveBeenCalled();
  });

  it("returns 404 when the QR does not exist", async () => {
    vi.mocked(db.qr.findUnique).mockResolvedValue(null);

    const { body, status } = await callAction({ qrId: "qr-missing" });

    expect(status).toBe(404);
    expect(body.error?.message).toBe("QR code not found");
    expect(claimQrCode).not.toHaveBeenCalled();
  });

  it("returns 403 and never claims an orgless code that is linked to an asset/kit", async () => {
    // why: an orgless-but-linked row is the corrupted state createAsset's
    // loose QR-connect branch can produce; the web claim loader refuses it
    // (`assetId: null, kitId: null` guard) so mobile must too — claiming it
    // would let "Create New Asset" re-parent the QR off its existing asset.
    vi.mocked(db.qr.findUnique).mockResolvedValue({
      id: "qr-1",
      assetId: "asset-linked",
      kitId: null,
    } as any);

    const { body, status } = await callAction({ qrId: "qr-1" });

    expect(status).toBe(403);
    expect(body.error?.message).toBe(
      "This QR code is not available for claiming."
    );
    expect(claimQrCode).not.toHaveBeenCalled();
  });
});
