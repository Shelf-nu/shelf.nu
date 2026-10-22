/**
 * Pins the Sort popover of the advanced asset index: rules move with Alt+Arrow
 * on their handle, the ascending switch flips a rule's direction, and Apply
 * writes the rules to the URL as ordered `sortBy` params.
 *
 * @see {@link file://./../../../app/components/assets/assets-index/advanced-asset-index-filters-and-sorting.tsx}
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { AdvancedSorting } from "~/components/assets/assets-index/advanced-asset-index-filters-and-sorting";

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
