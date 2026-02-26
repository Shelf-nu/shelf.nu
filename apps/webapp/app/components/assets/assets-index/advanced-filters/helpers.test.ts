import { describe, expect, it } from "vitest";

import type { Column } from "~/modules/asset-index-settings/helpers";

import { getUIFieldType } from "./helpers";

describe("getUIFieldType", () => {
  it("treats updatedAt as a date field", () => {
    const updatedColumn = {
      name: "updatedAt",
      visible: true,
      position: 0,
    } as unknown as Column;

    expect(getUIFieldType({ column: updatedColumn })).toBe("date");
    expect(getUIFieldType({ column: updatedColumn, friendlyName: true })).toBe(
      "Date"
    );
  });
});
