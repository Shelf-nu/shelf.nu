/**
 * Route tests for `/api/assets/bulk-update-asset-model`.
 *
 * The service is unit-tested separately; what lives ONLY here is the
 * notification the user actually reads. That copy is assembled from five
 * independent inputs (`linked`, `resolved`, `updated`, `moved`,
 * `skippedQuantityTracked`) into three different titles and three distinct
 * zero-row explanations, and getting it wrong is silent: a mislabelled toast
 * still returns `success: true`, so the dialog closes and the selection clears
 * exactly as it would on a real update.
 *
 * `parseData` and `assertIsPost` are deliberately NOT mocked — the tests post a
 * real request through the real wire schema, so the `assetIds[n]` bracket
 * parsing and the empty-`assetModelId`-means-unlink split are covered too.
 *
 * @see {@link file://./../../app/routes/api+/assets.bulk-update-asset-model.ts}
 * @see {@link file://./../../app/modules/asset/service.server.ts} `bulkUpdateAssetModel`
 */
import { OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BulkUpdateAssetModelResult } from "~/modules/asset/service.server";
import { bulkUpdateAssetModel } from "~/modules/asset/service.server";
import { action } from "~/routes/api+/assets.bulk-update-asset-model";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// why: React Router v7 single fetch — `data()` outside a request context returns
// an internal wrapper, not a Response. Returning a real Response makes status
// and body directly assertable.
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn((payload: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(payload), {
        status: init?.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    })
);

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: the route never touches the database directly; the service does, and it
// is mocked below. An empty client keeps a real Prisma connection out of tests.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: exercising the route's own logic, not the permission system
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the service is unit-tested in modules/asset/service.server.test.ts; here
// it is the input to the message composition, so each test drives its result
vi.mock("~/modules/asset/service.server", () => ({
  bulkUpdateAssetModel: vi.fn(),
}));

// why: index settings only decide simple vs advanced select-all resolution,
// which the service owns — the route just forwards them
vi.mock("~/modules/asset-index-settings/service.server", () => ({
  getAssetIndexSettings: vi.fn().mockResolvedValue({ mode: "SIMPLE" }),
}));

// why: the assertion target. Capturing it beats sending real notifications.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const requirePermissionMock = vi.mocked(requirePermission);
const bulkUpdateAssetModelMock = vi.mocked(bulkUpdateAssetModel);
const sendNotificationMock = vi.mocked(sendNotification);

/**
 * The three fields this route actually destructures from `requirePermission`.
 *
 * Asserted to the real return type instead of `any`: the full result also
 * carries `currentOrganization` / `organizations` / `userOrganizations`, which
 * are Prisma payloads running to ~30 fields the route never reads, so building
 * a complete literal would be noise. The assertion still fails the build if one
 * of these three is renamed or retyped, which the `any` cast would not.
 */
const permissionResult = {
  organizationId: "org-1",
  role: OrganizationRoles.ADMIN,
  canUseBarcodes: false,
} as Awaited<ReturnType<typeof requirePermission>>;

/** Builds the result shape the service returns, with link-success defaults. */
function serviceResult(
  overrides: Partial<BulkUpdateAssetModelResult> = {}
): BulkUpdateAssetModelResult {
  return {
    linked: true,
    resolved: 3,
    updated: 3,
    moved: 0,
    skippedQuantityTracked: 0,
    modelName: "Panasonic PT-VZ580",
    ...overrides,
  };
}

/**
 * Posts a real request through the route and returns its Response.
 *
 * `assetIds` is expanded into the `assetIds[n]` bracket names the dialogs
 * actually submit, so the array parsing is covered rather than assumed.
 */
async function callAction({
  assetIds = ["asset-1"],
  assetModelId = "model-1",
  currentSearchParams = "",
}: {
  assetIds?: string[];
  assetModelId?: string;
  currentSearchParams?: string;
} = {}) {
  // why: a URLSearchParams body, not FormData. happy-dom's multipart serializer
  // DROPS empty-valued fields on the Request round trip, which would silently
  // delete the very field this endpoint uses to mean "unlink" — Node's undici
  // (what the server actually runs) and real browsers both keep it. Url-encoded
  // round-trips faithfully in both, so the tests exercise the real
  // `assertIsPost` + `parseData` + wire-schema path instead of mocking it away.
  const body = new URLSearchParams();
  assetIds.forEach((id, i) => body.append(`assetIds[${i}]`, id));
  body.append("assetModelId", assetModelId);
  body.append("currentSearchParams", currentSearchParams);

  const request = new Request(
    "https://example.com/api/assets/bulk-update-asset-model",
    { method: "POST", body }
  );

  // The `as unknown` hop is required: the route's declared return type is
  // React Router's `DataWithResponseInit`, while the mocked `data()` above
  // hands back a real Response so status and body are assertable.
  return (await action({
    context: { getSession: () => ({ userId: "user-123" }) },
    request,
    params: {},
  } as unknown as ActionFunctionArgs)) as unknown as Response;
}

/**
 * The one notification the route sent. Asserting the count here means a test
 * can never accidentally read the first of several and call it a pass.
 */
function sentNotification() {
  expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  return sendNotificationMock.mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue(permissionResult);
  bulkUpdateAssetModelMock.mockResolvedValue(serviceResult());
});

describe("api/assets/bulk-update-asset-model", () => {
  describe("authorization and forwarding", () => {
    it("requires asset:update — the action is admin/owner territory", async () => {
      await callAction();

      expect(requirePermissionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: PermissionEntity.asset,
          action: PermissionAction.update,
        })
      );
    });

    it("forwards the selection, the model, the active filters and the index mode", async () => {
      // The filters and mode are what turn a cross-page "select all" into the
      // right set of assets. Dropping either silently operates on the wrong one.
      await callAction({
        assetIds: ["asset-1", "asset-2"],
        assetModelId: "model-7",
        currentSearchParams: "category=cat-1&status=AVAILABLE",
      });

      expect(bulkUpdateAssetModelMock).toHaveBeenCalledWith({
        userId: "user-123",
        assetIds: ["asset-1", "asset-2"],
        assetModelId: "model-7",
        organizationId: "org-1",
        currentSearchParams: "category=cat-1&status=AVAILABLE",
        settings: { mode: "SIMPLE" },
      });
    });

    it("passes an empty assetModelId straight through, because that is how removal is requested", async () => {
      bulkUpdateAssetModelMock.mockResolvedValue(
        serviceResult({ linked: false, updated: 1, modelName: null })
      );

      await callAction({ assetModelId: "" });

      expect(bulkUpdateAssetModelMock).toHaveBeenCalledWith(
        expect.objectContaining({ assetModelId: "" })
      );
    });

    it("rejects an empty selection before reaching the service", async () => {
      const response = await callAction({ assetIds: [] });

      expect(response.status).toBe(400);
      expect(bulkUpdateAssetModelMock).not.toHaveBeenCalled();
    });
  });

  describe("link succeeded", () => {
    it("names the model and states the count", async () => {
      const response = await callAction();

      expect(response.status).toBe(200);
      expect(sentNotification()).toMatchObject({
        title: "Assets grouped",
        message: "3 asset(s) were grouped into Panasonic PT-VZ580.",
        icon: { name: "success", variant: "success" },
        senderId: "user-123",
      });
    });

    it("calls out assets taken off another model", async () => {
      // The only signal that a different model's book-by-model pool shrank, so
      // it is stated rather than folded into the total.
      bulkUpdateAssetModelMock.mockResolvedValue(serviceResult({ moved: 1 }));

      await callAction();

      expect(sentNotification().message).toBe(
        "3 asset(s) were grouped into Panasonic PT-VZ580. 1 of them were moved from another asset model."
      );
    });

    it("reports quantity-tracked assets that were skipped", async () => {
      bulkUpdateAssetModelMock.mockResolvedValue(
        serviceResult({ resolved: 5, skippedQuantityTracked: 2 })
      );

      await callAction();

      expect(sentNotification().message).toBe(
        "3 asset(s) were grouped into Panasonic PT-VZ580. 2 quantity-tracked asset(s) were skipped."
      );
    });

    it("states moved before skipped when both apply", async () => {
      bulkUpdateAssetModelMock.mockResolvedValue(
        serviceResult({ resolved: 5, moved: 1, skippedQuantityTracked: 2 })
      );

      await callAction();

      expect(sentNotification().message).toBe(
        "3 asset(s) were grouped into Panasonic PT-VZ580. 1 of them were moved from another asset model. 2 quantity-tracked asset(s) were skipped."
      );
    });

    it("falls back to a generic label when the model has no usable name", async () => {
      // The branch is on `linked`, never on `modelName` — the name is only a
      // label, and a blank one must not flip the sentence to the removal copy.
      bulkUpdateAssetModelMock.mockResolvedValue(
        serviceResult({ modelName: null })
      );

      await callAction();

      expect(sentNotification()).toMatchObject({
        title: "Assets grouped",
        message: "3 asset(s) were grouped into the selected asset model.",
      });
    });
  });

  describe("unlink succeeded", () => {
    it("uses the removal copy and never mentions skipped assets", async () => {
      // A quantity-tracked asset can never have had a model, so counting it as
      // "skipped" here would invent a failure the user did not cause. The
      // service zeroes the count; this pins that the route does not re-add it.
      bulkUpdateAssetModelMock.mockResolvedValue(
        serviceResult({
          linked: false,
          resolved: 2,
          updated: 2,
          modelName: null,
        })
      );

      await callAction({ assetModelId: "" });

      expect(sentNotification()).toMatchObject({
        title: "Assets updated",
        message: "2 asset(s) were removed from their asset model.",
        icon: { name: "success", variant: "success" },
      });
    });
  });

  describe("nothing changed", () => {
    it("says the filters matched nothing when the selection resolved to no assets", async () => {
      bulkUpdateAssetModelMock.mockResolvedValue(
        serviceResult({ resolved: 0, updated: 0, modelName: null })
      );

      const response = await callAction();

      // Still a 200 with `success: true` — the dialog closes on a real
      // outcome, it just must not claim an update happened.
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true });
      expect(sentNotification()).toMatchObject({
        title: "No assets updated",
        message: "Your filters no longer match any assets.",
        icon: { name: "asset-model", variant: "gray" },
      });
    });

    it("says the assets are already on the model when linking changed nothing", async () => {
      bulkUpdateAssetModelMock.mockResolvedValue(
        serviceResult({ resolved: 3, updated: 0 })
      );

      await callAction();

      expect(sentNotification()).toMatchObject({
        title: "No assets updated",
        message: "The selected assets are already in this asset model.",
      });
    });

    it("says none had a model when unlinking changed nothing", async () => {
      bulkUpdateAssetModelMock.mockResolvedValue(
        serviceResult({
          linked: false,
          resolved: 3,
          updated: 0,
          modelName: null,
        })
      );

      await callAction({ assetModelId: "" });

      expect(sentNotification()).toMatchObject({
        title: "No assets updated",
        message: "None of the selected assets were in an asset model.",
      });
    });

    it("still reports the skip alongside the zero-row reason", async () => {
      bulkUpdateAssetModelMock.mockResolvedValue(
        serviceResult({ resolved: 5, updated: 0, skippedQuantityTracked: 2 })
      );

      await callAction();

      expect(sentNotification().message).toBe(
        "The selected assets are already in this asset model. 2 quantity-tracked asset(s) were skipped."
      );
    });
  });

  describe("errors", () => {
    it("preserves the service's status so the eligibility rule reaches the dialog", async () => {
      bulkUpdateAssetModelMock.mockRejectedValue(
        new ShelfError({
          cause: null,
          title: "Asset model not allowed",
          message:
            "All selected assets are quantity-tracked. Asset models can only be linked to individually tracked assets.",
          label: "Assets",
          status: 400,
          shouldBeCaptured: false,
        })
      );

      const response = await callAction();

      expect(response.status).toBe(400);
      // `error()` surfaces the ShelfError's own title and message. Both have to
      // survive, or the user gets "Something went wrong" instead of the rule
      // they broke — which is exactly why the service re-throws its own errors
      // rather than letting the generic wrapper replace the message.
      expect(sentNotification()).toMatchObject({
        title: "Asset model not allowed",
        message: expect.stringContaining("quantity-tracked"),
        icon: { name: "x", variant: "error" },
      });
    });

    it("preserves the 404 raised for a model outside the organization", async () => {
      bulkUpdateAssetModelMock.mockRejectedValue(
        new ShelfError({
          cause: null,
          title: "Invalid asset model",
          message:
            "The selected asset model could not be found in your workspace. Please reload and try again.",
          label: "Assets",
          status: 404,
          shouldBeCaptured: false,
        })
      );

      const response = await callAction({ assetModelId: "foreign-model" });

      expect(response.status).toBe(404);
      expect(sentNotification()).toMatchObject({
        title: "Invalid asset model",
        message: expect.stringContaining("workspace"),
      });
    });
  });
});
