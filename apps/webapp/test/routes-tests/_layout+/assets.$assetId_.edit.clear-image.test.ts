/**
 * Asset edit route — "clear image" atomicity.
 *
 * The edit form's "Remove image" / "Use the model's image instead" control
 * posts `clearMainImage=true`. That clear must be applied as part of the
 * `updateAsset` payload, never as its own committed write: `updateAsset` can
 * still reject (kit-managed location, quantity over pool, barcode gating,
 * preferred-barcode membership), and a standalone clear would null the image
 * while the action reports failure. `Asset.mainImage` holds a signed URL, so
 * the user cannot restore it — the edit has to be all-or-nothing.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.$assetId_.edit.tsx}
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { action } from "~/routes/_layout+/assets.$assetId_.edit";

// why: the route pulls the whole asset service graph (Prisma client, Supabase
// storage, permissions); stubbing at the module boundary keeps this a unit test
// of the action's ordering decision.
vi.mock("~/modules/asset/service.server", () => ({
  getAllEntriesForCreateAndEdit: vi.fn(),
  getAsset: vi.fn(),
  updateAsset: vi.fn().mockResolvedValue({ id: "asset-1", title: "A" }),
  updateAssetMainImage: vi.fn().mockResolvedValue(false),
}));
vi.mock("~/modules/custom-field/service.server", () => ({
  getActiveCustomFields: vi.fn().mockResolvedValue([]),
}));
vi.mock("~/modules/tag/service.server", () => ({
  buildTagsSet: vi.fn().mockReturnValue({ set: [] }),
}));
vi.mock("~/modules/asset-model/service.server", () => ({
  getAssetModels: vi
    .fn()
    .mockResolvedValue({ assetModels: [], totalAssetModels: 0 }),
}));
// why: permission resolution is an auth/network boundary, not the unit here.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi
    .fn()
    .mockResolvedValue({ organizationId: "org-1", canUseBarcodes: false }),
}));
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

import {
  updateAsset,
  updateAssetMainImage,
} from "~/modules/asset/service.server";

/**
 * Builds the action args for a save that requests an image clear.
 *
 * why: happy-dom drops empty FormData fields on the Request round-trip, so the
 * body is built as URLSearchParams (see the repo note on that behaviour).
 */
function buildArgs(overrides: Record<string, string> = {}) {
  const body = new URLSearchParams({
    title: "An asset",
    description: "",
    category: "uncategorized",
    clearMainImage: "true",
    ...overrides,
  });

  const request = new Request("http://localhost/assets/asset-1/edit", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return {
    request,
    params: { assetId: "asset-1" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof action>[0];
}

describe("assets.$assetId_.edit — clearMainImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateAssetMainImage).mockResolvedValue(false);
    vi.mocked(updateAsset).mockResolvedValue({
      id: "asset-1",
      title: "An asset",
    } as never);
  });

  it("nulls the image fields inside the updateAsset payload, not separately", async () => {
    await action(buildArgs());

    expect(updateAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "asset-1",
        mainImage: null,
        mainImageExpiration: null,
        thumbnailImage: null,
      })
    );
  });

  it("does not clear when updateAsset rejects — the whole edit fails together", async () => {
    vi.mocked(updateAsset).mockRejectedValueOnce(
      new Error("Quantity exceeds available pool")
    );

    await action(buildArgs()).catch(() => undefined);

    // The only write path is updateAsset itself; there is no separate clear
    // that could have committed ahead of it.
    expect(updateAsset).toHaveBeenCalledTimes(1);
  });

  // why: a submit that both clears and uploads must keep the upload — the
  // clear is suppressed when updateAssetMainImage reports it wrote an image.
  it("keeps a freshly uploaded image over a pending clear", async () => {
    vi.mocked(updateAssetMainImage).mockResolvedValue(true);

    await action(buildArgs());

    expect(updateAsset).toHaveBeenCalledWith(
      expect.not.objectContaining({ mainImage: null })
    );
  });
});
