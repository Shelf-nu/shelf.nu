// @vitest-environment node
/**
 * Asset overview loader: the Link fields behind the "Documents & links" card.
 *
 * The card lists every Link field that applies to the asset, unset ones as
 * "Not linked", for every reader. So the Link definitions decide which rows
 * are displayed and must load for a member who cannot edit the asset, while
 * the editor-only definitions stay skipped for them.
 *
 * The loader also sends `linkTitles` for the links among the values shown,
 * the same fixture the chip tests render, and reads them in the same batch as
 * the editor data.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.$assetId.overview.tsx}
 * @see {@link file://./../../../app/components/assets/asset-overview-custom-fields.tsx}
 */
import { OrganizationRoles } from "@prisma/client";
import { createCustomField } from "@factories";
import { LINK_TITLES, MANUAL_URL } from "@helpers/link-titles";
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

const { mockGetLinkTitles } = vi.hoisted(() => ({
  mockGetLinkTitles: vi.fn(),
}));
// why: the titles are read from LinkPreview rows in Postgres (and links due a
// fetch are queued); the test records which values the loader hands over.
vi.mock("~/modules/link-preview/service.server", () => ({
  getLinkTitles: mockGetLinkTitles,
}));

import { getCategoriesForCreateAndEdit } from "~/modules/asset/service.server";
import { loader } from "~/routes/_layout+/assets.$assetId.overview";

const manual = createCustomField({
  id: "cf-manual",
  name: "Manual",
  format: "LINK",
});
const serial = createCustomField({ id: "cf-serial", name: "Serial number" });

/** The asset row `getAsset` returns, with no custom field values. */
const camera = {
  id: "asset-1",
  title: "Camera",
  type: "INDIVIDUAL",
  categoryId: "cat-cameras",
  customFields: [],
  assetLocations: [],
  custody: [],
};

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
    linkTitles: unknown;
  };
}

describe("asset overview loader: Documents & links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAsset.mockResolvedValue(camera);
    mockGetActiveCustomFields.mockImplementation(
      ({ format }: { format?: string }) =>
        Promise.resolve(format === "LINK" ? [manual] : [manual, serial])
    );
    mockGetLinkTitles.mockResolvedValue({});
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

  it("sends the titles of the links among the values the page shows", async () => {
    grant([OrganizationRoles.BASE]);
    const manualValue = {
      value: { raw: MANUAL_URL, valueText: MANUAL_URL },
      customField: { ...manual, categories: [] },
    };
    const cameraOnly = {
      value: { raw: "ABC-123", valueText: "ABC-123" },
      customField: { ...serial, categories: [{ id: "cat-cameras" }] },
    };
    const lensOnly = {
      value: { raw: "https://www.example.com/lens.pdf" },
      customField: {
        ...manual,
        id: "cf-lens",
        categories: [{ id: "cat-lens" }],
      },
    };
    mockGetAsset.mockResolvedValue({
      ...camera,
      customFields: [manualValue, cameraOnly, lensOnly],
    });
    mockGetLinkTitles.mockResolvedValue(LINK_TITLES);

    const result = await load();

    // A field outside the asset's category is not on the page, so its link
    // is neither read nor queued for a fetch.
    expect(mockGetLinkTitles).toHaveBeenCalledWith({
      organizationId: "org-1",
      values: [manualValue, cameraOnly],
    });
    expect(result.linkTitles).toEqual(LINK_TITLES);
  });

  it("starts the editor data without waiting for the link titles", async () => {
    grant([OrganizationRoles.ADMIN]);
    let answerTitles: (titles: unknown) => void = () => {};
    mockGetLinkTitles.mockReturnValue(
      new Promise((resolve) => {
        answerTitles = resolve;
      })
    );

    const result = load();

    await vi.waitFor(() =>
      expect(getCategoriesForCreateAndEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          defaultCategory: "cat-cameras",
        })
      )
    );
    answerTitles(LINK_TITLES);
    expect((await result).linkTitles).toEqual(LINK_TITLES);
  });
});
