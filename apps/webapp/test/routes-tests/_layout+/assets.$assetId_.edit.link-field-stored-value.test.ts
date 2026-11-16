/**
 * Asset edit route: a Link field that still holds an older plain value.
 *
 * A field switched to the Link format keeps the values saved before the
 * switch. Saving the full edit form posts every field, so an unchanged older
 * value must not block an unrelated change (here, a new title): it is kept as
 * stored and left out of the write. A changed value still has to be a link.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.$assetId_.edit.tsx}
 * @see {@link file://./../../../app/utils/custom-fields.ts} `storedCustomFieldTexts`
 */
import { createCustomField } from "@factories";
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getActiveCustomFields,
  getAssetCustomFieldValues,
} from "~/modules/custom-field/service.server";
import { updateAsset } from "~/modules/asset/service.server";
import { action } from "~/routes/_layout+/assets.$assetId_.edit";

// why: the route pulls the whole asset service graph (Prisma client, Supabase
// storage); the update it is handed is what each case asserts.
vi.mock("~/modules/asset/service.server", () => ({
  getAllEntriesForCreateAndEdit: vi.fn(),
  getAsset: vi.fn(),
  updateAsset: vi.fn().mockResolvedValue({ id: "asset-1", title: "Camera 2" }),
  updateAssetMainImage: vi.fn().mockResolvedValue(false),
}));
// why: the field definitions and the asset's stored values come from
// Postgres; each case states them.
vi.mock("~/modules/custom-field/service.server", () => ({
  getActiveCustomFields: vi.fn(),
  getAssetCustomFieldValues: vi.fn(),
}));
// why: tags are not part of this save; the tag service reads Postgres.
vi.mock("~/modules/tag/service.server", () => ({
  buildTagsSet: vi.fn().mockReturnValue({ set: [] }),
}));
// why: asset models are loaded by the route module and read Postgres.
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
// why: the success toast goes through a server-sent-events emitter with no
// test transport.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const manual = createCustomField({
  id: "cfmanual",
  name: "Manual",
  format: "LINK",
});

/**
 * Posts the edit form with a new title and the Manual field's value.
 *
 * why: happy-dom drops empty FormData fields on the Request round-trip, so the
 * body is built as URLSearchParams.
 */
function save(manualValue: string) {
  const body = new URLSearchParams({
    title: "Camera 2",
    description: "",
    category: "uncategorized",
    "cf-cfmanual": manualValue,
  });
  return action({
    request: new Request("http://localhost/assets/asset-1/edit", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }),
    params: { assetId: "asset-1" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof action>[0]);
}

describe("assets.$assetId_.edit: a Link field with an older plain value", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getActiveCustomFields).mockResolvedValue([manual]);
    vi.mocked(getAssetCustomFieldValues).mockResolvedValue([
      {
        customFieldId: "cfmanual",
        value: { raw: "see binder 4", valueText: "see binder 4" },
      },
    ]);
  });

  it("saves the new title and keeps the unchanged value as stored", async () => {
    await save("see binder 4");

    expect(getAssetCustomFieldValues).toHaveBeenCalledWith({
      assetId: "asset-1",
      organizationId: "org-1",
      customFieldIds: ["cfmanual"],
    });
    expect(updateAsset).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Camera 2", customFieldsValues: [] })
    );
  });

  it("refuses a changed value that is not a link, and saves nothing", async () => {
    const response = await save("see binder 5");

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it("saves a changed value that is a link", async () => {
    await save("www.example.com/manual.pdf");

    expect(updateAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        customFieldsValues: [
          {
            id: "cfmanual",
            value: {
              raw: "https://www.example.com/manual.pdf",
              valueText: "https://www.example.com/manual.pdf",
            },
          },
        ],
      })
    );
  });
});
