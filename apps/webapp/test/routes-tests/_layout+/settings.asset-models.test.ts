/**
 * Loader gate tests for Settings > Asset models.
 *
 * The settings section manages the catalogue of models, so both its layout
 * and its index loader ask for `assetModel:update`. `assetModel:read` is held
 * by roles that only pick a model on an asset or a booking (a Custody manager,
 * Base), and must not open this page. The permission mock answers from the
 * real matrix, so a loader that asks for `read` lets those roles through and
 * fails here.
 *
 * @see {@link file://../../../app/routes/_layout+/settings.asset-models.tsx}
 * @see {@link file://../../../app/routes/_layout+/settings.asset-models.index.tsx}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionContext } from "@helpers/role-access";
import { createLoaderArgs } from "@mocks/remix";

import { loader as layoutLoader } from "~/routes/_layout+/settings.asset-models";
import { loader as indexLoader } from "~/routes/_layout+/settings.asset-models.index";
import { ShelfError } from "~/utils/error";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: permission resolution reads the membership from the database; the mock
// answers from the real matrix for the role under test instead.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: keep service calls out of this test; it asserts the loaders' gate, not
// the asset-model queries behind it.
vi.mock("~/modules/asset-model/service.server", () => ({
  getAssetModels: vi.fn(),
  deleteAssetModel: vi.fn(),
  bulkDeleteAssetModels: vi.fn(),
}));

// why: the layout imports the notification emitter for its delete action; no
// test here sends one.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: the real db.server connects at module load outside production; no test
// here reaches the database.
vi.mock("~/database/db.server", () => ({
  db: {},
}));

const mockContext = {
  getSession: () => ({ userId: "user-1" }),
  appVersion: "1.0.0",
  isAuthenticated: true,
  setSession: vi.fn(),
  destroySession: vi.fn(),
  errorMessage: null,
} as any;

/**
 * Makes `requirePermission` answer as `role` would: the real matrix decides,
 * and a refusal throws the same 403 the gate throws.
 */
function actAs(role: OrganizationRoles) {
  vi.mocked(requirePermission).mockImplementation(
    async ({ entity, action }) => {
      if (!userHasPermission({ roles: [role], entity, action })) {
        throw new ShelfError({
          cause: null,
          message: "You do not have permission to access this resource",
          label: "Permission",
          status: 403,
          shouldBeCaptured: false,
        });
      }
      return permissionContext({ roles: [role] }) as any;
    }
  );
}

/** Runs a loader and returns what it threw, or `undefined` if it returned. */
async function thrownBy(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
    return undefined;
  } catch (thrown) {
    return thrown;
  }
}

const loaderArgs = () =>
  createLoaderArgs({
    request: new Request("http://localhost/settings/asset-models"),
    context: mockContext,
  });

describe("Settings > Asset models loaders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["layout", layoutLoader],
    ["index", indexLoader],
  ] as const)("the %s loader asks for assetModel:update", async (_, loader) => {
    actAs(OrganizationRoles.CUSTODY_MANAGER);

    await thrownBy(() => loader(loaderArgs()));

    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "assetModel", action: "update" })
    );
  });

  it.each([
    ["layout", layoutLoader],
    ["index", indexLoader],
  ] as const)(
    "the %s loader refuses a Custody manager with a 403",
    async (_, loader) => {
      actAs(OrganizationRoles.CUSTODY_MANAGER);

      const thrown = await thrownBy(() => loader(loaderArgs()));

      expect(thrown?.init?.status).toBe(403);
    }
  );

  it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
    "the layout loader refuses %s with a 403",
    async (role) => {
      actAs(role);

      const thrown = await thrownBy(() => layoutLoader(loaderArgs()));

      expect(thrown?.init?.status).toBe(403);
    }
  );

  it.each([OrganizationRoles.ADMIN, OrganizationRoles.OWNER])(
    "the layout loader lets %s in",
    async (role) => {
      actAs(role);

      const thrown = await thrownBy(() => layoutLoader(loaderArgs()));

      expect(thrown).toBeUndefined();
    }
  );
});
