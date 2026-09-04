import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider, useSetAtom } from "jotai";
import { createRoutesStub, Outlet, useNavigate } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { AtomsResetHandler } from "./atoms-reset-handler";
import {
  selectedBulkItemsAtom,
  selectionIsFormStateAtom,
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
 * Seeds once per mount, the way the `manage-*` screens do, and exposes a button
 * that changes the query string.
 *
 * why: a real navigation rather than a re-render with new `initialEntries` —
 * that prop is read once at mount, so re-rendering never changes the URL and
 * the test would pass without exercising anything. Clicking is also what the
 * user does: typing in the search box rewrites the query string in place.
 */
function Page({ isFormState }: { isFormState: boolean }) {
  const navigate = useNavigate();
  const setSelected = useSetAtom(setSelectedBulkItemsAtom);
  const setIsFormState = useSetAtom(selectionIsFormStateAtom);
  if (!seeded.done) {
    seeded.done = true;
    setSelected([{ id: "asset-amaran" }, { id: "asset-streamdeck" }]);
    if (isFormState) setIsFormState(true);
  }
  return (
    <button
      data-testid="go"
      onClick={(e) => navigate(`/assets?${e.currentTarget.value}`)}
    />
  );
}

let seeded = { done: false };

function renderAt(url: string, isFormState = false) {
  const store = createStore();
  const Stub = createRoutesStub([
    {
      path: "/assets",
      Component: Layout,
      children: [
        { index: true, Component: () => <Page isFormState={isFormState} /> },
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
    // The defect this prevents: a tick made before a search stayed selected
    // while its row was off screen, so the next bulk action reached an asset
    // the user could no longer see. That is how an Aputure Amaran ended up on
    // a "Stream Deck XL" asset model nobody chose.
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

  it("keeps a form-state selection across a filter change", () => {
    // On the manage-* screens a tick means "attached to this booking or kit".
    // Clearing on search would submit every attached item as removed.
    const { goTo, count } = renderAt("/assets?s=amaran", true);
    expect(count()).toBe(2);

    goTo("s=stream+deck");

    expect(count()).toBe(2);
  });

  it("ignores the order the filter params are written in", () => {
    // The signature is sorted, so a reshuffle is not a filter change.
    const { goTo, count } = renderAt("/assets?category=cam&s=amaran");
    expect(count()).toBe(2);

    goTo("s=amaran&category=cam");

    expect(count()).toBe(2);
  });
});
