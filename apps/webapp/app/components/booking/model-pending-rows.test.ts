import { describe, expect, it } from "vitest";

import { buildPendingModelRows } from "./model-pending-rows";

describe("buildPendingModelRows", () => {
  it("emits one row per unit still to pull", () => {
    const rows = buildPendingModelRows([
      {
        assetModelId: "model-1",
        assetModelName: "Model One",
        booked: 3,
        remaining: 3,
        prefulfilled: 0,
        matched: 1,
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.assetModelName)).toEqual([
      "Model One",
      "Model One",
    ]);
  });

  it("counts against remaining, not booked", () => {
    // Units materialised in an earlier session are concrete assets now, so a
    // pending row for them would ask the operator to pull them twice.
    const rows = buildPendingModelRows([
      {
        assetModelId: "model-1",
        assetModelName: "Model One",
        booked: 5,
        remaining: 2,
        prefulfilled: 3,
        matched: 0,
      },
    ]);

    expect(rows).toHaveLength(2);
  });

  it("emits nothing once every remaining unit is matched", () => {
    expect(
      buildPendingModelRows([
        {
          assetModelId: "model-1",
          assetModelName: "Model One",
          booked: 2,
          remaining: 2,
          prefulfilled: 0,
          matched: 2,
        },
      ])
    ).toEqual([]);
  });
});
