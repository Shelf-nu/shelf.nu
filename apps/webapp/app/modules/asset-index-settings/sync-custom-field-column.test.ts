/**
 * Keeping one custom field's asset-index column in step with the field.
 *
 * Activating a field must give it a column, renaming it must carry the column
 * across, and deactivating it must take the column away — in every settings row
 * in the organization, one row per user.
 *
 * The case that matters most is the one where there is nothing to do. A
 * settings row need not have a column for the field at all: a row written
 * before the field existed does not, and `validateColumns` only re-adds the
 * fixed columns, never custom-field ones. Deactivating then has to leave that
 * row alone, because the alternative is destroying a column that has nothing
 * to do with the field being deactivated.
 *
 * @see {@link file://./helpers.ts} syncCustomFieldColumn
 */
import { CustomFieldType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { syncCustomFieldColumn, type Column } from "./helpers";

/** A settings row with three columns; `category` is last, so it is what a
 * mis-aimed removal would take. */
function columns(): Column[] {
  return [
    { name: "id", visible: true, position: 0 },
    { name: "status", visible: false, position: 1 },
    { name: "category", visible: true, position: 2 },
  ];
}

/** Adds a column for a custom field named `name`. */
function withCustomField(name: string, position = 3): Column[] {
  return [
    ...columns(),
    {
      name: `cf_${name}` as Column["name"],
      visible: false,
      position,
      cfType: CustomFieldType.TEXT,
    },
  ];
}

describe("syncCustomFieldColumn", () => {
  describe("deactivating", () => {
    it("removes the field's own column", () => {
      const result = syncCustomFieldColumn(withCustomField("warranty"), {
        oldName: "warranty",
        newName: "warranty",
        active: false,
      });

      expect(result.map((col) => col.name)).toEqual([
        "id",
        "status",
        "category",
      ]);
    });

    it("leaves every column alone when the field has none here", () => {
      // `findIndex` reports a miss as -1, and -1 is a valid `splice` start:
      // it counts from the end, so a removal aimed at a column that is not
      // there takes the last one instead.
      const result = syncCustomFieldColumn(columns(), {
        oldName: "warranty",
        newName: "warranty",
        active: false,
      });

      expect(result).toEqual(columns());
    });

    it("does not touch the other settings values it leaves behind", () => {
      const result = syncCustomFieldColumn(withCustomField("warranty"), {
        oldName: "warranty",
        newName: "warranty",
        active: false,
      });

      // A restored fixed column comes back from the static defaults, so a
      // wrongly-removed one loses whatever the user had chosen for it.
      expect(result).toContainEqual({
        name: "status",
        visible: false,
        position: 1,
      });
    });
  });

  describe("activating", () => {
    it("adds a column after the highest position when the field has none", () => {
      const result = syncCustomFieldColumn(columns(), {
        oldName: "warranty",
        newName: "warranty",
        active: true,
        cfType: CustomFieldType.TEXT,
      });

      expect(result).toContainEqual({
        name: "cf_warranty",
        visible: true,
        position: 3,
        cfType: CustomFieldType.TEXT,
      });
    });

    it("keeps the user's visibility and position when the column exists", () => {
      // The column is theirs — they hid it and placed it. Re-activating the
      // field is not a reason to move it or show it again.
      const result = syncCustomFieldColumn(withCustomField("warranty", 7), {
        oldName: "warranty",
        newName: "warranty",
        active: true,
        cfType: CustomFieldType.TEXT,
      });

      expect(result).toContainEqual({
        name: "cf_warranty",
        visible: false,
        position: 7,
        cfType: CustomFieldType.TEXT,
      });
    });

    it("carries the column across a rename", () => {
      const result = syncCustomFieldColumn(withCustomField("warranty", 7), {
        oldName: "warranty",
        newName: "guarantee",
        active: true,
        cfType: CustomFieldType.TEXT,
      });

      const names = result.map((col) => col.name);
      expect(names).toContain("cf_guarantee");
      expect(names).not.toContain("cf_warranty");
    });

    it("records the field's type on the column", () => {
      // `validateColumns` repairs a missing `cfType` on the next read, so an
      // omission here is invisible rather than harmful — which is exactly why
      // one of the two call sites could drop it unnoticed.
      const result = syncCustomFieldColumn(columns(), {
        oldName: "notes",
        newName: "notes",
        active: true,
        cfType: CustomFieldType.MULTILINE_TEXT,
      });

      expect(result.find((col) => col.name === "cf_notes")?.cfType).toBe(
        CustomFieldType.MULTILINE_TEXT
      );
    });
  });

  it("returns a new array rather than editing the caller's", () => {
    const original = withCustomField("warranty");
    const snapshot = JSON.parse(JSON.stringify(original)) as Column[];

    syncCustomFieldColumn(original, {
      oldName: "warranty",
      newName: "warranty",
      active: false,
    });

    expect(original).toEqual(snapshot);
  });
});
