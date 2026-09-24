import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShelfError } from "~/utils/error";

vi.mock("~/database/db.server", () => ({
  db: {
    $executeRaw: vi.fn().mockResolvedValue(0),
  },
}));

const { db } = await import("~/database/db.server");
const {
  removeCustomFieldFromAssetIndexSettings,
  insertColumnsAtDefaultPositions,
} = await import("./service.server");

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

describe("insertColumnsAtDefaultPositions", () => {
  /** A saved list in a customer's own order, as it comes out of the database. */
  const saved = [
    { name: "name", visible: true, position: 0 },
    { name: "status", visible: true, position: 1 },
    { name: "description", visible: true, position: 2 },
    { name: "actions", visible: true, position: 3 },
  ] as never[];

  it("splices a new column at its default position and shifts the rest", () => {
    // why: this is the bug it exists to prevent. Appending instead put the
    // quantity-pool columns past every custom field, roughly 3000px off the
    // right edge of a real workspace's table, a column nobody scrolls to is a
    // column that does not exist.
    const result = insertColumnsAtDefaultPositions(saved, [
      { name: "available", visible: true, position: 2 },
    ] as never[]);

    expect(
      [...result].sort((a, b) => a.position - b.position).map((c) => c.name)
    ).toEqual(["name", "status", "available", "description", "actions"]);
  });

  it("keeps multiple insertions in their intended order", () => {
    // why: each shift has to account for the ones before it, or two columns
    // land on the same position and the rendered order becomes arbitrary.
    const result = insertColumnsAtDefaultPositions(saved, [
      { name: "stockStatus", visible: true, position: 4 },
      { name: "available", visible: true, position: 2 },
      { name: "reserved", visible: true, position: 3 },
    ] as never[]);

    expect(
      [...result].sort((a, b) => a.position - b.position).map((c) => c.name)
    ).toEqual([
      "name",
      "status",
      "available",
      "reserved",
      "stockStatus",
      "description",
      "actions",
    ]);
  });

  it("never produces a duplicate position", () => {
    const result = insertColumnsAtDefaultPositions(saved, [
      { name: "available", visible: true, position: 1 },
      { name: "reserved", visible: true, position: 1 },
    ] as never[]);

    const positions = result.map((c) => c.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("appends when the default position is past the end of the saved list", () => {
    // why: preserves the OLD append behaviour for any field that genuinely
    // belongs at the end, so this change is additive rather than a rewrite.
    const result = insertColumnsAtDefaultPositions(saved, [
      { name: "minQuantity", visible: false, position: 99 },
    ] as never[]);

    const sorted = [...result].sort((a, b) => a.position - b.position);
    expect(sorted[sorted.length - 1].name).toBe("minQuantity");
  });

  it("does not mutate the caller's arrays", () => {
    // why: the caller reuses `columns` afterwards to decide whether to write.
    const original = JSON.parse(JSON.stringify(saved));
    insertColumnsAtDefaultPositions(saved, [
      { name: "stockStatus", visible: true, position: 0 },
    ] as never[]);
    expect(saved).toEqual(original);
  });

  it("preserves each new column's own visibility", () => {
    // Real column keys, not invented ones: the assertions compare against
    // `ColumnLabelKey`, so a made-up name typechecks as an impossible comparison
    // even though the test would pass at runtime.
    const result = insertColumnsAtDefaultPositions(saved, [
      { name: "available", visible: true, position: 1 },
      { name: "quantity", visible: false, position: 2 },
    ] as never[]);

    expect(result.find((c) => c.name === "available")?.visible).toBe(true);
    expect(result.find((c) => c.name === "quantity")?.visible).toBe(false);
  });
});
