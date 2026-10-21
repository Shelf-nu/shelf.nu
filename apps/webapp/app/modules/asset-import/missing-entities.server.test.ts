// @vitest-environment node
/**
 * Tests for `findMissingImportEntities`: which names a file would create.
 *
 * @see {@link file://./missing-entities.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { findMissingImportEntities } from "./missing-entities.server";

// why: the lookups are the only side effect; stub each kind's findMany.
vi.mock("~/database/db.server", () => {
  const model = () => ({ findMany: vi.fn() });
  return {
    db: {
      category: model(),
      location: model(),
      tag: model(),
      kit: model(),
      teamMember: model(),
      customField: model(),
      assetModel: model(),
    },
  };
});

const run = (data: Record<string, unknown>[]) =>
  findMissingImportEntities({ data: data as never, organizationId: "org" });

describe("findMissingImportEntities", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const model of [
      db.category,
      db.location,
      db.tag,
      db.kit,
      db.teamMember,
      db.customField,
      db.assetModel,
    ]) {
      vi.mocked(model.findMany).mockResolvedValue([] as never);
    }
  });

  it("reports categories the workspace lacks, once each, ignoring blanks", async () => {
    vi.mocked(db.category.findMany).mockResolvedValue([
      { name: "Laptops" },
    ] as never);
    const result = await run([
      { key: "1", title: "A", category: "Laptops" },
      { key: "2", title: "B", category: "Cables" },
      { key: "3", title: "C", category: "Cables" },
      { key: "4", title: "D", category: "" },
    ]);
    expect(result.categories).toEqual(["Cables"]);
  });

  it("matches existing names case-insensitively and keeps the first spelling", async () => {
    vi.mocked(db.location.findMany).mockResolvedValue([
      { name: "warehouse" },
    ] as never);
    const result = await run([
      { key: "1", title: "A", location: " Warehouse " },
      { key: "2", title: "B", location: "Shed" },
      { key: "3", title: "C", location: "SHED" },
    ]);
    expect(result.locations).toEqual(["Shed"]);
  });

  it("reports tags, kits, custodians and asset models", async () => {
    vi.mocked(db.tag.findMany).mockResolvedValue([{ name: "old" }] as never);
    const result = await run([
      {
        key: "1",
        title: "A",
        tags: ["old", "new", ""],
        kit: "Kit A",
        custodian: "Ann",
        assetModel: "MBP",
      },
    ]);
    expect(result.tags).toEqual(["new"]);
    expect(result.kits).toEqual(["Kit A"]);
    expect(result.custodians).toEqual(["Ann"]);
    expect(result.assetModels).toEqual(["MBP"]);
  });

  it("reads custom field names from cf: headers", async () => {
    vi.mocked(db.customField.findMany).mockResolvedValue([
      { name: "Serial" },
    ] as never);
    const result = await run([
      { key: "1", title: "A", "cf:Serial, type:text": "x", "cf:Color": "red" },
    ]);
    expect(result.customFields).toEqual(["Color"]);
  });

  it("returns empty lists and skips queries for a file with no references", async () => {
    const result = await run([{ key: "1", title: "A" }]);
    expect(result).toEqual({
      categories: [],
      locations: [],
      tags: [],
      kits: [],
      custodians: [],
      customFields: [],
      assetModels: [],
    });
    expect(db.category.findMany).not.toHaveBeenCalled();
  });
});
