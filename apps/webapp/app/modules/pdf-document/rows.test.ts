/**
 * How wide each column of a booking PDF prints, and how rows group.
 *
 * @see {@link file://./rows.ts}
 */
import { describe, expect, it } from "vitest";
import { BOOKING_CHECKLIST_CONFIG } from "./config";
import { documentColumns, groupDocumentRows } from "./rows";

function widths(
  config = BOOKING_CHECKLIST_CONFIG,
  customFieldIds: string[] = []
) {
  return documentColumns({ config, customFieldIds, codePercent: 27 }).map(
    (column): [string, number] => [
      column.kind === "customField" ? column.customFieldId : column.kind,
      Math.round(column.percent * 100) / 100,
    ]
  );
}

describe("booking PDF column widths", () => {
  it("keeps the Checklist's widths", () => {
    expect(widths()).toEqual([
      ["number", 5],
      ["image", 10],
      ["name", 16],
      ["quantity", 6],
      ["kit", 10],
      ["category", 13],
      ["location", 13],
      ["code", 27],
    ]);
  });

  it("keeps #, Image, Qty and Code at their widths when custom fields join", () => {
    const shares = Object.fromEntries(
      widths(BOOKING_CHECKLIST_CONFIG, ["cf-1", "cf-2", "cf-3"])
    );

    expect([shares.number, shares.image, shares.quantity, shares.code]).toEqual(
      [5, 10, 6, 27]
    );
    expect(
      Object.values(shares).reduce((sum, width) => sum + width, 0)
    ).toBeCloseTo(100, 1);
  });

  it("gives the room of hidden columns to Name", () => {
    expect(
      widths({
        ...BOOKING_CHECKLIST_CONFIG,
        columns: {
          image: false,
          quantity: false,
          kit: false,
          category: false,
          location: false,
        },
      })
    ).toEqual([
      ["number", 5],
      ["name", 68],
      ["code", 27],
    ]);
  });
});

describe("booking PDF row groups", () => {
  const rows = [
    { title: "Light", category: { name: "Lighting" } },
    { title: "Sandbag", category: null },
    { title: "Camera", category: { name: "Camera" } },
    { title: "Lens", category: { name: "Camera" } },
  ];

  it("keeps one group in the given order when not grouped", () => {
    expect(groupDocumentRows(rows, "none")).toEqual([{ name: null, rows }]);
  });

  it("groups by category A to Z, uncategorized last, rows in the given order", () => {
    expect(
      groupDocumentRows(rows, "category").map((group) => [
        group.name,
        group.rows.map((row) => row.title),
      ])
    ).toEqual([
      ["Camera", ["Camera", "Lens"]],
      ["Lighting", ["Light"]],
      ["Uncategorized", ["Sandbag"]],
    ]);
  });
});
