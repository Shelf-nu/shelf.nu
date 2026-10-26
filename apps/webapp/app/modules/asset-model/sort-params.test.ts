/**
 * The model view's header-click sort contract.
 *
 * Nothing is mocked: both functions are pure, and what is worth pinning is the
 * agreement between the header and the server. The server normalises an
 * unrecognised `modelSortBy` to name ascending, so a header must never announce
 * a sort built from one, which is the last case below.
 *
 * @see {@link file://./sort-params.ts}
 */
import { describe, expect, it } from "vitest";
import {
  resolveAssetModelAriaSort,
  resolveNextAssetModelSort,
} from "./sort-params";

describe("resolveNextAssetModelSort", () => {
  it("opens a name sort ascending and a count sort descending", () => {
    const from = { activeSortBy: "name", activeSortDirection: "asc" };

    expect(resolveNextAssetModelSort({ sortKey: "assets", ...from })).toEqual({
      sortBy: "assets",
      sortDirection: "desc",
    });
    expect(
      resolveNextAssetModelSort({ sortKey: "available", ...from })
    ).toEqual({ sortBy: "available", sortDirection: "desc" });
    expect(resolveNextAssetModelSort({ sortKey: "value", ...from })).toEqual({
      sortBy: "value",
      sortDirection: "desc",
    });
    expect(
      resolveNextAssetModelSort({
        sortKey: "name",
        activeSortBy: "value",
        activeSortDirection: "desc",
      })
    ).toEqual({ sortBy: "name", sortDirection: "asc" });
  });

  it("flips the direction of the column already sorted", () => {
    expect(
      resolveNextAssetModelSort({
        sortKey: "name",
        activeSortBy: "name",
        activeSortDirection: "asc",
      })
    ).toEqual({ sortBy: "name", sortDirection: "desc" });

    expect(
      resolveNextAssetModelSort({
        sortKey: "name",
        activeSortBy: "name",
        activeSortDirection: "desc",
      })
    ).toEqual({ sortBy: "name", sortDirection: "asc" });
  });

  it("opens a new column in its own direction, not the previous one", () => {
    expect(
      resolveNextAssetModelSort({
        sortKey: "value",
        activeSortBy: "name",
        activeSortDirection: "asc",
      })
    ).toEqual({ sortBy: "value", sortDirection: "desc" });

    expect(
      resolveNextAssetModelSort({
        sortKey: "name",
        activeSortBy: "assets",
        activeSortDirection: "desc",
      })
    ).toEqual({ sortBy: "name", sortDirection: "asc" });
  });

  it("treats a sort the server does not support as no sort at all", () => {
    // The server falls back to name ascending for an unknown key, so a click
    // must open the clicked column fresh rather than flip a direction that
    // describes an ordering nobody applied.
    expect(
      resolveNextAssetModelSort({
        sortKey: "assets",
        activeSortBy: "createdAt",
        activeSortDirection: "asc",
      })
    ).toEqual({ sortBy: "assets", sortDirection: "desc" });
  });
});

describe("resolveAssetModelAriaSort", () => {
  it("announces a direction on the active column only", () => {
    expect(
      resolveAssetModelAriaSort({
        sortKey: "value",
        activeSortBy: "value",
        activeSortDirection: "desc",
      })
    ).toBe("descending");

    expect(
      resolveAssetModelAriaSort({
        sortKey: "value",
        activeSortBy: "value",
        activeSortDirection: "asc",
      })
    ).toBe("ascending");

    expect(
      resolveAssetModelAriaSort({
        sortKey: "value",
        activeSortBy: "name",
        activeSortDirection: "asc",
      })
    ).toBe("none");
  });

  it("announces nothing for a sort key the server does not support", () => {
    expect(
      resolveAssetModelAriaSort({
        sortKey: "name",
        activeSortBy: "createdAt",
        activeSortDirection: "desc",
      })
    ).toBe("none");
  });
});
