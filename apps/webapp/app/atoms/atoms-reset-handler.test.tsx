import { act, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider, useSetAtom } from "jotai";
import { createRoutesStub, Outlet, useNavigate } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { AtomsResetHandler } from "./atoms-reset-handler";
import {
  seedFormSelectionAtom,
  selectedBulkItemsAtom,
  setSelectedBulkItemsAtom,
} from "./list";

/**
 * why: mirrors the real mounting. `AtomsResetHandler` sits in the layout as a
 * SIBLING ABOVE the route, so its render-time reset runs before the child route
 * seeds the selection. Rendering it inside the child would invert that order
 * and clear the seed, which is the hazard its own doc comment describes.
 */
function Layout() {
  return (
    <>
      <AtomsResetHandler />
      <Outlet />
    </>
  );
}

/**
 * Seeds once, the way the `manage-*` screens do, and exposes two buttons: one
 * that rewrites the query string in place and one that leaves for another
 * pathname.
 *
 * why: a real navigation rather than a re-render with new `initialEntries` —
 * that prop is read once at mount, so re-rendering never changes the URL and
 * the test would pass without exercising anything. Clicking is also what the
 * user does: typing in the search box rewrites the query string in place.
 */
function Page({ isFormState }: { isFormState: boolean }) {
  const navigate = useNavigate();
  const setSelected = useSetAtom(setSelectedBulkItemsAtom);
  const seedFormSelection = useSetAtom(seedFormSelectionAtom);
  if (!seeded.done) {
    seeded.done = true;
    const items = [{ id: "asset-amaran" }, { id: "asset-streamdeck" }];
    if (isFormState) {
      seedFormSelection(items);
    } else {
      setSelected(items);
    }
  }
  return (
    <>
      <button
        data-testid="go"
        onClick={(e) => navigate({ search: `?${e.currentTarget.value}` })}
      />
      <button
        data-testid="leave"
        onClick={(e) => navigate(e.currentTarget.value)}
      />
    </>
  );
}

let seeded = { done: false };

function renderAt(url: string, isFormState = false) {
  const store = createStore();
  // why: one pathless layout above both pages, so the handler stays mounted
  // across a pathname change exactly as it does under `_layout`.
  const Stub = createRoutesStub([
    {
      Component: Layout,
      children: [
        {
          path: "/assets",
          Component: () => <Page isFormState={isFormState} />,
        },
        {
          path: "/bookings/:bookingId/manage-assets",
          Component: () => <Page isFormState />,
        },
      ],
    },
  ]);
  render(
    <Provider store={store}>
      <Stub initialEntries={[url]} />
    </Provider>
  );
  return {
    goTo: (query: string) => {
      const btn = screen.getByTestId("go") as HTMLButtonElement;
      btn.value = query;
      fireEvent.click(btn);
    },
    leaveFor: (url: string) => {
      const btn = screen.getByTestId("leave") as HTMLButtonElement;
      btn.value = url;
      fireEvent.click(btn);
    },
    tick: (id: string) =>
      act(() => {
        store.set(setSelectedBulkItemsAtom, [{ id }]);
      }),
    // why: assert on the store, not rendered text. The seed happens during the
    // page's render, so a value read in that same render is always the pre-seed
    // one, and the test would be measuring React's timing rather than this
    // handler's behaviour.
    count: () => store.get(selectedBulkItemsAtom).length,
  };
}

describe("AtomsResetHandler", () => {
  beforeEach(() => {
    seeded = { done: false };
  });

  it("clears the selection when a filter changes", () => {
    // A tick must not outlive the filter it was made under: once its row is
    // off screen, a bulk action would still reach an asset the user cannot see.
    const { goTo, count } = renderAt("/assets?s=amaran");
    expect(count()).toBe(2);

    goTo("s=stream+deck");

    expect(count()).toBe(0);
  });

  it("keeps the selection when only the page changes", () => {
    // Selecting across pages is deliberate, so paging is not a filter change.
    const { goTo, count } = renderAt("/assets?s=amaran&page=1");
    expect(count()).toBe(2);

    goTo("s=amaran&page=2");

    expect(count()).toBe(2);
  });

  it("keeps the selection when only the page size changes", () => {
    // Page size re-slices the same result set, just like paging.
    const { goTo, count } = renderAt("/assets?s=amaran&per_page=20");
    expect(count()).toBe(2);

    goTo("s=amaran&per_page=50");

    expect(count()).toBe(2);
  });

  it("keeps a form-state selection across a filter change", () => {
    // On the manage-* screens a tick means "attached to this booking or kit".
    // Clearing on search would submit every attached item as removed.
    const { goTo, count } = renderAt("/assets?s=amaran", true);
    expect(count()).toBe(2);

    goTo("s=stream+deck");

    expect(count()).toBe(2);
  });

  it("does not carry a form-state opt-out onto the next page", () => {
    // The opt-out belongs to the screen that asked for it. If it survived the
    // navigation, every index visited afterwards would keep stale ticks.
    const { goTo, leaveFor, tick, count } = renderAt(
      "/bookings/b1/manage-assets?s=amaran"
    );
    expect(count()).toBe(2);

    leaveFor("/assets?s=amaran");
    tick("asset-amaran");
    expect(count()).toBe(1);

    goTo("s=stream+deck");

    expect(count()).toBe(0);
  });

  it("ignores the order the filter params are written in", () => {
    // The signature is sorted, so a reshuffle is not a filter change.
    const { goTo, count } = renderAt("/assets?category=cam&s=amaran");
    expect(count()).toBe(2);

    goTo("s=amaran&category=cam");

    expect(count()).toBe(2);
  });
});
