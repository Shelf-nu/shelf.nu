/**
 * POST /api/assets/bulk-update-location: what the route asks the service to do
 * with quantity-tracked assets, per caller.
 *
 * Two callers share this route. The asset index dialog warns about
 * quantity-tracked assets before the user confirms and relies on the service
 * skipping them. The scanner drawer submits an explicit list and shows one
 * result for it, so it asks for the list to be refused instead. The route is
 * the only place that choice is made, and a scanner request that lost it would
 * save the rest of the list under a success notification.
 *
 * @see {@link file://./../../../app/routes/api+/assets.bulk-update-location.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { accessFor } from "@helpers/role-access";
import { createActionArgs } from "@mocks/remix";

import { bulkUpdateAssetLocation } from "~/modules/asset/service.server";
import { action } from "~/routes/api+/assets.bulk-update-location";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError } from "~/utils/error";
import * as rolesServer from "~/utils/roles.server";

// @vitest-environment node

// why: the permission check reads the session cookie and the database.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the write behind the route. Its own rules are covered by the asset
// service tests; here only what it is called with matters.
vi.mock("~/modules/asset/service.server", () => ({
  bulkUpdateAssetLocation: vi.fn(),
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

/** Posts the form with the given extra fields over two asset ids. */
async function submit(extra: Record<string, string> = {}) {
  const body = new URLSearchParams({ newLocationId: "loc-1", ...extra });
  ["a1", "pool-1"].forEach((id, i) => body.append(`assetIds[${i}]`, id));

  const response = await action(
    createActionArgs({
      request: new Request("http://localhost/api/assets/bulk-update-location", {
        method: "POST",
        body,
      }),
      context: { getSession: () => ({ userId: "user-1" }) } as never,
    })
  );

  assertIsDataWithResponseInit(response);
  return response;
}

describe("POST /api/assets/bulk-update-location", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({
      organizationId: "org-1",
      role: "ADMIN",
      canUseBarcodes: false,
      access: accessFor(["ADMIN"]),
      currentOrganization: { auditsEnabled: true },
    } as never);
    vi.mocked(bulkUpdateAssetLocation).mockResolvedValue({
      success: true,
      skippedQuantityTracked: 0,
    });
  });

  it("asks the service to refuse quantity-tracked assets when the scanner says so", async () => {
    await submit({ quantityTracked: "refuse" });

    expect(bulkUpdateAssetLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        assetIds: ["a1", "pool-1"],
        newLocationId: "loc-1",
        quantityTracked: "refuse",
      })
    );
  });

  it("leaves the choice to the service's default for the asset index dialog", async () => {
    // The dialog sends no `quantityTracked`, and the service then skips.
    await submit();

    expect(bulkUpdateAssetLocation).toHaveBeenCalledWith(
      expect.objectContaining({ quantityTracked: undefined })
    );
  });

  it("answers the refusal as an error and sends no success notification", async () => {
    vi.mocked(bulkUpdateAssetLocation).mockRejectedValue(
      new ShelfError({
        cause: null,
        message:
          "1 quantity-tracked asset can't be moved this way, so no assets were moved: ZZ Test Cables.",
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
      })
    );

    const response = await submit({ quantityTracked: "refuse" });

    expect(response.init?.status).toBe(400);
    expect(response.data).toMatchObject({
      error: { message: expect.stringContaining("ZZ Test Cables") },
    });
    // The error itself is surfaced as a notification, so only the success
    // one must be absent.
    expect(sendNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Assets updated" })
    );
  });

  it("says how many quantity-tracked assets the save skipped", async () => {
    // The dialog can only count the rows it has loaded, and "select all"
    // reaches rows on other pages, so this notification carries the real
    // number.
    vi.mocked(bulkUpdateAssetLocation).mockResolvedValue({
      success: true,
      skippedQuantityTracked: 3,
    });

    await submit();

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Assets updated",
        message: expect.stringContaining(
          "3 quantity-tracked asset(s) were skipped"
        ),
      })
    );
  });

  it("adds nothing to the notification when no asset was skipped", async () => {
    await submit();

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Your assets' locations have been successfully updated.",
      })
    );
  });

  it("rejects a value it does not know", async () => {
    const response = await submit({ quantityTracked: "move-anyway" });

    expect(response.init?.status).toBe(400);
    expect(bulkUpdateAssetLocation).not.toHaveBeenCalled();
  });
});
