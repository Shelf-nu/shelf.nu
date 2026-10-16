import { describe, expect, it } from "vitest";
import {
  LIST_DETAIL_PATH,
  readListContext,
  readPage,
  withPage,
} from "./list-context";

describe("readPage", () => {
  it("reads the page param, with or without the leading ?", () => {
    expect(readPage("?s=drill&page=3")).toBe(3);
    expect(readPage("page=2")).toBe(2);
  });

  it("falls back to page 1 when the param is absent or not a positive integer", () => {
    expect(readPage("")).toBe(1);
    expect(readPage("?page=0")).toBe(1);
    expect(readPage("?page=-2")).toBe(1);
    expect(readPage("?page=abc")).toBe(1);
    expect(readPage("?page=1.5")).toBe(1);
  });
});

describe("withPage", () => {
  it("replaces the page and keeps every other param in order", () => {
    expect(withPage("?s=drill&page=2&sortBy=title:asc", 3)).toBe(
      "?s=drill&page=3&sortBy=title%3Aasc"
    );
  });

  it("adds the page when the search has none", () => {
    expect(withPage("", 2)).toBe("?page=2");
  });

  it("keeps repeated params", () => {
    expect(withPage("?status=a&status=b", 1)).toBe("?status=a&status=b&page=1");
  });
});

describe("readListContext", () => {
  it("accepts a well-formed context", () => {
    expect(readListContext({ entity: "kit", search: "?page=2" })).toEqual({
      entity: "kit",
      search: "?page=2",
    });
  });

  it("rejects anything else", () => {
    expect(readListContext(null)).toBeNull();
    expect(readListContext("asset")).toBeNull();
    expect(readListContext({ entity: "user", search: "" })).toBeNull();
    expect(readListContext({ entity: "asset" })).toBeNull();
  });
});

describe("LIST_DETAIL_PATH", () => {
  it("opens asset and booking rows on the overview tab, which keeps history state", () => {
    expect(LIST_DETAIL_PATH.asset("a1")).toBe("/assets/a1/overview");
    expect(LIST_DETAIL_PATH.booking("b1")).toBe("/bookings/b1/overview");
    expect(LIST_DETAIL_PATH.kit("k1")).toBe("/kits/k1/assets");
    expect(LIST_DETAIL_PATH.location("l1")).toBe("/locations/l1/assets");
  });
});
