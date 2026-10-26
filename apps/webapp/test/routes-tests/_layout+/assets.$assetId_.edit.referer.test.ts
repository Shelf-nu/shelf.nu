// @vitest-environment node
// why: happy-dom treats `Referer` as a forbidden request header and drops it,
// so the loader would never see the header this test is about.
/**
 * Asset edit route: the loader's `referer`.
 *
 * The edit form posts `referer` back as `redirectTo`, and the action redirects
 * there after a save. Picking an asset model navigates the edit page to itself
 * with `?category=<id>`, so that loader request carries the edit page as its
 * Referer. The loader must not offer the page itself as a place to return to,
 * or Save lands back on the edit page with a stale `?category` that
 * preselects a category the user never saved.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.$assetId_.edit.tsx}
 */
import { describe, expect, it, vi } from "vitest";

import { loader } from "~/routes/_layout+/assets.$assetId_.edit";

// why: the route pulls the whole asset service graph (Prisma client, Supabase
// storage, permissions); stubbing at the module boundary keeps this a unit test
// of the loader's referer decision.
vi.mock("~/modules/asset/service.server", () => ({
  getAllEntriesForCreateAndEdit: vi.fn().mockResolvedValue({
    categories: [],
    totalCategories: 0,
    tags: [],
    locations: [],
    totalLocations: 0,
  }),
  getAsset: vi.fn().mockResolvedValue({
    id: "asset-1",
    title: "An asset",
    categoryId: "cat-saved",
    archivedAt: null,
    assetLocations: [],
  }),
  updateAsset: vi.fn(),
  updateAssetMainImage: vi.fn(),
}));
vi.mock("~/modules/custom-field/service.server", () => ({
  getActiveCustomFields: vi.fn().mockResolvedValue([]),
}));
vi.mock("~/modules/asset-model/service.server", () => ({
  getAssetModels: vi
    .fn()
    .mockResolvedValue({ assetModels: [], totalAssetModels: 0 }),
}));
// why: permission resolution is an auth/network boundary, not the unit here.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn().mockResolvedValue({
    organizationId: "org-1",
    currentOrganization: { currency: "USD" },
    userOrganizations: [],
  }),
}));

const EDIT_URL = "http://localhost/assets/asset-1/edit";

/** Runs the loader for `url` with the given Referer and returns its data. */
async function loadWithReferer(url: string, referer?: string) {
  const request = new Request(url, {
    headers: referer ? { referer } : {},
  });
  return (await loader({
    request,
    params: { assetId: "asset-1" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof loader>[0])) as { referer: string | null };
}

describe("asset edit loader referer", () => {
  it("drops a referer that is the edit page itself with ?category", async () => {
    const data = await loadWithReferer(
      `${EDIT_URL}?category=cat-model`,
      `${EDIT_URL}?category=cat-model`
    );

    expect(data.referer).toBeNull();
  });

  it("keeps the filtered list the user came from", async () => {
    const data = await loadWithReferer(
      EDIT_URL,
      "http://localhost/assets?search=x"
    );

    expect(data.referer).toBe("/assets?search=x");
  });
});
