import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShelfError } from "~/utils/error";

const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });

// why: mock supabase client to avoid real database calls in unit tests
vi.mock("~/database/supabase.server", () => ({
  sbDb: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn(),
  },
}));

// why: mock db.server since other parts of the module still import it
vi.mock("~/database/db.server", () => ({
  db: {},
}));

const { removeCustomFieldFromAssetIndexSettings } = await import(
  "./service.server"
);

describe("removeCustomFieldFromAssetIndexSettings", () => {
  beforeEach(() => {
    rpcMock.mockClear();
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("calls RPC with correct column name and org id", async () => {
    await removeCustomFieldFromAssetIndexSettings({
      customFieldName: "Condition",
      organizationId: "org-123",
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      "remove_custom_field_from_asset_index",
      { column_name: "cf_Condition", organization_id: "org-123" }
    );
  });

  it("wraps database errors in a ShelfError", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: new Error("boom"),
    });

    await expect(
      removeCustomFieldFromAssetIndexSettings({
        customFieldName: "Condition",
        organizationId: "org-123",
      })
    ).rejects.toBeInstanceOf(ShelfError);
  });
});
