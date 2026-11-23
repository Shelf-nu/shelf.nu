/**
 * The "Create assets from stock" route action.
 *
 * Pins the two grants it asks for (asset create, then asset update with the
 * workspace switches), what it forwards to the service, and where it sends
 * the operator afterwards: the new asset for one, back to the stock for
 * several.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.$assetId.overview.create-from-stock.tsx}
 * @see {@link file://./../../../app/modules/asset/create-from-stock.db.test.ts}
 */

import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAssetsFromStock } from "~/modules/asset/create-from-stock.server";
import { action } from "~/routes/_layout+/assets.$assetId.overview.create-from-stock";
import { ShelfError } from "~/utils/error";
import { validatePermission } from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";

// why: mocking Remix's data() so the action returns a real Response
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (data: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(data), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    )
);

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: the conversion and its rules are the service's, pinned by its own tests
vi.mock("~/modules/asset/create-from-stock.server", () => ({
  createAssetsFromStock: vi.fn(),
  getAssetsFromStockChoices: vi.fn(),
}));

// why: the caller's context comes from the session and the database
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the second grant is asserted, not resolved against a real role
vi.mock("~/utils/permissions/permission.validator.server", () => ({
  validatePermission: vi.fn(),
}));

// why: preventing actual notification sending during route tests
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const mockCreate = vi.mocked(createAssetsFromStock);
const mockValidate = vi.mocked(validatePermission);

function post(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return {
    context: { getSession: () => ({ userId: "user-1" }) },
    request: new Request(
      "https://example.com/assets/pool-1/overview/create-from-stock",
      { method: "POST", body: formData }
    ),
    params: { assetId: "pool-1" },
  } as unknown as ActionFunctionArgs;
}

const form = { count: "3", source: "loc-van", title: "Reel", assetModelId: "" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermission).mockResolvedValue({
    organizationId: "org-1",
    currentOrganization: { id: "org-1" },
    userOrganizations: [{ organization: { id: "org-1" }, roles: ["MANAGER"] }],
  } as unknown as Awaited<ReturnType<typeof requirePermission>>);
  mockValidate.mockResolvedValue(true);
  mockCreate.mockResolvedValue({
    assets: [
      { id: "a1", title: "Reel 1" },
      { id: "a2", title: "Reel 2" },
      { id: "a3", title: "Reel 3" },
    ],
    locationId: "loc-van",
  });
});

describe("create assets from stock action", () => {
  it("asks for asset create, then asset update with the caller's roles", async () => {
    await action(post(form));

    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "asset", action: "create" })
    );
    expect(mockValidate).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "asset",
        action: "update",
        roles: ["MANAGER"],
        workspace: { id: "org-1" },
        organizationId: "org-1",
      })
    );
  });

  it("creates nothing when the update grant is missing", async () => {
    mockValidate.mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "You have no permission to perform this action",
        status: 403,
        label: "Permission",
      })
    );

    const response = (await action(post(form))) as Response;

    expect(response.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("forwards the form, with an empty model as no model", async () => {
    await action(post(form));

    expect(mockCreate).toHaveBeenCalledWith({
      poolId: "pool-1",
      organizationId: "org-1",
      userId: "user-1",
      count: 3,
      source: "loc-van",
      title: "Reel",
      assetModelId: undefined,
    });
  });

  it("returns to the stock after several assets and opens a single one", async () => {
    const several = (await action(post(form))) as Response;
    expect(several.headers.get("Location")).toBe("/assets/pool-1");

    mockCreate.mockResolvedValue({
      assets: [{ id: "a1", title: "Reel" }],
      locationId: null,
    });
    const one = (await action(post({ ...form, count: "1" }))) as Response;
    expect(one.headers.get("Location")).toBe("/assets/a1");
  });

  it("refuses a count above the cap before calling the service", async () => {
    const response = (await action(post({ ...form, count: "26" }))) as Response;

    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
