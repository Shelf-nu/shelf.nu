import { describe, expect, it } from "vitest";
import { formatCustodySourceOption } from "./custody-source-select";
import {
  describeCustodySources,
  groupCustodyRecords,
  releaseLineSource,
  releaseSourceValue,
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
      describeCustodySources([
        { quantity: 2, location: studio, custodian: { id: "tm" } },
      ])
    ).toEqual([{ key: "loc-studio", text: "from Studio", muted: false }]);
  });

  it("lists every source with its count when there are several", () => {
    expect(
      describeCustodySources([
        { quantity: 2, location: camera, custodian: { id: "tm" } },
        { quantity: 1, location: studio, custodian: { id: "tm" } },
      ]).map((p) => p.text)
    ).toEqual(["2 from Camera Room", "1 from Studio"]);
  });

  it("calls a row with no location unplaced", () => {
    expect(
      describeCustodySources([
        { quantity: 1, location: null, custodian: { id: "tm" } },
      ])
    ).toEqual([{ key: "unplaced", text: "unplaced", muted: false }]);
  });

  it("marks a source never recorded as not recorded, lighter", () => {
    expect(
      describeCustodySources([
        {
          quantity: 2,
          location: null,
          sourceUnknown: true,
          custodian: { id: "tm" },
        },
      ])
    ).toEqual([
      { key: "unrecorded", text: "location not recorded", muted: true },
    ]);
  });

  it("keeps the unplaced units and a source never recorded apart for one person", () => {
    expect(
      describeCustodySources([
        { quantity: 1, location: null, custodian: { id: "tm" } },
        {
          quantity: 2,
          location: null,
          sourceUnknown: true,
          custodian: { id: "tm" },
        },
      ])
    ).toEqual([
      { key: "unplaced", text: "1 unplaced", muted: false },
      { key: "unrecorded", text: "2 location not recorded", muted: true },
    ]);
  });
});

describe("releaseLineSource and releaseSourceValue", () => {
  it("name each source and post the value the release route reads", () => {
    const located = { quantity: 2, location: camera, custodian: { id: "tm" } };
    const unplaced = { quantity: 1, location: null, custodian: { id: "tm" } };
    const unrecorded = { ...unplaced, sourceUnknown: true };

    expect(releaseLineSource(located)).toBe("From Camera Room");
    expect(releaseLineSource(unplaced)).toBe("Unplaced");
    expect(releaseLineSource(unrecorded)).toBe("Location not recorded");

    expect(releaseSourceValue(located)).toBe("loc-camera");
    expect(releaseSourceValue(unplaced)).toBe("unplaced");
    expect(releaseSourceValue(unrecorded)).toBe("unrecorded");
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
      {
        source: "loc-camera",
        label: "From Camera Room",
        max: 2,
        quantity: 2,
        consumed: 2,
      },
      {
        source: "loc-studio",
        label: "From Studio",
        max: 1,
        quantity: 1,
        consumed: 1,
      },
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

  it("takes whole units only: a decimal is cut, an unreadable value is 0", () => {
    let lines = releaseLinesReducer([], {
      type: "reset",
      rows,
      isConsumable: false,
    });
    lines = releaseLinesReducer(lines, {
      type: "set_quantity",
      index: 0,
      value: 1.5,
    });
    expect(lines[0].quantity).toBe(1);
    lines = releaseLinesReducer(lines, {
      type: "set_quantity",
      index: 0,
      value: Number.NaN,
    });
    expect(lines[0].quantity).toBe(0);
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
      onBooking: 0,
      left: 2,
    };
    expect(formatCustodySourceOption(option, "pcs")).toBe(
      "Camera Room · 2 pcs"
    );
    expect(
      formatCustodySourceOption(
        { ...option, inCustody: 1, onBooking: 0, left: 1 },
        "pcs"
      )
    ).toBe("Camera Room · 2 pcs · 1 in custody");
  });
});
