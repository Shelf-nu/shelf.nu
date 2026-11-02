/**
 * Pins the Sort popover of the advanced asset index: rules move with Alt+Arrow
 * on their handle, the ascending switch flips a rule's direction, and Apply
 * writes the rules to the URL as ordered `sortBy` params.
 *
 * @see {@link file://./../../../app/components/assets/assets-index/advanced-asset-index-filters-and-sorting.tsx}
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdvancedSorting } from "~/components/assets/assets-index/advanced-asset-index-filters-and-sorting";

const dragStart = vi.hoisted(() => vi.fn());
vi.mock("framer-motion", async () => ({
  ...(await vi.importActual<object>("framer-motion")),
  // why: real DragControls need layout measurement happy-dom does not provide;
  // the spy shows which pointer-down starts a drag.
  useDragControls: () => ({ start: dragStart, subscribe: () => () => {} }),
}));

/** Renders the popover next to the current query string, so tests can read it. */
function Page() {
  const { search } = useLocation();
  return (
    <>
      <output data-testid="search">{search}</output>
      <AdvancedSorting />
    </>
  );
}

async function renderSorting(search: string) {
  const Stub = createRoutesStub([
    {
      path: "/assets",
      Component: Page,
      loader: () => ({ settings: { mode: "ADVANCED", columns: [] } }),
    },
  ]);
  render(<Stub initialEntries={[`/assets${search}`]} />);
  fireEvent.click(await screen.findByRole("button", { name: /Sorted by 2/ }));
  await screen.findByRole("button", { name: "Reorder Status" });
}

function appliedSorts() {
  const search = screen.getByTestId("search").textContent ?? "";
  return new URLSearchParams(search).getAll("sortBy");
}

describe("AdvancedSorting", () => {
  beforeEach(() => dragStart.mockClear());

  it("starts a drag only from the handle, not from the rule text", async () => {
    await renderSorting("?sortBy=status:asc&sortBy=name:desc");
    const ruleText = screen.getByText("Status");

    fireEvent.pointerDown(ruleText);
    expect(dragStart).not.toHaveBeenCalled();
    // framer marks a row that drags from anywhere with touch-action: pan-x.
    expect(ruleText.closest("li")?.style.touchAction).not.toBe("pan-x");

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Reorder Status" })
    );
    expect(dragStart).toHaveBeenCalledTimes(1);
  });

  it("moves a rule with Alt+ArrowDown and applies the new order", async () => {
    await renderSorting("?sortBy=status:asc&sortBy=name:desc");

    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Status" }), {
      key: "ArrowDown",
      altKey: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply sorting" }));

    await waitFor(() =>
      expect(appliedSorts()).toEqual(["name:desc", "status:asc"])
    );
  });

  it("flips a rule's direction from the ascending switch", async () => {
    await renderSorting("?sortBy=status:asc&sortBy=name:desc");

    fireEvent.click(screen.getAllByRole("switch")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Apply sorting" }));

    await waitFor(() =>
      expect(appliedSorts()).toEqual(["status:desc", "name:desc"])
    );
  });
});
