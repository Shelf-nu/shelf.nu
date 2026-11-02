import { beforeEach, describe, expect, it, vi } from "vitest";
import { getListNeighbours, pickNeighbours } from "./neighbours.server";
import type { ListNavigationCaller } from "./registry.server";

const fetchPageIds = vi.hoisted(() => vi.fn());
const createPageFetcher = vi.hoisted(() => vi.fn());

// why: the list queries are each index's own and are not under test here;
// this pins which pages are asked for and how their ids are stitched
vi.mock("./registry.server", () => ({
  LIST_NAVIGATION_REGISTRY: {
    asset: {
      permissionEntity: "asset",
      indexPath: "/assets",
      createPageFetcher,
    },
  },
}));

describe("pickNeighbours", () => {
  const pages = [
    { page: 1, ids: ["a", "b"] },
    { page: 2, ids: ["c", "d"] },
    { page: 3, ids: ["e"] },
  ];

  it("returns the rows either side, within a page", () => {
    expect(pickNeighbours(pages, "c")).toEqual({
      prev: { id: "b", page: 1 },
      next: { id: "d", page: 2 },
    });
  });

  it("crosses page boundaries in both directions", () => {
    expect(pickNeighbours(pages, "d")).toEqual({
      prev: { id: "c", page: 2 },
      next: { id: "e", page: 3 },
    });
  });

  it("has no previous on the first row and no next on the last", () => {
    expect(pickNeighbours(pages, "a").prev).toBeNull();
    expect(pickNeighbours(pages, "e").next).toBeNull();
  });

  it("counts a repeated id once, so a record is never its own neighbour", () => {
    const shifted = [
      { page: 1, ids: ["a", "b"] },
      { page: 2, ids: ["b", "c"] },
    ];
    expect(pickNeighbours(shifted, "b")).toEqual({
      prev: { id: "a", page: 1 },
      next: { id: "c", page: 2 },
    });
  });

  it("returns no neighbours when the record is not in the window", () => {
    expect(pickNeighbours(pages, "zzz")).toEqual({ prev: null, next: null });
    expect(pickNeighbours([], "a")).toEqual({ prev: null, next: null });
  });
});

describe("getListNeighbours", () => {
  const caller = { organizationId: "org-1" } as ListNavigationCaller;

  beforeEach(() => {
    createPageFetcher.mockReset();
    createPageFetcher.mockResolvedValue(fetchPageIds);
    fetchPageIds.mockReset();
    fetchPageIds.mockImplementation(({ filters }: { filters: string }) => {
      const page = new URLSearchParams(filters).get("page") ?? "";
      const pages: Record<string, string[]> = {
        "1": ["a"],
        "2": ["b", "c", "d"],
        "3": ["e", "f"],
      };
      return Promise.resolve(pages[page] ?? []);
    });
  });

  /** The filters of every page load, in call order. */
  function loadedPages() {
    return fetchPageIds.mock.calls.map(([args]) => args.filters);
  }

  it("loads only the record's own page when it sits mid-page", async () => {
    const neighbours = await getListNeighbours({
      entity: "asset",
      id: "c",
      filters: "s=drill&page=2",
      request: new Request("http://localhost/api/list-neighbours", {
        headers: { "accept-language": "de" },
      }),
      caller,
    });

    expect(neighbours).toEqual({
      prev: { id: "b", page: 2 },
      next: { id: "d", page: 2 },
    });
    expect(loadedPages()).toEqual(["s=drill&page=2"]);
    const [{ listRequest }] = fetchPageIds.mock.calls[0];
    expect(listRequest.url).toBe("http://localhost/assets?s=drill&page=2");
    expect(listRequest.headers.get("accept-language")).toBe("de");
    // The page-independent work runs once per lookup, not once per page.
    expect(createPageFetcher).toHaveBeenCalledTimes(1);
    expect(createPageFetcher).toHaveBeenCalledWith(
      expect.objectContaining({ filters: "s=drill&page=2", caller })
    );
  });

  it("loads the previous page for the first row and the next page for the last", async () => {
    const request = new Request("http://localhost/api/list-neighbours");

    const first = await getListNeighbours({
      entity: "asset",
      id: "b",
      filters: "page=2",
      request,
      caller,
    });
    expect(first).toEqual({
      prev: { id: "a", page: 1 },
      next: { id: "c", page: 2 },
    });
    expect(loadedPages()).toEqual(["page=2", "page=1"]);

    fetchPageIds.mockClear();
    const last = await getListNeighbours({
      entity: "asset",
      id: "d",
      filters: "page=2",
      request,
      caller,
    });
    expect(last).toEqual({
      prev: { id: "c", page: 2 },
      next: { id: "e", page: 3 },
    });
    expect(loadedPages()).toEqual(["page=2", "page=3"]);
  });

  it("loads both sides when the record has moved off its page", async () => {
    const neighbours = await getListNeighbours({
      entity: "asset",
      id: "e",
      filters: "page=2",
      request: new Request("http://localhost/api/list-neighbours"),
      caller,
    });

    expect(neighbours).toEqual({
      prev: { id: "d", page: 2 },
      next: { id: "f", page: 3 },
    });
    expect(loadedPages()).toEqual(["page=2", "page=1", "page=3"]);
  });

  it("never asks for page 0 when the list is on page 1", async () => {
    await getListNeighbours({
      entity: "asset",
      id: "a",
      filters: "",
      request: new Request("http://localhost/api/list-neighbours"),
      caller,
    });

    // "a" is page 1's only row, so it is also its last: page 2 loads, page 0 never.
    expect(loadedPages()).toEqual(["page=1", "page=2"]);
  });
});
