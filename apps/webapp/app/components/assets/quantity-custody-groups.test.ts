import { describe, expect, it } from "vitest";
import { formatCustodySourceOption } from "./custody-source-select";
import {
  describeCustodySources,
  groupCustodyRecords,
  releaseLineLabel,
} from "./quantity-custody-groups";
import { releaseLinesReducer } from "./release-by-source-button";

const camera = { id: "loc-camera", name: "Camera Room" };
const studio = { id: "loc-studio", name: "Studio" };

describe("groupCustodyRecords", () => {
  it("shows one line per person, summing their rows from each location", () => {
    const groups = groupCustodyRecords([
      {
        id: "c1",
        quantity: 2,
        location: camera,
        custodian: { id: "tm-ahmed" },
      },
      { id: "c2", quantity: 1, custodian: { id: "tm-sara" } },
      {
        id: "c3",
        quantity: 1,
        location: studio,
        custodian: { id: "tm-ahmed" },
      },
    ]);

    expect(
      groups.map((g) =>
        g.kind === "operator" ? [g.key, g.quantity, g.rows.length] : [g.key]
      )
    ).toEqual([
      ["op-tm-ahmed", 3, 2],
      ["op-tm-sara", 1, 1],
    ]);
  });

  it("keeps a kit-inherited row as its own line, with its own key", () => {
    const groups = groupCustodyRecords([
      { id: "c1", quantity: 2, custodian: { id: "tm-ahmed" } },
      {
        id: "c2",
        quantity: 5,
        kitCustodyId: "kc-1",
        custodian: { id: "tm-ahmed" },
      },
    ]);

    expect(groups.map((g) => [g.kind, g.key])).toEqual([
      ["operator", "op-tm-ahmed"],
      ["kit", "kit-c2"],
    ]);
  });
});

describe("describeCustodySources", () => {
  it("says 'from <Location>' for a single source", () => {
    expect(
      describeCustodySources(
        [{ quantity: 2, location: studio, custodian: { id: "tm" } }],
        false
      )
    ).toEqual([{ key: "loc-studio", text: "from Studio", muted: false }]);
  });

  it("lists every source with its count when there are several", () => {
    expect(
      describeCustodySources(
        [
          { quantity: 2, location: camera, custodian: { id: "tm" } },
          { quantity: 1, location: studio, custodian: { id: "tm" } },
        ],
        false
      ).map((p) => p.text)
    ).toEqual(["2 from Camera Room", "1 from Studio"]);
  });

  it("calls a missing source unplaced when the pool has unplaced units", () => {
    expect(
      describeCustodySources(
        [{ quantity: 1, location: null, custodian: { id: "tm" } }],
        true
      )
    ).toEqual([{ key: "none", text: "unplaced", muted: false }]);
  });

  it("marks a missing source on a fully placed pool as not recorded, lighter", () => {
    expect(
      describeCustodySources(
        [{ quantity: 2, location: null, custodian: { id: "tm" } }],
        false
      )
    ).toEqual([{ key: "none", text: "location not recorded", muted: true }]);
  });
});

describe("releaseLineLabel", () => {
  it("names the source and the most that can come from it", () => {
    expect(
      releaseLineLabel(
        { quantity: 2, location: camera, custodian: { id: "tm" } },
        false
      )
    ).toBe("From Camera Room: max 2");
    expect(
      releaseLineLabel(
        { quantity: 1, location: null, custodian: { id: "tm" } },
        true
      )
    ).toBe("Unplaced: max 1");
    expect(
      releaseLineLabel(
        { quantity: 1, location: null, custodian: { id: "tm" } },
        false
      )
    ).toBe("Location not recorded: max 1");
  });
});

describe("releaseLinesReducer", () => {
  const rows = [
    { quantity: 2, location: camera, custodian: { id: "tm" } },
    { quantity: 1, location: studio, custodian: { id: "tm" } },
  ];

  it("opens on a full release, fully used up for a consumable", () => {
    expect(
      releaseLinesReducer([], { type: "reset", rows, isConsumable: true })
    ).toEqual([
      { locationId: "loc-camera", max: 2, quantity: 2, consumed: 2 },
      { locationId: "loc-studio", max: 1, quantity: 1, consumed: 1 },
    ]);
  });

  it("keeps each line within what the person holds from that source", () => {
    let lines = releaseLinesReducer([], {
      type: "reset",
      rows,
      isConsumable: true,
    });
    lines = releaseLinesReducer(lines, {
      type: "set_quantity",
      index: 0,
      value: 5,
    });
    expect(lines[0].quantity).toBe(2);

    // Lowering the quantity pulls the used-up count down with it.
    lines = releaseLinesReducer(lines, {
      type: "set_quantity",
      index: 0,
      value: 1,
    });
    expect(lines[0]).toMatchObject({ quantity: 1, consumed: 1 });

    lines = releaseLinesReducer(lines, {
      type: "set_consumed",
      index: 1,
      value: 4,
    });
    expect(lines[1].consumed).toBe(1);
  });
});

describe("formatCustodySourceOption", () => {
  it("shows plain counts, adding what is in custody only when some are", () => {
    const option = {
      value: "loc-camera",
      locationId: "loc-camera",
      label: "Camera Room",
      placed: 2,
      inCustody: 0,
      left: 2,
    };
    expect(formatCustodySourceOption(option, "pcs")).toBe(
      "Camera Room · 2 pcs"
    );
    expect(
      formatCustodySourceOption({ ...option, inCustody: 1, left: 1 }, "pcs")
    ).toBe("Camera Room · 2 pcs · 1 in custody");
  });
});
