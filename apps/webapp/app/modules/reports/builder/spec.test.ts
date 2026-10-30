/**
 * Report builder spec: URL grammar and dataset compatibility.
 *
 * @see {@link file://./spec.ts}
 */

import { describe, expect, it } from "vitest";
import { REPORTS } from "../registry";
import {
  BUILDER_DATASETS,
  BUILDER_REPORT_DEF,
  DATASET_GROUP_BYS,
  DATASET_MEASURES,
  DEFAULT_BUILDER_SPEC,
  encodeGroupBy,
  parseBuilderSpec,
  withDataset,
  writeBuilderSpec,
} from "./spec";

describe("parseBuilderSpec", () => {
  it("falls back to the default report for an empty query string", () => {
    expect(parseBuilderSpec(new URLSearchParams())).toEqual(
      DEFAULT_BUILDER_SPEC
    );
  });

  it("reads a valid spec, custom-field grouping included", () => {
    const spec = parseBuilderSpec(
      new URLSearchParams(
        "dataset=bookings&groupBy=customField:cf-1&measure=daysBooked"
      )
    );

    expect(spec).toEqual({
      dataset: "bookings",
      groupBy: "customField",
      customFieldId: "cf-1",
      measure: "daysBooked",
    });
  });

  it("repairs a grouping or measure the dataset does not support", () => {
    // `month` and `bookingCount` belong to bookings, not assets.
    const spec = parseBuilderSpec(
      new URLSearchParams("dataset=assets&groupBy=month&measure=bookingCount")
    );

    expect(spec).toEqual({
      dataset: "assets",
      groupBy: DATASET_GROUP_BYS.assets[0],
      customFieldId: null,
      measure: DATASET_MEASURES.assets[0],
    });
  });

  it("ignores unknown values and an empty custom field id", () => {
    expect(
      parseBuilderSpec(
        new URLSearchParams("dataset=payroll&groupBy=customField:&measure=x")
      )
    ).toEqual(DEFAULT_BUILDER_SPEC);
  });

  it("keeps 'none' as a grouping on every dataset", () => {
    for (const dataset of BUILDER_DATASETS) {
      const spec = parseBuilderSpec(
        new URLSearchParams(`dataset=${dataset}&groupBy=none`)
      );
      expect(spec.groupBy).toBe("none");
    }
  });
});

describe("writeBuilderSpec / encodeGroupBy", () => {
  it("round-trips through the query string and resets paging", () => {
    const params = new URLSearchParams("category=c1&page=3&timeframe=last_7d");
    const spec = {
      dataset: "custody" as const,
      groupBy: "customField" as const,
      customFieldId: "cf-9",
      measure: "custodyUnits" as const,
    };

    const written = writeBuilderSpec(params, spec);

    expect(written.get("groupBy")).toBe("customField:cf-9");
    expect(written.get("category")).toBe("c1");
    expect(written.get("timeframe")).toBe("last_7d");
    expect(written.has("page")).toBe(false);
    expect(parseBuilderSpec(written)).toEqual(spec);
  });

  it("encodes plain groupings unchanged", () => {
    expect(encodeGroupBy("category", null)).toBe("category");
    expect(encodeGroupBy("customField", null)).toBe("customField");
  });
});

describe("withDataset", () => {
  it("keeps compatible choices and resets the rest", () => {
    const fromBookings = {
      dataset: "bookings" as const,
      groupBy: "month" as const,
      customFieldId: null,
      measure: "daysBooked" as const,
    };

    expect(withDataset(fromBookings, "custody")).toEqual({
      dataset: "custody",
      groupBy: DATASET_GROUP_BYS.custody[0],
      customFieldId: null,
      measure: DATASET_MEASURES.custody[0],
    });

    const shared = {
      dataset: "assets" as const,
      groupBy: "customField" as const,
      customFieldId: "cf-1",
      measure: "totalValue" as const,
    };
    expect(withDataset(shared, "custody")).toEqual({
      dataset: "custody",
      groupBy: "customField",
      customFieldId: "cf-1",
      measure: "totalValue",
    });
  });
});

describe("BUILDER_REPORT_DEF", () => {
  it("has an id no fixed report uses, so /reports/builder never collides", () => {
    expect(REPORTS.some((r) => r.id === BUILDER_REPORT_DEF.id)).toBe(false);
  });

  it("declares every dataset grouping as a filter where one exists", () => {
    const types = BUILDER_REPORT_DEF.filters.map((f) => f.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "category",
        "location",
        "status",
        "asset_model",
        "custom_field",
      ])
    );
  });
});
