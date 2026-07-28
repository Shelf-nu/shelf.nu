import { beforeEach, describe, expect, it, vi } from "vitest";

// why: the real `assertAssetsBelongToOrg` guard reads `db.asset.findMany`;
// stubbing just that avoids the real Prisma client (no DB in unit tests)
// while keeping the org-ownership guard's actual comparison logic in play.
vi.mock("~/database/db.server", () => ({
  db: {
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

// why: `relinkAssetQrCode` owns ALL QR-state guards + the audit note + the
// inline claim (same service as the web asset-detail relink action); the
// module it lives in is huge and drags in storage/email integrations at
// import time. The route's observable job is gating + delegation + error
// mapping, so the service is stubbed and its guard errors are simulated.
vi.mock("~/modules/asset/service.server", () => ({
  relinkAssetQrCode: vi.fn(),
}));

import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { relinkAssetQrCode } from "~/modules/asset/service.server";
import { ShelfError } from "~/utils/error";
import { action } from "./qr.link-asset";

/**
 * Tests for POST /api/mobile/qr/link-asset — the native takeover of the web
 * link-existing flow, delegating to the shared `relinkAssetQrCode` service.
 * Asserts observable branching: gating, body validation, org-scoping of the
 * user-supplied assetId, delegation with the caller's resolved org, and the
 * pass-through of the service's guard errors (404 / wrong-org 403 /
 * already-linked 403).
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
  // why: assertAssetsBelongToOrg compares found rows against the requested
  // ids; echoing them back makes the guard pass by default so each denial
  // test overrides only the branch it exercises.
  vi.mocked(db.asset.findMany).mockImplementation(
    (args: any) =>
      Promise.resolve(
        (args?.where?.id?.in ?? []).map((id: string) => ({ id }))
      ) as any
  );
  vi.mocked(relinkAssetQrCode).mockResolvedValue(undefined as never);
});

describe("POST /api/mobile/qr/link-asset", () => {
  it("delegates to relinkAssetQrCode with the caller's resolved org and returns the qr summary", async () => {
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
    // Same guarded service as the web asset-detail relink action; org and
    // user always come from the verified session, never the body.
    expect(relinkAssetQrCode).toHaveBeenCalledWith({
      qrId: "qr-1",
      assetId: "asset-1",
      organizationId: "org-1",
      userId: "user-1",
    });
  });

  it("maps the service's not-found error to a 404", async () => {
    vi.mocked(relinkAssetQrCode).mockRejectedValue(
      new ShelfError({
        cause: null,
        message:
          "This code doesn't exist or it doesn't belong to your current organization.",
        label: "QR",
        status: 404,
      })
    );

    const { body, status } = await callAction({
      qrId: "qr-missing",
      assetId: "asset-1",
    });

    expect(status).toBe(404);
    expect(body.error?.message).toBe(
      "This code doesn't exist or it doesn't belong to your current organization."
    );
  });

  it("maps the service's wrong-org guard to a 403", async () => {
    vi.mocked(relinkAssetQrCode).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "This QR code does not belong to your organization",
        label: "QR",
        status: 403,
      })
    );

    const { body, status } = await callAction({
      qrId: "qr-of-org-b",
      assetId: "asset-1",
    });

    expect(status).toBe(403);
    expect(body.error?.message).toBe(
      "This QR code does not belong to your organization"
    );
  });

  it("maps the service's already-linked guard to its error", async () => {
    vi.mocked(relinkAssetQrCode).mockRejectedValue(
      new ShelfError({
        cause: null,
        message:
          "You cannot link to this code because its already linked to another asset. Delete the other asset to free up the code and try again.",
        label: "QR",
        status: 500,
      })
    );

    const { body } = await callAction({
      qrId: "qr-linked",
      assetId: "asset-1",
    });

    expect(body.error?.message).toContain("already linked to another asset");
  });

  it("rejects an assetId that is not in the caller's org (cross-org IDOR) before delegating", async () => {
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
    expect(relinkAssetQrCode).not.toHaveBeenCalled();
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
    expect(relinkAssetQrCode).not.toHaveBeenCalled();
    expect(body.error?.message).toBe(
      "You have no permission to perform this action"
    );
  });

  it("returns 400 for a body missing assetId", async () => {
    const { body, status } = await callAction({ qrId: "qr-1" });

    expect(status).toBe(400);
    expect(body.error?.message).toBe("Invalid request body");
    expect(relinkAssetQrCode).not.toHaveBeenCalled();
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
    expect(relinkAssetQrCode).not.toHaveBeenCalled();
  });
});
