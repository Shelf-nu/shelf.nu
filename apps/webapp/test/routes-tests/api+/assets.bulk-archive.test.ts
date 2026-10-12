/**
 * POST /api/assets/bulk-archive: the permission it is gated on and the service
 * each `type` reaches (issue #382).
 *
 * Archiving and reinstating share one grant, `asset: archive`. ADMIN and OWNER
 * hold it; BASE and SELF_SERVICE do not. The gate is pinned here because
 * nothing else would notice it drifting: the UI hides the menu items from
 * roles without the grant, so a looser server gate still looks right in the
 * browser while a crafted POST walks straight through it.
 *
 * @see {@link file://./../../../app/routes/api+/assets.bulk-archive.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createActionArgs } from "@mocks/remix";

import {
  bulkArchiveAssets,
  bulkUnarchiveAssets,
} from "~/modules/asset/service.server";
import { ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import * as rolesServer from "~/utils/roles.server";

import { action } from "~/routes/api+/assets.bulk-archive";

// @vitest-environment node

// why: the permission check reads the session cookie and the database; what it
// is called WITH is the contract under test, and its answer is set per case.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the writes behind the route. Their own guards and events are covered by
// the asset service tests; here only which one is reached matters.
vi.mock("~/modules/asset/service.server", () => ({
  bulkArchiveAssets: vi.fn(),
  bulkUnarchiveAssets: vi.fn(),
}));

// why: reads the caller's column preferences from the database; the route only
// passes them through to resolve a "select all".
vi.mock("~/modules/asset-index-settings/service.server", () => ({
  getAssetIndexSettings: vi.fn().mockResolvedValue({ mode: "SIMPLE" }),
}));

// why: reads the acting user's date preferences from the database.
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn().mockResolvedValue({ timeZone: "UTC" }),
}));

// why: pushes to a server-sent-events emitter with no test transport.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

/** Posts the dialog's form for `type` over `assetIds`. */
async function submit(type: "archive" | "reinstate", assetIds: string[]) {
  // Indexed names, as `BulkUpdateDialogContent` emits them.
  const body = new URLSearchParams({ type });
  assetIds.forEach((id, i) => body.append(`assetIds[${i}]`, id));

  const response = await action(
    createActionArgs({
      request: new Request("http://localhost/api/assets/bulk-archive", {
        method: "POST",
        body,
      }),
      context: { getSession: () => ({ userId: "user-1" }) } as never,
    })
  );

  assertIsDataWithResponseInit(response);
  return response;
}

describe("POST /api/assets/bulk-archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({
      organizationId: "org-1",
      role: "ADMIN",
      canUseBarcodes: false,
      access: accessFor(["ADMIN"]),
    } as never);
    vi.mocked(bulkArchiveAssets).mockResolvedValue({
      archivedCount: 2,
      skippedCount: 0,
    });
    vi.mocked(bulkUnarchiveAssets).mockResolvedValue({
      unarchivedCount: 2,
      skippedCount: 0,
    });
  });

  it.each(["archive", "reinstate"] as const)(
    "gates %s on asset: archive, not asset: update",
    async (type) => {
      await submit(type, ["a1", "a2"]);

      expect(rolesServer.requirePermission).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: PermissionEntity.asset,
          action: PermissionAction.archive,
        })
      );
    }
  );

  it("archives the selection in the caller's workspace", async () => {
    const response = await submit("archive", ["a1", "a2"]);

    expect(response.init?.status ?? 200).toBe(200);
    expect(response.data).toMatchObject({ success: true });
    expect(bulkArchiveAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        assetIds: ["a1", "a2"],
        actorUserId: "user-1",
      })
    );
    expect(bulkUnarchiveAssets).not.toHaveBeenCalled();
  });

  it("reinstates the selection in the caller's workspace", async () => {
    const response = await submit("reinstate", ["a1", "a2"]);

    expect(response.init?.status ?? 200).toBe(200);
    expect(bulkUnarchiveAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        assetIds: ["a1", "a2"],
        actorUserId: "user-1",
      })
    );
    expect(bulkArchiveAssets).not.toHaveBeenCalled();
  });

  it("refuses a caller without the grant and writes nothing", async () => {
    // A BASE or SELF_SERVICE member posting the form by hand.
    vi.mocked(rolesServer.requirePermission).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "You do not have permission to do this.",
        label: "Permission",
        status: 403,
        shouldBeCaptured: false,
      })
    );

    const response = await submit("archive", ["a1"]);

    expect(response.init?.status).toBe(403);
    expect(bulkArchiveAssets).not.toHaveBeenCalled();
    expect(bulkUnarchiveAssets).not.toHaveBeenCalled();
  });

  it("keeps a service refusal's own status and message", async () => {
    // e.g. an invalid advanced filter behind a "select all" — the user should
    // read why, not a generic failure.
    vi.mocked(bulkArchiveAssets).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "That filter can't be applied.",
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
      })
    );

    const response = await submit("archive", ["a1"]);

    expect(response.init?.status).toBe(400);
    expect(response.data).toMatchObject({
      error: { message: "That filter can't be applied." },
    });
  });
});
