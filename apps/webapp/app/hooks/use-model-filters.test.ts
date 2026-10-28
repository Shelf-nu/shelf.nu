/**
 * What picking a filter value does to the page number in the URL.
 *
 * A filter changes which rows the list holds, so the page the user was on no
 * longer exists in the same form: page 3 of an unfiltered list can be past the
 * end of the filtered one, which then renders as an empty list. Every change a
 * filter makes to the URL therefore goes back to the first page. The other
 * params ride along.
 *
 * @see {@link file://./use-model-filters.ts}
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelFilterProps } from "./use-model-filters";
import { useModelFilters } from "./use-model-filters";

const urlState = vi.hoisted(() => ({
  /** The URL the hook reads. */
  current: new URLSearchParams(),
  /** What the last setter call asked the URL to become, or null if none. */
  applied: null as URLSearchParams | null,
}));

// why: the real hook is cookie-aware and needs a router plus the asset index
// loader; these cases are about the params the filter writes, so the setter
// records what the updater produced.
vi.mock("./search-params", () => ({
  useSearchParams: () => [
    urlState.current,
    (nextInit: (prev: URLSearchParams) => URLSearchParams) => {
      urlState.applied = nextInit(new URLSearchParams(urlState.current));
    },
  ],
}));

// why: the hook reads its initial options from the route's loader data.
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useLoaderData: () => ({
    categories: [
      { id: "cat-1", name: "Audio", metadata: {} },
      { id: "cat-2", name: "Lens", metadata: {} },
    ],
    totalCategories: 2,
  }),
}));

// why: the search fetcher needs a data router; no case here searches.
vi.mock("./use-fetcher-with-reset", () => ({
  default: () => ({
    data: undefined,
    state: "idle",
    submit: vi.fn(),
    reset: vi.fn(),
  }),
}));

/**
 * Renders the hook on a URL.
 *
 * @param from - The URL's query string
 * @param props - Overrides for the hook's props
 */
function renderFilters(from: string, props: Partial<ModelFilterProps> = {}) {
  urlState.current = new URLSearchParams(from);
  return renderHook(() =>
    useModelFilters({
      model: { name: "category", queryKey: "name" },
      initialDataKey: "categories",
      countKey: "totalCategories",
      ...props,
    })
  );
}

describe("useModelFilters page reset", () => {
  beforeEach(() => {
    urlState.applied = null;
  });

  it("goes back to the first page when a value is picked", () => {
    const { result } = renderFilters("page=3&pageSize=10&timeframe=last_7d");

    act(() => result.current.handleSelectItemChange("cat-1"));

    expect(urlState.applied?.get("page")).toBeNull();
    expect(urlState.applied?.getAll("category")).toEqual(["cat-1"]);
    expect(urlState.applied?.get("pageSize")).toBe("10");
    expect(urlState.applied?.get("timeframe")).toBe("last_7d");
  });

  it("goes back to the first page when a value is removed", () => {
    const { result } = renderFilters("page=2&category=cat-1&category=cat-2");

    act(() => result.current.handleSelectItemChange("cat-1"));

    expect(urlState.applied?.get("page")).toBeNull();
    expect(urlState.applied?.getAll("category")).toEqual(["cat-2"]);
  });

  it("goes back to the first page in single-value mode", () => {
    const { result } = renderFilters("page=4", { selectionMode: "set" });

    act(() => result.current.handleSelectItemChange("cat-2"));

    expect(urlState.applied?.get("page")).toBeNull();
    expect(urlState.applied?.get("category")).toBe("cat-2");
  });

  it("goes back to the first page when the filter is cleared", () => {
    const { result } = renderFilters("page=5&category=cat-1");

    act(() => result.current.clearFilters());

    expect(urlState.applied?.get("page")).toBeNull();
    expect(urlState.applied?.has("category")).toBe(false);
  });

  it("goes back to the first page when every value is selected", () => {
    const { result } = renderFilters("page=2");

    act(() => result.current.handleSelectAll());

    expect(urlState.applied?.get("page")).toBeNull();
    expect(urlState.applied?.getAll("category")).toEqual(["cat-1", "cat-2"]);
  });

  it("leaves the URL alone when the picker does not write to it", () => {
    const { result } = renderFilters("page=3", { selectionMode: "none" });

    act(() => result.current.handleSelectItemChange("cat-1"));

    expect(urlState.applied).toBeNull();
  });
});
