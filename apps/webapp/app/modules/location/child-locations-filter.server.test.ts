/**
 * "Include assets from child locations" — resolver behaviour.
 *
 * Pins what the resolver hands to the asset query builders for a URL: nothing
 * when the opt-in is off (so the builders stay on exact match), and the ticked
 * locations plus every descendant when it is on. Also pins when the checkbox is
 * offered: only when a ticked location has child locations.
 *
 * @see {@link file://./child-locations-filter.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import {
  hasTickedLocationWithChildren,
  resolveLocationFilterIds,
} from "./child-locations-filter.server";
import { getLocationDescendantIds } from "./descendants.server";

// why: the module graph reaches `db.server`, which opens a real Prisma
// connection on import. Only `location.findFirst` is ever called here.
vi.mock("~/database/db.server", () => ({
  db: { location: { findFirst: vi.fn() } },
}));

// why: the descendant lookup is a recursive SQL query against Postgres, which
// the unit suite cannot reach. The tests stand in a location tree for it that
// honours the same workspace scoping, and assert what the resolver does with
// the answer.
vi.mock("./descendants.server", () => ({
  getLocationDescendantIds: vi.fn(),
}));

const ORG = "org-1";

/**
 * A two-level tree owned by ORG, plus one location owned by another workspace:
 *
 *   campus ─┬─ building-a ─── room-a1
 *           └─ building-b
 *   other-org-site ─── other-org-room      (different organization)
 */
const CHILDREN_BY_ORG: Record<string, Record<string, string[]>> = {
  [ORG]: {
    campus: ["building-a", "building-b"],
    "building-a": ["room-a1"],
    "building-b": [],
    "room-a1": [],
  },
  "org-2": {
    "other-org-site": ["other-org-room"],
    "other-org-room": [],
  },
};

/** Mirrors the real helper: self plus all descendants, within one workspace. */
function descendantsInTree(organizationId: string, locationId: string) {
  const tree = CHILDREN_BY_ORG[organizationId] ?? {};
  if (!(locationId in tree)) return [];

  const ids: string[] = [];
  const queue = [locationId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    ids.push(current);
    queue.push(...(tree[current] ?? []));
  }
  return ids;
}

function resolve(query: string) {
  return resolveLocationFilterIds({
    organizationId: ORG,
    searchParams: new URLSearchParams(query),
  });
}

beforeEach(() => {
  vi.mocked(db.location.findFirst).mockReset();
  vi.mocked(getLocationDescendantIds)
    .mockReset()
    .mockImplementation(({ organizationId, locationId }) =>
      Promise.resolve(descendantsInTree(organizationId, locationId))
    );
});

describe("resolveLocationFilterIds", () => {
  it("returns no override when the checkbox is off, and reads nothing", async () => {
    expect(await resolve("location=campus")).toBeUndefined();
    expect(getLocationDescendantIds).not.toHaveBeenCalled();
  });

  it("treats any value other than the on-value as off", async () => {
    expect(
      await resolve("location=campus&includeChildLocations=false")
    ).toBeUndefined();
    expect(
      await resolve("location=campus&includeChildLocations=")
    ).toBeUndefined();
    expect(getLocationDescendantIds).not.toHaveBeenCalled();
  });

  it("returns no override when the checkbox is on but nothing is ticked", async () => {
    expect(await resolve("includeChildLocations=true")).toBeUndefined();
    expect(getLocationDescendantIds).not.toHaveBeenCalled();
  });

  it("widens a ticked parent to itself plus descendants two levels deep", async () => {
    const ids = await resolve("location=campus&includeChildLocations=true");

    expect(ids).toBeDefined();
    expect([...ids!].sort()).toEqual(
      ["building-a", "building-b", "campus", "room-a1"].sort()
    );
  });

  it("widens each ticked location and lists an id once when trees overlap", async () => {
    const ids = await resolve(
      "location=campus&location=building-a&includeChildLocations=true"
    );

    expect([...ids!].sort()).toEqual(
      ["building-a", "building-b", "campus", "room-a1"].sort()
    );
  });

  it("leaves a ticked leaf as itself", async () => {
    expect(
      await resolve("location=building-b&includeChildLocations=true")
    ).toEqual(["building-b"]);
  });

  it("keeps without-location alongside the widened locations", async () => {
    const ids = await resolve(
      "location=without-location&location=building-a&includeChildLocations=true"
    );

    expect([...ids!].sort()).toEqual(
      ["building-a", "room-a1", "without-location"].sort()
    );
    // It names a state, not a location, so it is never looked up.
    expect(getLocationDescendantIds).toHaveBeenCalledTimes(1);
    expect(getLocationDescendantIds).toHaveBeenCalledWith({
      organizationId: ORG,
      locationId: "building-a",
    });
  });

  it("returns no override when without-location is the only tick", async () => {
    expect(
      await resolve("location=without-location&includeChildLocations=true")
    ).toBeUndefined();
    expect(getLocationDescendantIds).not.toHaveBeenCalled();
  });

  it("adds nothing for a location that belongs to another workspace", async () => {
    const ids = await resolve(
      "location=other-org-site&location=building-a&includeChildLocations=true"
    );

    // The lookup is scoped to the caller's workspace, never the id's owner.
    expect(getLocationDescendantIds).toHaveBeenCalledWith({
      organizationId: ORG,
      locationId: "other-org-site",
    });
    expect(ids).not.toContain("other-org-room");
    expect([...ids!].sort()).toEqual(
      ["building-a", "other-org-site", "room-a1"].sort()
    );
  });

  it("never empties the set when every ticked id resolves to nothing", async () => {
    // An empty set reads as "no location filter" to the query builders, which
    // would list every asset in the workspace. The unresolvable id stays, and
    // keeps matching nothing — the same result as with the checkbox off.
    expect(
      await resolve("location=other-org-site&includeChildLocations=true")
    ).toEqual(["other-org-site"]);
  });
});

describe("hasTickedLocationWithChildren", () => {
  function offered(query: string) {
    return hasTickedLocationWithChildren({
      organizationId: ORG,
      searchParams: new URLSearchParams(query),
    });
  }

  it("is true when a ticked location has child locations", async () => {
    vi.mocked(db.location.findFirst).mockResolvedValue({
      id: "building-a",
    } as never);

    expect(await offered("location=campus")).toBe(true);
    // Scoped to the caller's workspace, so another workspace's location
    // never counts as a parent here.
    expect(db.location.findFirst).toHaveBeenCalledWith({
      where: { organizationId: ORG, parentId: { in: ["campus"] } },
      select: { id: true },
    });
  });

  it("is false when no ticked location has child locations", async () => {
    vi.mocked(db.location.findFirst).mockResolvedValue(null);

    expect(await offered("location=building-b")).toBe(false);
  });

  it("does not depend on the checkbox being on", async () => {
    vi.mocked(db.location.findFirst).mockResolvedValue({
      id: "building-a",
    } as never);

    expect(await offered("location=campus&includeChildLocations=true")).toBe(
      true
    );
    expect(await offered("location=campus")).toBe(true);
  });

  it("asks only about real locations, never without-location", async () => {
    vi.mocked(db.location.findFirst).mockResolvedValue(null);

    await offered("location=without-location&location=building-a");

    expect(db.location.findFirst).toHaveBeenCalledWith({
      where: { organizationId: ORG, parentId: { in: ["building-a"] } },
      select: { id: true },
    });
  });

  it("is false without a query when no real location is ticked", async () => {
    expect(await offered("")).toBe(false);
    expect(await offered("location=without-location")).toBe(false);
    expect(await offered("includeChildLocations=true")).toBe(false);
    expect(db.location.findFirst).not.toHaveBeenCalled();
  });
});
