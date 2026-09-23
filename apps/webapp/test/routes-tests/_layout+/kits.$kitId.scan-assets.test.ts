/**
 * Kit scan-assets: the scanner adds, it never replaces.
 *
 * The drawer is additive — an operator scans items to put INTO the kit — so the
 * write has to be additive too. Submitting a full desired membership would make
 * the kit's contents at the moment the page loaded authoritative, and anything a
 * colleague added while the scanner was open would be removed by the diff.
 *
 * @see {@link file://./../../../app/routes/_layout+/kits.$kitId.scan-assets.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { updateKitAssets } from "~/modules/kit/service.server";
import * as rolesServer from "~/utils/roles.server";

import { action } from "~/routes/_layout+/kits.$kitId.scan-assets";

// @vitest-environment node

// why: the route imports the real Prisma client transitively; the only write it
// makes goes through the service stubbed below.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the permission check reads the session cookie and the database.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the write under test. What it is called with IS the assertion.
vi.mock("~/modules/kit/service.server", () => ({ updateKitAssets: vi.fn() }));

// why: pushes to a server-sent-events emitter with no test transport.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

async function submit(body: URLSearchParams) {
  return action(
    createActionArgs({
      request: new Request("http://localhost/kits/kit-1/scan-assets", {
        method: "POST",
        body,
      }),
      params: { kitId: "kit-1" },
      context: { getSession: () => ({ userId: "user-1" }) } as never,
    })
  );
}

describe("kit scan-assets action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({
      organizationId: "org-1",
      role: "ADMIN",
    } as never);
    vi.mocked(updateKitAssets).mockResolvedValue({
      id: "kit-1",
      name: "Camera kit",
    } as never);
  });

  it("adds without removing, so a concurrently added asset survives", async () => {
    // Indexed names, as `ConfigurableDrawer` emits them — `Object.fromEntries`
    // keeps only the last value of a repeated key, so a bare `assetIds[]`
    // submits one id and quietly under-tests everything downstream.
    const body = new URLSearchParams({
      "assetIds[0]": "scanned-1",
      "assetIds[1]": "scanned-2",
    });

    await submit(body);

    expect(updateKitAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        kitId: "kit-1",
        organizationId: "org-1",
        assetIds: ["scanned-1", "scanned-2"],
        addOnly: true,
      })
    );
  });

  it("cannot remove anything even if the client submits a membership list", async () => {
    // Defence in depth, and the reason the guard belongs on the server: the
    // drawer sends what it believed the kit held when the page loaded. If that
    // snapshot is stale, a replace-shaped write deletes whatever it missed. A
    // payload shaped like a full membership must still add only.
    const body = new URLSearchParams({
      "assetIds[0]": "member-from-page-load",
      "assetIds[1]": "scanned-1",
    });

    await submit(body);

    const call = vi.mocked(updateKitAssets).mock.calls[0][0];
    expect(call.addOnly).toBe(true);
  });

  it("passes the per-asset quantities through", async () => {
    const body = new URLSearchParams({
      "assetIds[0]": "qt-1",
      assetQuantities: JSON.stringify({ "qt-1": 3 }),
    });

    await submit(body);

    expect(updateKitAssets).toHaveBeenCalledWith(
      expect.objectContaining({ assetQuantities: { "qt-1": 3 } })
    );
  });
});
