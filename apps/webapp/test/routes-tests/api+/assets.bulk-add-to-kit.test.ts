/**
 * POST /api/assets/bulk-add-to-kit: which assets the route hands to the kit.
 *
 * "Select all" posts the loaded rows plus a marker and means every asset the
 * list's filters match. The route has to expand it from the submitted search
 * params; adding only the posted ids would cut the selection to one page while
 * the dialog and the toast read as if the whole selection was handled.
 * Quantity-tracked assets are left out and counted in the toast.
 *
 * @see {@link file://./../../../app/routes/api+/assets.bulk-add-to-kit.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { accessFor } from "@helpers/role-access";
import { createActionArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import { resolveAssetIdsForBulkOperation } from "~/modules/asset/bulk-operations-helper.server";
import { updateKitAssets } from "~/modules/kit/service.server";
import { action } from "~/routes/api+/assets.bulk-add-to-kit";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ALL_SELECTED_KEY } from "~/utils/list";
import * as rolesServer from "~/utils/roles.server";

// @vitest-environment node

// why: the permission check reads the session cookie and the database.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the type split is a database read; each case states which of the
// resolved assets are quantity-tracked.
vi.mock("~/database/db.server", () => ({
  db: { asset: { findMany: vi.fn() }, kit: { findMany: vi.fn() } },
}));

// why: expanding "select all" runs the asset index query. What it is called
// with, and that its answer is what reaches the kit, is the contract here.
vi.mock("~/modules/asset/bulk-operations-helper.server", () => ({
  resolveAssetIdsForBulkOperation: vi.fn(),
}));

// why: the write behind the route, covered by the kit service tests.
vi.mock("~/modules/kit/service.server", () => ({
  updateKitAssets: vi.fn(),
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

/** Posts the dialog's form for the given asset ids. */
async function submit(assetIds: string[], currentSearchParams = "") {
  const body = new URLSearchParams({ kit: "kit-1", currentSearchParams });
  assetIds.forEach((id, i) => body.append(`assetIds[${i}]`, id));

  const response = await action(
    createActionArgs({
      request: new Request("http://localhost/api/assets/bulk-add-to-kit", {
        method: "POST",
        body,
      }),
      context: { getSession: () => ({ userId: "user-1" }) } as never,
    })
  );

  assertIsDataWithResponseInit(response);
  return response;
}

describe("POST /api/assets/bulk-add-to-kit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({
      organizationId: "org-1",
      role: "ADMIN",
      canUseBarcodes: false,
      access: accessFor(["ADMIN"]),
      currentOrganization: { auditsEnabled: true },
    } as never);
    vi.mocked(updateKitAssets).mockResolvedValue({
      name: "ZZ Test Kit",
    } as never);
  });

  it("adds every asset the select-all resolves to, not only the posted rows", async () => {
    // Page 1 held a1 and a2; the filters match a3 and a pool on other pages.
    vi.mocked(resolveAssetIdsForBulkOperation).mockResolvedValue([
      "a1",
      "a2",
      "a3",
      "pool-1",
    ]);
    vi.mocked(db.asset.findMany).mockResolvedValue([
      { id: "a1", type: "INDIVIDUAL" },
      { id: "a2", type: "INDIVIDUAL" },
      { id: "a3", type: "INDIVIDUAL" },
      { id: "pool-1", type: "QUANTITY_TRACKED" },
    ] as never);

    await submit(["a1", "a2", ALL_SELECTED_KEY], "status=AVAILABLE");

    expect(resolveAssetIdsForBulkOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        assetIds: ["a1", "a2", ALL_SELECTED_KEY],
        organizationId: "org-1",
        currentSearchParams: "status=AVAILABLE",
      })
    );
    expect(updateKitAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        kitId: "kit-1",
        assetIds: ["a1", "a2", "a3"],
        addOnly: true,
      })
    );
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "1 quantity-tracked asset(s) were skipped"
        ),
      })
    );
  });

  it("adds hand-picked assets as posted", async () => {
    vi.mocked(resolveAssetIdsForBulkOperation).mockResolvedValue(["a1", "a2"]);
    vi.mocked(db.asset.findMany).mockResolvedValue([
      { id: "a1", type: "INDIVIDUAL" },
      { id: "a2", type: "INDIVIDUAL" },
    ] as never);

    await submit(["a1", "a2"]);

    expect(updateKitAssets).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: ["a1", "a2"] })
    );
  });

  it("refuses a selection that is all quantity-tracked", async () => {
    vi.mocked(resolveAssetIdsForBulkOperation).mockResolvedValue(["pool-1"]);
    vi.mocked(db.asset.findMany).mockResolvedValue([
      { id: "pool-1", type: "QUANTITY_TRACKED" },
    ] as never);

    const response = await submit(["pool-1"]);

    expect(response.init?.status).toBe(400);
    expect(response.data).toMatchObject({
      error: { message: expect.stringContaining("quantity-tracked") },
    });
    expect(updateKitAssets).not.toHaveBeenCalled();
  });
});
