/**
 * Tests for the action of `qr+/_private+/$qrId_.link.kit`.
 *
 * This route is the second door to "attach this QR to this kit" — the first is
 * the relink action on the kit detail page. Both must refuse the same things,
 * because the QR id arrives in the URL and nothing upstream vouches for it:
 * the route tree has no layout loader, and `$qrId_` does not nest under one.
 *
 * The cases below run the REAL `relinkKitQrCode` against a stubbed database
 * rather than asserting that a mocked service was called, so they fail if the
 * route stops delegating to it OR if the service's own guards regress.
 *
 * @see {@link file://../../../../app/routes/qr+/_private+/$qrId_.link.kit.tsx}
 * @see {@link file://../../../../app/modules/kit/service.server.ts} relinkKitQrCode
 */
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: React Router v7 single fetch returns `data()` envelopes, not Responses,
// so the status a failed action reports is otherwise unreadable in a test.
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (payload: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(payload), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    )
);

const dataMock = vi.hoisted(createDataMock);
const qrMocks = vi.hoisted(() => ({ getQr: vi.fn() }));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, data: dataMock };
});

// why: the guard under test reads the QR by id; this is how each case states
// which QR the URL pointed at (another org's, an already-linked one, a free one).
vi.mock("~/modules/qr/service.server", () => ({
  getQr: qrMocks.getQr,
}));

// why: authorization is covered by the loader suite; here it only needs to
// resolve to the caller's organization so the guard has something to compare.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi
    .fn()
    .mockResolvedValue({ organizationId: "org-1", role: "ADMIN" }),
}));

// why: the writes are what these cases assert on — that a refused link performs
// none of them — so the delegates are stubs rather than a real connection.
vi.mock("~/database/db.server", () => ({
  db: {
    kit: {
      findFirst: vi.fn().mockResolvedValue({ qrCodes: [{ id: "old-qr" }] }),
      update: vi.fn().mockResolvedValue({}),
    },
    qr: { update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(),
  },
}));

import { db } from "~/database/db.server";
import { action } from "~/routes/qr+/_private+/$qrId_.link.kit";

const linkRequest = () =>
  new Request("http://localhost/qr/qr-target/link/kit", {
    method: "POST",
    body: new URLSearchParams({ kitId: "kit-1" }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

const runAction = (request: Request) =>
  action({
    request,
    params: { qrId: "qr-target" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as ActionFunctionArgs) as unknown as Promise<Response>;

describe("qr+/_private+/$qrId_.link.kit action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.kit.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      qrCodes: [{ id: "old-qr" }],
    });
    (db.kit.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (db.qr.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    // The guard runs its writes inside a transaction, so the body has to
    // execute against the same stubbed delegates the assertions read.
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      (callback: (tx: typeof db) => unknown) => callback(db)
    );
  });

  it("refuses a QR that belongs to another organization", async () => {
    qrMocks.getQr.mockResolvedValue({
      id: "qr-target",
      organizationId: "org-2",
      assetId: null,
      kitId: null,
    });

    const response = await runAction(linkRequest());

    expect(response.status).toBe(403);
    // Nothing may be written: the kit must not end up holding another
    // tenant's code, and that code must not be re-pointed at this kit.
    expect(db.kit.update).not.toHaveBeenCalled();
    expect(db.qr.update).not.toHaveBeenCalled();
  });

  it("refuses a QR that is already linked to an asset", async () => {
    qrMocks.getQr.mockResolvedValue({
      id: "qr-target",
      organizationId: "org-1",
      assetId: "asset-9",
      kitId: null,
    });

    const response = await runAction(linkRequest());

    expect(response.status).toBe(403);
    expect(db.kit.update).not.toHaveBeenCalled();
  });

  it("links a free QR and claims it for the organization", async () => {
    qrMocks.getQr.mockResolvedValue({
      id: "qr-target",
      organizationId: null,
      assetId: null,
      kitId: null,
    });

    const response = await runAction(linkRequest());

    // A redirect, not an error envelope.
    expect(response.status).toBe(302);
    expect(db.qr.update).toHaveBeenCalled();
    expect(db.kit.update).toHaveBeenCalled();
  });
});
