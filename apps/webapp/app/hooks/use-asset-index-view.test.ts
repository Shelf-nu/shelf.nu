/**
 * What switching the asset index's view does to the rest of the URL.
 *
 * Every other param rides along, because a view change is not a filter change.
 * The two exceptions are the ones the destination cannot make sense of: the page
 * number, which counts different things in each view, and the params the model
 * view hides the controls for. Left in place, the second kind is state no
 * control on screen can reach, and it narrows the list again as soon as the user
 * switches back.
 *
 * @see {@link file://./use-asset-index-view.ts}
 * @see {@link file://./../modules/asset-model/view-params.ts}
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAssetIndexView } from "./use-asset-index-view";

const urlState = vi.hoisted(() => ({
  /** The URL the hook reads. */
  current: new URLSearchParams(),
  /** What the last `setView` call asked the URL to become. */
  applied: null as URLSearchParams | null,
}));

// why: the real hook is cookie-aware and needs a router plus the asset index
// loader; the cases here are about the params it hands back, so the setter just
// records what the updater produced.
vi.mock("./search-params", () => ({
  useSearchParams: () => [
    urlState.current,
    (nextInit: (prev: URLSearchParams) => URLSearchParams) => {
      urlState.applied = nextInit(new URLSearchParams(urlState.current));
    },
  ],
}));

// why: the three gates all read route loader data or the viewport. Opened here,
// so `isModelView` reflects the `view` param alone.
vi.mock("./use-asset-index-view-state", () => ({
  useAssetIndexViewState: () => ({ modeIsAdvanced: true }),
}));
vi.mock("./use-is-user-assets-page", () => ({
  useIsUserAssetsPage: () => false,
}));
vi.mock("./use-viewport-height", () => ({
  useViewportHeight: () => ({ isMd: true }),
}));

/**
 * Switches the view from a given URL.
 *
 * @param from - The URL's query string before the switch
 * @param next - The view to switch to
 * @returns The query the hook asked the URL to become
 */
function switchView(from: string, next: "table" | "availability" | "models") {
  urlState.current = new URLSearchParams(from);

  const { result } = renderHook(() => useAssetIndexView());
  result.current.setView(next);

  if (!urlState.applied) {
    throw new Error("setView did not write the URL");
  }
  return urlState.applied;
}

beforeEach(() => {
  urlState.current = new URLSearchParams();
  urlState.applied = null;
});

describe("setView", () => {
  it("drops the params the model view cannot express", () => {
    const applied = switchView(
      "lowStockOnly=true&title=contains:laptop&page=4",
      "models"
    );

    expect(applied.get("view")).toBe("models");
    expect(applied.get("lowStockOnly")).toBeNull();
    // Column filters apply to the rollup unchanged: it is built from the same
    // filtered asset set as the list.
    expect(applied.get("title")).toBe("contains:laptop");
    expect(applied.get("page")).toBeNull();
  });

  it("keeps them on the views that offer the toggle", () => {
    expect(
      switchView("lowStockOnly=true&view=models", "availability").get(
        "lowStockOnly"
      )
    ).toBe("true");

    expect(
      switchView("lowStockOnly=true&view=models", "table").get("lowStockOnly")
    ).toBe("true");
  });

  it("removes the view param for the table view rather than naming it", () => {
    const applied = switchView("view=models", "table");

    expect(applied.has("view")).toBe(false);
  });
});
