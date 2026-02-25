import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShelfError } from "~/utils/error";

vi.mock("~/database/db.server", () => ({
  db: {
    $executeRaw: vi.fn().mockResolvedValue(0),
  },
}));

const { db } = await import("~/database/db.server");
const { removeCustomFieldFromAssetIndexSettings } = await import(
  "./service.server"
);

const executeRawMock = vi.mocked(db.$executeRaw);

describe("removeCustomFieldFromAssetIndexSettings", () => {
  beforeEach(() => {
    executeRawMock.mockClear();
  });

  it("removes the custom field column for all organization settings", async () => {
    await removeCustomFieldFromAssetIndexSettings({
      customFieldName: "Condition",
      organizationId: "org-123",
    });

    expect(executeRawMock).toHaveBeenCalledTimes(1);
    const [strings, ...values] = executeRawMock.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];

    expect(strings.join(" ")).toContain('UPDATE "AssetIndexSettings" AS ais');
    expect(values).toContain("cf_Condition");
    expect(values).toContain("org-123");
  });

  it("wraps database errors in a ShelfError", async () => {
    executeRawMock.mockRejectedValueOnce(new Error("boom"));

    await expect(
      removeCustomFieldFromAssetIndexSettings({
        customFieldName: "Condition",
        organizationId: "org-123",
      })
    ).rejects.toBeInstanceOf(ShelfError);
  });
});
