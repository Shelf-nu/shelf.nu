/**
 * Asset edit route — barcodes are left alone when the workspace has no add-on.
 *
 * `updateAsset` reconciles the barcode list it is given against the barcodes
 * on the asset and deletes whatever is missing from that list. A workspace
 * without the alternative-barcodes add-on submits no barcode fields at all
 * (the form hides the section), so the action must hand `updateAsset` no list
 * rather than an empty one: barcode rows survive an add-on lapse and are back
 * the moment the add-on is switched on again.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.$assetId_.edit.tsx}
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { action } from "~/routes/_layout+/assets.$assetId_.edit";

// why: the route pulls the whole asset service graph (Prisma client, Supabase
// storage, permissions); stubbing at the module boundary keeps this a unit test
// of what the action hands to updateAsset.
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
// It is also where the add-on entitlement (`canUseBarcodes`) comes from, so
// each test states it explicitly.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

import { updateAsset } from "~/modules/asset/service.server";
import { requirePermission } from "~/utils/roles.server";

/**
 * Builds the action args for a plain save of the asset's core fields.
 *
 * why: happy-dom drops empty FormData fields on the Request round-trip, so the
 * body is built as URLSearchParams (see the repo note on that behaviour).
 */
function buildArgs(fields: Record<string, string> = {}) {
  const body = new URLSearchParams({
    title: "An asset",
    description: "",
    category: "uncategorized",
    ...fields,
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

/** The single payload the action handed to `updateAsset`. */
function updateAssetPayload() {
  expect(updateAsset).toHaveBeenCalledTimes(1);
  return vi.mocked(updateAsset).mock.calls[0][0];
}

describe("assets.$assetId_.edit — barcodes without the add-on", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateAsset).mockResolvedValue({
      id: "asset-1",
      title: "An asset",
    } as never);
  });

  it("hands updateAsset no barcode list when the workspace lacks the add-on", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      canUseBarcodes: false,
    } as never);

    await action(buildArgs());

    const payload = updateAssetPayload();
    expect(payload.barcodes).toBeUndefined();
    expect(payload.preferredBarcodeId).toBeUndefined();
  });

  it("passes the submitted barcodes when the workspace has the add-on", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      canUseBarcodes: true,
    } as never);

    await action(
      buildArgs({
        "barcodes[0].type": "Code128",
        "barcodes[0].value": "ABC123",
      })
    );

    expect(updateAssetPayload().barcodes).toEqual([
      { type: "Code128", value: "ABC123" },
    ]);
  });
});
