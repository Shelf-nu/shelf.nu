// @vitest-environment node
/**
 * Advanced assets index loader: titles for the link chips in custom field
 * columns.
 *
 * The page's rows carry each value's field id and type but not its format, so
 * the loader picks the Link field values with the active field definitions it
 * already loads, hands only those to `getLinkTitles`, and returns the answer
 * as `linkTitles`, the same fixture the chip tests render.
 *
 * Every other read is stubbed so the loader runs to the end.
 *
 * @see {@link file://./data.server.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCustomField } from "@factories";
import { LINK_TITLES, MANUAL_URL, SHOP_URL } from "@helpers/link-titles";
import { permissionContext } from "@helpers/role-access";

import type { Column } from "~/modules/asset-index-settings/helpers";

// why: the kit and booking filter options are read straight from Postgres;
// the page has none.
vi.mock("~/database/db.server", () => ({
  db: {
    kit: { findMany: vi.fn(() => []), count: vi.fn(() => 0) },
    booking: { findMany: vi.fn(() => []), count: vi.fn(() => 0) },
  },
}));

// why: the filters come from a cookie or the URL; the test fixes them as empty.
vi.mock("~/utils/cookies.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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

const { mockAssetsPage } = vi.hoisted(() => ({ mockAssetsPage: vi.fn() }));
// why: the page of assets comes from a raw SQL query; the test supplies the
// rows, shaped as that query returns their custom field values.
vi.mock("./service.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAdvancedPaginatedAndFilterableAssets: mockAssetsPage,
  getEntitiesWithSelectedValues: vi.fn(() =>
    Promise.resolve({
      tags: [],
      totalTags: 0,
      categories: [],
      totalCategories: 0,
      locations: [],
      totalLocations: 0,
      assetModels: [],
      totalAssetModels: 0,
    })
  ),
  refreshExpiredAssetImages: vi.fn((assets: unknown[]) =>
    Promise.resolve(assets)
  ),
}));

// why: the active custom fields come from Postgres: one Link field and one
// plain field, both of which hold a URL on this page.
vi.mock("../custom-field/service.server", () => ({
  getActiveCustomFields: vi.fn(() =>
    Promise.resolve([
      createCustomField({ id: "cf-manual", name: "Manual", format: "LINK" }),
      createCustomField({ id: "cf-supplier", name: "Supplier" }),
    ])
  ),
}));

// why: the filter and form option reads below hit the database; the page has
// none of them.
vi.mock("../team-member/service.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getTeamMemberForCustodianFilter: vi.fn(() =>
    Promise.resolve({ teamMembers: [], totalTeamMembers: 0 })
  ),
  getTeamMembersForNotify: vi.fn(() => Promise.resolve({})),
}));
vi.mock("../tag/service.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getTagsForBookingTagsFilter: vi.fn(() =>
    Promise.resolve({ tags: [], totalTags: 0 })
  ),
}));
vi.mock("../asset-filter-presets/service.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listPresetsForUser: vi.fn(() => Promise.resolve([])),
}));
vi.mock("./quantity-breakdown.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getStillOutBookingRowsByAsset: vi.fn(() => Promise.resolve(new Map())),
}));

// why: the import gate reads the owner's tier from the database, and the
// audits rule also reads premium env flags.
vi.mock("~/utils/subscription.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveCanImportAssets: vi.fn(() => Promise.resolve(true)),
  canUseAudits: () => false,
}));

const { mockGetLinkTitles } = vi.hoisted(() => ({
  mockGetLinkTitles: vi.fn(),
}));
// why: the titles are read from LinkPreview rows in Postgres (and links due a
// fetch are queued); the test records which values the loader hands over.
vi.mock("../link-preview/service.server", () => ({
  getLinkTitles: mockGetLinkTitles,
}));

import { advancedModeLoader } from "./data.server";

/** One custom field value as the index's SQL returns it. */
function value(fieldId: string, raw: string) {
  return {
    value: { raw, valueText: raw },
    customField: { id: fieldId, name: fieldId, type: "TEXT" },
  };
}

/** Runs the loader to the end for an admin and returns its payload. */
async function load() {
  const ctx = permissionContext({ roles: [OrganizationRoles.ADMIN] });
  const result = await advancedModeLoader({
    request: new Request("http://localhost/assets"),
    userId: "user-1",
    organizationId: "org-1",
    organizations: [{ id: "org-1" }],
    role: OrganizationRoles.ADMIN,
    currentOrganization: { ...ctx.currentOrganization, auditsEnabled: false },
    user: { firstName: "A", lastName: "B", displayName: null },
    settings: {
      mode: "ADVANCED",
      columns: [{ name: "cf_Manual", visible: true, position: 1 }] as Column[],
    },
    canSeeAllCustody: true,
    access: ctx.access,
  } as unknown as Parameters<typeof advancedModeLoader>[0]);
  return (result as unknown as { data: { linkTitles: unknown } }).data;
}

describe("advancedModeLoader: link titles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssetsPage.mockResolvedValue({
      search: null,
      totalAssets: 2,
      perPage: 20,
      page: 1,
      totalPages: 1,
      cookie: {},
      assets: [
        {
          id: "asset-1",
          customFields: [
            value("cf-manual", MANUAL_URL),
            value("cf-supplier", "https://www.example.com/supplier"),
          ],
        },
        { id: "asset-2", customFields: [value("cf-manual", SHOP_URL)] },
      ],
    });
    mockGetLinkTitles.mockResolvedValue(LINK_TITLES);
  });

  it("reads titles for the page's Link field values only and returns them", async () => {
    const payload = await load();

    expect(mockGetLinkTitles).toHaveBeenCalledWith({
      organizationId: "org-1",
      values: [
        {
          value: { raw: MANUAL_URL, valueText: MANUAL_URL },
          customField: { type: "TEXT", format: "LINK" },
        },
        {
          value: { raw: SHOP_URL, valueText: SHOP_URL },
          customField: { type: "TEXT", format: "LINK" },
        },
      ],
    });
    expect(payload.linkTitles).toEqual(LINK_TITLES);
  });
});
