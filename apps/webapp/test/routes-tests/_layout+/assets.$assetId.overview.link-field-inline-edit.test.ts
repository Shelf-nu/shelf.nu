/**
 * Asset overview route: inline edit of a Link field.
 *
 * The inline `customField` edit is one of the write paths of a Link field, so
 * it applies the same rule as the asset form: a value must be a web link, a
 * link typed without a scheme is stored as https, and a value saved before
 * the field became a Link field is kept when submitted unchanged.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.$assetId.overview.tsx}
 * @see {@link file://./../../../app/utils/custom-fields.ts} `buildCustomFieldValue`
 */
import { createCustomField } from "@factories";
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getActiveCustomFieldsForAsset,
  updateAsset,
} from "~/modules/asset/service.server";
import { getAssetCustomFieldValues } from "~/modules/custom-field/service.server";
import { action } from "~/routes/_layout+/assets.$assetId.overview";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: the inline edit is exercised without a database
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: authorization is not under test; the action only needs the org id
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the field definitions come from Postgres, and the write is asserted
// through the payload it receives
vi.mock("~/modules/asset/service.server", () => ({
  getActiveCustomFieldsForAsset: vi.fn(),
  updateAsset: vi.fn(),
}));

// why: the stored value comes from Postgres
vi.mock("~/modules/custom-field/service.server", () => ({
  getActiveCustomFields: vi.fn(),
  getAssetCustomFieldValues: vi.fn(),
}));

// why: the success toast is a side channel that needs a live emitter
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const manual = createCustomField({
  id: "cfmanual",
  name: "Manual",
  format: "LINK",
});

/** Posts an inline edit of the Manual field with `fieldValue`. */
function editManual(fieldValue: string): ActionFunctionArgs {
  const body = new FormData();
  body.set("intent", "updateField");
  body.set("fieldName", "customField");
  body.set("customFieldId", "cfmanual");
  body.set("fieldValue", fieldValue);

  const request = new Request("https://example.com/assets/asset-1/overview", {
    method: "POST",
    body,
  });
  return {
    context: { getSession: () => ({ userId: "user-1" }) },
    params: { assetId: "asset-1" },
    request,
  } as unknown as ActionFunctionArgs;
}

describe("asset overview inline edit of a Link field", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
    } as Awaited<ReturnType<typeof requirePermission>>);
    vi.mocked(getActiveCustomFieldsForAsset).mockResolvedValue([
      manual,
    ] as Awaited<ReturnType<typeof getActiveCustomFieldsForAsset>>);
    vi.mocked(getAssetCustomFieldValues).mockResolvedValue([]);
  });

  it("refuses text that is not a web link, and saves nothing", async () => {
    const result = (await action(editManual("see shelf"))) as {
      init: ResponseInit | null;
    };

    expect(result.init?.status).toBe(400);
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it("stores a link typed without a scheme as https", async () => {
    await action(editManual("www.example.com/manual.pdf"));

    expect(vi.mocked(updateAsset).mock.calls[0][0]).toMatchObject({
      id: "asset-1",
      organizationId: "org-1",
      customFieldsValues: [
        {
          id: "cfmanual",
          value: {
            raw: "https://www.example.com/manual.pdf",
            valueText: "https://www.example.com/manual.pdf",
          },
        },
      ],
    });
  });

  it("keeps a value saved before the field became a Link field when it is submitted unchanged", async () => {
    vi.mocked(getAssetCustomFieldValues).mockResolvedValue([
      { customFieldId: "cfmanual", value: { raw: "see shelf" } },
    ]);

    const result = await action(editManual("see shelf"));

    expect(result).toMatchObject({ success: true });
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it("still refuses a changed value that is not a web link", async () => {
    vi.mocked(getAssetCustomFieldValues).mockResolvedValue([
      { customFieldId: "cfmanual", value: { raw: "see shelf" } },
    ]);

    const result = (await action(editManual("see the shelf"))) as {
      init: ResponseInit | null;
    };

    expect(result.init?.status).toBe(400);
    expect(updateAsset).not.toHaveBeenCalled();
  });
});
