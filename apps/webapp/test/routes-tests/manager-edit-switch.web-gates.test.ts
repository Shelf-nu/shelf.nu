// @vitest-environment node
/**
 * Which web routes a Manager reaches when the owner turns on "Managers can
 * edit assets" (`Organization.managersCanEditAssets`), and which stay closed
 * whichever way it is set.
 *
 * The switch adds `asset: create, update`, `kit: create, update` and
 * `qr: update` to MANAGER. Single-record edits, single and bulk location and
 * QR linking follow it. Every other bulk edit, bulk create from a model, the
 * sequential-id migration and delete answer from the matrix alone.
 *
 * Every case runs the real `requirePermission` over a Manager membership of a
 * workspace whose switch the case sets. Only the membership lookup and the
 * services behind each gate are stubbed, so a case fails if a route stops
 * reading the switch, or starts reading it where it must not.
 *
 * @see {@link file://./../../../../packages/permissions/src/workspace-grants.ts}
 * @see {@link file://./../../app/utils/roles.server.ts} requirePermission
 */
import { OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_TOGGLES_OFF } from "@helpers/role-access";
import { createActionArgs, createLoaderArgs } from "@mocks/remix";

import { generateBulkSequentialIdsEfficient } from "~/modules/asset/sequential-id.server";
import {
  bulkAssignAssetTags,
  bulkCreateAssetsFromModel,
  bulkMarkAvailability,
  bulkUpdateAssetCategory,
  bulkUpdateAssetLocation,
  bulkUpdateAssetModel,
  createAsset,
  deleteAsset,
  duplicateAsset,
  relinkAssetQrCode,
  updateAsset,
} from "~/modules/asset/service.server";
import { adjustQuantity } from "~/modules/consumption-log/service.server";
import {
  bulkRemoveAssetsFromKits,
  bulkUpdateKitLocation,
  createKit,
  updateKit,
  updateKitAssets,
} from "~/modules/kit/service.server";
import { getSelectedOrganization } from "~/modules/organization/context.server";
import { assertWhetherQrBelongsToCurrentOrganization } from "~/modules/qr/service.server";
import { action as assetDetailAction } from "~/routes/_layout+/assets.$assetId";
import { action as duplicateAssetAction } from "~/routes/_layout+/assets.$assetId.overview.duplicate";
import { action as updateAssetLocationAction } from "~/routes/_layout+/assets.$assetId.overview.update-location";
import { action as editAssetAction } from "~/routes/_layout+/assets.$assetId_.edit";
import {
  action as newAssetAction,
  loader as newAssetLoader,
} from "~/routes/_layout+/assets.new";
import { action as kitDetailAction } from "~/routes/_layout+/kits.$kitId";
import { action as manageKitAssetsAction } from "~/routes/_layout+/kits.$kitId.assets.manage-assets";
import { action as editKitAction } from "~/routes/_layout+/kits.$kitId_.edit";
import { action as newKitAction } from "~/routes/_layout+/kits.new";
import { action as adjustQuantityAction } from "~/routes/api+/assets.adjust-quantity";
import { action as bulkAddToKitAction } from "~/routes/api+/assets.bulk-add-to-kit";
import { action as bulkAssignTagsAction } from "~/routes/api+/assets.bulk-assign-tags";
import { action as bulkMarkAvailabilityAction } from "~/routes/api+/assets.bulk-mark-availability";
import { action as bulkRemoveFromKitsAction } from "~/routes/api+/assets.bulk-remove-from-kits";
import { action as bulkUpdateAssetModelAction } from "~/routes/api+/assets.bulk-update-asset-model";
import { action as bulkUpdateCategoryAction } from "~/routes/api+/assets.bulk-update-category";
import { action as bulkUpdateLocationAction } from "~/routes/api+/assets.bulk-update-location";
import { action as generateSequentialIdsAction } from "~/routes/api+/generate-sequential-ids";
import { action as kitsBulkAction } from "~/routes/api+/kits.bulk-actions";
import { action as linkQrToAssetAction } from "~/routes/qr+/_private+/$qrId_.link.asset";

const USER_ID = "user-1";
const ORG_ID = "org-1";

/** The signed-in member's roles, read by the membership stubs below. */
const membership = vi.hoisted(() => ({ roles: [] as string[] }));

/**
 * The few Prisma calls the routes make directly, outside a service. The
 * kit-removal transaction runs against the same delegates.
 */
const dbMock = vi.hoisted(() => {
  const delegates = {
    // `assertAssetsAreNotArchived` (relink) counts archived rows: none here.
    asset: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => [{ id: "asset-1", type: "INDIVIDUAL" }]),
    },
    assetKit: {
      findMany: vi.fn(async () => [
        {
          id: "asset-kit-1",
          quantity: 1,
          asset: { type: "INDIVIDUAL", unitOfMeasure: null },
        },
      ]),
    },
    kit: {
      update: vi.fn(async () => ({ name: "Camera kit", custody: null })),
    },
  };
  return {
    ...delegates,
    $transaction: vi.fn((work: (tx: typeof delegates) => unknown) =>
      work(delegates)
    ),
  };
});

// why: memberships come from the session cookie and the database. They are
// the input these cases vary (role, switch), so they are supplied directly;
// `requirePermission`, which consumes them, is real.
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: vi.fn(),
}));

// why: a few routes query Prisma directly (archived check, kit removal
// transaction, bulk add-to-kit type split); no database runs in unit tests.
vi.mock("~/database/db.server", () => ({ db: dbMock }));

// why: every asset write below has its own service tests; these cases only
// pin whether a route reaches it, and with which record.
vi.mock("~/modules/asset/service.server", () => ({
  bulkAssignAssetTags: vi.fn(async () => undefined),
  bulkCreateAssetsFromModel: vi.fn(async () => ({
    createdAssetIds: ["asset-a", "asset-b", "asset-c"],
  })),
  bulkMarkAvailability: vi.fn(async () => undefined),
  bulkUpdateAssetCategory: vi.fn(async () => undefined),
  bulkUpdateAssetLocation: vi.fn(async () => undefined),
  bulkUpdateAssetModel: vi.fn(async () => ({
    linked: true,
    resolved: 1,
    updated: 1,
    moved: 0,
    skippedQuantityTracked: 0,
    modelName: "Tripod model",
  })),
  createAsset: vi.fn(async () => ({
    id: "asset-new",
    type: "INDIVIDUAL",
    unitOfMeasure: null,
    assetLocations: [],
    user: {
      id: USER_ID,
      firstName: "Mia",
      lastName: "Manager",
      displayName: null,
    },
  })),
  deleteAsset: vi.fn(async () => undefined),
  assertAssetDeleteConfirmed: vi.fn(async () => undefined),
  duplicateAsset: vi.fn(async () => [{ id: "asset-copy" }]),
  getAllEntriesForCreateAndEdit: vi.fn(async () => ({
    categories: [],
    totalCategories: 0,
    tags: [],
    locations: [],
    totalLocations: 0,
  })),
  getAsset: vi.fn(async () => ({ id: "asset-1", title: "Tripod" })),
  relinkAssetQrCode: vi.fn(async () => undefined),
  updateAsset: vi.fn(async () => ({ id: "asset-1" })),
  updateAssetMainImage: vi.fn(async () => false),
}));

// why: the form routes resolve category-driven custom fields from the
// database; none are defined in this workspace.
vi.mock("~/modules/custom-field/service.server", () => ({
  getActiveCustomFields: vi.fn(async () => []),
}));

// why: the next id is estimated from, and the migration rewrites, every asset
// in the workspace.
vi.mock("~/modules/asset/sequential-id.server", () => ({
  estimateNextSequentialId: vi.fn(async () => "SAM-0001"),
  generateBulkSequentialIdsEfficient: vi.fn(async () => 3),
}));

// why: model lookups for the new-asset form and the bulk-create success
// message read the database.
vi.mock("~/modules/asset-model/service.server", () => ({
  getAssetModel: vi.fn(async () => ({ name: "Tripod model" })),
  getAssetModels: vi.fn(async () => ({ assetModels: [], totalAssetModels: 0 })),
}));

// why: activity notes are database writes with their own coverage.
vi.mock("~/modules/note/service.server", () => ({
  createNote: vi.fn(async () => ({})),
}));

// why: the new-asset loader checks a `?qrId=` against the database.
vi.mock("~/modules/qr/service.server", () => ({
  assertWhetherQrBelongsToCurrentOrganization: vi.fn(async () => undefined),
}));

// why: kit writes and the kit-removal booking cascade have their own service
// tests; these cases only pin whether a route reaches them.
vi.mock("~/modules/kit/service.server", () => ({
  bulkRemoveAssetsFromKits: vi.fn(async () => ({ removedFromKitCount: 1 })),
  bulkUpdateKitLocation: vi.fn(async () => undefined),
  createKit: vi.fn(async () => ({ id: "kit-new" })),
  emitAssetKitDetachmentNotes: vi.fn(async () => undefined),
  fetchAssetKitDetachmentImpact: vi.fn(async () => []),
  getKit: vi.fn(async () => ({ id: "kit-1", locationId: null })),
  mergeStandaloneCollisionsForKitDetachment: vi.fn(async () => undefined),
  preserveKitDrivenPlacements: vi.fn(async () => undefined),
  removeKitSlicesFromPlanningBookings: vi.fn(async () => []),
  updateKit: vi.fn(async () => ({ id: "kit-1" })),
  updateKitAssets: vi.fn(async () => ({ name: "Camera kit" })),
  updateKitImage: vi.fn(async () => undefined),
  updateKitLocation: vi.fn(async () => undefined),
}));

// why: narrowing a custody filter to the caller's team members reads the
// database; the location intent never filters by custodian.
vi.mock("~/modules/team-member/service.server", () => ({
  scopeCustodianFilterIds: vi.fn(async () => []),
}));

// why: the bulk routes read the caller's saved asset index settings.
vi.mock("~/modules/asset-index-settings/service.server", () => ({
  getAssetIndexSettings: vi.fn(async () => ({ mode: "SIMPLE" })),
}));

// why: the caller's timezone preference is a database read.
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn(async () => ({ timeZone: "UTC" })),
}));

// why: the stock write has its own service tests.
vi.mock("~/modules/consumption-log/service.server", () => ({
  adjustQuantity: vi.fn(async () => ({
    asset: { id: "asset-1" },
    location: { locationId: null, locationName: null, multiSource: false },
  })),
}));

// why: the low-stock check sends notifications.
vi.mock("~/modules/consumption-log/low-stock.server", () => ({
  checkAndNotifyLowStock: vi.fn(async () => undefined),
}));

// why: the note actor and the migration's membership are database reads; the
// migration judges the caller by the roles returned here.
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn(async () => ({
    id: USER_ID,
    firstName: "Mia",
    lastName: "Manager",
    displayName: null,
    userOrganizations: [{ roles: membership.roles }],
  })),
}));

// why: marking the workspace migrated is a database write.
vi.mock("~/modules/organization/service.server", () => ({
  updateOrganization: vi.fn(async () => ({})),
}));

// why: toasts go through the server event emitter.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

/**
 * Signs the caller in as `role` in a workspace whose "Managers can edit
 * assets" switch is `managersCanEditAssets`.
 */
function signInAs(
  role: OrganizationRoles,
  { managersCanEditAssets }: { managersCanEditAssets: boolean }
) {
  membership.roles = [role];
  const workspace = {
    id: ORG_ID,
    name: "Acme",
    type: "TEAM",
    currency: "USD",
    barcodesEnabled: false,
    auditsEnabled: false,
    ...ALL_TOGGLES_OFF,
    managersCanEditAssets,
  };
  vi.mocked(getSelectedOrganization).mockResolvedValue({
    organizationId: ORG_ID,
    organizations: [workspace],
    currentOrganization: workspace,
    userOrganizations: [{ organization: workspace, roles: [role] }],
  } as never);
}

const context = { getSession: () => ({ userId: USER_ID }) } as never;

/** A route handler, loader or action. */
type Handler = (args: ActionFunctionArgs) => unknown;

/** Posts a form to `handler` the way the browser submits it. */
function post(
  handler: Handler,
  path: string,
  fields: Record<string, string>,
  params: Record<string, string> = {}
) {
  return async () =>
    handler(
      createActionArgs({
        request: new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(fields),
        }),
        params,
        context,
      })
    );
}

/** Loads `path` through `handler`. */
function get(handler: Handler, path: string) {
  return async () =>
    handler(
      createLoaderArgs({
        request: new Request(`http://localhost${path}`),
        context,
      }) as ActionFunctionArgs
    );
}

/**
 * The HTTP status a handler answered with, whether it returned or threw it:
 * a `Response` (redirects), a `data()` envelope, or a bare payload (200).
 */
async function statusOf(call: () => Promise<unknown>): Promise<number> {
  const settled = await call().catch((thrown: unknown) => thrown);
  if (settled instanceof Response) return settled.status;
  if (
    typeof settled === "object" &&
    settled !== null &&
    "type" in settled &&
    settled.type === "DataWithResponseInit" &&
    "init" in settled
  ) {
    return (settled.init as ResponseInit | null)?.status ?? 200;
  }
  if (settled instanceof Error) throw settled;
  return 200;
}

/** One gated route, and the write behind its gate. */
type GatedRoute = {
  /** The route file and handler, as the case is named. */
  route: string;
  /** Calls the handler as the browser does. */
  call: () => Promise<unknown>;
  /** The service the gate guards. */
  service: unknown;
  /** What that service receives once the caller is through. */
  receives: unknown;
  /** The status the handler answers with once the service succeeds. */
  status: number;
};

/** Routes the switch opens to a Manager. */
const OPENED_BY_THE_SWITCH: GatedRoute[] = [
  {
    route: "_layout+/assets.new.tsx action (single create)",
    call: post(newAssetAction, "/assets/new", {
      title: "Tripod",
      description: "",
      category: "uncategorized",
    }),
    service: createAsset,
    receives: expect.objectContaining({
      organizationId: ORG_ID,
      title: "Tripod",
    }),
    status: 302,
  },
  {
    route: "_layout+/assets.$assetId.overview.duplicate.tsx action",
    call: post(
      duplicateAssetAction,
      "/assets/asset-1/overview/duplicate",
      { amountOfDuplicates: "1" },
      { assetId: "asset-1" }
    ),
    service: duplicateAsset,
    receives: expect.objectContaining({
      asset: { id: "asset-1", title: "Tripod" },
      amountOfDuplicates: 1,
      organizationId: ORG_ID,
    }),
    status: 302,
  },
  {
    route: "_layout+/assets.$assetId_.edit.tsx action",
    call: post(
      editAssetAction,
      "/assets/asset-1/edit",
      { title: "Tripod", description: "", category: "uncategorized" },
      { assetId: "asset-1" }
    ),
    service: updateAsset,
    receives: expect.objectContaining({
      id: "asset-1",
      organizationId: ORG_ID,
      title: "Tripod",
    }),
    status: 200,
  },
  {
    route: "_layout+/assets.$assetId.overview.update-location.tsx action",
    call: post(
      updateAssetLocationAction,
      "/assets/asset-1/overview/update-location",
      { newLocationId: "loc-2", currentLocationId: "loc-1" },
      { assetId: "asset-1" }
    ),
    service: updateAsset,
    receives: expect.objectContaining({
      id: "asset-1",
      organizationId: ORG_ID,
      newLocationId: "loc-2",
      currentLocationId: "loc-1",
    }),
    status: 302,
  },
  {
    route: "_layout+/assets.$assetId.tsx action, intent relink-qr-code",
    call: post(
      assetDetailAction,
      "/assets/asset-1",
      { intent: "relink-qr-code", newQrId: "qr-2" },
      { assetId: "asset-1" }
    ),
    service: relinkAssetQrCode,
    receives: {
      qrId: "qr-2",
      assetId: "asset-1",
      organizationId: ORG_ID,
      userId: USER_ID,
    },
    status: 200,
  },
  {
    route: "_layout+/kits.new.tsx action",
    call: post(newKitAction, "/kits/new", { name: "Camera kit" }),
    service: createKit,
    receives: expect.objectContaining({
      name: "Camera kit",
      organizationId: ORG_ID,
    }),
    status: 302,
  },
  {
    route: "_layout+/kits.$kitId_.edit.tsx action",
    call: post(
      editKitAction,
      "/kits/kit-1/edit",
      { name: "Camera kit" },
      { kitId: "kit-1" }
    ),
    service: updateKit,
    receives: expect.objectContaining({
      id: "kit-1",
      organizationId: ORG_ID,
      name: "Camera kit",
    }),
    status: 200,
  },
  {
    route: "_layout+/kits.$kitId.assets.manage-assets.tsx action",
    call: post(
      manageKitAssetsAction,
      "/kits/kit-1/assets/manage-assets",
      { "assetIds[0]": "asset-1" },
      { kitId: "kit-1" }
    ),
    service: updateKitAssets,
    receives: expect.objectContaining({
      kitId: "kit-1",
      assetIds: ["asset-1"],
      organizationId: ORG_ID,
    }),
    status: 302,
  },
  {
    route: "_layout+/kits.$kitId.tsx action, intent removeAsset",
    call: post(
      kitDetailAction,
      "/kits/kit-1",
      { intent: "removeAsset", assetId: "asset-1" },
      { kitId: "kit-1" }
    ),
    service: dbMock.kit.update,
    receives: expect.objectContaining({
      where: { id: "kit-1", organizationId: ORG_ID },
      data: { assetKits: { deleteMany: { assetId: "asset-1" } } },
    }),
    status: 200,
  },
  {
    route: "api+/assets.bulk-update-location.ts action",
    call: post(bulkUpdateLocationAction, "/api/assets/bulk-update-location", {
      "assetIds[0]": "asset-1",
      newLocationId: "loc-2",
    }),
    service: bulkUpdateAssetLocation,
    receives: expect.objectContaining({
      assetIds: ["asset-1"],
      newLocationId: "loc-2",
      organizationId: ORG_ID,
    }),
    status: 200,
  },
  {
    route: "api+/kits.bulk-actions.ts action, intent bulk-update-location",
    call: post(kitsBulkAction, "/api/kits/bulk-actions", {
      intent: "bulk-update-location",
      "kitIds[0]": "kit-1",
      newLocationId: "loc-2",
    }),
    service: bulkUpdateKitLocation,
    receives: expect.objectContaining({
      kitIds: ["kit-1"],
      newLocationId: "loc-2",
      organizationId: ORG_ID,
    }),
    status: 200,
  },
  {
    route: "api+/assets.adjust-quantity.ts action",
    call: post(adjustQuantityAction, "/api/assets/adjust-quantity", {
      assetId: "asset-1",
      quantity: "5",
      category: "RESTOCK",
      direction: "add",
    }),
    service: adjustQuantity,
    receives: expect.objectContaining({
      assetId: "asset-1",
      quantity: 5,
      direction: "add",
      organizationId: ORG_ID,
    }),
    status: 200,
  },
  {
    route: "qr+/_private+/$qrId_.link.asset.tsx action",
    call: post(
      linkQrToAssetAction,
      "/qr/qr-1/link/asset",
      { assetId: "asset-1" },
      { qrId: "qr-1" }
    ),
    service: relinkAssetQrCode,
    receives: {
      qrId: "qr-1",
      assetId: "asset-1",
      organizationId: ORG_ID,
      userId: USER_ID,
    },
    status: 302,
  },
];

/** Routes that share a granted pair but stay closed to a Manager. */
const CLOSED_EITHER_WAY: GatedRoute[] = [
  {
    route: "api+/assets.bulk-update-category.ts action",
    call: post(bulkUpdateCategoryAction, "/api/assets/bulk-update-category", {
      "assetIds[0]": "asset-1",
      category: "cat-1",
    }),
    service: bulkUpdateAssetCategory,
    receives: expect.objectContaining({
      assetIds: ["asset-1"],
      categoryId: "cat-1",
      organizationId: ORG_ID,
    }),
    status: 200,
  },
  {
    route: "api+/assets.bulk-assign-tags.ts action",
    call: post(bulkAssignTagsAction, "/api/assets/bulk-assign-tags", {
      "assetIds[0]": "asset-1",
      tags: "tag-1",
    }),
    service: bulkAssignAssetTags,
    receives: expect.objectContaining({
      assetIds: ["asset-1"],
      tagsIds: ["tag-1"],
      organizationId: ORG_ID,
    }),
    status: 200,
  },
  {
    route: "api+/assets.bulk-update-asset-model.ts action",
    call: post(
      bulkUpdateAssetModelAction,
      "/api/assets/bulk-update-asset-model",
      { "assetIds[0]": "asset-1", assetModelId: "model-1" }
    ),
    service: bulkUpdateAssetModel,
    receives: expect.objectContaining({
      assetIds: ["asset-1"],
      assetModelId: "model-1",
      organizationId: ORG_ID,
    }),
    status: 200,
  },
  {
    route: "api+/assets.bulk-mark-availability.ts action",
    call: post(
      bulkMarkAvailabilityAction,
      "/api/assets/bulk-mark-availability",
      { "assetIds[0]": "asset-1", type: "unavailable" }
    ),
    service: bulkMarkAvailability,
    receives: expect.objectContaining({
      assetIds: ["asset-1"],
      type: "unavailable",
      organizationId: ORG_ID,
    }),
    status: 200,
  },
  {
    route: "api+/assets.bulk-add-to-kit.ts action",
    call: post(bulkAddToKitAction, "/api/assets/bulk-add-to-kit", {
      "assetIds[0]": "asset-1",
      kit: "kit-1",
    }),
    service: updateKitAssets,
    receives: expect.objectContaining({
      kitId: "kit-1",
      assetIds: ["asset-1"],
      organizationId: ORG_ID,
      addOnly: true,
    }),
    status: 200,
  },
  {
    route: "api+/assets.bulk-remove-from-kits.ts action",
    call: post(bulkRemoveFromKitsAction, "/api/assets/bulk-remove-from-kits", {
      "assetIds[0]": "asset-1",
    }),
    service: bulkRemoveAssetsFromKits,
    receives: expect.objectContaining({
      assetIds: ["asset-1"],
      organizationId: ORG_ID,
    }),
    status: 200,
  },
  {
    route:
      "_layout+/assets.new.tsx action with bulk=1 (bulk create from model)",
    call: post(newAssetAction, "/assets/new", {
      bulk: "1",
      title: "Tripod 1",
      description: "",
      category: "uncategorized",
      assetModelId: "model-1",
      nameTemplate: "Tripod {n}",
      count: "3",
    }),
    service: bulkCreateAssetsFromModel,
    receives: expect.objectContaining({
      assetModelId: "model-1",
      count: 3,
      nameTemplate: "Tripod {n}",
      organizationId: ORG_ID,
    }),
    status: 200,
  },
  {
    route: "_layout+/assets.new.tsx loader with ?bulk=1",
    call: get(newAssetLoader, "/assets/new?bulk=1"),
    service: assertWhetherQrBelongsToCurrentOrganization,
    receives: expect.objectContaining({ organizationId: ORG_ID }),
    status: 200,
  },
  {
    route: "api+/generate-sequential-ids.tsx action",
    call: post(generateSequentialIdsAction, "/api/generate-sequential-ids", {}),
    service: generateBulkSequentialIdsEfficient,
    receives: ORG_ID,
    status: 200,
  },
  {
    route: "_layout+/assets.$assetId.tsx action, intent delete",
    call: post(
      assetDetailAction,
      "/assets/asset-1",
      { intent: "delete", confirmation: "Tripod" },
      { assetId: "asset-1" }
    ),
    service: deleteAsset,
    receives: {
      organizationId: ORG_ID,
      id: "asset-1",
      actorUserId: USER_ID,
    },
    status: 302,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

// why: a loop rather than `describe.each`, whose `$route` titles are cut at 40
// characters and would leave two routes of the same file indistinguishable.
for (const { route, call, service, receives, status } of OPENED_BY_THE_SWITCH) {
  describe(`${route}, opened to a Manager by the switch`, () => {
    it("refuses a Manager with 403 while the switch is off", async () => {
      signInAs(OrganizationRoles.MANAGER, { managersCanEditAssets: false });

      expect(await statusOf(call)).toBe(403);
      expect(service).not.toHaveBeenCalled();
    });

    it("lets a Manager through to the write once the switch is on", async () => {
      signInAs(OrganizationRoles.MANAGER, { managersCanEditAssets: true });

      expect(await statusOf(call)).toBe(status);
      expect(service).toHaveBeenCalledWith(receives);
    });
  });
}

for (const { route, call, service, receives, status } of CLOSED_EITHER_WAY) {
  describe(`${route}, closed to a Manager whatever the switch`, () => {
    it("refuses a Manager with 403 while the switch is off", async () => {
      signInAs(OrganizationRoles.MANAGER, { managersCanEditAssets: false });

      expect(await statusOf(call)).toBe(403);
      expect(service).not.toHaveBeenCalled();
    });

    it("still refuses a Manager with 403 once the switch is on", async () => {
      signInAs(OrganizationRoles.MANAGER, { managersCanEditAssets: true });

      expect(await statusOf(call)).toBe(403);
      expect(service).not.toHaveBeenCalled();
    });

    it("lets an Administrator of the same workspace through", async () => {
      signInAs(OrganizationRoles.ADMIN, { managersCanEditAssets: true });

      expect(await statusOf(call)).toBe(status);
      expect(service).toHaveBeenCalledWith(receives);
    });
  });
}

describe("_layout+/assets.new.tsx loader without ?bulk=1", () => {
  it("opens the single-asset form to a Manager once the switch is on", async () => {
    signInAs(OrganizationRoles.MANAGER, { managersCanEditAssets: true });

    expect(await statusOf(get(newAssetLoader, "/assets/new"))).toBe(200);
    expect(assertWhetherQrBelongsToCurrentOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID })
    );
  });
});
