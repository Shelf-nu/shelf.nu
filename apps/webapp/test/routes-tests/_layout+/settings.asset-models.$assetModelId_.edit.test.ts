/**
 * Action tests for Settings > Asset models > Edit.
 *
 * The action takes two submissions. The `fillLinkedAssets` intent writes to
 * every asset linked to the model, so on top of `assetModel:update` it needs
 * `asset:update`. The model form saves the model and its defaults, then stays
 * on the page only when the save gave the defaults something new to fill on
 * linked assets, so the user sees the card that offers it.
 *
 * @see {@link file://../../../app/routes/_layout+/settings.asset-models.$assetModelId_.edit.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssetModelDefaults } from "~/modules/asset-model/defaults";
import {
  fillLinkedAssetsFromModel,
  getAssetModelDefaults,
  getLinkedAssetsFillSummary,
  getModelDefaultFieldOptions,
  parseModelDefaultsFromFormData,
  saveAssetModelCustomFieldDefaults,
} from "~/modules/asset-model/defaults.server";
import {
  updateAssetModel,
  updateAssetModelImage,
} from "~/modules/asset-model/service.server";
import { action } from "~/routes/_layout+/settings.asset-models.$assetModelId_.edit";
import { ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: React Router v7 single fetch: `data()` outside a request context
// returns an internal wrapper, not a Response. A real Response makes the
// status directly assertable.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: vi.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), { status: init?.status ?? 200 })
    ),
  };
});

// why: the model and its defaults are saved in one transaction; running the
// callback straight away keeps the save observable through the mocked writers.
vi.mock("~/database/db.server", () => ({
  db: {
    $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback({})),
  },
}));

// why: permission resolution reads the membership from the database; each test
// states which permissions the user holds.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the defaults services read and write Prisma and have their own suite
// (`asset-model/defaults.server.test.ts`); here they are the inputs and
// outputs of the action's decisions.
vi.mock("~/modules/asset-model/defaults.server", () => ({
  fillLinkedAssetsFromModel: vi.fn(),
  getAssetModelDefaults: vi.fn(),
  getLinkedAssetsFillSummary: vi.fn(),
  getModelDefaultFieldOptions: vi.fn(),
  parseModelDefaultsFromFormData: vi.fn(),
  saveAssetModelCustomFieldDefaults: vi.fn(),
}));

// why: the model writes are unit-tested in `asset-model/service.server.test.ts`;
// the image update streams to storage.
vi.mock("~/modules/asset-model/service.server", () => ({
  getAssetModel: vi.fn(),
  updateAssetModel: vi.fn(),
  updateAssetModelImage: vi.fn(),
}));

// why: loader-only category lookup behind Prisma; the action never calls it.
vi.mock("~/modules/asset/service.server", () => ({
  getCategoriesForCreateAndEdit: vi.fn(),
}));

// why: notifications go over the event bus; no test here asserts on them.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const requirePermissionMock = vi.mocked(requirePermission);
const getAssetModelDefaultsMock = vi.mocked(getAssetModelDefaults);
const getLinkedAssetsFillSummaryMock = vi.mocked(getLinkedAssetsFillSummary);

/** What the action reads from a granted `requirePermission`. */
const granted = {
  organizationId: "org-1",
  currentOrganization: { id: "org-1", currency: "AUD" },
} as Awaited<ReturnType<typeof requirePermission>>;

/** A model's defaults, as `getAssetModelDefaults` returns them. */
function defaults(defaultValuation: number | null): AssetModelDefaults {
  return {
    id: "model-1",
    name: "Westermo L210",
    defaultCategoryId: null,
    defaultValuation,
    customFieldDefaults: [],
  };
}

/** Posts the given fields to the action. */
async function post(fields: Record<string, string>): Promise<Response> {
  // why: a URLSearchParams body, not FormData: happy-dom's multipart round
  // trip drops empty-valued fields.
  const request = new Request(
    "http://localhost/settings/asset-models/model-1/edit",
    {
      method: "POST",
      body: new URLSearchParams(fields),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );
  // The action answers with a Response on every path these tests take.
  return (await action({
    request,
    params: { assetModelId: "model-1" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof action>[0])) as unknown as Response;
}

/** Posts a plain model save. */
function save() {
  return post({ name: "Westermo L210", defaultValuation: "450" });
}

beforeEach(() => {
  // Reset, not clear: a `mockResolvedValueOnce` left over by one test must
  // not answer the next.
  vi.resetAllMocks();
  requirePermissionMock.mockResolvedValue(granted);
  vi.mocked(fillLinkedAssetsFromModel).mockResolvedValue({
    assetsFilled: 2,
    fieldsFilled: 4,
  });
  vi.mocked(getModelDefaultFieldOptions).mockResolvedValue([]);
  vi.mocked(parseModelDefaultsFromFormData).mockReturnValue([]);
  vi.mocked(updateAssetModelImage).mockResolvedValue(undefined as never);
});

describe("fillLinkedAssets intent", () => {
  it("refuses the fill when the user may not update assets", async () => {
    requirePermissionMock.mockImplementation(async ({ entity, action }) => {
      if (
        entity === PermissionEntity.asset &&
        action === PermissionAction.update
      ) {
        throw new ShelfError({
          cause: null,
          message: "You do not have permission to access this resource",
          label: "Permission",
          status: 403,
          shouldBeCaptured: false,
        });
      }
      return granted;
    });

    const response = await post({ intent: "fillLinkedAssets" });

    expect(response.status).toBe(403);
    expect(fillLinkedAssetsFromModel).not.toHaveBeenCalled();
  });

  it("fills the linked assets when the user may update assets", async () => {
    const response = await post({ intent: "fillLinkedAssets" });

    expect(requirePermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.asset,
        action: PermissionAction.update,
      })
    );
    expect(fillLinkedAssetsFromModel).toHaveBeenCalledWith(
      expect.objectContaining({
        assetModelId: "model-1",
        organizationId: "org-1",
        userId: "user-1",
        currency: "AUD",
      })
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/settings/asset-models/model-1/edit"
    );
  });

  it("answers 400 to an unknown intent and writes nothing", async () => {
    const response = await post({ intent: "somethingElse" });

    expect(response.status).toBe(400);
    expect(fillLinkedAssetsFromModel).not.toHaveBeenCalled();
    expect(updateAssetModel).not.toHaveBeenCalled();
  });
});

describe("model save", () => {
  it("saves the model and its defaults together", async () => {
    getAssetModelDefaultsMock.mockResolvedValue(defaults(450));

    await save();

    expect(updateAssetModel).toHaveBeenCalledWith(
      expect.objectContaining({ id: "model-1", organizationId: "org-1" }),
      {}
    );
    expect(saveAssetModelCustomFieldDefaults).toHaveBeenCalledWith(
      { assetModelId: "model-1", organizationId: "org-1", defaults: [] },
      {}
    );
  });

  it("goes back to the list when the save left the defaults unchanged", async () => {
    getAssetModelDefaultsMock.mockResolvedValue(defaults(450));

    const response = await save();

    expect(response.headers.get("Location")).toBe("/settings/asset-models");
    // Unchanged defaults offer nothing new, so linked assets are not scanned.
    expect(getLinkedAssetsFillSummaryMock).not.toHaveBeenCalled();
  });

  it("stays on the page when the new defaults have something new to fill", async () => {
    getAssetModelDefaultsMock
      .mockResolvedValueOnce(defaults(null))
      .mockResolvedValueOnce(defaults(450));
    getLinkedAssetsFillSummaryMock
      .mockResolvedValueOnce({
        assetCount: 3,
        fields: [{ label: "Valuation", count: 3 }],
      })
      .mockResolvedValueOnce({ assetCount: 0, fields: [] });

    const response = await save();

    expect(response.headers.get("Location")).toBe(
      "/settings/asset-models/model-1/edit"
    );
  });

  it("goes back to the list when the changed defaults have no linked asset to fill", async () => {
    getAssetModelDefaultsMock
      .mockResolvedValueOnce(defaults(null))
      .mockResolvedValueOnce(defaults(450));
    getLinkedAssetsFillSummaryMock.mockResolvedValueOnce({
      assetCount: 0,
      fields: [],
    });

    const response = await save();

    expect(response.headers.get("Location")).toBe("/settings/asset-models");
  });

  it("goes back to the list when the changed defaults fill the same as before", async () => {
    getAssetModelDefaultsMock
      .mockResolvedValueOnce(defaults(300))
      .mockResolvedValueOnce(defaults(450));
    // Both versions fill the same Valuation on the same assets.
    getLinkedAssetsFillSummaryMock.mockResolvedValue({
      assetCount: 2,
      fields: [{ label: "Valuation", count: 3 }],
    });

    const response = await save();

    expect(response.headers.get("Location")).toBe("/settings/asset-models");
  });
});
