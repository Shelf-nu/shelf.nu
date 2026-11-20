import { describe, expect, it } from "vitest";
import { describeSavedReportQuery } from "./describe";

describe("describeSavedReportQuery", () => {
  it("names the data set, grouping and measure", () => {
    expect(
      describeSavedReportQuery(
        "dataset=assets&groupBy=category&measure=totalValue"
      )
    ).toBe("Assets · by Category · Total value");
  });

  it("omits the grouping when there is none", () => {
    expect(
      describeSavedReportQuery(
        "dataset=bookings&groupBy=none&measure=bookingCount"
      )
    ).toBe("Bookings · Number of bookings");
  });

  it("counts filter values", () => {
    expect(
      describeSavedReportQuery(
        "dataset=assets&groupBy=location&measure=assetCount&category=a&category=b&cf=f%3Ax"
      )
    ).toMatch(/· 3 filters$/);
    expect(
      describeSavedReportQuery(
        "dataset=assets&measure=assetCount&status=AVAILABLE"
      )
    ).toMatch(/· 1 filter$/);
  });

  it("falls back to the default spec for an empty query", () => {
    expect(describeSavedReportQuery("")).toMatch(/^Assets/);
  });
});
