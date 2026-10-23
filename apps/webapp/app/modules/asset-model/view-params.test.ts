/**
 * The model view's param normalization.
 *
 * `lowStockOnly` is the case this exists for. The model view hides the toggle
 * that sets it, so a value riding in on a bookmark, a shared link or the
 * restored filter cookie is state no control on screen can reach: it counts as
 * an active filter, and it narrows the list again the moment the user switches
 * back to it. Both surfaces that normalize a URL for this view go through these
 * two functions, so they cannot come to disagree about which params it is
 * unable to express.
 *
 * @see {@link file://./view-params.ts}
 * @see {@link file://./../../hooks/use-asset-index-view.ts}
 * @see {@link file://./../../components/assets/assets-index/advanced-asset-index-filters-and-sorting.tsx}
 */
import { describe, expect, it } from "vitest";
import {
  findModelViewInapplicableParams,
  MODEL_VIEW_INAPPLICABLE_PARAMS,
  stripModelViewInapplicableParams,
} from "./view-params";

describe("findModelViewInapplicableParams", () => {
  it("names only the params that are set", () => {
    expect(
      findModelViewInapplicableParams(
        new URLSearchParams("view=models&lowStockOnly=true")
      )
    ).toEqual(["lowStockOnly"]);

    expect(
      findModelViewInapplicableParams(
        new URLSearchParams("view=models&title=contains:laptop")
      )
    ).toEqual([]);
  });

  it("leaves the params it was given alone", () => {
    const params = new URLSearchParams("view=models&lowStockOnly=true");

    findModelViewInapplicableParams(params);

    // Call sites pass react-router's live URLSearchParams, so a read that
    // mutated would change the URL the page is rendering from.
    expect(params.toString()).toBe("view=models&lowStockOnly=true");
  });
});

describe("stripModelViewInapplicableParams", () => {
  it("removes them and keeps everything else", () => {
    const params = new URLSearchParams(
      "view=models&lowStockOnly=true&title=contains:laptop&page=3"
    );

    const removed = stripModelViewInapplicableParams(params);

    expect(removed).toEqual(["lowStockOnly"]);
    expect(params.get("lowStockOnly")).toBeNull();
    expect(params.get("view")).toBe("models");
    expect(params.get("title")).toBe("contains:laptop");
    // The rollup ignores these params, so no row moved and the page the user is
    // looking at is still the page they asked for.
    expect(params.get("page")).toBe("3");
  });

  it("reports nothing removed when there was nothing to remove", () => {
    const params = new URLSearchParams("view=models&title=contains:laptop");

    expect(stripModelViewInapplicableParams(params)).toEqual([]);
    expect(params.toString()).toBe("view=models&title=contains%3Alaptop");
  });

  it("covers every param on the list", () => {
    const params = new URLSearchParams();
    MODEL_VIEW_INAPPLICABLE_PARAMS.forEach((param) =>
      params.set(param, "true")
    );

    // A param added to the list without being handled here would leave the
    // model view holding it with no control to clear it.
    expect(stripModelViewInapplicableParams(params)).toEqual([
      ...MODEL_VIEW_INAPPLICABLE_PARAMS,
    ]);
    expect(params.toString()).toBe("");
  });
});
