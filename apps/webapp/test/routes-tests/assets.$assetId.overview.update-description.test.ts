import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateAsset } from "~/modules/asset/service.server";
import { action } from "~/routes/_layout+/assets.$assetId.overview";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: the inline description edit is exercised without a database
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: authorization is not under test; the action only needs the org id
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the write is asserted through the payload it receives
vi.mock("~/modules/asset/service.server", () => ({
  updateAsset: vi.fn(),
}));

// why: the success toast is a side channel that needs a live emitter
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

function editDescription(fieldValue: string): ActionFunctionArgs {
  const body = new FormData();
  body.set("intent", "updateField");
  body.set("fieldName", "description");
  body.set("fieldValue", fieldValue);

  const request = new Request("https://example.com/assets/asset-123/overview", {
    method: "POST",
    body,
  });
  return {
    context: { getSession: () => ({ userId: "user-123" }) },
    params: { assetId: "asset-123" },
    request,
  } as unknown as ActionFunctionArgs;
}

async function readResponse(result: unknown) {
  const response = result as { data: unknown; init: ResponseInit | null };
  return { status: response.init?.status ?? 200, body: response.data };
}

describe("asset overview inline description edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
    } as Awaited<ReturnType<typeof requirePermission>>);
  });

  it("saves a 5,000 character description", async () => {
    const description = "a".repeat(5000);

    const { status } = await readResponse(
      await action(editDescription(description))
    );

    expect(status).toBe(200);
    expect(vi.mocked(updateAsset).mock.calls[0][0]).toMatchObject({
      id: "asset-123",
      organizationId: "org-1",
      description,
    });
  });

  it("saves the description trimmed", async () => {
    await action(editDescription("  Spare charger in the drawer \n"));

    expect(vi.mocked(updateAsset).mock.calls[0][0].description).toBe(
      "Spare charger in the drawer"
    );
  });

  it("refuses a 5,001 character description with the limit message", async () => {
    const { status, body } = await readResponse(
      await action(editDescription("a".repeat(5001)))
    );

    expect(status).toBe(400);
    expect(body).toMatchObject({
      error: { message: "Description must be 5,000 characters or fewer" },
    });
    expect(updateAsset).not.toHaveBeenCalled();
  });
});
