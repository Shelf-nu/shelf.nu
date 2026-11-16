/**
 * POST /api/assets/bulk-update-reorder-point: the permission it is gated on,
 * what reaches `bulkUpdateAssetMinQuantity`, and the confirmation it sends.
 *
 * The workspace always comes from `requirePermission`, never from the form, so
 * a crafted POST cannot write another workspace's thresholds. A blank min
 * quantity clears the threshold. The confirmation reports what changed, not
 * what was asked for, so a selection with nothing to write says so.
 *
 * @see {@link file://./../../../app/routes/api+/assets.bulk-update-reorder-point.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createActionArgs } from "@mocks/remix";

import { bulkUpdateAssetMinQuantity } from "~/modules/asset/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError } from "~/utils/error";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import * as rolesServer from "~/utils/roles.server";

import { action } from "~/routes/api+/assets.bulk-update-reorder-point";

// @vitest-environment node

// why: the permission check reads the session cookie and the database; what it
// is called WITH is the contract under test, and its answer is set per case.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the write behind the route. Its own guards, events and marker sync are
// covered by the asset service tests; here only what reaches it matters.
vi.mock("~/modules/asset/service.server", () => ({
  bulkUpdateAssetMinQuantity: vi.fn(),
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

/** What the dialog posts; any field can be overridden or added. */
type Submission = {
  assetIds: string[];
  minQuantity: string;
  currentSearchParams?: string;
  organizationId?: string;
};

/**
 * Posts the dialog's form. A URLSearchParams body, not FormData: happy-dom
 * drops empty FormData fields, and a blank `minQuantity` is the clear case.
 */
async function submit(
  { assetIds, minQuantity, currentSearchParams, organizationId }: Submission,
  method = "POST"
) {
  // Indexed names, as `BulkUpdateDialogContent` emits them.
  const body = new URLSearchParams({ minQuantity });
  assetIds.forEach((id, i) => body.append(`assetIds[${i}]`, id));
  if (currentSearchParams !== undefined) {
    body.append("currentSearchParams", currentSearchParams);
  }
  if (organizationId !== undefined) {
    body.append("organizationId", organizationId);
  }

  const response = await action(
    createActionArgs({
      request: new Request(
        "http://localhost/api/assets/bulk-update-reorder-point",
        method === "GET" ? { method } : { method, body }
      ),
      context: { getSession: () => ({ userId: "user-1" }) } as never,
    })
  );

  // A success is the bare payload; a refusal is wrapped with its status.
  return response;
}

describe("POST /api/assets/bulk-update-reorder-point", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({
      organizationId: "org-1",
      role: "ADMIN",
      canUseBarcodes: false,
      access: accessFor(["ADMIN"]),
      currentOrganization: { auditsEnabled: true },
    } as never);
    vi.mocked(bulkUpdateAssetMinQuantity).mockResolvedValue(2);
  });

  it("refuses a method other than POST and writes nothing", async () => {
    const response = await submit(
      { assetIds: ["a1"], minQuantity: "5" },
      "GET"
    );

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(405);
    expect(bulkUpdateAssetMinQuantity).not.toHaveBeenCalled();
  });

  it("gates the write on asset: update", async () => {
    await submit({ assetIds: ["a1"], minQuantity: "5" });

    expect(rolesServer.requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        entity: PermissionEntity.asset,
        action: PermissionAction.update,
      })
    );
  });

  it("returns the permission refusal's status and writes nothing", async () => {
    vi.mocked(rolesServer.requirePermission).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "You do not have permission to do this.",
        label: "Permission",
        status: 403,
        shouldBeCaptured: false,
      })
    );

    const response = await submit({ assetIds: ["a1"], minQuantity: "5" });

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(403);
    expect(bulkUpdateAssetMinQuantity).not.toHaveBeenCalled();
  });

  it("writes in the caller's workspace, never one named in the form", async () => {
    const response = await submit({
      assetIds: ["a1", "a2"],
      minQuantity: "5",
      organizationId: "org-attacker",
    });

    expect(response).toMatchObject({ success: true, error: null });
    expect(bulkUpdateAssetMinQuantity).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        userId: "user-1",
        assetIds: ["a1", "a2"],
        minQuantity: 5,
      })
    );
  });

  it("clears the threshold when the min quantity is blank", async () => {
    await submit({ assetIds: ["a1"], minQuantity: "" });

    expect(bulkUpdateAssetMinQuantity).toHaveBeenCalledWith(
      expect.objectContaining({ minQuantity: null })
    );
  });

  it("forwards the live search params for a select-all", async () => {
    await submit({
      assetIds: [ALL_SELECTED_KEY],
      minQuantity: "3",
      currentSearchParams: "stockStatus=is:LOW",
    });

    expect(bulkUpdateAssetMinQuantity).toHaveBeenCalledWith(
      expect.objectContaining({
        assetIds: [ALL_SELECTED_KEY],
        currentSearchParams: "stockStatus=is:LOW",
        minQuantity: 3,
      })
    );
  });

  it("says nothing changed when no asset was written", async () => {
    vi.mocked(bulkUpdateAssetMinQuantity).mockResolvedValue(0);

    await submit({ assetIds: ["a1"], minQuantity: "5" });

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Nothing to change",
        senderId: "user-1",
      })
    );
  });

  it("names one asset in the singular", async () => {
    vi.mocked(bulkUpdateAssetMinQuantity).mockResolvedValue(1);

    await submit({ assetIds: ["a1"], minQuantity: "5" });

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Min quantity set",
        message: expect.stringContaining("Set on 1 asset."),
      })
    );
  });

  it("names several assets in the plural", async () => {
    vi.mocked(bulkUpdateAssetMinQuantity).mockResolvedValue(4);

    await submit({ assetIds: ["a1", "a2", "a3", "a4"], minQuantity: "5" });

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Min quantity set",
        message: expect.stringContaining("Set on 4 assets."),
      })
    );
  });

  it("titles a cleared threshold as cleared", async () => {
    vi.mocked(bulkUpdateAssetMinQuantity).mockResolvedValue(2);

    await submit({ assetIds: ["a1", "a2"], minQuantity: "" });

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Min quantity cleared",
        message: expect.stringContaining("Cleared on 2 assets."),
      })
    );
  });

  it("keeps a service refusal's own status and message", async () => {
    vi.mocked(bulkUpdateAssetMinQuantity).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "Some selected assets are archived.",
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
      })
    );

    const response = await submit({ assetIds: ["a1"], minQuantity: "5" });

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(response.data).toMatchObject({
      error: { message: "Some selected assets are archived." },
    });
    // The refusal's own error toast goes out; a success confirmation must not.
    expect(sendNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({
        icon: expect.objectContaining({ variant: "success" }),
      })
    );
  });
});
