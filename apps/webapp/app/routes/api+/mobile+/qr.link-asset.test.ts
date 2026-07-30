import { beforeEach, describe, expect, it, vi } from "vitest";

// why: the route reads the QR state via `db.qr.findUnique` and the real
// `assertAssetsBelongToOrg` guard reads `db.asset.findMany`; stubbing just
// those avoids the real Prisma client (no DB in unit tests) while keeping
// the org-ownership guard's actual comparison logic in play.
vi.mock("~/database/db.server", () => ({
  db: {
    qr: { findUnique: vi.fn() },
    asset: { findMany: vi.fn() },
  },
}));

// why: `mobile-auth.server` transitively loads the Supabase admin client
// (needs env + network wiring we don't have in unit tests). The route only
// calls these three gate functions.
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
}));

// why: `updateAssetQrCode` is the web-parity service the web link route uses;
// the module it lives in is huge and drags in storage/email integrations at
// import time. The route's observable job is gating + state guards, so the
// write itself is stubbed.
vi.mock("~/modules/asset/service.server", () => ({
  updateAssetQrCode: vi.fn(),
}));

import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { updateAssetQrCode } from "~/modules/asset/service.server";
import { ShelfError } from "~/utils/error";
import { action } from "./qr.link-asset";

/**
 * Tests for POST /api/mobile/qr/link-asset — the native takeover of the web
 * link-existing flow. Asserts observable branching: the QR state guards
 * (not found / unclaimed / other org / already linked), the org-scoping of
 * the user-supplied assetId, and the success envelope.
 *
 * @see {@link file://./qr.link-asset.ts}
 */

/** Shape of the `data()` result the route action returns. */
type DataResult<T> = { data: T; init: ResponseInit | null };

/** Runs the action with a JSON body and unwraps the data() envelope. */
async function callAction(body: unknown) {
  const request = new Request(
    "http://localhost/api/mobile/qr/link-asset?orgId=org-1",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const result = await action({ request, params: {}, context: {} } as never);
  const { data, init } = result as unknown as DataResult<{
    qr?: { id: string; organizationId: string | null; assetId: string | null };
    error?: { message: string; reason?: string; qrId?: string };
  }>;
  return { body: data, status: init?.status ?? 200 };
}

/** Sets up the QR row the route will read. */
function mockQr(
  qr: {
    id: string;
    organizationId: string | null;
    assetId: string | null;
    kitId: string | null;
  } | null
) {
  // why: cast — the route selects a narrow shape, not the full Qr row.
  vi.mocked(db.qr.findUnique).mockResolvedValue(qr as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: { id: "user-1" },
  } as any);
  vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
  vi.mocked(requireMobilePermission).mockResolvedValue(undefined);
  // why: assertAssetsBelongToOrg compares found rows against the requested
  // ids; echoing them back makes the guard pass by default so each denial
  // test overrides only the branch it exercises.
  vi.mocked(db.asset.findMany).mockImplementation(
    (args: any) =>
      Promise.resolve(
        (args?.where?.id?.in ?? []).map((id: string) => ({ id }))
      ) as any
  );
  vi.mocked(updateAssetQrCode).mockResolvedValue({} as any);
});

describe("POST /api/mobile/qr/link-asset", () => {
  it("links a claimed-but-unlinked QR to an org asset and returns the qr summary", async () => {
    mockQr({
      id: "qr-1",
      organizationId: "org-1",
      assetId: null,
      kitId: null,
    });

    const { body, status } = await callAction({
      qrId: "qr-1",
      assetId: "asset-1",
    });

    expect(status).toBe(200);
    expect(body).toEqual({
      qr: {
        id: "qr-1",
        organizationId: "org-1",
        assetId: "asset-1",
        kitId: null,
      },
    });
    // The write is org-scoped to the caller's resolved org (same service
    // call as the web link route).
    expect(updateAssetQrCode).toHaveBeenCalledWith({
      newQrId: "qr-1",
      assetId: "asset-1",
      organizationId: "org-1",
    });
  });

  it("returns 404 when the QR does not exist", async () => {
    mockQr(null);

    const { body, status } = await callAction({
      qrId: "qr-missing",
      assetId: "asset-1",
    });

    expect(status).toBe(404);
    expect(body.error?.message).toBe("QR code not found");
    expect(updateAssetQrCode).not.toHaveBeenCalled();
  });

  it("returns 400 with reason 'unclaimed' when the QR has no organization yet", async () => {
    mockQr({ id: "qr-1", organizationId: null, assetId: null, kitId: null });

    const { body, status } = await callAction({
      qrId: "qr-1",
      assetId: "asset-1",
    });

    expect(status).toBe(400);
    expect(body.error).toEqual({
      message: "This QR code is not claimed yet. Claim it before linking.",
      reason: "unclaimed",
      qrId: "qr-1",
    });
    expect(updateAssetQrCode).not.toHaveBeenCalled();
  });

  it("returns 403 when the QR belongs to a different organization", async () => {
    mockQr({
      id: "qr-1",
      organizationId: "org-other",
      assetId: null,
      kitId: null,
    });

    const { body, status } = await callAction({
      qrId: "qr-1",
      assetId: "asset-1",
    });

    expect(status).toBe(403);
    expect(body.error?.message).toBe(
      "This QR code doesn't belong to your current organization."
    );
    expect(updateAssetQrCode).not.toHaveBeenCalled();
  });

  it("returns 403 when the QR is already linked to an asset or kit", async () => {
    mockQr({
      id: "qr-1",
      organizationId: "org-1",
      assetId: "asset-linked",
      kitId: null,
    });

    const { body, status } = await callAction({
      qrId: "qr-1",
      assetId: "asset-1",
    });

    expect(status).toBe(403);
    expect(body.error?.message).toBe(
      "This QR code is already linked to an asset or a kit."
    );
    expect(updateAssetQrCode).not.toHaveBeenCalled();
  });

  it("rejects an assetId that is not in the caller's org (cross-org IDOR)", async () => {
    mockQr({
      id: "qr-1",
      organizationId: "org-1",
      assetId: null,
      kitId: null,
    });
    // why: simulate the asset living in another org — the org-scoped lookup
    // finds nothing, so the shared guard must reject before any write.
    vi.mocked(db.asset.findMany).mockResolvedValue([] as any);

    const { body, status } = await callAction({
      qrId: "qr-1",
      assetId: "asset-of-org-b",
    });

    expect(status).toBe(400);
    expect(body.error?.message).toContain(
      "Some of the selected assets do not exist in your workspace"
    );
    expect(updateAssetQrCode).not.toHaveBeenCalled();
  });

  it("returns 403 and never links when the caller lacks qr:update (non-admin/owner)", async () => {
    vi.mocked(requireMobilePermission).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "You have no permission to perform this action",
        label: "Permission",
        status: 403,
      })
    );

    const { body, status } = await callAction({
      qrId: "qr-1",
      assetId: "asset-1",
    });

    expect(status).toBe(403);
    expect(updateAssetQrCode).not.toHaveBeenCalled();
    expect(body.error?.message).toBe(
      "You have no permission to perform this action"
    );
  });

  it("returns 400 for a body missing assetId", async () => {
    const { body, status } = await callAction({ qrId: "qr-1" });

    expect(status).toBe(400);
    expect(body.error?.message).toBe("Invalid request body");
    expect(updateAssetQrCode).not.toHaveBeenCalled();
  });

  it("returns 400 (not 500) for a non-JSON body", async () => {
    // why: raw Request — `request.json()` must throw a SyntaxError here, and
    // the route has to funnel it into the same 400 as a Zod failure instead
    // of leaking a 500 through makeShelfError's unknown-error branch.
    const request = new Request(
      "http://localhost/api/mobile/qr/link-asset?orgId=org-1",
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
    expect(updateAssetQrCode).not.toHaveBeenCalled();
  });
});
