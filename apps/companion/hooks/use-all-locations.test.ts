/**
 * Tests for `useAllLocations`: which load's result the Location field keeps.
 *
 * Runs under `node --test`; the hook renders in a plain React test tree. Pages
 * come from a fake whose responses each test resolves by hand, so the order in
 * which loads finish is under the test's control.
 *
 * @see {@link file://./use-all-locations.ts}
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { act, createElement } from "react";
import { create } from "react-test-renderer";
import type { PageResult } from "../lib/fetch-all-pages";
import { useAllLocations } from "./use-all-locations";

type Loc = { id: string };
type Page = PageResult<{ locations: Loc[] }>;

/** One page request the fake received, answered when the test says so. */
type PendingPage = {
  orgId: string;
  page: number;
  resolve: (result: Page) => void;
};

/** A fake page endpoint whose requests wait for the test to answer them. */
// why: the real endpoint is the network; these tests need to decide when each
// page answers and with what, to play out slow, failed and superseded loads.
function fakeEndpoint() {
  const pending: PendingPage[] = [];
  const fetchPage = (orgId: string, page: number) =>
    new Promise<Page>((resolve) => pending.push({ orgId, page, resolve }));
  return { fetchPage, pending };
}

/** A page of `count` locations named after the workspace. */
function page(orgId: string, from: number, count: number, totalPages: number) {
  return {
    data: {
      locations: Array.from({ length: count }, (_, i) => ({
        id: `${orgId}-${from + i}`,
      })),
      totalPages,
    },
    error: null,
  };
}

/** Renders the hook for `orgId` and returns a handle to its latest result. */
function renderLoader(
  orgId: string | null,
  fetchPage: ReturnType<typeof fakeEndpoint>["fetchPage"]
) {
  const latest: { current: ReturnType<typeof useAllLocations<Loc>> | null } = {
    current: null,
  };
  function Probe({ org }: { org: string | null }) {
    latest.current = useAllLocations<Loc>(org, fetchPage);
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(Probe, { org: orgId }));
  });
  return {
    result: () => latest.current!,
    setOrg: (org: string | null) =>
      act(() => {
        renderer.update(createElement(Probe, { org }));
      }),
  };
}

/** Lets pending promise callbacks run. */
const flush = () => act(async () => {});

describe("useAllLocations", () => {
  it("keeps every page of the workspace", async () => {
    const { fetchPage, pending } = fakeEndpoint();
    const loader = renderLoader("A", fetchPage);

    act(() => void loader.result().loadLocations());
    pending.shift()!.resolve(page("A", 0, 100, 2));
    await flush();
    pending.shift()!.resolve(page("A", 100, 20, 2));
    await flush();

    assert.equal(loader.result().locations.length, 120);
    assert.equal(loader.result().isLocationsLoading, false);
  });

  it("drops a slow load for a previous workspace", async () => {
    const { fetchPage, pending } = fakeEndpoint();
    const loader = renderLoader("A", fetchPage);

    act(() => void loader.result().loadLocations());
    const slowA = pending.shift()!;
    loader.setOrg("B");
    act(() => void loader.result().loadLocations());
    pending.shift()!.resolve(page("B", 0, 3, 1));
    await flush();

    slowA.resolve(page("A", 0, 5, 1));
    await flush();

    assert.deepEqual(
      loader.result().locations.map((l) => l.id),
      ["B-0", "B-1", "B-2"]
    );
  });

  it("keeps the workspace's complete list when a reload fails on a later page", async () => {
    const { fetchPage, pending } = fakeEndpoint();
    const loader = renderLoader("A", fetchPage);

    act(() => void loader.result().loadLocations());
    pending.shift()!.resolve(page("A", 0, 100, 2));
    await flush();
    pending.shift()!.resolve(page("A", 100, 20, 2));
    await flush();

    act(() => void loader.result().loadLocations());
    pending.shift()!.resolve(page("A", 0, 100, 2));
    await flush();
    pending.shift()!.resolve({ error: "Network error" });
    await flush();

    assert.equal(loader.result().locations.length, 120);
  });

  it("does not keep a list cut off at the hard stop as complete", async () => {
    const { fetchPage, pending } = fakeEndpoint();
    const loader = renderLoader("A", fetchPage);

    // 60 pages exist; the walk stops after the hard stop (50).
    act(() => void loader.result().loadLocations());
    for (let p = 0; p < 50; p += 1) {
      pending.shift()!.resolve(page("A", p, 1, 60));
      await flush();
    }
    assert.equal(loader.result().locations.length, 50);

    // A reload that fails on page 2 shows what loaded, not the cut-off list.
    act(() => void loader.result().loadLocations());
    pending.shift()!.resolve(page("A", 0, 1, 60));
    await flush();
    pending.shift()!.resolve({ error: "Network error" });
    await flush();

    assert.equal(loader.result().locations.length, 1);
  });

  it("shows another workspace's partial list rather than the old workspace's", async () => {
    const { fetchPage, pending } = fakeEndpoint();
    const loader = renderLoader("A", fetchPage);

    act(() => void loader.result().loadLocations());
    pending.shift()!.resolve(page("A", 0, 10, 1));
    await flush();

    loader.setOrg("B");
    act(() => void loader.result().loadLocations());
    pending.shift()!.resolve(page("B", 0, 100, 2));
    await flush();
    pending.shift()!.resolve({ error: "Network error" });
    await flush();
    assert.ok(loader.result().locations.every((l) => l.id.startsWith("B-")));

    // Back to A, whose reload also fails: B's partial list must not stay.
    loader.setOrg("A");
    act(() => void loader.result().loadLocations());
    pending.shift()!.resolve({ error: "Network error" });
    await flush();
    assert.deepEqual(loader.result().locations, []);
  });

  it("empties the list and drops a load in flight when signed out", async () => {
    const { fetchPage, pending } = fakeEndpoint();
    const loader = renderLoader("A", fetchPage);

    act(() => void loader.result().loadLocations());
    const inFlight = pending.shift()!;
    loader.setOrg(null);
    act(() => void loader.result().loadLocations());

    inFlight.resolve(page("A", 0, 5, 1));
    await flush();

    assert.deepEqual(loader.result().locations, []);
    assert.equal(loader.result().isLocationsLoading, false);
  });
});
