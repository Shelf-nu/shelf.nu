import { describe, expect, it } from "vitest";
import type { AuditFindingsPage } from "~/modules/audit/findings.server";
import {
  findingSummary,
  findingsListReducer,
  initFindingsList,
} from "./audit-findings-helpers";

/** A page of findings holding one asset per id given. */
function page(
  number: number,
  assetIds: string[],
  { hasMore = true, totalFindings = 25 } = {}
): AuditFindingsPage {
  return {
    page: number,
    hasMore,
    totalFindings,
    findings: assetIds.map((assetId) => ({
      assetId,
      assetName: `Asset ${assetId}`,
      images: [],
      notes: [],
    })),
  };
}

const ids = (state: { findings: { assetId: string }[] }) =>
  state.findings.map((f) => f.assetId);

describe("findingsListReducer", () => {
  it("appends the next page and takes its paging facts", () => {
    const state = findingsListReducer(initFindingsList(page(1, ["a", "b"])), {
      type: "page_loaded",
      page: page(2, ["c"], { hasMore: false, totalFindings: 3 }),
    });

    expect(ids(state)).toEqual(["a", "b", "c"]);
    expect(state).toMatchObject({
      lastPage: 2,
      hasMore: false,
      totalFindings: 3,
    });
  });

  it("ignores a repeated or out-of-order page", () => {
    const start = initFindingsList(page(1, ["a"]));

    expect(
      findingsListReducer(start, { type: "page_loaded", page: page(1, ["a"]) })
    ).toBe(start);
    expect(
      findingsListReducer(start, { type: "page_loaded", page: page(3, ["z"]) })
    ).toBe(start);
  });

  it("drops an asset already listed when the pages shift", () => {
    const state = findingsListReducer(initFindingsList(page(1, ["a", "b"])), {
      type: "page_loaded",
      page: page(2, ["b", "c"]),
    });

    expect(ids(state)).toEqual(["a", "b", "c"]);
  });
});

describe("findingSummary", () => {
  it("counts photos and notes with singular and plural words", () => {
    expect(findingSummary(1, 2)).toBe("1 photo · 2 notes");
    expect(findingSummary(3, 0)).toBe("3 photos");
    expect(findingSummary(0, 1)).toBe("1 note");
  });
});
