import { describe, expect, it } from "vitest";
import {
  SAVED_REPORT_QUERY_KEYS,
  sanitizeSavedReportQuery,
  savedReportQueryEquals,
} from "./query";

describe("sanitizeSavedReportQuery", () => {
  it("keeps the spec, the filters and the timeframe", () => {
    const query =
      "dataset=bookings&groupBy=month&measure=bookingCount&category=c1&category=c2&cf=f1%3Ared&timeframe=custom&from=2026-01-01&to=2026-03-31";
    const kept = new URLSearchParams(sanitizeSavedReportQuery(query));

    expect(kept.get("dataset")).toBe("bookings");
    expect(kept.get("groupBy")).toBe("month");
    expect(kept.get("measure")).toBe("bookingCount");
    expect(kept.getAll("category")).toEqual(["c1", "c2"]);
    expect(kept.get("cf")).toBe("f1:red");
    expect(kept.get("timeframe")).toBe("custom");
    expect(kept.get("from")).toBe("2026-01-01");
    expect(kept.get("to")).toBe("2026-03-31");
  });

  it("drops keys the builder does not read and empty values", () => {
    const kept = sanitizeSavedReportQuery(
      "?dataset=assets&page=3&per_page=50&utm_source=x&category="
    );
    expect(kept).toBe("dataset=assets");
  });

  it("orders keys by the whitelist, not by the input", () => {
    const a = sanitizeSavedReportQuery("measure=units&dataset=assets");
    const b = sanitizeSavedReportQuery("dataset=assets&measure=units");
    expect(a).toBe(b);
    expect(a).toBe("dataset=assets&measure=units");
  });

  it("accepts URLSearchParams", () => {
    const params = new URLSearchParams({ dataset: "custody", page: "2" });
    expect(sanitizeSavedReportQuery(params)).toBe("dataset=custody");
  });

  it("returns an empty string for an empty or unrelated query", () => {
    expect(sanitizeSavedReportQuery("")).toBe("");
    expect(sanitizeSavedReportQuery("page=2")).toBe("");
  });
});

describe("savedReportQueryEquals", () => {
  it("treats queries as equal when only ignored keys differ", () => {
    expect(
      savedReportQueryEquals(
        "dataset=assets&groupBy=category&page=2",
        "?groupBy=category&dataset=assets"
      )
    ).toBe(true);
  });

  it("sees a different filter value", () => {
    expect(
      savedReportQueryEquals(
        "dataset=assets&category=c1",
        "dataset=assets&category=c2"
      )
    ).toBe(false);
  });
});

describe("SAVED_REPORT_QUERY_KEYS", () => {
  it("covers the legacy filter keys so old links still save", () => {
    expect(SAVED_REPORT_QUERY_KEYS.has("categories")).toBe(true);
    expect(SAVED_REPORT_QUERY_KEYS.has("cf")).toBe(true);
    expect(SAVED_REPORT_QUERY_KEYS.has("timeframe")).toBe(true);
  });
});
