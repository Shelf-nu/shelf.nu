/**
 * Route tests for `/api/assets/bulk-update-custom-field`.
 *
 * The service is unit-tested separately. What lives here is the wire contract:
 * the GET payload the dialog reads (`customFields`), how the POST body is
 * parsed into the service call (including the default mode), and the toast.
 *
 * `parseData` and `assertIsPost` are not mocked, so the real wire schema runs.
 *
 * @see {@link file://./../../app/routes/api+/assets.bulk-update-custom-field.ts}
 * @see {@link file://./../../app/modules/asset/bulk-custom-field.server.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";

import {
  bulkSetAssetCustomField,
  getBulkSettableCustomFields,
} from "~/modules/asset/bulk-custom-field.server";
import { action, loader } from "~/routes/api+/assets.bulk-update-custom-field";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError } from "~/utils/error";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// why: React Router v7 single fetch: `data()` outside a request context returns
// an internal wrapper. A real Response makes status and body assertable.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: vi.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    ),
  };
});

// why: the route never touches the database directly; the service does.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: exercising the route's own logic, not the permission system.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the service is unit-tested in modules/asset; here it is the input.
vi.mock("~/modules/asset/bulk-custom-field.server", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "~/modules/asset/bulk-custom-field.server"
  );
  return {
    ...actual,
    bulkSetAssetCustomField: vi.fn(),
    getBulkSettableCustomFields: vi.fn(),
  };
});

// why: index settings only decide select-all resolution, which the service owns.
vi.mock("~/modules/asset-index-settings/service.server", () => ({
  getAssetIndexSettings: vi.fn().mockResolvedValue({ mode: "SIMPLE" }),
}));

// why: the user's timezone lookup reads the user table.
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn().mockResolvedValue({ timeZone: "UTC" }),
}));

// why: the toast is an assertion target.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const permissionResult = {
  organizationId: "org-1",
  role: OrganizationRoles.ADMIN,
  canUseBarcodes: false,
  access: accessFor([OrganizationRoles.ADMIN]),
  currentOrganization: { auditsEnabled: true },
} as Awaited<ReturnType<typeof requirePermission>>;

const context = { getSession: () => ({ userId: "user-1" }) };

/**
 * Posts the dialog's form through the real action. The selection defaults to
 * two explicit ids with no live filters.
 */
async function post(
  fields: Record<string, string>,
  {
    assetIds = ["a1", "a2"],
    currentSearchParams = "",
  }: { assetIds?: string[]; currentSearchParams?: string } = {}
) {
  const body = new URLSearchParams();
  assetIds.forEach((id, i) => body.append(`assetIds[${i}]`, id));
  body.append("currentSearchParams", currentSearchParams);
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return (await action({
    context,
    request: new Request("https://x/api/assets/bulk-update-custom-field", {
      method: "POST",
      body,
    }),
    params: {},
  } as unknown as ActionFunctionArgs)) as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(permissionResult);
  vi.mocked(bulkSetAssetCustomField).mockResolvedValue({
    resolved: 2,
    changed: 1,
    skippedWithValue: 1,
    skippedCategory: 0,
  });
});

describe("loader", () => {
  it("returns the fields under `customFields`, the key the dialog reads", async () => {
    const fields = [
      {
        id: "cf-1",
        name: "Brand",
        type: "OPTION" as const,
        options: ["Westermo"],
        helpText: null,
        categories: [],
      },
    ];
    vi.mocked(getBulkSettableCustomFields).mockResolvedValue(fields);

    const response = (await loader({
      context,
      request: new Request("https://x/api/assets/bulk-update-custom-field"),
      params: {},
    } as unknown as LoaderFunctionArgs)) as unknown as {
      customFields: unknown;
    };

    expect(response.customFields).toEqual(fields);
    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        entity: PermissionEntity.asset,
        action: PermissionAction.update,
      })
    );
  });

  it("lists nothing to a member without asset update", async () => {
    vi.mocked(requirePermission).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "Forbidden",
        label: "Permission",
        status: 403,
      })
    );

    await expect(
      loader({
        context,
        request: new Request("https://x/api/assets/bulk-update-custom-field"),
        params: {},
      } as unknown as LoaderFunctionArgs)
    ).rejects.toMatchObject({ status: 403 });
    expect(getBulkSettableCustomFields).not.toHaveBeenCalled();
  });
});

describe("action", () => {
  it("forwards the field, the value and the default only-empty mode", async () => {
    await post({ customFieldId: "cf-1", value: "Westermo" });

    expect(bulkSetAssetCustomField).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        assetIds: ["a1", "a2"],
        customFieldId: "cf-1",
        rawValue: "Westermo",
        mode: "EMPTY_ONLY",
      })
    );
  });

  it("requires asset update, and refuses a member without it", async () => {
    await post({ customFieldId: "cf-1", value: "Westermo" });
    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        entity: PermissionEntity.asset,
        action: PermissionAction.update,
      })
    );

    vi.mocked(bulkSetAssetCustomField).mockClear();
    vi.mocked(requirePermission).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "Forbidden",
        label: "Permission",
        status: 403,
      })
    );
    const response = await post({ customFieldId: "cf-1", value: "Westermo" });

    expect(response.status).toBe(403);
    expect(bulkSetAssetCustomField).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown mode", { customFieldId: "cf-1", value: "x", mode: "BOGUS" }],
    ["no field", { value: "x" }],
  ])("refuses %s before touching any asset", async (_, fields) => {
    const response = await post(fields);

    expect(response.status).toBe(400);
    expect(bulkSetAssetCustomField).not.toHaveBeenCalled();
  });

  it("hands select-all the live filters and the caller's list scope", async () => {
    await post(
      { customFieldId: "cf-1", value: "Westermo" },
      {
        assetIds: [ALL_SELECTED_KEY],
        currentSearchParams: "s=router&category=cat-1",
      }
    );

    expect(bulkSetAssetCustomField).toHaveBeenCalledWith(
      expect.objectContaining({
        assetIds: [ALL_SELECTED_KEY],
        currentSearchParams: "s=router&category=cat-1",
        settings: { mode: "SIMPLE" },
        timeZone: "UTC",
        // An admin sees the whole list, so the scope narrows nothing.
        bookableScope: null,
      })
    );
  });

  it("forwards the replace mode when the user picked it", async () => {
    await post({ customFieldId: "cf-1", value: "Westermo", mode: "REPLACE" });

    expect(bulkSetAssetCustomField).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "REPLACE" })
    );
  });

  it("tells the user what changed and what was left alone", async () => {
    await post({ customFieldId: "cf-1", value: "Westermo" });

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Custom field set",
        message:
          "Set on 1 asset. 1 asset already had a value and was left alone.",
        icon: { name: "success", variant: "success" },
      })
    );
  });

  it("does not show a success tick when nothing changed", async () => {
    vi.mocked(bulkSetAssetCustomField).mockResolvedValue({
      resolved: 0,
      changed: 0,
      skippedWithValue: 0,
      skippedCategory: 0,
    });

    await post({ customFieldId: "cf-1", value: "Westermo" });

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Nothing to change",
        icon: { name: "custom-field", variant: "gray" },
      })
    );
  });

  it("returns the service's refusal with its status", async () => {
    vi.mocked(bulkSetAssetCustomField).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "Brand is required",
        label: "Assets",
        status: 400,
      })
    );

    const response = await post({ customFieldId: "cf-1", value: "" });

    expect(response.status).toBe(400);
    // Only the shared error toast, never a success one.
    expect(sendNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Custom field set" })
    );
  });
});
