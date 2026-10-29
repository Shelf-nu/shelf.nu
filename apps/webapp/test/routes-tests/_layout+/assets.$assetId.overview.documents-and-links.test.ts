// @vitest-environment node
/**
 * Asset overview loader: the Link fields behind the "Documents & links" card.
 *
 * The card lists every Link field that applies to the asset, unset ones as
 * "Not linked", for every reader. So the Link definitions decide which rows
 * are displayed and must load for a member who cannot edit the asset, while
 * the editor-only definitions stay skipped for them.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.$assetId.overview.tsx}
 * @see {@link file://./../../../app/components/assets/asset-overview-custom-fields.tsx}
 */
import { OrganizationRoles } from "@prisma/client";
import { createCustomField } from "@factories";
import { permissionContext } from "@helpers/role-access";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequirePermission } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
}));
// why: the RBAC gate is not under test; it hands back the viewer's access.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mockRequirePermission,
}));

// why: the audits add-on rule also reads premium env flags; it is reduced to
// the workspace's own flag, which these tests keep off.
vi.mock("~/utils/subscription.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  canUseAudits: (org: { auditsEnabled: boolean }) => org.auditsEnabled,
}));

const { mockGetAsset } = vi.hoisted(() => ({ mockGetAsset: vi.fn() }));
// why: the asset read and the editor's category and location pickers hit the
// database; the test supplies the asset row and empty pickers.
vi.mock("~/modules/asset/service.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAsset: mockGetAsset,
  getCategoriesForCreateAndEdit: vi
    .fn()
    .mockResolvedValue({ categories: [], totalCategories: 0 }),
  getLocationsForCreateAndEdit: vi
    .fn()
    .mockResolvedValue({ locations: [], totalLocations: 0 }),
}));

// why: the last scan read hits the database and is pinned in its own test.
vi.mock("~/modules/scan/service.server", () => ({
  getLastScanForViewer: vi.fn().mockResolvedValue(null),
}));

// why: QR generation reads and writes QR rows; unrelated to custom fields.
vi.mock("~/modules/qr/utils.server", () => ({
  generateQrObj: vi.fn().mockResolvedValue({}),
}));

// why: reminders are a database read unrelated to custom fields.
vi.mock("~/modules/asset-reminder/service.server", () => ({
  getRemindersForOverviewPage: vi.fn().mockResolvedValue([]),
}));

const { mockGetActiveCustomFields } = vi.hoisted(() => ({
  mockGetActiveCustomFields: vi.fn(),
}));
// why: the definitions come from Postgres; the test supplies one Link field
// and one plain field, and answers by the filter each call asks for.
vi.mock("~/modules/custom-field/service.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getActiveCustomFields: mockGetActiveCustomFields,
}));

import { loader } from "~/routes/_layout+/assets.$assetId.overview";

const manual = createCustomField({
  id: "cf-manual",
  name: "Manual",
  format: "LINK",
});
const serial = createCustomField({ id: "cf-serial", name: "Serial number" });

/** Grants `roles` in a workspace with the audits add-on off. */
function grant(roles: OrganizationRoles[]) {
  const ctx = permissionContext({ roles });
  mockRequirePermission.mockResolvedValue({
    ...ctx,
    currentOrganization: { ...ctx.currentOrganization, auditsEnabled: false },
    canUseBarcodes: false,
  });
}

/** Runs the loader and returns the custom field part of its payload. */
async function load() {
  return (await loader({
    request: new Request("http://localhost/assets/asset-1/overview"),
    params: { assetId: "asset-1" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof loader>[0])) as unknown as {
    linkDefinitions: unknown[];
    allCustomFieldDefs: unknown[];
  };
}

describe("asset overview loader: Documents & links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAsset.mockResolvedValue({
      id: "asset-1",
      title: "Camera",
      type: "INDIVIDUAL",
      categoryId: "cat-cameras",
      customFields: [],
      assetLocations: [],
      custody: [],
    });
    mockGetActiveCustomFields.mockImplementation(
      ({ format }: { format?: string }) =>
        Promise.resolve(format === "LINK" ? [manual] : [manual, serial])
    );
  });

  it("sends the Link fields to a member who cannot edit the asset", async () => {
    grant([OrganizationRoles.BASE]);

    const result = await load();

    expect(mockGetActiveCustomFields).toHaveBeenCalledWith({
      organizationId: "org-1",
      category: "cat-cameras",
      format: "LINK",
    });
    expect(result.linkDefinitions).toEqual([
      {
        id: "cf-manual",
        name: "Manual",
        type: "TEXT",
        format: "LINK",
        options: [],
      },
    ]);
    expect(result.allCustomFieldDefs).toEqual([]);
  });

  it("sends the same Link fields to an editor, beside the editable definitions", async () => {
    grant([OrganizationRoles.ADMIN]);

    const result = await load();

    expect(result.linkDefinitions).toEqual([
      expect.objectContaining({ id: "cf-manual", format: "LINK" }),
    ]);
    expect(result.allCustomFieldDefs).toHaveLength(2);
  });
});
