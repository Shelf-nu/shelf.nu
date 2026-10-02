/**
 * Query-string helpers behind the report filter bar.
 *
 * @see {@link file://./search-param-utils.ts}
 */

import { describe, expect, it } from "vitest";
import {
  appendSearchParamValue,
  clearReportFilterParams,
  removeSearchParamValue,
  toggleSearchParamValue,
} from "./search-param-utils";

describe("removeSearchParamValue", () => {
  it("removes one value of a repeated key and keeps the rest", () => {
    const params = new URLSearchParams(
      "category=a&category=b&location=l&page=3"
    );

    const next = removeSearchParamValue(params, "category", "a");

    expect(next.getAll("category")).toEqual(["b"]);
    expect(next.get("location")).toBe("l");
    expect(next.has("page")).toBe(false);
  });

  it("leaves the params alone when the pair is absent, except paging", () => {
    const params = new URLSearchParams("category=a&page=2&timeframe=last_7d");

    const next = removeSearchParamValue(params, "category", "zzz");

    expect(next.getAll("category")).toEqual(["a"]);
    expect(next.get("timeframe")).toBe("last_7d");
    expect(next.has("page")).toBe(false);
  });
});

describe("appendSearchParamValue", () => {
  it("adds a value once and resets paging", () => {
    const params = new URLSearchParams("category=a&page=4");

    const once = appendSearchParamValue(params, "category", "b");
    const twice = appendSearchParamValue(once, "category", "b");

    expect(once.getAll("category")).toEqual(["a", "b"]);
    expect(twice.getAll("category")).toEqual(["a", "b"]);
    expect(once.has("page")).toBe(false);
  });
});

describe("toggleSearchParamValue", () => {
  it("adds when absent and removes when present", () => {
    const params = new URLSearchParams("status=AVAILABLE");

    const added = toggleSearchParamValue(params, "status", "IN_CUSTODY");
    expect(added.getAll("status")).toEqual(["AVAILABLE", "IN_CUSTODY"]);

    const removed = toggleSearchParamValue(added, "status", "AVAILABLE");
    expect(removed.getAll("status")).toEqual(["IN_CUSTODY"]);
  });
});

describe("clearReportFilterParams", () => {
  it("drops every filter key, current and legacy, and keeps the rest", () => {
    const params = new URLSearchParams(
      "category=a&categories=b&location=l&teamMember=t&custodian=c&status=s&statuses=s2&assetModel=m&asset=x&cf=f:v&timeframe=last_30d&sortBy=x&page=2"
    );

    const next = clearReportFilterParams(params);

    expect([...next.keys()].sort()).toEqual(["sortBy", "timeframe"]);
    expect(next.get("timeframe")).toBe("last_30d");
  });
});
