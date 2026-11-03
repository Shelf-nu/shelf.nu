// @vitest-environment node
/**
 * The Managers switch (`Organization.managersCanEditAssets`) on the mobile API.
 *
 * With the switch on, a Manager also holds `asset: create, update`,
 * `kit: create, update` and `qr: update`, and nothing else. Every route here is
 * called the way the companion calls it, and its permission check resolves for
 * real: `requireMobilePermission` loads the membership row below, which carries
 * the caller's role and the workspace's switch. A route that stops checking,
 * checks a different pair, or a check that stops reading the switch turns
 * these tests red.
 *
 * @see {@link file://../../../../../../packages/permissions/src/workspace-grants.ts}
 * @see {@link file://../../../../app/utils/permissions/permission.validator.server.ts}
 */
import type { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mobileUserContext } from "@helpers/mobile-user-context";
import { createActionArgs, createLoaderArgs } from "@mocks/remix";

// why: token auth validates a JWT against Supabase, and membership plus the
// caller's context are fixtures here. `requireMobilePermission` stays real, so
// each gate resolves through `hasPermission` against the database row below.
// `getMobileAssetForViewer` re-signs image URLs through Supabase storage.
vi.mock("~/modules/api/mobile-auth.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/modules/api/mobile-auth.server")
  >()),
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  getMobileUserContext: vi.fn(),
  getMobileAssetForViewer: vi.fn(),
}));

// why: no database in unit tests. `userOrganization.findFirst` is the
// membership read inside `hasPermission` (answered by `signIn`); the rest are
// the reads and writes each route's success path makes, set per route.
vi.mock("~/database/db.server", () => ({
  db: {
    userOrganization: { findFirst: vi.fn() },
    asset: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    assetLocation: { findMany: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
    location: { findFirst: vi.fn() },
    customField: { findMany: vi.fn() },
    qr: { findUnique: vi.fn() },
    tag: { findMany: vi.fn() },
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    activityEvent: { create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

// why: these asset writes run Prisma transactions with rules of their own,
// covered by the asset service suite. The routes only have to reach them.
vi.mock("~/modules/asset/service.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/modules/asset/service.server")>()),
  createAsset: vi.fn(),
  updateAsset: vi.fn(),
  updateAssetMainImage: vi.fn(),
  replaceAssetPlacements: vi.fn(),
  bulkUpdateAssetLocation: vi.fn(),
  relinkAssetQrCode: vi.fn(),
  deleteAsset: vi.fn(),
  unarchiveAsset: vi.fn(),
}));

// why: the kit location cascade is a multi-table transaction covered by the
// kit service suite.
vi.mock("~/modules/kit/service.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/modules/kit/service.server")>()),
  bulkUpdateKitLocation: vi.fn(),
}));

// why: the claim is the web claim flow's service, covered by its own suite.
vi.mock("~/modules/qr/service.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/modules/qr/service.server")>()),
  claimQrCode: vi.fn(),
}));

// why: tag creation writes through Prisma; the tag picker read stays real.
vi.mock("~/modules/tag/service.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/modules/tag/service.server")>()),
  createTag: vi.fn(),
}));

// why: the stock change runs a locked transaction covered by the
// consumption-log suite.
vi.mock("~/modules/consumption-log/service.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/modules/consumption-log/service.server")
  >()),
  adjustQuantity: vi.fn(),
}));

// why: the low-stock check sends email after a stock change.
vi.mock(
  "~/modules/consumption-log/low-stock.server",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("~/modules/consumption-log/low-stock.server")
    >()),
    checkAndNotifyLowStock: vi.fn(),
  })
);

// why: index settings are created on first read; the bulk location route only
// forwards them to the (mocked) service.
vi.mock(
  "~/modules/asset-index-settings/service.server",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("~/modules/asset-index-settings/service.server")
    >()),
    getAssetIndexSettings: vi.fn(),
  })
);

// why: activity notes are written after the gate and checked by the note
// service suite.
vi.mock("~/modules/note/service.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/modules/note/service.server")>()),
  createNote: vi.fn(),
}));

// why: the in-memory limiter counts every call in this file against one user
// and would answer 429 partway through; throttling is not under test.
vi.mock("~/utils/rate-limit.server", () => ({
  enforceUserRateLimit: vi.fn(),
}));

import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import {
  bulkUpdateAssetLocation,
  createAsset,
  deleteAsset,
  relinkAssetQrCode,
  replaceAssetPlacements,
  unarchiveAsset,
  updateAsset,
  updateAssetMainImage,
} from "~/modules/asset/service.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { adjustQuantity } from "~/modules/consumption-log/service.server";
import { bulkUpdateKitLocation } from "~/modules/kit/service.server";
import { claimQrCode } from "~/modules/qr/service.server";
import { createTag } from "~/modules/tag/service.server";
import { action as adjustQuantityAction } from "~/routes/api+/mobile+/asset.adjust-quantity";
import { action as createAssetAction } from "~/routes/api+/mobile+/asset.create";
import { action as deleteAssetAction } from "~/routes/api+/mobile+/asset.delete";
import { action as managePlacementsAction } from "~/routes/api+/mobile+/asset.manage-placements";
import { action as reinstateAssetAction } from "~/routes/api+/mobile+/asset.reinstate";
import { action as updateAssetAction } from "~/routes/api+/mobile+/asset.update";
import { action as updateImageAction } from "~/routes/api+/mobile+/asset.update-image";
import { action as updateLocationAction } from "~/routes/api+/mobile+/asset.update-location";
import { action as bulkUpdateLocationAction } from "~/routes/api+/mobile+/bulk-update-location";
import { action as kitsBulkAction } from "~/routes/api+/mobile+/kits.bulk-actions";
import { action as claimQrAction } from "~/routes/api+/mobile+/qr.claim";
import { action as linkQrAction } from "~/routes/api+/mobile+/qr.link-asset";
import { loader as tagsLoader } from "~/routes/api+/mobile+/tags";
import { action as createTagAction } from "~/routes/api+/mobile+/tags.create";

const ORG_ID = "org-1";
const USER = {
  id: "user-1",
  email: "mia@example.com",
  firstName: "Mia",
  lastName: "Hart",
  displayName: null,
};
const SHED = { id: "loc-1", name: "Shed" };
const OFFICE = { id: "loc-2", name: "Office" };
const NO_PERMISSION = "You have no permission to perform this action";

/** The part of the membership query the fake below reads. */
type MembershipQuery = {
  where: { userId: string; organizationId: string };
  select?: {
    organization?: { select?: { managersCanEditAssets?: boolean } };
  };
};

/**
 * Signs the caller in as a member of the workspace holding `role`, with the
 * Managers switch as given. The membership row honours the query's select the
 * way Prisma does, so a permission check that stops selecting the switch reads
 * it as off.
 */
function signIn(
  role: OrganizationRoles,
  workspace: { managersCanEditAssets: boolean }
) {
  vi.mocked(db.userOrganization.findFirst).mockImplementation((({
    where,
    select,
  }: MembershipQuery) =>
    Promise.resolve(
      where.userId === USER.id && where.organizationId === ORG_ID
        ? {
            roles: [role],
            organization: select?.organization?.select?.managersCanEditAssets
              ? { managersCanEditAssets: workspace.managersCanEditAssets }
              : {},
          }
        : null
    )) as never);
  vi.mocked(getMobileUserContext).mockResolvedValue(
    mobileUserContext({ roles: [role], workspace }) as never
  );
}

/** A companion POST: bearer token, workspace in the query, JSON body. */
function post(path: string, body: unknown, query: Record<string, string> = {}) {
  const url = new URL(`http://localhost/api/mobile/${path}`);
  url.searchParams.set("orgId", ORG_ID);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return new Request(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** The status and body a route answered with; `data()` keeps both. */
async function answer(response: Promise<unknown>) {
  const { data: body, init } = (await response) as {
    data: unknown;
    init: ResponseInit | null;
  };
  return { status: init?.status ?? 200, body };
}

/** One mobile route behind a permission gate. */
type GatedRoute = {
  /** The path under /api/mobile, plus the intent where one route has several. */
  name: string;
  /** Answers the reads the route makes once its gate passes. */
  arrange?: () => void;
  /** Calls the route as the companion does. */
  call: () => Promise<unknown>;
  /** The write the route makes once its gate passes. */
  write: unknown;
  /** Fields of the payload that write receives. */
  payload: Record<string, unknown>;
};

const ASSET_UPDATE: GatedRoute = {
  name: "asset/update",
  arrange: () => {
    vi.mocked(updateAsset).mockResolvedValue({
      id: "asset-1",
      title: "Cordless drill",
      description: "",
    } as never);
  },
  call: () =>
    updateAssetAction(
      createActionArgs({
        request: post("asset/update", {
          assetId: "asset-1",
          title: "Cordless drill",
        }),
      })
    ),
  write: updateAsset,
  payload: { id: "asset-1", title: "Cordless drill" },
};

/** Routes the switch opens to a Manager: `asset`, `kit` and `qr` writes. */
const OPENED_BY_SWITCH: GatedRoute[] = [
  {
    name: "asset/create",
    arrange: () => {
      vi.mocked(db.customField.findMany).mockResolvedValue([]);
      vi.mocked(createAsset).mockResolvedValue({
        id: "asset-1",
        title: "Cordless drill",
        type: "INDIVIDUAL",
        unitOfMeasure: null,
        assetLocations: [],
        user: USER,
      } as never);
    },
    call: () =>
      createAssetAction(
        createActionArgs({
          request: post("asset/create", { title: "Cordless drill" }),
        })
      ),
    write: createAsset,
    payload: { title: "Cordless drill", organizationId: ORG_ID },
  },
  ASSET_UPDATE,
  {
    name: "asset/update-image",
    arrange: () => {
      vi.mocked(db.asset.findUnique).mockResolvedValue({
        id: "asset-1",
        title: "Cordless drill",
      } as never);
      vi.mocked(db.asset.findFirst).mockResolvedValue({
        id: "asset-1",
        title: "Cordless drill",
        mainImage: "https://storage.example/drill.jpg",
        thumbnailImage: null,
      } as never);
    },
    call: () =>
      updateImageAction(
        createActionArgs({
          request: post("asset/update-image", {}, { assetId: "asset-1" }),
        })
      ),
    write: updateAssetMainImage,
    payload: { assetId: "asset-1", organizationId: ORG_ID },
  },
  {
    name: "asset/update-location",
    arrange: () => {
      vi.mocked(db.asset.findUnique).mockResolvedValue({
        id: "asset-1",
        title: "Cordless drill",
        type: "INDIVIDUAL",
        quantity: 1,
        unitOfMeasure: null,
        assetLocations: [{ quantity: 1, location: SHED }],
        assetKits: [],
      } as never);
      vi.mocked(db.asset.count).mockResolvedValue(0);
      vi.mocked(db.location.findFirst).mockResolvedValue(OFFICE as never);
      // The row lock (`SELECT ... FOR UPDATE`) answers with the asset.
      vi.mocked(db.$queryRaw).mockResolvedValue([
        { id: "asset-1", type: "INDIVIDUAL", quantity: 1 },
      ] as never);
      vi.mocked(db.assetLocation.findMany).mockResolvedValue([
        { quantity: 1, location: SHED },
      ] as never);
      vi.mocked(db.asset.findUniqueOrThrow).mockResolvedValue({
        id: "asset-1",
        title: "Cordless drill",
        assetLocations: [{ location: OFFICE }],
      } as never);
    },
    call: () =>
      updateLocationAction(
        createActionArgs({
          request: post("asset/update-location", {
            assetId: "asset-1",
            locationId: OFFICE.id,
          }),
        })
      ),
    write: db.assetLocation.create,
    payload: {
      data: expect.objectContaining({
        assetId: "asset-1",
        locationId: OFFICE.id,
      }),
    },
  },
  {
    name: "asset/manage-placements",
    arrange: () => {
      vi.mocked(db.asset.findUniqueOrThrow).mockResolvedValue({
        id: "asset-1",
        title: "Cordless drill",
        assetLocations: [
          { quantity: 1, assetKitId: null, location: OFFICE, assetKit: null },
        ],
      } as never);
    },
    call: () =>
      managePlacementsAction(
        createActionArgs({
          request: post("asset/manage-placements", {
            assetId: "asset-1",
            placements: [{ locationId: OFFICE.id, quantity: 1 }],
          }),
        })
      ),
    write: replaceAssetPlacements,
    payload: {
      assetId: "asset-1",
      placements: [{ locationId: OFFICE.id, quantity: 1 }],
    },
  },
  {
    name: "asset/adjust-quantity",
    arrange: () => {
      vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue(USER as never);
    },
    call: () =>
      adjustQuantityAction(
        createActionArgs({
          request: post("asset/adjust-quantity", {
            assetId: "asset-1",
            quantity: 5,
            category: "RESTOCK",
            direction: "add",
          }),
        })
      ),
    write: adjustQuantity,
    payload: { assetId: "asset-1", quantity: 5, direction: "add" },
  },
  {
    name: "bulk-update-location",
    arrange: () => {
      // None of the assets is archived.
      vi.mocked(db.asset.findMany).mockResolvedValue([]);
      vi.mocked(getAssetIndexSettings).mockResolvedValue({} as never);
    },
    call: () =>
      bulkUpdateLocationAction(
        createActionArgs({
          request: post("bulk-update-location", {
            assetIds: ["asset-1", "asset-2"],
            locationId: OFFICE.id,
          }),
        })
      ),
    write: bulkUpdateAssetLocation,
    payload: { assetIds: ["asset-1", "asset-2"], newLocationId: OFFICE.id },
  },
  {
    name: "kits/bulk-actions (update-location)",
    call: () =>
      kitsBulkAction(
        createActionArgs({
          request: post("kits/bulk-actions", {
            intent: "update-location",
            kitIds: ["kit-1"],
            newLocationId: OFFICE.id,
          }),
        })
      ),
    write: bulkUpdateKitLocation,
    payload: { kitIds: ["kit-1"], newLocationId: OFFICE.id },
  },
  {
    name: "qr/claim",
    arrange: () => {
      vi.mocked(db.qr.findUnique).mockResolvedValue({
        id: "qr-1",
        assetId: null,
        kitId: null,
      } as never);
      vi.mocked(claimQrCode).mockResolvedValue({
        id: "qr-1",
        organizationId: ORG_ID,
        assetId: null,
        kitId: null,
      } as never);
    },
    call: () =>
      claimQrAction(
        createActionArgs({ request: post("qr/claim", { qrId: "qr-1" }) })
      ),
    write: claimQrCode,
    payload: { id: "qr-1", organizationId: ORG_ID },
  },
  {
    name: "qr/link-asset",
    arrange: () => {
      // The asset belongs to the caller's workspace.
      vi.mocked(db.asset.findMany).mockResolvedValue([
        { id: "asset-1" },
      ] as never);
    },
    call: () =>
      linkQrAction(
        createActionArgs({
          request: post("qr/link-asset", { qrId: "qr-1", assetId: "asset-1" }),
        })
      ),
    write: relinkAssetQrCode,
    payload: { qrId: "qr-1", assetId: "asset-1" },
  },
];

/** Routes the switch never opens: delete, archive and tag creation. */
const CLOSED_TO_MANAGERS: GatedRoute[] = [
  {
    name: "asset/delete",
    call: () =>
      deleteAssetAction(
        createActionArgs({
          request: post("asset/delete", { assetId: "asset-1" }),
        })
      ),
    write: deleteAsset,
    payload: { id: "asset-1", organizationId: ORG_ID },
  },
  {
    name: "asset/reinstate",
    arrange: () => {
      vi.mocked(unarchiveAsset).mockResolvedValue({ id: "asset-1" } as never);
    },
    call: () =>
      reinstateAssetAction(
        createActionArgs({
          request: post("asset/reinstate", { assetId: "asset-1" }),
        })
      ),
    write: unarchiveAsset,
    payload: { id: "asset-1", organizationId: ORG_ID },
  },
  {
    name: "tags/create",
    arrange: () => {
      vi.mocked(createTag).mockResolvedValue({
        id: "tag-2",
        name: "Power tools",
      } as never);
    },
    call: () =>
      createTagAction(
        createActionArgs({
          request: post("tags/create", { name: "Power tools" }),
        })
      ),
    write: createTag,
    payload: { name: "Power tools", organizationId: ORG_ID },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({ user: USER } as never);
  vi.mocked(requireOrganizationAccess).mockResolvedValue(ORG_ID);
  // The transaction client is the same fake client.
  vi.mocked(db.$transaction).mockImplementation(((
    run: (tx: typeof db) => unknown
  ) => run(db)) as never);
});

describe.each(OPENED_BY_SWITCH)("POST /api/mobile/$name", (route) => {
  beforeEach(() => route.arrange?.());

  it("refuses a Manager with 403 while the switch is off, and writes nothing", async () => {
    signIn("MANAGER", { managersCanEditAssets: false });

    expect(await answer(route.call())).toEqual({
      status: 403,
      body: { error: { message: NO_PERMISSION } },
    });
    expect(route.write).not.toHaveBeenCalled();
  });

  it("lets a Manager write once the switch is on", async () => {
    signIn("MANAGER", { managersCanEditAssets: true });

    const { status } = await answer(route.call());

    expect(status).toBe(200);
    expect(route.write).toHaveBeenCalledWith(
      expect.objectContaining(route.payload)
    );
  });
});

describe.each(CLOSED_TO_MANAGERS)("POST /api/mobile/$name", (route) => {
  beforeEach(() => route.arrange?.());

  it.each([false, true])(
    "refuses a Manager with 403 (switch on: %s), and writes nothing",
    async (managersCanEditAssets) => {
      signIn("MANAGER", { managersCanEditAssets });

      expect(await answer(route.call())).toEqual({
        status: 403,
        body: { error: { message: NO_PERMISSION } },
      });
      expect(route.write).not.toHaveBeenCalled();
    }
  );

  it("lets an Admin write, so the refusal is the role's", async () => {
    signIn("ADMIN", { managersCanEditAssets: false });

    const { status } = await answer(route.call());

    expect(status).toBe(200);
    expect(route.write).toHaveBeenCalledWith(
      expect.objectContaining(route.payload)
    );
  });
});

describe("POST /api/mobile/asset/update for the roles the switch does not name", () => {
  beforeEach(() => ASSET_UPDATE.arrange?.());

  it.each(["OWNER", "ADMIN"] as const)(
    "lets an %s write with the switch off",
    async (role) => {
      signIn(role, { managersCanEditAssets: false });

      const { status } = await answer(ASSET_UPDATE.call());

      expect(status).toBe(200);
      expect(updateAsset).toHaveBeenCalledWith(
        expect.objectContaining(ASSET_UPDATE.payload)
      );
    }
  );

  it.each(["SELF_SERVICE", "BASE"] as const)(
    "refuses %s with 403 with the switch on, and writes nothing",
    async (role) => {
      signIn(role, { managersCanEditAssets: true });

      expect(await answer(ASSET_UPDATE.call())).toEqual({
        status: 403,
        body: { error: { message: NO_PERMISSION } },
      });
      expect(updateAsset).not.toHaveBeenCalled();
    }
  );
});

describe("GET /api/mobile/tags", () => {
  const callTags = () =>
    answer(
      tagsLoader(
        createLoaderArgs({
          request: new Request(
            `http://localhost/api/mobile/tags?orgId=${ORG_ID}`,
            {
              headers: { Authorization: "Bearer token" },
            }
          ),
        })
      )
    );

  beforeEach(() => {
    vi.mocked(db.tag.findMany).mockResolvedValue([
      { id: "tag-1", name: "Power tools" },
    ] as never);
  });

  it.each([false, true])(
    "never offers a Manager tag creation (switch on: %s)",
    async (managersCanEditAssets) => {
      signIn("MANAGER", { managersCanEditAssets });

      expect(await callTags()).toEqual({
        status: 200,
        body: {
          tags: [{ id: "tag-1", name: "Power tools" }],
          canCreate: false,
        },
      });
    }
  );

  it("offers an Admin tag creation", async () => {
    signIn("ADMIN", { managersCanEditAssets: false });

    expect(await callTags()).toEqual({
      status: 200,
      body: { tags: [{ id: "tag-1", name: "Power tools" }], canCreate: true },
    });
  });
});
