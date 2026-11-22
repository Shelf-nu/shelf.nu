/**
 * Report filter URL grammar.
 *
 * @see {@link file://./filter-params.ts}
 */

import { describe, expect, it } from "vitest";
import {
  ALL_REPORT_FILTER_PARAM_KEYS,
  canonicalReportFilterSearch,
  decodeCustomFieldParam,
  encodeCustomFieldParam,
  hasActiveReportFilters,
  parseReportFilterParams,
  REPORT_FILTER_PARAM,
} from "./filter-params";

describe("parseReportFilterParams", () => {
  it("reads repeated and comma-joined values, trimmed and de-duplicated", () => {
    const params = new URLSearchParams(
      "category=a&category=b,%20c&category=a&location=l1"
    );

    const parsed = parseReportFilterParams(params);

    expect(parsed.categoryIds).toEqual(["a", "b", "c"]);
    expect(parsed.locationIds).toEqual(["l1"]);
  });

  it("accepts the legacy spellings so old links keep filtering", () => {
    const params = new URLSearchParams(
      "categories=a,b&locations=l1&statuses=AVAILABLE,IN_CUSTODY&custodian=tm1"
    );

    const parsed = parseReportFilterParams(params);

    expect(parsed.categoryIds).toEqual(["a", "b"]);
    expect(parsed.locationIds).toEqual(["l1"]);
    expect(parsed.statuses).toEqual(["AVAILABLE", "IN_CUSTODY"]);
    expect(parsed.teamMemberId).toBe("tm1");
  });

  it("prefers the current key over its legacy alias for single values", () => {
    const params = new URLSearchParams("teamMember=new&custodian=old");

    expect(parseReportFilterParams(params).teamMemberId).toBe("new");
  });

  it("parses custom-field pairs and drops malformed ones", () => {
    const params = new URLSearchParams();
    params.append("cf", "field1:yes");
    params.append("cf", "field2:16/17:extra"); // value may contain colons
    params.append("cf", "nocolon");
    params.append("cf", ":novalue");
    params.append("cf", "field1:yes"); // duplicate

    const parsed = parseReportFilterParams(params);

    expect(parsed.customFieldValues).toEqual([
      { customFieldId: "field1", value: "yes" },
      { customFieldId: "field2", value: "16/17:extra" },
    ]);
  });

  it("returns empty lists and nulls when nothing is set", () => {
    const parsed = parseReportFilterParams(new URLSearchParams("page=2"));

    expect(parsed).toEqual({
      categoryIds: [],
      locationIds: [],
      teamMemberId: null,
      statuses: [],
      assetModelIds: [],
      assetId: null,
      customFieldValues: [],
    });
    expect(hasActiveReportFilters(parsed)).toBe(false);
  });

  it("reports activity for every filter kind", () => {
    for (const query of [
      "category=a",
      "location=a",
      "teamMember=a",
      "status=AVAILABLE",
      "assetModel=a",
      "asset=a",
      "cf=f:v",
    ]) {
      expect(
        hasActiveReportFilters(
          parseReportFilterParams(new URLSearchParams(query))
        )
      ).toBe(true);
    }
  });
});

describe("custom field param encoding", () => {
  it("round-trips through encode and decode", () => {
    const filter = { customFieldId: "clx1", value: "Perkins: yes" };

    expect(decodeCustomFieldParam(encodeCustomFieldParam(filter))).toEqual(
      filter
    );
  });

  it("keeps a value's own leading and trailing spaces, which the stored text may carry", () => {
    for (const value of ["Room 4 ", " Room 4", "a  b"]) {
      const filter = { customFieldId: "clx1", value };
      expect(decodeCustomFieldParam(encodeCustomFieldParam(filter))).toEqual(
        filter
      );
    }
  });

  it("drops a value that is only whitespace", () => {
    expect(decodeCustomFieldParam("clx1:   ")).toBeNull();
  });

  it("uses the key the parser reads", () => {
    expect(REPORT_FILTER_PARAM.customField).toBe("cf");
    expect(ALL_REPORT_FILTER_PARAM_KEYS).toContain("cf");
    expect(ALL_REPORT_FILTER_PARAM_KEYS).toContain("categories");
  });
});

describe("canonicalReportFilterSearch", () => {
  it("rewrites legacy keys and comma-joined values to one value per key", () => {
    const canonical = canonicalReportFilterSearch(
      new URLSearchParams(
        "statuses=AVAILABLE,IN_CUSTODY&timeframe=last_7d&categories=a,b&locations=l1&custodian=u1"
      )
    );

    expect(canonical?.toString()).toBe(
      "status=AVAILABLE&status=IN_CUSTODY&timeframe=last_7d&category=a&category=b&location=l1&teamMember=u1"
    );
  });

  it("splits comma-joined values on current keys and drops duplicates", () => {
    const canonical = canonicalReportFilterSearch(
      new URLSearchParams("category=a,b&category=a&assetModel=m1,m2")
    );

    expect(canonical?.toString()).toBe(
      "category=a&category=b&assetModel=m1&assetModel=m2"
    );
  });

  it("lets the current custodian key win over the legacy one", () => {
    const canonical = canonicalReportFilterSearch(
      new URLSearchParams("teamMember=tm1&custodian=u1")
    );

    expect(canonical?.toString()).toBe("teamMember=tm1");
  });

  it("leaves custom-field values alone, commas included", () => {
    expect(
      canonicalReportFilterSearch(
        new URLSearchParams("cf=f1:a,b&category=c1&timeframe=last_7d")
      )
    ).toBeNull();
  });

  it("returns null when the query is already canonical", () => {
    expect(
      canonicalReportFilterSearch(
        new URLSearchParams("category=a&category=b&status=AVAILABLE&page=2")
      )
    ).toBeNull();
  });
});
