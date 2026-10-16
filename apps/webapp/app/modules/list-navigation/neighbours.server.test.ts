import { beforeEach, describe, expect, it, vi } from "vitest";
import { getListNeighbours, pickNeighbours } from "./neighbours.server";
import type { ListNavigationCaller } from "./registry.server";

const fetchPageIds = vi.hoisted(() => vi.fn());

// why: the list queries are each index's own and are not under test here;
// this pins which pages are asked for and how their ids are stitched
vi.mock("./registry.server", () => ({
  LIST_NAVIGATION_REGISTRY: {
    asset: { permissionEntity: "asset", indexPath: "/assets", fetchPageIds },
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

  it("returns no neighbours when the record is not in the window", () => {
    expect(pickNeighbours(pages, "zzz")).toEqual({ prev: null, next: null });
    expect(pickNeighbours([], "a")).toEqual({ prev: null, next: null });
  });
});

describe("getListNeighbours", () => {
  const caller = { organizationId: "org-1" } as ListNavigationCaller;

  beforeEach(() => {
    fetchPageIds.mockReset();
    fetchPageIds.mockImplementation(({ filters }: { filters: string }) => {
      const page = new URLSearchParams(filters).get("page") ?? "";
      const pages: Record<string, string[]> = {
        "1": ["a", "b"],
        "2": ["c", "d"],
        "3": ["e", "f"],
      };
      return Promise.resolve(pages[page] ?? []);
    });
  });

  it("loads the page and the pages either side through the list's own request", async () => {
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
      prev: { id: "b", page: 1 },
      next: { id: "d", page: 2 },
    });
    const calls = fetchPageIds.mock.calls.map(([args]) => args);
    expect(calls.map((c) => c.filters)).toEqual([
      "s=drill&page=1",
      "s=drill&page=2",
      "s=drill&page=3",
    ]);
    expect(calls[0].listRequest.url).toBe(
      "http://localhost/assets?s=drill&page=1"
    );
    expect(calls[0].listRequest.headers.get("accept-language")).toBe("de");
    expect(calls[0].caller).toBe(caller);
  });

  it("never asks for page 0 when the list is on page 1", async () => {
    await getListNeighbours({
      entity: "asset",
      id: "b",
      filters: "",
      request: new Request("http://localhost/api/list-neighbours"),
      caller,
    });

    expect(fetchPageIds.mock.calls.map(([args]) => args.filters)).toEqual([
      "page=1",
      "page=2",
    ]);
  });
});
