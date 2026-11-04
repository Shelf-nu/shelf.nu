// @vitest-environment node
/**
 * What the read-only loaders hand a Manager when the owner turns "Managers
 * can edit assets" (`Organization.managersCanEditAssets`) on or off.
 *
 * These loaders gate on `read`, so every member reaches them. What changes is
 * the data behind an edit the member may run: the asset overview's inline
 * editor options, the scanner's location list and the kit page's booking
 * impact for Remove follow the switch. The sequential id prompt in the app
 * layout does not: the migration rewrites every asset, so the matrix alone
 * decides.
 *
 * Every case runs the real `requirePermission` and `hasPermission` over a
 * membership whose switch the case sets. Only the membership lookup and the
 * reads behind each loader are stubbed.
 *
 * @see {@link file://./../../../../packages/permissions/src/workspace-grants.ts}
 * @see {@link file://./manager-edit-switch.web-gates.test.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_TOGGLES_OFF } from "@helpers/role-access";
import { createLoaderArgs } from "@mocks/remix";

import {
  getAsset,
  getCategoriesForCreateAndEdit,
} from "~/modules/asset/service.server";
import {
  getAssetsForKits,
  getBookingImpactForAssetKits,
} from "~/modules/kit/service.server";
import { getSelectedOrganization } from "~/modules/organization/context.server";
import { getUserByID } from "~/modules/user/service.server";
import { loader as layoutLoader } from "~/routes/_layout+/_layout";
import { loader as assetOverviewLoader } from "~/routes/_layout+/assets.$assetId.overview";
import { loader as kitAssetsLoader } from "~/routes/_layout+/kits.$kitId.assets";
import { loader as scannerLoader } from "~/routes/_layout+/scanner";

const USER_ID = "user-1";
const ORG_ID = "org-1";

/** The Prisma calls the loaders make directly, outside a service. */
const dbMock = vi.hoisted(() => ({
  location: {
    findMany: vi.fn(async () => [{ id: "loc-1", name: "Studio" }]),
    count: vi.fn(async () => 1),
  },
  kit: {
    findFirst: vi.fn(async () => ({ name: "Camera kit" })),
    findMany: vi.fn(async () => []),
  },
  assetKit: { count: vi.fn(async () => 0) },
  booking: { findFirst: vi.fn(async () => null) },
  bookingAsset: { groupBy: vi.fn(async () => []) },
}));

// why: memberships come from the session cookie and the database. They are
// the input these cases vary (role, switch), so they are supplied directly;
// `requirePermission`, which consumes them, is real.
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: vi.fn(),
  setSelectedOrganizationIdCookie: vi.fn(async () => "org=org-1"),
}));

// why: no database runs in unit tests.
vi.mock("~/database/db.server", () => ({ db: dbMock }));

// why: the asset row and the editor's option lists are database reads with
// their own tests; the cases read whether the loader asks for the options.
vi.mock("~/modules/asset/service.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/modules/asset/service.server")>()),
  getAsset: vi.fn(),
  getCategoriesForCreateAndEdit: vi.fn(async () => ({
    categories: [{ id: "cat-1", name: "Cameras" }],
    totalCategories: 1,
  })),
  getLocationsForCreateAndEdit: vi.fn(async () => ({
    locations: [{ id: "loc-1", name: "Studio" }],
    totalLocations: 1,
  })),
}));

// why: custom field definitions are a database read.
vi.mock("~/modules/custom-field/service.server", () => ({
  getActiveCustomFields: vi.fn(async () => []),
}));

// why: the last scan, the QR object and the reminders are database reads the
// overview page shows to every reader alike.
vi.mock("~/modules/scan/service.server", () => ({
  getLastScanForViewer: vi.fn(async () => null),
}));
vi.mock("~/modules/qr/utils.server", () => ({
  generateQrObj: vi.fn(async () => ({ qr: null })),
}));
vi.mock("~/modules/asset-reminder/service.server", () => ({
  getRemindersForOverviewPage: vi.fn(async () => []),
}));

// why: the kit's member page and its booking impact are database reads with
// their own service tests.
vi.mock("~/modules/kit/service.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/modules/kit/service.server")>()),
  getAssetsForKits: vi.fn(),
  getBookingImpactForAssetKits: vi.fn(),
}));

// why: the scanner's custodian picker reads team members from the database.
vi.mock("~/modules/team-member/service.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/modules/team-member/service.server")
  >()),
  getTeamMemberForCustodianFilter: vi.fn(async () => ({
    teamMembers: [],
    totalTeamMembers: 0,
  })),
}));

// why: the layout loader reads the signed-in user row from the database.
vi.mock("~/modules/user/service.server", () => ({ getUserByID: vi.fn() }));

// why: booking settings, working hours, unread updates and the running import
// are database reads the layout passes through unchanged.
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn(async () => null),
}));
vi.mock("~/modules/working-hours/service.server", () => ({
  getWorkingHoursForOrganization: vi.fn(async () => null),
}));
vi.mock("~/modules/update/service.server", () => ({
  getUnreadCountForUser: vi.fn(async () => 0),
}));
vi.mock("~/modules/asset-import/service.server", () => ({
  getActiveAssetImport: vi.fn(async () => null),
}));

// why: the disabled-team check calls Stripe.
vi.mock("~/utils/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/stripe.server")>()),
  disabledTeamOrg: vi.fn(async () => false),
}));

// why: the per-page preference cookie is parsed from the request and is
// irrelevant to the flags under test.
vi.mock("~/utils/cookies.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/cookies.server")>()),
  initializePerPageCookieOnLayout: vi.fn(async () => ({})),
}));

/**
 * Signs the caller in as `role` in a workspace whose "Managers can edit
 * assets" switch is `managersCanEditAssets`.
 */
function signInAs(
  role: OrganizationRoles,
  { managersCanEditAssets }: { managersCanEditAssets: boolean }
) {
  const workspace = {
    id: ORG_ID,
    name: "Acme",
    type: "TEAM",
    currency: "USD",
    barcodesEnabled: false,
    auditsEnabled: false,
    workspaceDisabled: false,
    hasSequentialIdsMigrated: false,
    ...ALL_TOGGLES_OFF,
    managersCanEditAssets,
  };
  vi.mocked(getSelectedOrganization).mockResolvedValue({
    organizationId: ORG_ID,
    organizations: [workspace],
    currentOrganization: workspace,
    userOrganizations: [{ organization: workspace, roles: [role] }],
    cookieRefreshNeeded: false,
    noVisibleOrganizations: false,
  } as never);
  vi.mocked(getUserByID).mockResolvedValue({
    id: USER_ID,
    email: "mia@example.com",
    onboarded: true,
    customerId: null,
    sso: true,
    hasUnpaidInvoice: false,
    warnForNoPaymentMethod: false,
    roles: [],
    userOrganizations: [
      { id: "uo-1", roles: [role], organization: { id: ORG_ID } },
    ],
  } as never);
}

const context = { getSession: () => ({ userId: USER_ID }) } as never;

/** Runs `loader` for `path` and returns its payload. */
async function load(
  loader: (args: never) => unknown,
  path: string,
  params: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const result = (await loader(
    createLoaderArgs({
      request: new Request(`http://localhost${path}`),
      params,
      context,
    }) as never
  )) as Record<string, unknown>;
  // `data(payload(...))` wraps the payload; a bare `payload(...)` does not.
  return (
    result.type === "DataWithResponseInit" ? result.data : result
  ) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAsset).mockResolvedValue({
    id: "asset-1",
    title: "Tripod",
    type: "INDIVIDUAL",
    categoryId: null,
    customFields: [],
    custody: [],
    assetLocations: [],
  } as never);
  vi.mocked(getAssetsForKits).mockResolvedValue({
    items: [{ id: "asset-1", assetKits: [{ id: "ak-1", kitId: "kit-1" }] }],
  } as never);
  vi.mocked(getBookingImpactForAssetKits).mockResolvedValue({
    "ak-1": { reserved: [{ id: "booking-1", name: "Shoot" }] },
  } as never);
});

describe("asset overview loader: inline editor options (canEditAsset)", () => {
  const overview = () =>
    load(assetOverviewLoader, "/assets/asset-1/overview", {
      assetId: "asset-1",
    });

  it("gives a Manager no editor options while the switch is off", async () => {
    signInAs(OrganizationRoles.MANAGER, { managersCanEditAssets: false });

    const page = await overview();

    expect(page.categories).toEqual([]);
    expect(page.locations).toEqual([]);
    expect(getCategoriesForCreateAndEdit).not.toHaveBeenCalled();
  });

  it("gives a Manager the editor options once the switch is on", async () => {
    signInAs(OrganizationRoles.MANAGER, { managersCanEditAssets: true });

    const page = await overview();

    expect(page.categories).toEqual([{ id: "cat-1", name: "Cameras" }]);
    expect(page.locations).toEqual([{ id: "loc-1", name: "Studio" }]);
  });
});

describe("scanner loader: the Update location list (canUpdateLocations)", () => {
  it("gives a Manager no locations while the switch is off", async () => {
    signInAs(OrganizationRoles.MANAGER, { managersCanEditAssets: false });

    const page = await load(scannerLoader, "/scanner");

    expect(page.locations).toBeUndefined();
    expect(dbMock.location.findMany).not.toHaveBeenCalled();
  });

  it("gives a Manager the locations once the switch is on", async () => {
    signInAs(OrganizationRoles.MANAGER, { managersCanEditAssets: true });

    const page = await load(scannerLoader, "/scanner");

    expect(page.totalLocations).toBe(1);
    expect(page.locations).toEqual([
      { id: "loc-1", name: "Studio" },
      { id: "loc-1", name: "Studio" },
    ]);
  });
});

describe("kit assets loader: booking impact for Remove (canUpdateKit)", () => {
  const kitAssets = () =>
    load(kitAssetsLoader, "/kits/kit-1/assets", { kitId: "kit-1" });

  it("gives a Manager no booking impact while the switch is off", async () => {
    signInAs(OrganizationRoles.MANAGER, { managersCanEditAssets: false });

    const page = await kitAssets();

    expect(page).not.toHaveProperty("bookingImpactByAssetId");
    expect(getBookingImpactForAssetKits).not.toHaveBeenCalled();
  });

  it("gives a Manager the booking impact once the switch is on", async () => {
    signInAs(OrganizationRoles.MANAGER, { managersCanEditAssets: true });

    const page = await kitAssets();

    expect(page.bookingImpactByAssetId).toEqual({
      "asset-1": { reserved: [{ id: "booking-1", name: "Shoot" }] },
    });
  });
});

describe("_layout loader: the sequential id prompt (needsSequentialIdMigration)", () => {
  it("never prompts a Manager, even with the switch on", async () => {
    signInAs(OrganizationRoles.MANAGER, { managersCanEditAssets: true });

    const page = await load(layoutLoader, "/assets");

    expect(page.needsSequentialIdMigration).toBe(false);
  });

  it("prompts an Administrator of a workspace that has not migrated", async () => {
    signInAs(OrganizationRoles.ADMIN, { managersCanEditAssets: true });

    const page = await load(layoutLoader, "/assets");

    expect(page.needsSequentialIdMigration).toBe(true);
  });
});
