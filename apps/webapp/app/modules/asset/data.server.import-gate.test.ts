// @vitest-environment node
/**
 * Assets index loaders: the import gate.
 *
 * Both loaders decide whether to offer "Import" through
 * `resolveCanImportAssets`, which combines the plan and the `asset: import`
 * permission. This pins the WIRING only: each loader asks that helper, with the
 * member's own workspace and role, and the simple loader returns its answer as
 * `canImportAssets`. The helper's answer is covered in
 * `test/utils/subscription.server.test.ts`.
 *
 * The simple loader's reads are stubbed, so it runs to the end. The advanced
 * loader reads a dozen more things that are not: every database call returns a
 * promise that never settles, so it parks on its parallel reads, by which time
 * the helper has been called and its arguments are recorded.
 *
 * @see {@link file://./data.server.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionContext } from "@helpers/role-access";

import type { Column } from "~/modules/asset-index-settings/helpers";

// why: importing the loader pulls in `db.server`, which would otherwise open a
// real PostgreSQL connection. Any call (`db.asset.findMany(...)`,
// `db.$queryRaw(...)`) returns a promise that never settles, so the loader
// stops at its parallel reads without failing them.
vi.mock("~/database/db.server", () => {
  const pending: unknown = new Proxy(() => {}, {
    get: () => pending,
    apply: () => new Promise(() => {}),
  });
  return { db: pending };
});

// why: the filters come from a cookie or the URL; the test fixes them as empty.
vi.mock("~/utils/cookies.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getFiltersFromRequest: vi.fn(() =>
    Promise.resolve({
      filters: "",
      serializedCookie: null,
      redirectNeeded: false,
    })
  ),
  getAdvancedFiltersFromRequest: vi.fn(() =>
    Promise.resolve({
      filters: "",
      serializedCookie: null,
      redirectNeeded: false,
    })
  ),
}));

// why: parsing expands location hierarchies from the database.
vi.mock("./query.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  parseFiltersWithHierarchy: vi.fn(() => Promise.resolve([])),
}));

// why: resolves the selected filter values from the database.
vi.mock("./utils.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAllSelectedValuesFromFilters: vi.fn(() =>
    Promise.resolve({
      selectedTags: [],
      selectedCategory: [],
      selectedLocation: [],
      selectedAssetModel: [],
    })
  ),
}));

// why: reads the member's date preferences from the database.
vi.mock("~/utils/date-format.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveUserFormatPrefsById: vi.fn(() => Promise.resolve({ timeZone: "UTC" })),
}));

// why: the simple loader's reads hit the database; they return an empty page.
vi.mock("./service.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPaginatedAndFilterableAssets: vi.fn(() =>
    Promise.resolve({
      search: null,
      totalAssets: 0,
      perPage: 20,
      page: 1,
      categories: [],
      tags: [],
      assets: [],
      totalPages: 0,
      cookie: {},
      totalCategories: 0,
      totalTags: 0,
      locations: [],
      totalLocations: 0,
      assetModels: [],
      totalAssetModels: 0,
      teamMembers: [],
      totalTeamMembers: 0,
    })
  ),
  refreshExpiredAssetImages: vi.fn((assets: unknown[]) =>
    Promise.resolve(assets)
  ),
}));
// why: same, for the simple loader's other parallel reads.
vi.mock("../tag/service.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getTagsForBookingTagsFilter: vi.fn(() =>
    Promise.resolve({ tags: [], totalTags: 0 })
  ),
}));
vi.mock("../team-member/service.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getTeamMembersForNotify: vi.fn(() => Promise.resolve({})),
}));
vi.mock("../asset-filter-presets/service.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listPresetsForUser: vi.fn(() => Promise.resolve([])),
}));
vi.mock("./quantity-breakdown.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getStillOutBookingRowsByAsset: vi.fn(() => Promise.resolve(new Map())),
}));

const { mockResolveCanImport } = vi.hoisted(() => ({
  mockResolveCanImport: vi.fn(),
}));
// why: the import gate reads the owner's tier from the database; the test
// records what each loader asks it. The audits rule is reduced to the
// workspace's own flag because it also reads premium env flags.
vi.mock("~/utils/subscription.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveCanImportAssets: mockResolveCanImport,
  canUseAudits: (org: { auditsEnabled: boolean }) => org.auditsEnabled,
}));

import { advancedModeLoader, simpleModeLoader } from "./data.server";

const columns = [{ name: "category", visible: true, position: 1 }] as Column[];

/** The props both loaders take, for a member holding `role`. */
function props(role: OrganizationRoles, mode: "SIMPLE" | "ADVANCED") {
  const ctx = permissionContext({ roles: [role] });
  return {
    request: new Request("http://localhost/assets"),
    userId: "user-1",
    organizationId: "org-1",
    organizations: [{ id: "org-1" }],
    role,
    currentOrganization: { ...ctx.currentOrganization, auditsEnabled: true },
    user: { firstName: "A", lastName: "B", displayName: null },
    settings: { mode, columns },
    canSeeAllCustody: true,
    access: ctx.access,
  } as unknown as Parameters<typeof simpleModeLoader>[0];
}

describe("assets index loaders: import gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCanImport.mockResolvedValue(true);
  });

  it.each([
    ["simple", simpleModeLoader, "SIMPLE"],
    ["advanced", advancedModeLoader, "ADVANCED"],
  ] as const)(
    "the %s loader asks resolveCanImportAssets with the member's workspace and role",
    async (_name, loader, mode) => {
      // Never settles: the stubbed database parks it on its parallel reads.
      void loader(props(OrganizationRoles.BASE, mode));

      await vi.waitFor(() =>
        expect(mockResolveCanImport).toHaveBeenCalledTimes(1)
      );
      expect(mockResolveCanImport).toHaveBeenCalledWith({
        organizationId: "org-1",
        organizations: [{ id: "org-1" }],
        userId: "user-1",
        role: OrganizationRoles.BASE,
      });
    }
  );

  it.each([true, false])(
    "the simple loader returns the helper's answer (%s) as canImportAssets",
    async (answer) => {
      mockResolveCanImport.mockResolvedValue(answer);

      // Read as `unknown`: the loader's inferred return type is large, and
      // the assertion below only needs one path through it.
      const result: unknown = await (
        simpleModeLoader as (args: unknown) => Promise<unknown>
      )(props(OrganizationRoles.ADMIN, "SIMPLE"));

      expect(result).toHaveProperty("data.canImportAssets", answer);
    }
  );
});
